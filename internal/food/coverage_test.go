package food

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
)

// fixtureOFF answers from recorded OFF responses so the coverage run is deterministic and never touches the network.
type fixtureOFF struct {
	dir   string
	calls int
}

func (f *fixtureOFF) Product(_ context.Context, code string) (OFFProduct, error) {
	f.calls++
	b, err := os.ReadFile(filepath.Join(f.dir, code+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return OFFProduct{}, ErrProductNotFound
	}
	if err != nil {
		return OFFProduct{}, err
	}
	var env struct {
		Product OFFProduct `json:"product"`
	}
	if err := json.Unmarshal(b, &env); err != nil {
		return OFFProduct{}, err
	}
	return env.Product, nil
}

func (f *fixtureOFF) Search(context.Context, string) ([]OFFProduct, error) { return nil, nil }

type corpusRow struct{ chain, product, barcode, expected string }

func readCorpus(t *testing.T) []corpusRow {
	t.Helper()
	fh, err := os.Open("testdata/barcodes-de.csv")
	if errors.Is(err, os.ErrNotExist) {
		t.Skip("no corpus: build it with `make coverage-live`")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = fh.Close() }()
	recs, err := csv.NewReader(fh).ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	var rows []corpusRow
	for _, r := range recs[1:] {
		rows = append(rows, corpusRow{r[0], r[1], r[2], r[3]})
	}
	return rows
}

// TestCoverage runs the German barcode corpus through the real lookup flow. With PLATE_COVERAGE_SEED pointing at the
// release catalog it measures coverage; without it, it builds a seed from the rows the corpus says the catalog covers and
// checks that the pipeline classifies every row as recorded.
func TestCoverage(t *testing.T) {
	rows := readCorpus(t)
	if len(rows) < 200 {
		t.Fatalf("the corpus has %d rows; the plan asks for at least 200", len(rows))
	}
	x := newFx(t)
	fx := &fixtureOFF{dir: "testdata/off-fixtures"}
	x.svc = NewService(x.db, fx, quiet())
	x.svc.SetClock(func() time.Time { return x.now })

	realSeed := os.Getenv("PLATE_COVERAGE_SEED")
	seedPath := realSeed
	if seedPath == "" {
		var catalog []domain.CatalogFood
		for _, r := range rows {
			if r.expected == "catalog" && !haveBarcode(catalog, r.barcode) {
				catalog = append(catalog, domain.CatalogFood{Barcode: r.barcode, Name: r.product, Per100: domain.Nutrients{Kcal: 100}})
			}
		}
		seedPath = seedFile(t, catalog, "corpus-slice")
	}
	if _, err := ImportCatalog(context.Background(), x.db, seedPath, quiet()); err != nil {
		t.Fatal(err)
	}

	type tally struct{ total, catalog, off, miss, unloggable int }
	perChain := map[string]*tally{}
	var overall tally
	mismatch := 0
	for _, r := range rows {
		got := "miss"
		before := fx.calls
		f, err := x.svc.Barcode(context.Background(), uid, r.barcode)
		switch {
		case err == nil && f.Source == domain.SourceCatalog:
			got = "catalog"
			if fx.calls != before {
				t.Errorf("%s (%s): a catalog hit called OFF", r.barcode, r.product)
			}
		case err == nil:
			got = "off"
		case errors.Is(err, domain.ErrNotLoggable):
			got = "unloggable" // OFF lists it without usable nutrition: the manual flow takes over
		case errors.Is(err, domain.ErrNotFound):
		default:
			t.Errorf("%s (%s): unexpected error %v; every miss must land in the manual flow without an error", r.barcode, r.product, err)
		}
		if realSeed == "" && got != r.expected {
			mismatch++
			t.Errorf("%s (%s, %s): resolved as %s, corpus says %s", r.barcode, r.product, r.chain, got, r.expected)
		}
		tl := perChain[r.chain]
		if tl == nil {
			tl = &tally{}
			perChain[r.chain] = tl
		}
		for _, c := range []*tally{tl, &overall} {
			c.total++
			switch got {
			case "catalog":
				c.catalog++
			case "off":
				c.off++
			case "unloggable":
				c.unloggable++
			default:
				c.miss++
			}
		}
	}

	names := make([]string, 0, len(perChain))
	for n := range perChain {
		names = append(names, n)
	}
	sort.Strings(names)
	var report strings.Builder
	fmt.Fprintf(&report, "\n%-12s %6s %8s %6s %6s %11s %9s\n", "chain", "rows", "catalog", "OFF", "miss", "no kcal", "catalog%")
	for _, n := range names {
		c := perChain[n]
		fmt.Fprintf(&report, "%-12s %6d %8d %6d %6d %11d %8.0f%%\n", n, c.total, c.catalog, c.off, c.miss, c.unloggable, pct(c.catalog, c.total))
	}
	existing := overall.total - countMisses(rows) - overall.unloggable
	fmt.Fprintf(&report, "\nrows expected to exist: %d. catalog without OFF: %.1f%%. resolved overall: %.1f%%\n",
		existing, pct(overall.catalog, existing), pct(overall.catalog+overall.off, existing))
	t.Log(report.String())
	if p := os.Getenv("PLATE_COVERAGE_REPORT"); p != "" {
		_ = os.MkdirAll(filepath.Dir(p), 0o750)
		_ = os.WriteFile(p, []byte(report.String()), 0o600)
	}

	if realSeed != "" {
		if pct(overall.catalog, existing) < 70 {
			t.Errorf("only %.1f%% of the corpus resolves from the catalog without OFF; the target is 70%%", pct(overall.catalog, existing))
		}
		if pct(overall.catalog+overall.off, existing) < 95 {
			t.Errorf("only %.1f%% resolves overall; the target is 95%%", pct(overall.catalog+overall.off, existing))
		}
	}
	if mismatch > 0 {
		t.Fatalf("%d rows were classified differently from the corpus", mismatch)
	}
}

func haveBarcode(rows []domain.CatalogFood, code string) bool {
	for _, c := range rows {
		if c.Barcode == code {
			return true
		}
	}
	return false
}

func countMisses(rows []corpusRow) int {
	n := 0
	for _, r := range rows {
		if r.expected == "miss" {
			n++
		}
	}
	return n
}

func pct(a, b int) float64 {
	if b == 0 {
		return 0
	}
	return 100 * float64(a) / float64(b)
}

// TestRealSeedSearch imports the release catalog and checks the German fixture queries and speed on real data.
func TestRealSeedSearch(t *testing.T) {
	seed := os.Getenv("PLATE_COVERAGE_SEED")
	if seed == "" {
		t.Skip("set PLATE_COVERAGE_SEED to the release catalog (make catalog) to run this")
	}
	x := newFx(t)
	start := time.Now()
	res, err := ImportCatalog(context.Background(), x.db, seed, quiet())
	if err != nil {
		t.Fatal(err)
	}
	var dbBytes int64
	_ = x.db.QueryRow(`SELECT page_count * page_size FROM pragma_page_count, pragma_page_size`).Scan(&dbBytes)
	t.Logf("imported %d rows in %s; database %.1f MB", res.Rows, time.Since(start).Round(time.Millisecond), float64(dbBytes)/1e6)

	queries := []string{"joghurt", "Joghurt", "käse", "Kase", "Vollkornbrot", "vollkorn", "Müller", "ja!", "Gut & Günstig", "Milbona",
		"Hähnchenbrust", "brot", "nutella", "haferflocken", "80177173"}
	var durs []time.Duration
	for _, q := range queries {
		var d []time.Duration
		var top []Result
		for range 20 {
			s := time.Now()
			top, err = x.svc.Search(context.Background(), uid, q)
			d = append(d, time.Since(s))
			if err != nil {
				t.Fatalf("%q: %v", q, err)
			}
		}
		sort.Slice(d, func(i, j int) bool { return d[i] < d[j] })
		durs = append(durs, d[len(d)*95/100])
		t.Logf("%-16s p95 %-8s %d results: %v", q, d[len(d)*95/100].Round(10*time.Microsecond), len(top), topNames(top, 3))
		if len(top) == 0 {
			t.Errorf("%q found nothing", q)
		}
	}
	var lookups []time.Duration
	var codes []string
	rows, err := x.db.Query(`SELECT barcode FROM catalog_foods ORDER BY scans DESC LIMIT 200`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		codes = append(codes, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for _, c := range codes { // first lookups materialize the rows; the second pass is the cached path
		_, _ = x.svc.Barcode(context.Background(), uid, c)
	}
	for _, c := range codes {
		s := time.Now()
		if _, err := x.svc.Barcode(context.Background(), uid, c); err != nil {
			t.Fatal(err)
		}
		lookups = append(lookups, time.Since(s))
	}
	sort.Slice(lookups, func(i, j int) bool { return lookups[i] < lookups[j] })
	t.Logf("cached barcode lookup p95 %s over %d lookups", lookups[len(lookups)*95/100].Round(10*time.Microsecond), len(lookups))
	if p := lookups[len(lookups)*95/100]; p > 50*time.Millisecond {
		t.Errorf("cached barcode lookup p95 = %s; the budget is 50 ms", p)
	}
	sort.Slice(durs, func(i, j int) bool { return durs[i] < durs[j] })
	if worst := durs[len(durs)-1]; worst > 20*time.Millisecond {
		t.Errorf("worst p95 = %s; the budget is 20 ms", worst)
	}
}
