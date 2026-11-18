// Command corpus builds testdata/barcodes-de.csv from the Open Food Facts dump and records OFF responses for the rows the
// catalog seed does not cover. It is a build-time tool; `make coverage-live` documents how to run it.
//
// Sampling: for each chain, products tagged as sold there, sold in Germany, with energy and at least two unique scans,
// ordered by a hash of the barcode so the sample is stable. This approximates what people actually buy; it is not the
// operator's own shopping list, so treat the percentages as an estimate.
package main

import (
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"

	"plate/internal/food"
)

type chain struct {
	name    string
	pattern *regexp.Regexp
}

var chains = []chain{
	{"Edeka", regexp.MustCompile(`(?i)\bedeka\b`)},
	{"Rewe", regexp.MustCompile(`(?i)\brewe\b`)},
	{"Aldi Nord", regexp.MustCompile(`(?i)aldi\s*nord`)},
	{"Aldi Süd", regexp.MustCompile(`(?i)aldi\s*s(ü|u|ue)d`)},
	{"Lidl", regexp.MustCompile(`(?i)\blidl\b`)},
	{"Kaufland", regexp.MustCompile(`(?i)\bkaufland\b`)},
	{"Penny", regexp.MustCompile(`(?i)\bpenny\b`)},
	{"Netto", regexp.MustCompile(`(?i)\bnetto\b`)},
	{"dm", regexp.MustCompile(`(?i)(^|,\s*)dm(-drogerie.*)?(,|$)`)},
	{"Rossmann", regexp.MustCompile(`(?i)\brossmann\b`)},
}

type row struct{ chain, product, barcode, source string }

func main() {
	dump := flag.String("dump", "", "OFF CSV dump (.csv.gz)")
	seed := flag.String("seed", "data/off-catalog.db", "catalog seed built by tools/catalog")
	out := flag.String("out", "internal/food/testdata/barcodes-de.csv", "corpus CSV to write")
	fixtures := flag.String("fixtures", "internal/food/testdata/off-fixtures", "directory for recorded OFF responses")
	per := flag.Int("per-chain", 22, "products per chain")
	record := flag.Bool("record", false, "fetch OFF live for rows outside the seed and write fixtures (30 requests a minute)")
	ua := flag.String("user-agent", "Plate-corpus/1.0 (self-hosted; build tool)", "User-Agent for live requests")
	flag.Parse()
	if *dump == "" {
		fmt.Fprintln(os.Stderr, "corpus: -dump is required")
		os.Exit(2)
	}
	if err := run(*dump, *seed, *out, *fixtures, *per, *record, *ua); err != nil {
		fmt.Fprintln(os.Stderr, "corpus:", err)
		os.Exit(1)
	}
}

func run(dump, seedPath, out, fixtures string, per int, record bool, ua string) error {
	inSeed, err := loadSeedBarcodes(seedPath)
	if err != nil {
		return err
	}
	cands, err := candidates(dump)
	if err != nil {
		return err
	}
	var rows []row
	seen := map[string]bool{} // a barcode sold at several chains counts once
	for _, c := range chains {
		list := cands[c.name]
		list = slices.DeleteFunc(list, func(r row) bool { return seen[r.barcode] })
		slices.SortFunc(list, func(a, b row) int { return strings.Compare(hash(a.barcode), hash(b.barcode)) })
		if len(list) > per {
			list = list[:per]
		}
		for _, r := range list {
			seen[r.barcode] = true
		}
		rows = append(rows, list...)
	}
	for i := range rows {
		rows[i].source = "off"
		if inSeed[rows[i].barcode] {
			rows[i].source = "catalog"
		}
	}
	rows = append(rows, misses()...)

	if record {
		if err := recordFixtures(rows, fixtures, ua); err != nil {
			return err
		}
	}
	return writeCSV(out, rows)
}

func hash(s string) string {
	h := sha256.Sum256([]byte("plate-corpus-v1" + s))
	return hex.EncodeToString(h[:])
}

func loadSeedBarcodes(path string) (map[string]bool, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro&immutable=1") // #nosec G304 -- operator-supplied build input
	if err != nil {
		return nil, fmt.Errorf("opening seed: %w", err)
	}
	defer func() { _ = db.Close() }()
	rows, err := db.QueryContext(context.Background(), `SELECT barcode FROM catalog_foods`)
	if err != nil {
		return nil, fmt.Errorf("reading seed: %w", err)
	}
	defer func() { _ = rows.Close() }()
	set := map[string]bool{}
	for rows.Next() {
		var b string
		if err := rows.Scan(&b); err != nil {
			return nil, fmt.Errorf("reading seed: %w", err)
		}
		set[b] = true
	}
	return set, rows.Err()
}

