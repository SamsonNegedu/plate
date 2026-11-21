package food

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

// MaxSeedBytes caps the seed file we are willing to open.
var MaxSeedBytes int64 = 512 << 20

const seedSchema = `
CREATE TABLE catalog_foods (
	barcode          TEXT PRIMARY KEY,
	name             TEXT NOT NULL,
	brand            TEXT NOT NULL DEFAULT '',
	quantity         TEXT NOT NULL DEFAULT '',
	serving_size     TEXT NOT NULL DEFAULT '',
	serving_grams    REAL,
	kcal_100g        REAL NOT NULL,
	protein_100g     REAL,
	carbs_100g       REAL,
	fat_100g         REAL,
	sugar_100g       REAL,
	satfat_100g      REAL,
	fiber_100g       REAL,
	salt_100g        REAL,
	nutriscore       TEXT,
	image_source_url TEXT,
	scans            INTEGER NOT NULL DEFAULT 0,
	category         TEXT
) WITHOUT ROWID;
CREATE TABLE category_stats (
	category TEXT PRIMARY KEY,
	n        INTEGER NOT NULL,
	ranges   TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE catalog_meta (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
) WITHOUT ROWID;
`

const seedColumns = `barcode, name, brand, quantity, serving_size, serving_grams, kcal_100g, protein_100g, carbs_100g,
	fat_100g, sugar_100g, satfat_100g, fiber_100g, salt_100g, nutriscore, image_source_url, scans, category`

// SeedMeta describes a seed release.
type SeedMeta struct {
	DatasetVersion string
	BuiltAt        string
	Source         string
}

// WriteSeed writes a distributable seed file: the catalog table and its metadata, nothing else.
// The tool in tools/catalog and the importer tests both use it.
func WriteSeed(path string, rows []domain.CatalogFood, meta SeedMeta) error {
	return WriteSeedWithStats(path, rows, nil, meta)
}

