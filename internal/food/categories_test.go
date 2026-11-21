package food

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"plate/internal/domain"
	"plate/internal/store"
)

var salmonRanges = map[string][3]float64{"kcal": {123, 180, 244}, "fat": {3.3, 11, 17}, "protein": {18, 21, 24}, "salt": {1.4, 2.8, 3.6}}

func seedWithStats(t *testing.T, rows []domain.CatalogFood, stats []domain.CategoryStats) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "seed.db")
	meta := SeedMeta{DatasetVersion: "v1", BuiltAt: "2026-11-21T00:00:00Z", Source: "Open Food Facts (ODbL)"}
	if err := WriteSeedWithStats(p, rows, stats, meta); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestACatalogProductCarriesItsCategoryAndTheCategoryRangesComeWithIt(t *testing.T) {
	x := newFx(t)
	rows := []domain.CatalogFood{
		{Barcode: "4000000000011", Name: "Räucherlachs", Per100: domain.Nutrients{Kcal: 190}, Category: "en:smoked-salmons"},
		{Barcode: "4000000000028", Name: "Nudeln", Per100: domain.Nutrients{Kcal: 350}},
	}
	stats := []domain.CategoryStats{{Category: "en:smoked-salmons", N: 227, Ranges: salmonRanges}}
	if _, err := ImportCatalog(context.Background(), x.db, seedWithStats(t, rows, stats), quiet()); err != nil {
		t.Fatal(err)
	}
	got, err := x.svc.Barcode(context.Background(), uid, "4000000000011")
	if err != nil || got.Category != "en:smoked-salmons" {
		t.Fatalf("category = %q (%v)", got.Category, err)
	}
	cs, err := store.NewRepo(x.db).CategoryStats(context.Background(), "en:smoked-salmons")
	if err != nil || cs.N != 227 || cs.Ranges["kcal"] != [3]float64{123, 180, 244} {
		t.Fatalf("stats = %+v (%v)", cs, err)
	}
	if plain, _ := x.svc.Barcode(context.Background(), uid, "4000000000028"); plain.Category != "" {
		t.Fatalf("a product with no category got %q", plain.Category)
	}
}

func TestAnOldSeedWithoutCategoriesStillImports(t *testing.T) {
	x := newFx(t)
	p := seedFile(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, "v0")
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{`DROP TABLE category_stats`, `ALTER TABLE catalog_foods DROP COLUMN category`} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()
	res, err := ImportCatalog(context.Background(), x.db, p, quiet())
	if err != nil || res.Rows != 1 {
		t.Fatalf("import = %+v (%v)", res, err)
	}
	if got, err := x.svc.Barcode(context.Background(), uid, "4000000000011"); err != nil || got.Category != "" {
		t.Fatalf("food = %+v (%v)", got, err)
	}
}

func TestMalformedRangesAreSkippedNotTrusted(t *testing.T) {
	x := newFx(t)
	p := seedFile(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, "v0")
	db, err := sql.Open("sqlite", p)
	if err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO category_stats VALUES ('en:good', 50, '{"kcal":[1,2,3]}')`,
		`INSERT INTO category_stats VALUES ('en:backwards', 50, '{"kcal":[9,2,3]}')`,
		`INSERT INTO category_stats VALUES ('en:not-json', 50, 'DROP TABLE foods')`,
		`INSERT INTO category_stats VALUES ('not a tag', 50, '{"kcal":[1,2,3]}')`,
		`INSERT INTO category_stats VALUES ('en:huge', 50, '{"kcal":[1,2,99999999]}')`,
		`INSERT INTO category_stats VALUES ('en:unknown-key', 50, '{"mystery":[1,2,3]}')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	_ = db.Close()
	if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err != nil {
		t.Fatal(err)
	}
	n, _ := store.NewRepo(x.db).CountCategoryStats(context.Background())
	if n != 1 {
		t.Fatalf("%d categories kept, want only en:good", n)
	}
}

func TestAProductFetchedFromOpenFoodFactsGetsTheMostSpecificCategoryThatHasRanges(t *testing.T) {
	x := newFx(t)
	stats := []domain.CategoryStats{
		{Category: "en:seafood", N: 9000, Ranges: map[string][3]float64{"kcal": {50, 150, 300}}},
		{Category: "en:smoked-salmons", N: 227, Ranges: salmonRanges},
	}
	if _, err := ImportCatalog(context.Background(), x.db, seedWithStats(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, stats), quiet()); err != nil {
		t.Fatal(err)
	}
	p := offProduct("4337256560191", "Räucherlachs", 399)
	p.CategoriesTags = []string{"en:seafood", "en:fishes", "en:smoked-fishes", "en:smoked-salmons"}
	x.off.products["4337256560191"] = p
	got, err := x.svc.Barcode(context.Background(), uid, "4337256560191")
	if err != nil || got.Category != "en:smoked-salmons" {
		t.Fatalf("category = %q (%v)", got.Category, err)
	}
	if again, _ := x.r.FoodByBarcode(context.Background(), uid, "4337256560191"); again.Category != "en:smoked-salmons" {
		t.Fatalf("the category must be stored with the food: %q", again.Category)
	}
}

func TestCategoryRangesAreReplacedByTheNextImport(t *testing.T) {
	x := newFx(t)
	first := seedWithStats(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, []domain.CategoryStats{{Category: "en:a", N: 40, Ranges: salmonRanges}})
	second := seedWithStats(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, []domain.CategoryStats{{Category: "en:b", N: 40, Ranges: salmonRanges}})
	for _, p := range []string{first, second} {
		if _, err := ImportCatalog(context.Background(), x.db, p, quiet()); err != nil {
			t.Fatal(err)
		}
	}
	r := store.NewRepo(x.db)
	if _, err := r.CategoryStats(context.Background(), "en:a"); err == nil {
		t.Fatal("the old category survived the import")
	}
	if _, err := r.CategoryStats(context.Background(), "en:b"); err != nil {
		t.Fatal(err)
	}
}

func TestOfTwoCategoriesCoveringTheSameProductsTheMoreSpecificOneWins(t *testing.T) {
	x := newFx(t)
	same := salmonRanges
	stats := []domain.CategoryStats{
		{Category: "en:fishes", N: 40, Ranges: same},
		{Category: "en:seafood", N: 40, Ranges: same},
		{Category: "en:smoked-salmons", N: 40, Ranges: same},
	}
	if _, err := ImportCatalog(context.Background(), x.db, seedWithStats(t, []domain.CatalogFood{cf("4000000000011", "Joghurt", 61)}, stats), quiet()); err != nil {
		t.Fatal(err)
	}
	got, err := store.NewRepo(x.db).MostSpecificCategory(context.Background(), []string{"en:seafood", "en:fishes", "en:smoked-salmons"})
	if err != nil || got != "en:smoked-salmons" {
		t.Fatalf("category = %q (%v)", got, err)
	}
}
