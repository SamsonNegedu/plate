package main

import (
	"fmt"
	"testing"

	"plate/internal/domain"
)

func fp(v float64) *float64 { return &v }

// salmons builds n smoked-salmon products around 190 kcal, plus a few broader "fish" products that are not salmon.
func salmons(n int) []domain.CatalogFood {
	var rows []domain.CatalogFood
	for i := 0; i < n; i++ {
		rows = append(rows, domain.CatalogFood{
			Barcode:    fmt.Sprintf("40000000%05d", i),
			Per100:     domain.Nutrients{Kcal: 170 + float64(i%5)*10, Fat: fp(10 + float64(i%4)), Protein: fp(20 + float64(i%3)), Carbs: fp(0.5), Salt: fp(2.5 + float64(i%3)*0.3)},
			Categories: []string{"en:seafood", "en:fishes", "en:smoked-salmons"},
		})
	}
	for i := 0; i < 40; i++ {
		rows = append(rows, domain.CatalogFood{
			Barcode:    fmt.Sprintf("41000000%05d", i),
			Per100:     domain.Nutrients{Kcal: 90 + float64(i), Fat: fp(1), Protein: fp(18), Carbs: fp(0), Salt: fp(0.4)},
			Categories: []string{"en:seafood", "en:fishes", "en:white-fishes"},
		})
	}
	return rows
}

func TestCategoryStatsGiveRangesOnlyToCategoriesWithEnoughProducts(t *testing.T) {
	rows := salmons(60)
	rows = append(rows, domain.CatalogFood{Barcode: "49000000000001", Per100: domain.Nutrients{Kcal: 500}, Categories: []string{"en:rare-thing"}})
	stats := categoryStats(rows)
	got := map[string]domain.CategoryStats{}
	for _, s := range stats {
		got[s.Category] = s
	}
	if _, ok := got["en:rare-thing"]; ok {
		t.Fatal("a category with one product has no ranges")
	}
	sal, ok := got["en:smoked-salmons"]
	if !ok || sal.N != 60 {
		t.Fatalf("smoked salmons = %+v", sal)
	}
	k := sal.Ranges["kcal"]
	if !(k[0] <= k[1] && k[1] <= k[2]) || k[1] < 170 || k[1] > 210 {
		t.Fatalf("kcal range = %v", k)
	}
	if _, ok := sal.Ranges["salt"]; !ok {
		t.Fatalf("salt range missing: %v", sal.Ranges)
	}
	if got["en:seafood"].N != 100 {
		t.Fatalf("seafood covers every fish product: %+v", got["en:seafood"])
	}
}

func TestAProductIsComparedWithItsMostSpecificCategory(t *testing.T) {
	rows := salmons(60)
	stats := categoryStats(rows)
	assignCategories(rows, stats)
	if rows[0].Category != "en:smoked-salmons" {
		t.Fatalf("a smoked salmon is compared with %q", rows[0].Category)
	}
	if last := rows[len(rows)-1]; last.Category != "en:white-fishes" {
		t.Fatalf("a white fish is compared with %q", last.Category)
	}
}

func TestAProductWithNoCategoryWithRangesGetsNone(t *testing.T) {
	rows := []domain.CatalogFood{{Barcode: "49000000000002", Per100: domain.Nutrients{Kcal: 100}, Categories: []string{"en:only-one"}}}
	assignCategories(rows, categoryStats(rows))
	if rows[0].Category != "" {
		t.Fatalf("category = %q", rows[0].Category)
	}
}

func TestPercentileInterpolates(t *testing.T) {
	xs := []float64{0, 10, 20, 30, 40}
	if got := percentile(xs, 0.5); got != 20 {
		t.Fatalf("median = %v", got)
	}
	if got := percentile(xs, 0.05); got != 2 {
		t.Fatalf("p05 = %v", got)
	}
	if got := percentile(xs, 0.95); got != 38 {
		t.Fatalf("p95 = %v", got)
	}
}

func TestCategoryTagsSplitsTheDumpColumn(t *testing.T) {
	got := categoryTags("en:seafood, en:fishes,,en:smoked-salmons ")
	if len(got) != 3 || got[2] != "en:smoked-salmons" {
		t.Fatalf("got %v", got)
	}
}
