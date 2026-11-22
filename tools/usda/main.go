// Command usda builds the short USDA list the app ships as internal/food/data/usda_sr_legacy.csv, from the USDA
// FoodData Central "SR Legacy" CSV download (a zip). It is a build-time tool (`make usda`), not part of the running
// service. The data is public domain (CC0); the credit is in internal/food/data/NOTICE.md.
package main

import (
	"archive/zip"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"plate/internal/domain"
	"plate/internal/food"
)

const source = "usda-sr-legacy"

// FoodData Central nutrient ids.
const (
	nKcal, nProtein, nFat, nCarbs, nFiber, nSugar, nSatFat, nSodium = "1008", "1003", "1004", "1005", "1079", "2000", "1258", "1093"
)

func main() {
	in := flag.String("in", "", "path to FoodData_Central_sr_legacy_food_csv_2018-04.zip (required)")
	out := flag.String("out", "internal/food/data/usda_sr_legacy.csv", "output CSV")
	flag.Parse()
	if *in == "" {
		fmt.Fprintln(os.Stderr, "usda: -in is required")
		os.Exit(2)
	}
	if err := run(*in, *out); err != nil {
		fmt.Fprintln(os.Stderr, "usda:", err)
		os.Exit(1)
	}
}

func run(in, out string) error {
	foods, err := build(in, time.Now())
	if err != nil {
		return err
	}
	fh, err := os.Create(out) // #nosec G304 -- the operator's output path
	if err != nil {
		return fmt.Errorf("creating %s: %w", out, err)
	}
	if err := food.WriteReferenceCSV(fh, foods); err != nil {
		_ = fh.Close()
		return err
	}
	if err := fh.Close(); err != nil {
		return fmt.Errorf("closing %s: %w", out, err)
	}
	fmt.Printf("usda: wrote %d foods to %s\n", len(foods), out)
	return nil
}

func build(zipPath string, now time.Time) ([]domain.ReferenceFood, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("opening %s: %w", zipPath, err)
	}
	defer func() { _ = zr.Close() }()
	files := map[string]*zip.File{}
	for _, f := range zr.File {
		files[path.Base(f.Name)] = f
	}

	want := map[string]bool{}
	for _, p := range picks {
		want[p.Description] = true
	}
	ids := map[string]string{} // description -> fdc id
	if err := eachRow(files["food.csv"], func(r map[string]string) {
		if want[r["description"]] {
			ids[r["description"]] = r["fdc_id"]
		}
	}); err != nil {
		return nil, err
	}
	byID := map[string]map[string]float64{}
	for _, id := range ids {
		byID[id] = map[string]float64{}
	}
	if err := eachRow(files["food_nutrient.csv"], func(r map[string]string) {
		m, ok := byID[r["fdc_id"]]
		if !ok {
			return
		}
		if v, err := strconv.ParseFloat(r["amount"], 64); err == nil {
			m[r["nutrient_id"]] = v
		}
	}); err != nil {
		return nil, err
	}

	ts := now.UTC().Format(time.RFC3339)
	var out []domain.ReferenceFood
	for _, p := range picks {
		id, ok := ids[p.Description]
		if !ok {
			return nil, fmt.Errorf("USDA has no food described %q", p.Description)
		}
		n := byID[id]
		kcal, ok := n[nKcal]
		if !ok {
			return nil, fmt.Errorf("%q has no energy", p.Description)
		}
		get := func(k string) *float64 {
			if v, ok := n[k]; ok {
				return &v
			}
			return nil
		}
		var salt *float64
		if na, ok := n[nSodium]; ok {
			s := na / 1000 * 2.5
			salt = &s
		}
		per, ok := food.SanitizeNutrients(domain.Nutrients{
			Kcal: kcal, Protein: get(nProtein), Carbs: get(nCarbs), Sugar: get(nSugar), Fat: get(nFat),
			SatFat: get(nSatFat), Fiber: get(nFiber), Salt: salt,
		})
		if !ok {
			return nil, fmt.Errorf("%q fails the nutrient checks", p.Description)
		}
		out = append(out, domain.ReferenceFood{
			RefID: "usda:" + id, Name: p.Name, LocalNames: p.Local, Category: p.Category, Per100: per,
			Source: source, DatasetVersion: source, ImportedAt: ts,
		})
	}
	return out, nil
}

func eachRow(f *zip.File, each func(map[string]string)) error {
	if f == nil {
		return errors.New("the zip lacks a file this tool needs; is it the SR Legacy CSV download?")
	}
	rc, err := f.Open()
	if err != nil {
		return fmt.Errorf("opening %s: %w", f.Name, err)
	}
	defer func() { _ = rc.Close() }()
	cr := csv.NewReader(rc)
	head, err := cr.Read()
	if err != nil {
		return fmt.Errorf("reading %s: %w", f.Name, err)
	}
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("reading %s: %w", f.Name, err)
		}
		row := make(map[string]string, len(head))
		for i, h := range head {
			if i < len(rec) {
				row[strings.TrimSpace(h)] = rec[i]
			}
		}
		each(row)
	}
}