func candidates(dump string) (map[string][]row, error) {
	fh, err := os.Open(dump) // #nosec G304 -- operator-supplied build input
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
	get := func(rec []string, n string) string {
		if i, ok := col[n]; ok && i < len(rec) {
			return strings.TrimSpace(rec[i])
		}
		return ""
	}
	out := map[string][]row{}
	for {
		rec, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			continue
		}
		code := get(rec, "code")
		if len(code) < 8 || len(code) > 14 || strings.Trim(code, "0123456789") != "" {
			continue
		}
		if !strings.Contains(get(rec, "countries_tags"), "en:germany") || get(rec, "energy-kcal_100g") == "" {
			continue
		}
		name := get(rec, "product_name")
		scans, _ := strconv.Atoi(get(rec, "unique_scans_n"))
		if name == "" || scans < 2 {
			continue
		}
		stores := get(rec, "stores")
		for _, c := range chains {
			if c.pattern.MatchString(stores) {
				out[c.name] = append(out[c.name], row{chain: c.name, product: name, barcode: code})
			}
		}
	}
	return out, nil
}

// misses are structurally valid barcodes with no product; recording confirms OFF answers 404 for them.
func misses() []row {
	var out []row
	for i := range 10 {
		out = append(out, row{chain: "none", product: fmt.Sprintf("Known miss %d", i+1), barcode: fmt.Sprintf("40999999%04d", 7+i*13), source: "miss"})
	}
	return out
}

func recordFixtures(rows []row, dir, ua string) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating fixtures directory: %w", err)
	}
	client := &http.Client{Timeout: 15 * time.Second}
	fields := "code,product_name,product_name_de,generic_name,brands,quantity,serving_size,serving_quantity,nutriments,nutriscore_grade,image_front_url,image_url,ingredients_text,allergens,last_modified_t,countries_tags"
	for i := range rows {
		r := &rows[i]
		if r.source == "catalog" {
			continue
		}
		path := filepath.Join(dir, r.barcode+".json")
		if _, err := os.Stat(path); err == nil && r.source != "miss" {
			r.source = classify(path)
			continue
		}
		u := "https://world.openfoodfacts.org/api/v2/product/" + url.PathEscape(r.barcode) + ".json?fields=" + url.QueryEscape(fields)
		var resp *http.Response
		var body []byte
		for attempt := 0; ; attempt++ {
			req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, u, nil)
			req.Header.Set("User-Agent", ua)
			var err error
			resp, err = client.Do(req)
			if err != nil {
				return fmt.Errorf("fetching %s: %w", r.barcode, err)
			}
			body, _ = io.ReadAll(io.LimitReader(resp.Body, 2<<20))
			_ = resp.Body.Close()
			if resp.StatusCode != http.StatusTooManyRequests || attempt >= 6 {
				break
			}
			fmt.Fprintf(os.Stderr, "rate limited; waiting 70s (attempt %d)\n", attempt+1)
			time.Sleep(70 * time.Second)
		}
		switch resp.StatusCode {
		case http.StatusNotFound:
			if r.source != "miss" {
				r.source = "miss" // OFF no longer has it
			}
			_ = os.Remove(path)
		case http.StatusOK:
			if r.source == "miss" {
				return fmt.Errorf("%s was meant to be a miss but OFF has it; change the miss list", r.barcode)
			}
			if err := os.WriteFile(path, body, 0o600); err != nil {
				return fmt.Errorf("writing fixture: %w", err)
			}
			r.source = classify(path)
		default:
			return fmt.Errorf("fetching %s: status %d", r.barcode, resp.StatusCode)
		}
		time.Sleep(3200 * time.Millisecond) // about 18 requests a minute, well under the 30 a minute budget
	}
	return nil
}

// classify says whether a recorded product can be logged: OFF sometimes lists a product without usable nutrition.
func classify(fixture string) string {
	b, err := os.ReadFile(fixture) // #nosec G304 -- written by this tool
	if err != nil {
		return "off"
	}
	var env struct {
		Product food.OFFProduct `json:"product"`
	}
	if json.Unmarshal(b, &env) != nil {
		return "off"
	}
	if _, err := food.Normalize(env.Product, time.Now()); err != nil {
		return "unloggable"
	}
	return "off"
}

func writeCSV(path string, rows []row) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("creating output directory: %w", err)
	}
	fh, err := os.Create(path) // #nosec G304 -- operator-supplied build output
	if err != nil {
		return fmt.Errorf("creating corpus: %w", err)
	}
	w := csv.NewWriter(fh)
	_ = w.Write([]string{"chain", "product", "barcode", "expected_source"})
	for _, r := range rows {
		_ = w.Write([]string{r.chain, r.product, r.barcode, r.source})
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return fmt.Errorf("writing corpus: %w", err)
	}
	return fh.Close()
}
