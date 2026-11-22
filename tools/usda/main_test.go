package main

import (
	"os"
	"testing"
	"time"
)

func TestPicksAreUniqueAndNamed(t *testing.T) {
	seen := map[string]bool{}
	for _, p := range picks {
		if p.Description == "" || p.Name == "" || p.Category == "" {
			t.Errorf("incomplete pick %+v", p)
		}
		if seen[p.Description] {
			t.Errorf("%q is listed twice", p.Description)
		}
		seen[p.Description] = true
	}
}

func TestBuildFromTheRealDownload(t *testing.T) {
	zip := os.Getenv("PLATE_TEST_USDA_FILE")
	if zip == "" {
		t.Skip("set PLATE_TEST_USDA_FILE to FoodData_Central_sr_legacy_food_csv_2018-04.zip to run this")
	}
	foods, err := build(zip, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(foods) != len(picks) {
		t.Fatalf("built %d, want %d", len(foods), len(picks))
	}
	for _, f := range foods {
		if f.Per100.Kcal <= 0 && f.Name != "Salt, table" {
			t.Errorf("%s has %v kcal", f.Name, f.Per100.Kcal)
		}
	}
}
