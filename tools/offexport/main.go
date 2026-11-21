// Command offexport writes the community facts the app serves in Open Food Facts field names, one JSON object per line,
// plus the photos beside it. It reads the database and sends nothing anywhere: it is the file a person reviews, or a
// later decision pushes upstream (ADR-020).
package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"image"
	_ "image/jpeg" // registers the decoder used to name a photo's file extension
	_ "image/png"  // registers the decoder used to name a photo's file extension
	"os"
	"path/filepath"

	"plate/internal/domain"
	"plate/internal/store"
)

// record is one product in the shape of an Open Food Facts product edit (product_jqm2.pl field names).
type record struct {
	Code            string   `json:"code"`
	Lang            string   `json:"lc"`
	Countries       string   `json:"countries"`
	ProductName     string   `json:"product_name"`
	Brands          string   `json:"brands"`
	Quantity        string   `json:"quantity"`
	ServingSize     string   `json:"serving_size"`
	IngredientsText string   `json:"ingredients_text"`
	NutritionPer    string   `json:"nutrition_data_per"`
	EnergyKcal      float64  `json:"nutriment_energy-kcal"`
	EnergyKJ        *float64 `json:"nutriment_energy-kj,omitempty"`
	Fat             *float64 `json:"nutriment_fat,omitempty"`
	SaturatedFat    *float64 `json:"nutriment_saturated-fat,omitempty"`
	Carbohydrates   *float64 `json:"nutriment_carbohydrates,omitempty"`
	Sugars          *float64 `json:"nutriment_sugars,omitempty"`
	Fiber           *float64 `json:"nutriment_fiber,omitempty"`
	Proteins        *float64 `json:"nutriment_proteins,omitempty"`
	Salt            *float64 `json:"nutriment_salt,omitempty"`
	AppName         string   `json:"app_name"`
	AppVersion      string   `json:"app_version"`
	Revision        string   `json:"revision"`
	Origin          string   `json:"origin"`
	Source          string   `json:"source"`
	NutritionImage  string   `json:"nutrition_image,omitempty"`
	FrontImage      string   `json:"front_image,omitempty"`
	PushReady       bool     `json:"push_ready"`
	AlreadyPushed   bool     `json:"already_pushed"`
}

func main() {
	dbPath := flag.String("db", "data/plate.db", "SQLite database")
	out := flag.String("out", "off-export", "directory for facts.ndjson and the photos")
	flag.Parse()
	if err := run(context.Background(), *dbPath, *out); err != nil {
		fmt.Fprintln(os.Stderr, "offexport:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, dbPath, outDir string) error {
	db, err := store.Open(dbPath)
	if err != nil {
		return fmt.Errorf("opening %s: %w", dbPath, err)
	}
	defer func() { _ = db.Close() }()
	facts, err := store.NewRepo(db).FactsForExport(ctx)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(outDir, "images"), 0o750); err != nil {
		return fmt.Errorf("creating %s: %w", outDir, err)
	}
	f, err := os.Create(filepath.Join(outDir, "facts.ndjson")) //nolint:gosec // the operator chose outDir
	if err != nil {
		return fmt.Errorf("creating facts file: %w", err)
	}
	defer func() { _ = f.Close() }()
	w := bufio.NewWriter(f)
	ready := 0
	for _, v := range facts {
		rec, err := toRecord(v, outDir)
		if err != nil {
			return err
		}
		if rec.PushReady {
			ready++
		}
		b, err := json.Marshal(rec)
		if err != nil {
			return fmt.Errorf("encoding %s: %w", v.Barcode, err)
		}
		if _, err := w.Write(append(b, '\n')); err != nil {
			return fmt.Errorf("writing %s: %w", v.Barcode, err)
		}
	}
	if err := w.Flush(); err != nil {
		return fmt.Errorf("writing facts file: %w", err)
	}
	fmt.Printf("%d facts written to %s (%d with the photos Open Food Facts needs)\n", len(facts), outDir, ready)
	return nil
}

func toRecord(v domain.FactRevision, outDir string) (record, error) {
	rec := record{
		Code: v.Barcode, Lang: v.Lang, Countries: v.Countries, ProductName: v.Name, Brands: v.Brand, Quantity: v.Quantity,
		ServingSize: v.ServingSize, IngredientsText: v.IngredientsText, NutritionPer: "100g", EnergyKcal: v.Per100.Kcal,
		EnergyKJ: v.EnergyKJ, Fat: v.Per100.Fat, SaturatedFat: v.Per100.SatFat, Carbohydrates: v.Per100.Carbs,
		Sugars: v.Per100.Sugar, Fiber: v.Per100.Fiber, Proteins: v.Per100.Protein, Salt: v.Per100.Salt,
		AppName: "plate", AppVersion: v.AppVersion, Revision: v.ID, Origin: string(v.Origin), Source: v.Source,
		AlreadyPushed: v.PushedAt != nil,
	}
	var err error
	if rec.NutritionImage, err = writeImage(outDir, v.Barcode, "nutrition", v.LabelImage); err != nil {
		return record{}, err
	}
	if rec.FrontImage, err = writeImage(outDir, v.Barcode, "front", v.FrontImage); err != nil {
		return record{}, err
	}
	// Open Food Facts wants a nutrition table photo for a correction and a front photo as well for a new product.
	rec.PushReady = rec.NutritionImage != "" && (v.Origin != domain.OriginNew || rec.FrontImage != "")
	return rec, nil
}

// writeImage stores a photo and returns its path relative to outDir, or "" when there is none.
func writeImage(outDir, barcode, kind string, b []byte) (string, error) {
	if len(b) == 0 {
		return "", nil
	}
	_, format, err := image.DecodeConfig(bytes.NewReader(b))
	if err != nil {
		return "", fmt.Errorf("%s photo of %s is not an image: %w", kind, barcode, err)
	}
	name := filepath.Join("images", fmt.Sprintf("%s_%s.%s", barcode, kind, format))
	if err := os.WriteFile(filepath.Join(outDir, name), b, 0o640); err != nil { //nolint:gosec // an export the operator reads
		return "", fmt.Errorf("writing %s: %w", name, err)
	}
	return name, nil
}
