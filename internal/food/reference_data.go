package food

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed" // the shipped table
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

// The generic-food tables the app ships, one file per source, all in the same shape (see referenceHeader). The FAO
// file is the FAO/INFOODS West African table, cleaned and given local names by tools/wafct; the USDA file is a short
// list from USDA FoodData Central built by tools/usda. internal/food/data/NOTICE.md has their sources and terms.
//
//go:embed data/wafct_2019.csv
var wafctCSV []byte

//go:embed data/usda_sr_legacy.csv
var usdaCSV []byte

var referenceHeader = []string{
	"ref_id", "name", "local_names", "scientific_name", "category",
	"kcal", "protein", "carbs", "sugar", "fat", "satfat", "fiber", "salt", "estimated", "source",
}

func fmtFloat(v *float64) string {
	if v == nil {
		return ""
	}
	return strconv.FormatFloat(*v, 'g', -1, 64)
}

// WriteReferenceCSV writes foods as the shipped CSV. A missing value is an empty cell, never 0.
func WriteReferenceCSV(w io.Writer, foods []domain.ReferenceFood) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(referenceHeader); err != nil {
		return fmt.Errorf("writing header: %w", err)
	}
	for _, f := range foods {
		kcal := f.Per100.Kcal
		est := "0"
		if f.Estimated {
			est = "1"
		}
		row := []string{
			f.RefID, f.Name, f.LocalNames, f.ScientificName, f.Category,
			fmtFloat(&kcal), fmtFloat(f.Per100.Protein), fmtFloat(f.Per100.Carbs), fmtFloat(f.Per100.Sugar), fmtFloat(f.Per100.Fat),
			fmtFloat(f.Per100.SatFat), fmtFloat(f.Per100.Fiber), fmtFloat(f.Per100.Salt), est, f.Source,
		}
		if err := cw.Write(row); err != nil {
			return fmt.Errorf("writing %s: %w", f.RefID, err)
		}
	}
	cw.Flush()
	return cw.Error()
}

func parseCell(s string) (*float64, error) {
	if s == "" {
		return nil, nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil, fmt.Errorf("not a number: %q", s)
	}
	return &v, nil
}

// ReadReferenceCSV reads the shipped table. Every row must be loggable and pass the same sanity checks as an import.
func ReadReferenceCSV(r io.Reader, version string, now time.Time) ([]domain.ReferenceFood, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = len(referenceHeader)
	head, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}
	if strings.Join(head, ",") != strings.Join(referenceHeader, ",") {
		return nil, errors.New("reference table has an unexpected header")
	}
	ts := now.UTC().Format(time.RFC3339)
	var out []domain.ReferenceFood
	for line := 2; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line, err)
		}
		cells := make([]*float64, 8)
		for i := range cells {
			if cells[i], err = parseCell(rec[5+i]); err != nil {
				return nil, fmt.Errorf("line %d: %w", line, err)
			}
		}
		if cells[0] == nil {
			return nil, fmt.Errorf("line %d: %s has no energy", line, rec[0])
		}
		n, ok := SanitizeNutrients(domain.Nutrients{
			Kcal: *cells[0], Protein: cells[1], Carbs: cells[2], Sugar: cells[3], Fat: cells[4], SatFat: cells[5], Fiber: cells[6], Salt: cells[7],
		})
		if !ok || rec[0] == "" || rec[1] == "" || rec[14] == "" {
			return nil, fmt.Errorf("line %d: %s is not a valid food", line, rec[0])
		}
		out = append(out, domain.ReferenceFood{
			RefID: rec[0], Name: rec[1], LocalNames: rec[2], ScientificName: rec[3], Category: rec[4], Per100: n,
			Estimated: rec[13] == "1", Source: rec[14], DatasetVersion: version, ImportedAt: ts,
		})
	}
}

// referenceVersion names this build of the tables: a hash of the shipped files, so editing a local name or a value
// brings every database up to date on the next start.
func referenceVersion() string {
	sum := sha256.Sum256(append(append([]byte{}, wafctCSV...), usdaCSV...))
	return "ref-" + hex.EncodeToString(sum[:5])
}

// EnsureReference loads the shipped generic foods into the shared reference table when the table is empty or holds
// another version. It does nothing on an up-to-date database.
func EnsureReference(ctx context.Context, db *sql.DB, log *slog.Logger) error {
	return ensureReference(ctx, db, [][]byte{wafctCSV, usdaCSV}, referenceVersion(), log)
}

func ensureReference(ctx context.Context, db *sql.DB, files [][]byte, version string, log *slog.Logger) error {
	repo := store.NewRepo(db)
	have, err := repo.ReferenceVersion(ctx)
	if err != nil {
		return err
	}
	if have == version {
		return nil
	}
	var foods []domain.ReferenceFood
	for _, data := range files {
		part, err := ReadReferenceCSV(bytes.NewReader(data), version, time.Now())
		if err != nil {
			return fmt.Errorf("shipped reference foods: %w", err)
		}
		foods = append(foods, part...)
	}
	if err := store.InTx(ctx, db, func(r *store.Repo) error { return r.ReplaceReference(ctx, foods) }); err != nil {
		return fmt.Errorf("loading reference foods: %w", err)
	}
	log.InfoContext(ctx, "reference foods loaded", slog.Int("foods", len(foods)), slog.String("version", version))
	return nil
}
