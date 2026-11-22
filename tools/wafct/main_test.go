package main

import (
	"bytes"
	"encoding/csv"
	"os"
	"testing"
	"time"

	"plate/internal/food"
)

const shipped = "../../internal/food/data/wafct_2019.csv"

func TestEveryAliasPointsAtAShippedFood(t *testing.T) {
	f, err := os.Open(shipped)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	rows, err := csv.NewReader(f).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	have := map[string]bool{}
	for _, r := range rows[1:] {
		have[r[0]] = true
	}
	for code := range aliases {
		if !have["wafct:"+code] {
			t.Errorf("alias for %s, which is not in the shipped table (merged or mistyped)", code)
		}
	}
}

// TestShippedCSVIsWhatTheToolMakes guards the shipped file against hand edits that the source file cannot reproduce.
func TestShippedCSVIsWhatTheToolMakes(t *testing.T) {
	src := os.Getenv("PLATE_TEST_WAFCT_FILE")
	if src == "" {
		t.Skip("set PLATE_TEST_WAFCT_FILE to WAFCT_2019.xlsx to run this")
	}
	foods, _, err := food.ParseWAFCT(src, time.Now(), aliases)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := food.WriteReferenceCSV(&buf, foods); err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(shipped)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(buf.Bytes(), want) {
		t.Fatal("internal/food/data/wafct_2019.csv differs from what `make wafct` makes; regenerate it or move the edit into tools/wafct/aliases.go")
	}
}
