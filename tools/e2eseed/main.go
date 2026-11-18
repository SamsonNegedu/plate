// Command e2eseed writes a tiny catalog seed for the Playwright tests, so end-to-end runs never need the 17 MB release seed.
package main

import (
	"fmt"
	"os"

	"plate/internal/domain"
	"plate/internal/food"
)

func f(v float64) *float64 { return &v }

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: e2eseed <out.db>")
		os.Exit(2)
	}
	img := "https://images.openfoodfacts.org/images/products/801/771/73/front.jpg"
	rows := []domain.CatalogFood{
		{Barcode: "80177173", Name: "Nutella", Brand: "Ferrero", Quantity: "400 g", ServingSize: "15 g", ServingGrams: f(15),
			Per100: domain.Nutrients{Kcal: 539, Protein: f(6.3), Carbs: f(57.5), Fat: f(30.9), Sugar: f(56.3), SatFat: f(10.6), Salt: f(0.107)}, ImageSourceURL: &img, Scans: 853},
		{Barcode: "4000000000011", Name: "Joghurt", Brand: "Ehrmann", Quantity: "500 g", Per100: domain.Nutrients{Kcal: 61, Protein: f(3.5)}, Scans: 50},
		{Barcode: "4000000000028", Name: "Vollkornbrot", Brand: "Harry", Per100: domain.Nutrients{Kcal: 210, Protein: f(7)}, Scans: 40},
		{Barcode: "4000000000035", Name: "Haferdrink", Brand: "Milbona", Quantity: "1 l", ServingSize: "250 ml", ServingGrams: f(250), Per100: domain.Nutrients{Kcal: 45}, Scans: 30},
		{Barcode: "4000000000042", Name: "Käse", Brand: "Hochland", Per100: domain.Nutrients{Kcal: 350, Protein: f(25), Fat: f(28)}, Scans: 20},
	}
	meta := food.SeedMeta{DatasetVersion: "e2e", BuiltAt: "2026-11-13T00:00:00Z", Source: "Open Food Facts (ODbL), end-to-end test fixture"}
	if err := food.WriteSeed(os.Args[1], rows, meta); err != nil {
		fmt.Fprintln(os.Stderr, "e2eseed:", err)
		os.Exit(1)
	}
}
