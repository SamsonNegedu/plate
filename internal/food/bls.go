package food

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

const maxBLSBytes = 100 << 20

var blsCodeRe = regexp.MustCompile(`^[A-Z][A-Z0-9]{6}$`)

// BLSImport reports an import of the Bundeslebensmittelschlüssel.
type BLSImport struct {
	Added, Updated, Skipped, Protected int
}

// blsColumns maps BLS component codes to the value column index, found from header text such as
// "ENERCC Energie (Kilokalorien) [kcal/100g]".
type blsColumns struct {
	code, name                                                        int
	kcal, kj, protein, carbs, fat, fiber, sugar, satfat, salt, sodium int
}

func findBLSColumns(head []string) (blsColumns, error) {
	c := blsColumns{code: -1, name: -1, kcal: -1, kj: -1, protein: -1, carbs: -1, fat: -1, fiber: -1, sugar: -1, satfat: -1, salt: -1, sodium: -1}
	for i, h := range head {
		h = strings.TrimSpace(h)
		switch {
		case h == "BLS Code":
			c.code = i
		case h == "Lebensmittelbezeichnung":
			c.name = i
		case isValueHeader(h, "ENERCC"):
			c.kcal = i
		case isValueHeader(h, "ENERCJ"):
			c.kj = i
		case isValueHeader(h, "PROT625"):
			c.protein = i
		case isValueHeader(h, "CHO"):
			c.carbs = i
		case isValueHeader(h, "FAT"):
			c.fat = i
		case isValueHeader(h, "FIBT"):
			c.fiber = i
		case isValueHeader(h, "SUGAR"):
			c.sugar = i
		case isValueHeader(h, "FASAT"):
			c.satfat = i
		case isValueHeader(h, "NACL"):
			c.salt = i
		case isValueHeader(h, "NA"):
			c.sodium = i
		}
	}
	if c.code < 0 || c.name < 0 || (c.kcal < 0 && c.kj < 0) {
		return c, errors.New("worksheet lacks the BLS code, name or energy columns; is this the BLS 4.0 data file?")
	}
	return c, nil
}

// isValueHeader matches the value column of a component ("CODE ... [unit/100g]"), not its origin or reference columns.
func isValueHeader(h, code string) bool {
	return strings.HasPrefix(h, code+" ") && strings.HasSuffix(h, "/100g]")
}

func cell(row []string, i int) *float64 {
	if i < 0 || i >= len(row) {
		return nil
	}
	s := strings.TrimSpace(strings.ReplaceAll(row[i], ",", "."))
	if s == "" {
		return nil
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil
	}
	return &v
}

// ImportBLS reads the BLS 4.0 data file (.xlsx) and upserts generic foods for the user by BLS code. It is idempotent:
// it updates earlier imports in place and never touches a row the user corrected. Missing values stay NULL.
func ImportBLS(ctx context.Context, db *sql.DB, userID, path string, log *slog.Logger) (BLSImport, error) {
	info, err := os.Stat(path) // #nosec G703 -- the path is the operator's PLATE_IMPORT_BLS_PATH
	if err != nil {
		return BLSImport{}, fmt.Errorf("BLS file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxBLSBytes {
		return BLSImport{}, errors.New("BLS file is not a regular file under the size limit")
	}

	var foods []domain.Food
	var cols blsColumns
	var res BLSImport
	first := true
	now := time.Now().UTC()
	err = xlsxRows(path, func(row []string) error {
		if first {
			first = false
			var err error
			cols, err = findBLSColumns(row)
			return err
		}
		f, ok := blsFood(row, cols, userID, now)
		if !ok {
			res.Skipped++
			return nil
		}
		foods = append(foods, f)
		return nil
	})
	if err != nil {
		return BLSImport{}, fmt.Errorf("reading BLS file: %w", err)
	}
	if len(foods) == 0 {
		return BLSImport{}, errors.New("BLS file contains no usable foods")
	}

	err = store.InTx(ctx, db, func(r *store.Repo) error {
		res.Added, res.Updated, res.Protected = 0, 0, 0
		for _, f := range foods {
			code := *f.SourceID
			if _, err := r.FoodBySource(ctx, userID, domain.SourceUser, code); err == nil {
				res.Protected++ // a correction of this food wins forever
				continue
			} else if !errors.Is(err, domain.ErrNotFound) {
				return err
			}
			existing, err := r.FoodBySource(ctx, userID, domain.SourceBLS, code)
			switch {
			case err == nil:
				f.ID, f.CreatedAt = existing.ID, existing.CreatedAt
				res.Updated++
			case errors.Is(err, domain.ErrNotFound):
				id, err := uuid.NewV7()
				if err != nil {
					return fmt.Errorf("generating food id: %w", err)
				}
				f.ID = id.String()
				res.Added++
			default:
				return err
			}
			if err := r.PutFood(ctx, f); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return BLSImport{}, fmt.Errorf("importing BLS: %w", err)
	}
	log.InfoContext(ctx, "BLS imported", slog.Int("added", res.Added), slog.Int("updated", res.Updated),
		slog.Int("skipped", res.Skipped), slog.Int("protected", res.Protected))
	return res, nil
}

func blsFood(row []string, c blsColumns, userID string, now time.Time) (domain.Food, bool) {
	if c.code >= len(row) || c.name >= len(row) {
		return domain.Food{}, false
	}
	code := strings.TrimSpace(row[c.code])
	name := cleanName(row[c.name])
	if !blsCodeRe.MatchString(code) || name == "" {
		return domain.Food{}, false
	}
	kcal := cell(row, c.kcal)
	if kcal == nil {
		if kj := cell(row, c.kj); kj != nil {
			k := *kj / kjPerKcal
			kcal = &k
		}
	}
	if kcal == nil {
		return domain.Food{}, false
	}
	salt := cell(row, c.salt)
	if salt == nil {
		if na := cell(row, c.sodium); na != nil {
			s := *na / 1000 * 2.5
			salt = &s
		}
	}
	n, ok := SanitizeNutrients(domain.Nutrients{
		Kcal: *kcal, Protein: cell(row, c.protein), Carbs: cell(row, c.carbs), Fat: cell(row, c.fat),
		Sugar: cell(row, c.sugar), SatFat: cell(row, c.satfat), Fiber: cell(row, c.fiber), Salt: salt,
	})
	if !ok {
		return domain.Food{}, false
	}
	ts := now.Format(time.RFC3339)
	return domain.Food{
		UserID: userID, Name: name, Per100: n, Source: domain.SourceBLS, SourceID: &code,
		SourceCheckedAt: &ts, SearchName: domain.SearchName(name), CreatedAt: ts, UpdatedAt: ts,
	}, true
}
