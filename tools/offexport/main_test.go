package main

import (
	"bytes"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"plate/internal/domain"
)

func photo(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewGray(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestPushReadyNeedsTheTablePhotoAndAFrontPhotoForNewProducts(t *testing.T) {
	kcal, p := 192.0, 21.0
	base := domain.FactRevision{Barcode: "4337256560191", ID: "r1", Per100: domain.Nutrients{Kcal: kcal, Protein: &p}, Lang: "de"}
	cases := []struct {
		name         string
		origin       domain.FactOrigin
		label, front bool
		want         bool
	}{
		{"correction with a table photo", domain.OriginCorrection, true, false, true},
		{"correction without photos", domain.OriginCorrection, false, false, false},
		{"new product with both photos", domain.OriginNew, true, true, true},
		{"new product without a front photo", domain.OriginNew, true, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := base
			v.Origin = c.origin
			if c.label {
				v.LabelImage = photo(t)
			}
			if c.front {
				v.FrontImage = photo(t)
			}
			dir := t.TempDir()
			if err := os.MkdirAll(filepath.Join(dir, "images"), 0o750); err != nil {
				t.Fatal(err)
			}
			rec, err := toRecord(v, dir)
			if err != nil || rec.PushReady != c.want {
				t.Fatalf("push_ready = %v (%v), want %v", rec.PushReady, err, c.want)
			}
			if c.label {
				if _, err := os.Stat(filepath.Join(dir, rec.NutritionImage)); err != nil {
					t.Fatalf("photo not written: %v", err)
				}
			}
			if rec.EnergyKcal != 192 || rec.NutritionPer != "100g" || rec.AppName != "plate" {
				t.Fatalf("record = %+v", rec)
			}
		})
	}
}