// WriteSeedWithStats is WriteSeed plus the per-category ranges the products' `category` values refer to.
func WriteSeedWithStats(path string, rows []domain.CatalogFood, stats []domain.CategoryStats, meta SeedMeta) error {
	ctx := context.Background()
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("removing old seed: %w", err)
	}
	db, err := store.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	if _, err := db.ExecContext(ctx, "PRAGMA journal_mode = DELETE"); err != nil {
		return fmt.Errorf("setting journal mode: %w", err)
	}
	if _, err := db.ExecContext(ctx, seedSchema); err != nil {
		return fmt.Errorf("creating seed schema: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("starting seed transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO catalog_foods (`+seedColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return fmt.Errorf("preparing seed insert: %w", err)
	}
	defer func() { _ = stmt.Close() }()
	for _, c := range rows {
		_, err := stmt.ExecContext(ctx, c.Barcode, c.Name, c.Brand, c.Quantity, c.ServingSize, c.ServingGrams, c.Per100.Kcal,
			c.Per100.Protein, c.Per100.Carbs, c.Per100.Fat, c.Per100.Sugar, c.Per100.SatFat, c.Per100.Fiber, c.Per100.Salt,
			c.Nutriscore, c.ImageSourceURL, c.Scans, optionalText(c.Category))
		if err != nil {
			return fmt.Errorf("writing seed row %s: %w", c.Barcode, err)
		}
	}
	for _, st := range stats {
		b, err := json.Marshal(st.Ranges)
		if err != nil {
			return fmt.Errorf("encoding ranges of %s: %w", st.Category, err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO category_stats(category, n, ranges) VALUES (?, ?, ?)`, st.Category, st.N, string(b)); err != nil {
			return fmt.Errorf("writing category stats: %w", err)
		}
	}
	for k, v := range map[string]string{
		"dataset_version": meta.DatasetVersion, "built_at": meta.BuiltAt, "row_count": strconv.Itoa(len(rows)), "source": meta.Source,
	} {
		if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_meta(key, value) VALUES (?, ?)`, k, v); err != nil {
			return fmt.Errorf("writing seed meta: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("committing seed: %w", err)
	}
	return nil
}

// ImportResult reports a catalog import.
type CatalogImport struct {
	Version  string
	Rows     int
	Skipped  int
	Duration time.Duration
}

// ImportCatalog replaces catalog_foods from a seed file in one transaction. The file is untrusted: it is opened read-only,
// its structure is checked first (no triggers, views or unexpected tables), and rows are copied into the app-owned
// table one by one, validated. Any failure leaves the previous catalog intact.
func ImportCatalog(ctx context.Context, db *sql.DB, path string, log *slog.Logger) (CatalogImport, error) {
	start := time.Now()
	info, err := os.Stat(path) // #nosec G703 -- the path is the operator's PLATE_IMPORT_CATALOG_PATH
	if err != nil {
		return CatalogImport{}, fmt.Errorf("seed file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return CatalogImport{}, errors.New("seed file is not a regular file")
	}
	if info.Size() > MaxSeedBytes {
		return CatalogImport{}, fmt.Errorf("seed file is %d bytes; the limit is %d", info.Size(), MaxSeedBytes)
	}
	seed, err := sql.Open("sqlite", "file:"+url.PathEscape(path)+"?mode=ro&immutable=1")
	if err != nil {
		return CatalogImport{}, fmt.Errorf("opening seed read-only: %w", err)
	}
	defer func() { _ = seed.Close() }()
	seed.SetMaxOpenConns(1)

	meta, err := validateSeed(ctx, seed)
	if err != nil {
		return CatalogImport{}, err
	}
	version := meta["dataset_version"]

	stats := readCategoryStats(ctx, seed)
	var res CatalogImport
	res.Version = version
	now := time.Now().UTC().Format(time.RFC3339)
	err = store.InTx(ctx, db, func(r *store.Repo) error {
		res.Rows, res.Skipped = 0, 0
		if err := r.ClearCatalog(ctx); err != nil {
			return err
		}
		rows, err := seed.QueryContext(ctx, `SELECT `+seedColumnsFor(seed)+` FROM catalog_foods`) //nolint:gosec // the column list is fixed by the seed schema, not user input
		if err != nil {
			return fmt.Errorf("reading seed rows: %w", err)
		}
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			c, ok, err := scanSeedRow(rows)
			if err != nil {
				return err
			}
			if !ok {
				res.Skipped++
				continue
			}
			c.DatasetVersion, c.ImportedAt = version, now
			if err := r.PutCatalogFood(ctx, c, now); err != nil {
				return err
			}
			res.Rows++
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("reading seed rows: %w", err)
		}
		if res.Rows == 0 {
			return errors.New("seed contains no usable rows; the previous catalog is kept")
		}
		if err := r.ReplaceCategoryStats(ctx, stats); err != nil {
			return err
		}
		n, err := r.CountCatalog(ctx)
		if err != nil {
			return err
		}
		res.Rows = int(n) // duplicates collapse, last one wins
		for k, v := range map[string]string{
			"dataset_version": version, "built_at": meta["built_at"], "source": meta["source"],
			"imported_at": now, "row_count": strconv.Itoa(res.Rows),
		} {
			if err := r.SetCatalogMeta(ctx, k, v); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return CatalogImport{}, fmt.Errorf("importing catalog: %w", err)
	}
	res.Duration = time.Since(start)
	log.InfoContext(ctx, "catalog imported", slog.String("version", version), slog.Int("rows", res.Rows),
		slog.Int("skipped", res.Skipped), slog.Duration("took", res.Duration))
	return res, nil
}

var allowedSeedTables = map[string]bool{"catalog_foods": true, "catalog_meta": true, "category_stats": true}

// validateSeed checks structure and metadata without trusting anything in the file.
func validateSeed(ctx context.Context, seed *sql.DB) (map[string]string, error) {
	rows, err := seed.QueryContext(ctx, `SELECT type, name FROM sqlite_master`)
	if err != nil {
		return nil, fmt.Errorf("seed is not a readable SQLite file: %w", err)
	}
	defer func() { _ = rows.Close() }()
	tables := map[string]bool{}
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			return nil, fmt.Errorf("reading seed schema: %w", err)
		}
		switch typ {
		case "table":
			if !allowedSeedTables[name] {
				return nil, fmt.Errorf("seed contains an unexpected table %q", name)
			}
			tables[name] = true
		case "index":
		default:
			return nil, fmt.Errorf("seed contains a %s %q, which is not allowed", typ, name)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading seed schema: %w", err)
	}
	if !tables["catalog_foods"] || !tables["catalog_meta"] {
		return nil, errors.New("seed lacks catalog_foods or catalog_meta")
	}
	if err := probeColumns(ctx, seed); err != nil {
		return nil, err
	}

	meta := map[string]string{}
	mrows, err := seed.QueryContext(ctx, `SELECT key, value FROM catalog_meta`)
	if err != nil {
		return nil, fmt.Errorf("reading seed metadata: %w", err)
	}
	defer func() { _ = mrows.Close() }()
	for mrows.Next() {
		var k, v string
		if err := mrows.Scan(&k, &v); err != nil {
			return nil, fmt.Errorf("reading seed metadata: %w", err)
		}
		meta[k] = v
	}
	if err := mrows.Err(); err != nil {
		return nil, fmt.Errorf("reading seed metadata: %w", err)
	}
	for _, k := range []string{"dataset_version", "built_at", "row_count", "source"} {
		if strings.TrimSpace(meta[k]) == "" {
			return nil, fmt.Errorf("seed metadata lacks %q", k)
		}
	}
	if n, err := strconv.Atoi(meta["row_count"]); err != nil || n <= 0 {
		return nil, errors.New("seed row_count is not a positive number")
	}
	return meta, nil
}

// scanSeedRow reads one row and reports whether it is usable. Unusable rows are skipped, never repaired.
func probeColumns(ctx context.Context, seed *sql.DB) error {
	probe, err := seed.QueryContext(ctx, `SELECT `+seedColumnsFor(seed)+` FROM catalog_foods LIMIT 1`) //nolint:gosec // the column list is fixed by the seed schema, not user input
	if err != nil {
		return fmt.Errorf("seed has the wrong columns: %w", err)
	}
	defer func() { _ = probe.Close() }()
	return probe.Err()
}

func scanSeedRow(rows *sql.Rows) (domain.CatalogFood, bool, error) {
	var (
		barcode, name, brand, quantity, servingSize         sql.NullString
		c                                                   domain.CatalogFood
		kcal                                                sql.NullFloat64
		serving, protein, carbs, fat, sugar, sat, fib, salt sql.NullFloat64
		nutri, image, category                              sql.NullString
		scans                                               sql.NullInt64
	)
	err := rows.Scan(&barcode, &name, &brand, &quantity, &servingSize, &serving, &kcal, &protein, &carbs, &fat,
		&sugar, &sat, &fib, &salt, &nutri, &image, &scans, &category)
	if err != nil {
		return domain.CatalogFood{}, false, fmt.Errorf("scanning seed row: %w", err)
	}
	if !kcal.Valid {
		return domain.CatalogFood{}, false, nil
	}
	code, _, err := NormalizeBarcode(barcode.String)
	if err != nil || len(code) < 8 || code != barcode.String {
		return domain.CatalogFood{}, false, nil //nolint:nilerr // an unusable row is skipped, not an error
	}
	c.Barcode = code
	c.Name, c.Brand = cleanName(name.String), cleanName(brand.String)
	c.Quantity, c.ServingSize = truncate(strings.TrimSpace(quantity.String), 100), truncate(strings.TrimSpace(servingSize.String), 100)
	if c.Name == "" {
		return domain.CatalogFood{}, false, nil
	}
	nf := func(v sql.NullFloat64) *float64 {
		if !v.Valid {
			return nil
		}
		x := v.Float64
		return &x
	}
	n, ok := SanitizeNutrients(domain.Nutrients{
		Kcal: kcal.Float64, Protein: nf(protein), Carbs: nf(carbs), Fat: nf(fat), Sugar: nf(sugar), SatFat: nf(sat),
		Fiber: nf(fib), Salt: nf(salt),
	})
	if !ok {
		return domain.CatalogFood{}, false, nil
	}
	c.Per100 = n
	c.ServingGrams = nf(serving)
	if c.ServingGrams != nil && *c.ServingGrams <= 0 {
		c.ServingGrams = nil
	}
	if nutri.Valid {
		c.Nutriscore = nutriscore(nutri.String)
	}
	if image.Valid && AllowedImageURL(image.String) {
		s := image.String
		c.ImageSourceURL = &s
	}
	c.Scans = scans.Int64
	c.Category = cleanCategory(category.String)
	return c, true, nil
}

func optionalText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// seedColumnsFor lists the columns to read. A seed built before categories existed has no category column; it reads as NULL.
func seedColumnsFor(seed *sql.DB) string {
	rows, err := seed.QueryContext(context.Background(), `PRAGMA table_info(catalog_foods)`)
	if err != nil {
		return seedColumns
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var cid int
		var name, typ string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notnull, &dflt, &pk); err != nil {
			return seedColumns
		}
		if name == "category" {
			return seedColumns
		}
	}
	if err := rows.Err(); err != nil {
		return seedColumns
	}
	return strings.TrimSuffix(seedColumns, ", category") + ", NULL"
}

var categoryTagRe = regexp.MustCompile(`^[a-z]{2,3}:[^\s,;"']{1,100}$`)

// cleanCategory keeps a category tag only if it looks like one. It is data from a file we do not trust.
func cleanCategory(s string) string {
	s = strings.TrimSpace(s)
	if categoryTagRe.MatchString(s) {
		return s
	}
	return ""
}

// RangeKeys are the nutrients a category's ranges describe.
var RangeKeys = []string{"kcal", "fat", "protein", "carbs", "salt"}

// readCategoryStats reads the seed's ranges, skipping anything malformed: a bad row costs one category's warning, not the import.
func readCategoryStats(ctx context.Context, seed *sql.DB) []domain.CategoryStats {
	var present int
	if err := seed.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'category_stats'`).Scan(&present); err != nil || present == 0 {
		return nil
	}
	rows, err := seed.QueryContext(ctx, `SELECT category, n, ranges FROM category_stats`)
	if err != nil {
		return nil
	}
	defer func() { _ = rows.Close() }()
	var out []domain.CategoryStats
	for rows.Next() {
		var tag, ranges string
		var n int
		if err := rows.Scan(&tag, &n, &ranges); err != nil || cleanCategory(tag) == "" || n <= 0 {
			continue
		}
		var raw map[string][3]float64
		if err := json.Unmarshal([]byte(ranges), &raw); err != nil {
			continue
		}
		clean := map[string][3]float64{}
		for _, k := range RangeKeys {
			if r, ok := raw[k]; ok && r[0] <= r[1] && r[1] <= r[2] && r[0] >= 0 && r[2] < 1e5 {
				clean[k] = r
			}
		}
		if len(clean) > 0 {
			out = append(out, domain.CategoryStats{Category: tag, N: n, Ranges: clean})
		}
	}
	if err := rows.Err(); err != nil {
		return nil
	}
	return out
}
