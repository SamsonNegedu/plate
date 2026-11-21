// Command catalog builds the OFF German catalog seed from the Open Food Facts CSV dump. It is a build-time tool for
// releases (`make catalog`), not part of the running service.
//
// The seed keeps German products with per-100 g kcal, cleans names, merges near-duplicates and ranks by scan count.
// It is a derivative of Open Food Facts data under the ODbL: see docs/attribution.md.
package main

import (
	"compress/gzip"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"plate/internal/domain"
	"plate/internal/food"
)

func main() {
	dump := flag.String("dump", "", "path to en.openfoodfacts.org.products.csv.gz (required)")
	out := flag.String("out", "data/off-catalog.db", "output seed file")
	n := flag.Int("n", 100000, "most products to keep")
	minScans := flag.Int("min-scans", 2, "keep only products scanned by at least this many people; a hard cutoff avoids an arbitrary split inside a tie")
	version := flag.String("version", time.Now().UTC().Format("2006-01-02"), "dataset version label")
	flag.Parse()
	if *dump == "" {
		fmt.Fprintln(os.Stderr, "catalog: -dump is required")
		os.Exit(2)
	}
	if err := run(*dump, *out, *version, *n, *minScans); err != nil {
		fmt.Fprintln(os.Stderr, "catalog:", err)
		os.Exit(1)
	}
}

type counters map[string]int

func run(dump, out, version string, n, minScans int) error {
	start := time.Now()
	stats := counters{}
	rows, err := read(dump, stats)
	if err != nil {
		return err
	}
	rows = dedupe(rows, stats)
	cats := categoryStats(rows) // over every German product with energy, before the scan cut
	assignCategories(rows, cats)
	stats["categories_with_ranges"] = len(cats)
	slices.SortFunc(rows, func(a, b domain.CatalogFood) int {
		if a.Scans != b.Scans {
			return int(b.Scans - a.Scans)
		}
		return strings.Compare(a.Barcode, b.Barcode)
	})
	kept := rows[:0]
	for _, c := range rows {
		if c.Scans >= int64(minScans) {
			kept = append(kept, c)
		}
	}
	stats["dropped_below_min_scans"] = len(rows) - len(kept)
	rows = kept
	if len(rows) > n {
		rows = rows[:n]
	}
	if len(rows) == 0 {
		return fmt.Errorf("no usable products found")
	}
	meta := food.SeedMeta{
		DatasetVersion: version, BuiltAt: time.Now().UTC().Format(time.RFC3339),
		Source: "Open Food Facts (ODbL 1.0), German products with per-100 g energy, ranked by unique scans",
	}
	if err := food.WriteSeedWithStats(out, rows, cats, meta); err != nil {
		return err
	}
	st, err := os.Stat(out)
	if err != nil {
		return fmt.Errorf("checking output: %w", err)
	}
	keys := make([]string, 0, len(stats))
	for k := range stats {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		fmt.Printf("%-28s %d\n", k, stats[k])
	}
	fmt.Printf("wrote %d products to %s (%.1f MB, version %s) in %s\n", len(rows), out, float64(st.Size())/1e6, version, time.Since(start).Round(time.Second))
	return nil
}

func read(path string, stats counters) ([]domain.CatalogFood, error) {
	fh, err := os.Open(path) // #nosec G304 -- operator-supplied build input
	if err != nil {
		return nil, fmt.Errorf("opening dump: %w", err)
	}
	defer func() { _ = fh.Close() }()
	zr, err := gzip.NewReader(fh)
	if err != nil {
		return nil, fmt.Errorf("reading gzip: %w", err)
	}
	r := csv.NewReader(zr)
	r.Comma, r.LazyQuotes, r.FieldsPerRecord, r.ReuseRecord = '\t', true, -1, true
	head, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}
	col := map[string]int{}
	for i, h := range head {
		col[h] = i
	}
	for _, need := range []string{"code", "product_name", "countries_tags", "energy-kcal_100g"} {
		if _, ok := col[need]; !ok {
			return nil, fmt.Errorf("dump lacks column %q", need)
		}
	}
	get := func(rec []string, name string) string {
		if i, ok := col[name]; ok && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	num := func(rec []string, name string) *float64 {
		s := strings.ReplaceAll(get(rec, name), ",", ".")
		if s == "" {
			return nil
		}
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil
		}
		return &v
	}

	var out []domain.CatalogFood
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			stats["csv_error"]++
			continue
		}
		stats["rows_total"]++
		if !strings.Contains(get(rec, "countries_tags"), "en:germany") {
			continue
		}
		stats["germany"]++
		code, _, err := food.NormalizeBarcode(get(rec, "code"))
		if err != nil || len(code) < 8 || code != get(rec, "code") {
			stats["drop_bad_barcode"]++
			continue
		}
		name := food.CleanProductName(get(rec, "product_name"))
		if name == "" {
			stats["drop_bad_name"]++
			continue
		}
		kcal := num(rec, "energy-kcal_100g")
		if kcal == nil {
			stats["drop_no_kcal"]++
			continue
		}
		nutr, ok := food.SanitizeNutrients(domain.Nutrients{
			Kcal: *kcal, Protein: num(rec, "proteins_100g"), Carbs: num(rec, "carbohydrates_100g"), Fat: num(rec, "fat_100g"),
			Sugar: num(rec, "sugars_100g"), SatFat: num(rec, "saturated-fat_100g"), Fiber: num(rec, "fiber_100g"), Salt: num(rec, "salt_100g"),
		})
		if !ok {
			stats["drop_implausible"]++
			continue
		}
		brand, _, _ := strings.Cut(get(rec, "brands"), ",")
		scans, _ := strconv.ParseInt(get(rec, "unique_scans_n"), 10, 64)
		servingSize := get(rec, "serving_size")
		c := domain.CatalogFood{
			Barcode: code, Name: name, Brand: food.CleanProductName(brand), Quantity: get(rec, "quantity"),
			ServingSize: servingSize, ServingGrams: food.ParseServingGrams(servingSize, num(rec, "serving_quantity")),
			Per100: nutr, Scans: scans,
		}
		if g := get(rec, "nutriscore_grade"); len(g) == 1 && g[0] >= 'a' && g[0] <= 'e' {
			c.Nutriscore = &g
		}
		img := get(rec, "image_front_url")
		if img == "" {
			img = get(rec, "image_url")
		}
		if food.AllowedImageURL(img) {
			c.ImageSourceURL = &img
		}
		c.Categories = categoryTags(get(rec, "categories_tags"))
		out = append(out, c)
	}
	return out, nil
}

// dedupe merges products that differ only in case, punctuation or accents, keeping the most scanned.
func dedupe(rows []domain.CatalogFood, stats counters) []domain.CatalogFood {
	best := make(map[string]int, len(rows))
	out := make([]domain.CatalogFood, 0, len(rows))
	for _, c := range rows {
		key := domain.SearchName(c.Name) + "|" + domain.SearchName(c.Brand)
		if i, ok := best[key]; ok {
			stats["merged_near_duplicate"]++
			if c.Scans > out[i].Scans {
				out[i] = c
			}
			continue
		}
		best[key] = len(out)
		out = append(out, c)
	}
	return out
}

// categoryTags splits the dump's comma-separated categories_tags.
func categoryTags(s string) []string {
	var out []string
	for _, t := range strings.Split(s, ",") {
		if t = strings.TrimSpace(t); t != "" {
			out = append(out, t)
		}
	}
	return out
}
