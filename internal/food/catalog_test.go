package food

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"plate/internal/domain"
	"plate/internal/store"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func cf(barcode, name string, kcal float64) domain.CatalogFood {
	return domain.CatalogFood{Barcode: barcode, Name: name, Brand: "Marke", Per100: domain.Nutrients{Kcal: kcal}, Scans: 10}
}

func seedFile(t *testing.T, rows []domain.CatalogFood, version string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "seed.db")
	if err := WriteSeed(p, rows, SeedMeta{DatasetVersion: version, BuiltAt: "2026-11-13T00:00:00Z", Source: "Open Food Facts (ODbL)"}); err != nil {
		t.Fatal(err)
	}
	return p
}

// rawSeed builds a seed with arbitrary SQL, for hostile or malformed files.
func rawSeed(t *testing.T, stmts ...string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "raw.db")
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	return p
}

const looseSchema = `CREATE TABLE catalog_foods (barcode TEXT, name TEXT, brand TEXT, quantity TEXT, serving_size TEXT, serving_grams REAL,
	kcal_100g REAL, protein_100g REAL, carbs_100g REAL, fat_100g REAL, sugar_100g REAL, satfat_100g REAL, fiber_100g REAL,
	salt_100g REAL, nutriscore TEXT, image_source_url TEXT, scans INTEGER);
	CREATE TABLE catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`

const goodMeta = `INSERT INTO catalog_meta VALUES ('dataset_version','v9'),('built_at','2026-11-13'),('row_count','3'),('source','OFF')`

func catalogCount(t *testing.T, x *fx) int {
	t.Helper()
	n, err := x.r.CountCatalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func TestImportReplacesTheCatalogAndBuildsSearch(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	p := seedFile(t, []domain.CatalogFood{cf("3017620422003", "Nutella", 539), cf("4000000000011", "Joghurt", 61)}, "2026-11")
	res, err := ImportCatalog(ctx, x.db, p, quiet())
	if err != nil || res.Rows != 2 || res.Version != "2026-11" {
		t.Fatalf("res = %+v, %v", res, err)
	}
	c, err := x.r.CatalogByBarcode(ctx, "3017620422003")
	if err != nil || c.Per100.Kcal != 539 || c.DatasetVersion != "2026-11" || c.ImportedAt == "" {
		t.Fatalf("row = %+v, %v", c, err)
	}
	if v, _ := x.r.CatalogMeta(ctx, "dataset_version"); v != "2026-11" {
		t.Fatalf("meta version = %q", v)
	}
	hits, err := x.svc.Search(ctx, uid, "nutella")
	if err != nil || len(hits) != 1 {
		t.Fatalf("search after import: %v %v", hits, err)
	}
}

func TestReimportIsIdempotentAndReplacesOldRows(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	if _, err := ImportCatalog(ctx, x.db, seedFile(t, []domain.CatalogFood{cf("4000000000011", "Alt", 1), cf("4000000000012", "Weg", 1)}, "v1"), quiet()); err != nil {
		t.Fatal(err)
	}
	p := seedFile(t, []domain.CatalogFood{cf("4000000000011", "Neu", 2), cf("4000000000013", "Dazu", 3)}, "v2")
	for range 2 {
		if _, err := ImportCatalog(ctx, x.db, p, quiet()); err != nil {
			t.Fatal(err)
		}
	}
	if catalogCount(t, x) != 2 {
		t.Fatalf("rows = %d", catalogCount(t, x))
	}
	if _, err := x.r.CatalogByBarcode(ctx, "4000000000012"); err == nil {
		t.Fatal("a row missing from the new seed must be gone")
	}
	if c, _ := x.r.CatalogByBarcode(ctx, "4000000000011"); c.Name != "Neu" {
		t.Fatalf("name = %q", c.Name)
	}
	if hits, _ := x.svc.Search(ctx, uid, "alt"); len(hits) != 0 {
		t.Fatalf("the old row still appears in search: %v", hits)
	}
	var dup int
	_ = x.db.QueryRow(`SELECT count(*) FROM catalog_fts WHERE catalog_fts MATCH '"neu"'`).Scan(&dup)
	if dup != 1 {
		t.Fatalf("fts rows for 'neu' = %d", dup)
	}
}

func TestDuplicateBarcodesResolveLastWins(t *testing.T) {
	x := newFx(t)
	p := rawSeed(t, looseSchema, goodMeta,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','Erste',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','Zweite',20)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000012','Andere',30)`)
	if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err != nil {
		t.Fatal(err)
	}
	c, _ := x.r.CatalogByBarcode(context.Background(), "4000000000011")
	if c.Name != "Zweite" || c.Per100.Kcal != 20 || catalogCount(t, x) != 2 {
		t.Fatalf("row = %+v count = %d", c, catalogCount(t, x))
	}
}

func TestRowsWithoutKcalOrWithBadDataAreSkipped(t *testing.T) {
	x := newFx(t)
	p := rawSeed(t, looseSchema, goodMeta,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','Gut',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000012','Ohne kcal',NULL)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('','Leerer Code',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('abcdefgh','Buchstaben',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('123','Zu kurz',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000013','  ',10)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000014','Absurd',99999)`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g,fat_100g) VALUES ('4000000000015','Fett 500g',100,500)`)
	res, err := ImportCatalog(context.Background(), x.db, p, quiet())
	if err != nil || res.Rows != 1 || res.Skipped != 7 {
		t.Fatalf("res = %+v, %v", res, err)
	}
	if catalogCount(t, x) != 1 {
		t.Fatal("only the valid row may be imported")
	}
}

func TestOnlyAllowlistedImageURLsSurvive(t *testing.T) {
	x := newFx(t)
	p := rawSeed(t, looseSchema, goodMeta,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g,image_source_url) VALUES ('4000000000011','A',1,'https://images.openfoodfacts.org/images/products/1/front.jpg')`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g,image_source_url) VALUES ('4000000000012','B',1,'http://169.254.169.254/latest/meta-data')`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g,image_source_url) VALUES ('4000000000013','C',1,'https://evil.example/images/x.jpg')`,
		`INSERT INTO catalog_foods(barcode,name,kcal_100g,image_source_url) VALUES ('4000000000014','D',1,'https://images.openfoodfacts.org@evil.example/images/x.jpg')`)
	if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err != nil {
		t.Fatal(err)
	}
	for bc, want := range map[string]bool{"4000000000011": true, "4000000000012": false, "4000000000013": false, "4000000000014": false} {
		c, _ := x.r.CatalogByBarcode(context.Background(), bc)
		if (c.ImageSourceURL != nil) != want {
			t.Errorf("%s: image = %v, want present=%v", bc, c.ImageSourceURL, want)
		}
	}
}

func TestBadSeedFilesLeaveThePreviousCatalogIntact(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	if _, err := ImportCatalog(ctx, x.db, seedFile(t, []domain.CatalogFood{cf("4000000000011", "Behalten", 1)}, "v1"), quiet()); err != nil {
		t.Fatal(err)
	}
	notSQLite := filepath.Join(t.TempDir(), "junk.db")
	_ = os.WriteFile(notSQLite, []byte(strings.Repeat("not a database ", 100)), 0o600)

	bad := map[string]string{
		"not a sqlite file": notSQLite,
		"missing file":      filepath.Join(t.TempDir(), "nope.db"),
		"trigger":           rawSeed(t, looseSchema, goodMeta, `INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','X',1)`, `CREATE TRIGGER t AFTER INSERT ON catalog_foods BEGIN SELECT 1; END`),
		"view":              rawSeed(t, looseSchema, goodMeta, `CREATE VIEW v AS SELECT 1`),
		"extra table":       rawSeed(t, looseSchema, goodMeta, `CREATE TABLE users (x)`),
		"missing meta":      rawSeed(t, looseSchema, `INSERT INTO catalog_meta VALUES ('dataset_version','v')`, `INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','X',1)`),
		"wrong columns":     rawSeed(t, `CREATE TABLE catalog_foods (barcode TEXT, name TEXT)`, `CREATE TABLE catalog_meta (key TEXT, value TEXT)`),
		"zero row_count":    rawSeed(t, looseSchema, `INSERT INTO catalog_meta VALUES ('dataset_version','v'),('built_at','b'),('row_count','0'),('source','s')`),
		"no usable rows":    rawSeed(t, looseSchema, goodMeta, `INSERT INTO catalog_foods(barcode,name,kcal_100g) VALUES ('4000000000011','X',NULL)`),
		"no tables":         rawSeed(t, `CREATE TABLE other (x)`),
	}
	for name, p := range bad {
		if _, err := ImportCatalog(ctx, x.db, p, quiet()); err == nil {
			t.Errorf("%s: import succeeded", name)
		}
	}
	if catalogCount(t, x) != 1 {
		t.Fatalf("catalog has %d rows; a failed import must keep the old catalog", catalogCount(t, x))
	}
	if c, err := x.r.CatalogByBarcode(ctx, "4000000000011"); err != nil || c.Name != "Behalten" {
		t.Fatalf("old row = %+v, %v", c, err)
	}
	if v, _ := x.r.CatalogMeta(ctx, "dataset_version"); v != "v1" {
		t.Fatalf("meta = %q", v)
	}
}

