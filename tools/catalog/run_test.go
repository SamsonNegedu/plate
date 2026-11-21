package main

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"plate/internal/food"
	"plate/internal/store"
)

// writeDump writes a small Open Food Facts style CSV (tab separated, gzipped): 40 smoked salmons around 190 kcal, 35 pizzas,
// and one product that carries no usable category.
func writeDump(t *testing.T) string {
	t.Helper()
	var b strings.Builder
	b.WriteString("code\tproduct_name\tbrands\tcountries_tags\tenergy-kcal_100g\tproteins_100g\tfat_100g\tcarbohydrates_100g\tsalt_100g\tcategories_tags\tunique_scans_n\n")
	row := func(code, name, kcal, prot, fat, carbs, salt, cats string, scans int) {
		fmt.Fprintf(&b, "%s\t%s\tMarke\ten:germany\t%s\t%s\t%s\t%s\t%s\t%s\t%d\n", code, name, kcal, prot, fat, carbs, salt, cats, scans)
	}
	for i := 0; i < 40; i++ {
		row(fmt.Sprintf("40100000%05d", i), fmt.Sprintf("Räucherlachs Sorte %d", i), fmt.Sprint(170+i%5*10), fmt.Sprint(20+i%3), fmt.Sprint(10+i%4), "0.5", fmt.Sprint(2.5+float64(i%3)*0.3),
			"en:seafood,en:fishes,en:smoked-salmons", 3+i%6)
	}
	for i := 0; i < 35; i++ {
		row(fmt.Sprintf("40200000%05d", i), fmt.Sprintf("Pizza Salami %d", i), fmt.Sprint(240+i%7*8), "10", "10", "30", "1.3", "en:meals,en:pizzas", 2+i%4)
	}
	row("4030000000001", "Mystery Bar", "400", "5", "20", "50", "0.2", "en:snacks", 9)
	p := filepath.Join(t.TempDir(), "dump.csv.gz")
	fh, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	zw := gzip.NewWriter(fh)
	if _, err := io.WriteString(zw, b.String()); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := fh.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTheBuildWritesCategoryRangesAndTheAppImportsThem(t *testing.T) {
	out := filepath.Join(t.TempDir(), "seed.db")
	if err := run(writeDump(t), out, "test", 1000, 2); err != nil {
		t.Fatal(err)
	}
	db, err := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	if err := store.Migrate(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := food.ImportCatalog(ctx, db, out, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	repo := store.NewRepo(db)

	salmon, err := repo.CatalogByBarcode(ctx, "4010000000000")
	if err != nil || salmon.Category != "en:smoked-salmons" {
		t.Fatalf("salmon = %+v (%v)", salmon, err)
	}
	cs, err := repo.CategoryStats(ctx, "en:smoked-salmons")
	if err != nil || cs.N != 40 {
		t.Fatalf("stats = %+v (%v)", cs, err)
	}
	kcal := cs.Ranges["kcal"]
	if kcal[0] < 170 || kcal[2] > 210 || kcal[1] < kcal[0] || kcal[2] < kcal[1] {
		t.Fatalf("kcal range = %v", kcal)
	}
	pizza, err := repo.CatalogByBarcode(ctx, "4020000000000")
	if err != nil || pizza.Category != "en:pizzas" {
		t.Fatalf("pizza = %+v (%v)", pizza, err)
	}
	// "meals" covers the same 35 pizzas, so size alone cannot tell them apart: the later (more specific) tag wins the tie.
	if cs, _ := repo.CategoryStats(ctx, "en:meals"); cs.N != 35 {
		t.Fatalf("meals = %+v", cs)
	}
	mystery, err := repo.CatalogByBarcode(ctx, "4030000000001")
	if err != nil || mystery.Category != "" {
		t.Fatalf("a product whose only category has too few products is compared with nothing: %+v (%v)", mystery, err)
	}
}