func TestSeedAboveTheSizeLimitIsRejectedUnopened(t *testing.T) {
	x := newFx(t)
	p := seedFile(t, []domain.CatalogFood{cf("4000000000011", "A", 1)}, "v1")
	old := MaxSeedBytes
	MaxSeedBytes = 10
	t.Cleanup(func() { MaxSeedBytes = old })
	if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err == nil || !strings.Contains(err.Error(), "limit") {
		t.Fatalf("err = %v", err)
	}
}

func TestSeedFileIsNeverModified(t *testing.T) {
	x := newFx(t)
	p := seedFile(t, []domain.CatalogFood{cf("4000000000011", "A", 1)}, "v1")
	before, _ := os.ReadFile(p)
	if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err != nil {
		t.Fatal(err)
	}
	after, _ := os.ReadFile(p)
	if string(before) != string(after) {
		t.Fatal("the seed file changed during import")
	}
	if m, _ := filepath.Glob(p + "-*"); len(m) != 0 {
		t.Fatalf("import left sidecar files: %v", m)
	}
}

func TestImportDoesNotTouchUserFoodsOrEntries(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.addCatalog(t, "3017620422003", "Nutella", 539)
	cat, _ := x.svc.Barcode(ctx, uid, "3017620422003") // materialized
	if _, err := ImportCatalog(ctx, x.db, seedFile(t, []domain.CatalogFood{cf("4000000000011", "Neu", 1)}, "v2"), quiet()); err != nil {
		t.Fatal(err)
	}
	got, err := x.r.Food(ctx, uid, cat.ID)
	if err != nil || got.Per100.Kcal != 539 {
		t.Fatalf("a materialized row must survive a catalog replacement: %+v %v", got, err)
	}
	_ = store.Pending
}
