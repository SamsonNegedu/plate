package food

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
	psync "plate/internal/sync"
)

type seed struct{ barcode, name, brand string }

var catalogSeed = []seed{
	{"4000000000011", "Joghurt", "Ehrmann"},
	{"4000000000012", "Joghurt Natur", "Milbona"},
	{"4000000000013", "Fruchtjoghurt Erdbeere", "Müller"},
	{"4000000000014", "Joghurt mild 3,5% Fett", "Gut & Günstig"},
	{"4000000000015", "Käse", "Hochland"},
	{"4000000000016", "Käsekuchen", "Kuchenzauber"},
	{"4000000000017", "Gouda Käse", "Milbona"},
	{"4000000000018", "Vollkornbrot", "Harry"},
	{"4000000000019", "Vollkornbrot Saaten", "Mestemacher"},
	{"4000000000020", "Knäckebrot Vollkorn", "Edeka"},
	{"4000000000021", "Müllermilch Schoko", "Müller"},
	{"4000000000022", "Hähnchenbrust", "Wiesenhof"},
	{"4000000000023", "Hähnchenbrustfilet", "Gut & Günstig"},
	{"4000000000024", "Milbona Cappuccino", "Milbona"},
	{"4000000000025", "Haferdrink", "Milbona"},
	{"4000000000026", "Jana jagoda guava", "Jana"},
	{"4000000000027", "Ja Erdnüsse", "Ja!"},
	{"4000000000028", "Ja! Schmelzkäse", "Ja!"},
	{"4000000000029", "Jägermeister", "Jägermeister"},
	{"4000000000030", "Schokolade", "Gut & Günstig"},
	{"4000000000031", "Gut & Günstig Nougat Bits", "Edeka"},
	{"4000000000032", "Skyr Joghurt Vanille", "Arla"},
}

func loadCatalog(t *testing.T, x *fx, rows []seed) {
	t.Helper()
	err := store.InTx(context.Background(), x.db, func(r *store.Repo) error {
		for _, s := range rows {
			if err := r.PutCatalogFood(context.Background(), domain.CatalogFood{
				Barcode: s.barcode, Name: s.name, Brand: s.brand, Per100: domain.Nutrients{Kcal: 100}, DatasetVersion: "v1", ImportedAt: stamp(now),
			}, stamp(now)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func topNames(res []Result, n int) []string {
	var out []string
	for _, r := range res[:min(n, len(res))] {
		out = append(out, r.Name)
	}
	return out
}

func TestGermanFixturesReturnTheExpectedProductInTheTopThree(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	cases := map[string]string{
		"joghurt":       "Joghurt",
		"Joghurt":       "Joghurt",
		"käse":          "Käse",
		"Kase":          "Käse",
		"Vollkornbrot":  "Vollkornbrot",
		"vollkorn":      "Vollkornbrot",
		"Müller":        "Müllermilch Schoko",
		"ja!":           "Ja Erdnüsse",
		"Gut & Günstig": "Schokolade",
		"Milbona":       "Milbona Cappuccino",
		"Hähnchenbrust": "Hähnchenbrust",
		"Hahnchenbrust": "Hähnchenbrust",
		"gut gunstig":   "Schokolade",
		"4000000000011": "Joghurt",
	}
	for q, want := range cases {
		res, err := x.svc.Search(context.Background(), uid, q)
		if err != nil {
			t.Errorf("%q: %v", q, err)
			continue
		}
		if !slices.Contains(topNames(res, 3), want) {
			t.Errorf("%q: top 3 = %v, want %q among them", q, topNames(res, 3), want)
		}
	}
	if x.off.searches.Load() != 0 {
		t.Log("note: OFF was consulted for a thin query (expected for queries with < 5 hits)")
	}
}

func TestJaBangPutsJaBrandProductsAheadOfJana(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	res, _ := x.svc.Search(context.Background(), uid, "ja!")
	if len(res) < 3 || strings.HasPrefix(res[0].Name, "Jana") {
		t.Fatalf("top = %v; Spike F's whole-word fix must put Ja! products first", topNames(res, 4))
	}
	for _, r := range res[:2] {
		if r.Brand != "Ja!" {
			t.Fatalf("top = %v", topNames(res, 4))
		}
	}
}

func TestPunctuationAndSyntaxNeverErrors(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	for _, q := range []string{`"`, `(`, `)`, `a:b`, `NEAR(`, `*`, `OR`, `AND NOT`, `^x`, `-käse`, `ja!!!`, `Gut & Günstig`, `'; DROP TABLE foods;--`, `käse*`, `"käse`} {
		if _, err := x.svc.Search(context.Background(), uid, q); err != nil {
			t.Errorf("%q: %v", q, err)
		}
	}
	if x.foodsCount(t) < 0 {
		t.Fatal("unreachable")
	}
	if _, err := x.db.Exec(`SELECT 1 FROM foods`); err != nil {
		t.Fatal("the table is gone")
	}
}

func TestPrefixSearchWorks(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	res, _ := x.svc.Search(context.Background(), uid, "vollk")
	if !slices.Contains(topNames(res, 5), "Vollkornbrot") {
		t.Fatalf("got %v", topNames(res, 5))
	}
	res, _ = x.svc.Search(context.Background(), uid, "Gouda Kä")
	if len(res) == 0 || res[0].Name != "Gouda Käse" {
		t.Fatalf("multi-token prefix: %v", topNames(res, 3))
	}
}

func TestExactBarcodeRanksFirst(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	res, _ := x.svc.Search(context.Background(), uid, "4000000000023")
	if len(res) == 0 || *res[0].Barcode != "4000000000023" {
		t.Fatalf("got %v", topNames(res, 3))
	}
}

func TestSearchMergesFoodsAndCatalogWithoutDuplicateBarcodes(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	if _, err := x.svc.Barcode(context.Background(), uid, "4000000000011"); err != nil { // materializes into foods
		t.Fatal(err)
	}
	res, _ := x.svc.Search(context.Background(), uid, "joghurt")
	seen := map[string]int{}
	for _, r := range res {
		seen[*r.Barcode]++
	}
	for bc, n := range seen {
		if n != 1 {
			t.Fatalf("barcode %s appears %d times", bc, n)
		}
	}
	for _, r := range res {
		if *r.Barcode == "4000000000011" && r.ID == nil {
			t.Fatal("the materialized food should win over its catalog row and carry its id")
		}
		if *r.Barcode == "4000000000012" && r.ID != nil {
			t.Fatal("an unselected catalog hit has no id until it is selected")
		}
	}
}

func TestUserCorrectionShadowsCatalogInSearch(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	bc := "4000000000011"
	if _, err := x.svc.SaveCustom(context.Background(), uid, "0190a1b2-0000-7000-8000-0000000000aa", FoodInput{
		Barcode: &bc, Name: "Joghurt (meins)", Per100: domain.Nutrients{Kcal: 70},
	}); err != nil {
		t.Fatal(err)
	}
	res, _ := x.svc.Search(context.Background(), uid, "joghurt")
	n := 0
	for _, r := range res {
		if r.Barcode != nil && *r.Barcode == bc {
			n++
			if r.Source != domain.SourceUser || r.Kcal100 != 70 {
				t.Fatalf("shadowing failed: %+v", r)
			}
		}
	}
	if n != 1 {
		t.Fatalf("barcode appears %d times", n)
	}
}

func TestFavoriteAndRecentBoosts(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	loadCatalog(t, x, catalogSeed)
	fav, err := x.svc.Barcode(ctx, uid, "4000000000032") // "Skyr Joghurt Vanille": a whole-word hit that would rank low
	if err != nil {
		t.Fatal(err)
	}
	if _, err := x.svc.SetFavorite(ctx, uid, fav.ID, true); err != nil {
		t.Fatal(err)
	}
	res, _ := x.svc.Search(ctx, uid, "joghurt")
	if res[0].Name != "Skyr Joghurt Vanille" || !res[0].Favorite {
		t.Fatalf("favorite boost: %v", topNames(res, 3))
	}

	recent, _ := x.svc.Barcode(ctx, uid, "4000000000014")
	svc := psync.NewService(x.db)
	svc.SetClock(func() time.Time { return x.now })
	if _, err := svc.PutEntry(ctx, uid, "0190a1b2-0000-7000-8000-0000000000e1", psync.EntryBody{
		EatenOn: "2026-11-13", Meal: "lunch", FoodID: &recent.ID, Name: recent.Name, Amount: 100, Unit: "g", Grams: 100, Kcal: 100,
		ClientUpdatedAt: stamp(x.now),
	}); err != nil {
		t.Fatal(err)
	}
	res, _ = x.svc.Search(ctx, uid, "joghurt")
	if res[0].Name != "Skyr Joghurt Vanille" || res[1].Name != "Joghurt mild 3,5% Fett" {
		t.Fatalf("favorite then recent expected, got %v", topNames(res, 3))
	}
}

func TestShortQueriesReturnNothingAndSkipOFF(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	for _, q := range []string{"", " ", "j", "!"} {
		res, err := x.svc.Search(context.Background(), uid, q)
		if err != nil || len(res) != 0 {
			t.Errorf("%q: %v %v", q, res, err)
		}
	}
	if x.off.searches.Load() != 0 {
		t.Fatal("OFF was called for a trivial query")
	}
}

func TestOFFFallbackStoresHitsAndNextQueryIsLocal(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.off.hits = []OFFProduct{
		offProduct("4100000000011", "Skyr Vanille", 63),
		offProduct("4100000000012", "Skyr Natur", 57),
		{Code: "4100000000013", ProductName: "Skyr ohne Zahlen", Nutriments: map[string]rawJSON{"proteins_100g": rawJSON("11")}},
	}
	res, err := x.svc.Search(ctx, uid, "skyr")
	if err != nil {
		t.Fatal(err)
	}
	if len(res) != 2 {
		t.Fatalf("results = %v; a hit without kcal must be dropped, not shown as zero-calorie", topNames(res, 5))
	}
	for _, r := range res {
		if r.ID == nil || r.Kcal100 == 0 {
			t.Fatalf("OFF hits are stored and loggable: %+v", r)
		}
	}
	if x.off.searches.Load() != 1 {
		t.Fatalf("searches = %d", x.off.searches.Load())
	}
	res, _ = x.svc.Search(ctx, uid, "skyr")
	if len(res) != 2 || x.off.searches.Load() != 1 {
		t.Fatalf("the repeat must be answered locally: %d results, %d searches", len(res), x.off.searches.Load())
	}
	if x.foodsCount(t) != 2 {
		t.Fatalf("foods = %d", x.foodsCount(t))
	}
}

func TestOFFSearchNeverOverwritesUserRow(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	bc := "4100000000011"
	if _, err := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000aa", FoodInput{Barcode: &bc, Name: "Skyr (meins)", Per100: domain.Nutrients{Kcal: 80}}); err != nil {
		t.Fatal(err)
	}
	x.off.hits = []OFFProduct{offProduct(bc, "Skyr Vanille", 63)}
	res, _ := x.svc.Search(ctx, uid, "skyr")
	if len(res) != 1 || res[0].Source != domain.SourceUser || res[0].Kcal100 != 80 {
		t.Fatalf("res = %+v", res)
	}
}

func TestEmptyOFFResultIsCachedBriefly(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	for range 3 {
		_, _ = x.svc.Search(ctx, uid, "zzzzqqq")
	}
	if x.off.searches.Load() != 1 {
		t.Fatalf("searches = %d, want 1", x.off.searches.Load())
	}
	x.now = x.now.Add(61 * time.Minute)
	_, _ = x.svc.Search(ctx, uid, "zzzzqqq")
	if x.off.searches.Load() != 2 {
		t.Fatal("an empty result is cached for one hour only")
	}
}

func TestUpstreamFailureKeepsLocalResults(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	x.off.err = &UpstreamError{Reason: "down"}
	res, err := x.svc.Search(context.Background(), uid, "milbona")
	if err != nil || len(res) == 0 {
		t.Fatalf("res=%d err=%v", len(res), err)
	}
	x.off.err = errors.New("boom")
	if _, err := x.svc.Search(context.Background(), uid, "milbona"); err != nil {
		t.Fatalf("any OFF failure must leave local results intact: %v", err)
	}
}

func TestEnoughLocalHitsSkipOFF(t *testing.T) {
	x := newFx(t)
	var rows []seed
	for i := range 8 {
		rows = append(rows, seed{fmt.Sprintf("42000000000%02d", i), fmt.Sprintf("Müsli Variante %d", i), "Marke"})
	}
	loadCatalog(t, x, rows)
	_, _ = x.svc.Search(context.Background(), uid, "müsli")
	if x.off.searches.Load() != 0 {
		t.Fatal("five or more local hits must not call OFF")
	}
}

func TestSearchIsFastOnTwentyThousandRows(t *testing.T) {
	if testing.Short() {
		t.Skip("slow seed")
	}
	x := newFx(t)
	kinds := []string{"Joghurt", "Käse", "Brot", "Müsli", "Schokolade", "Nudeln", "Reis", "Wurst", "Milch", "Quark"}
	mods := []string{"Vollkorn", "Bio", "Fettarm", "Mild", "Cremig", "Klassik", "Frisch", "Würzig", "Light", "Extra"}
	brands := []string{"Müller", "Ehrmann", "Gut & Günstig", "Milbona", "Ja!", "K-Classic", "Alnatura"}
	var rows []seed
	for i := range 20000 {
		rows = append(rows, seed{fmt.Sprintf("43%011d", i), fmt.Sprintf("%s %s %s %d", mods[i%10], kinds[(i/10)%10], mods[(i/100)%10], i), brands[i%len(brands)]})
	}
	loadCatalog(t, x, rows)
	x.off.hits = nil
	var durs []time.Duration
	for range 60 {
		start := time.Now()
		if _, err := x.svc.Search(context.Background(), uid, "vollkorn joghurt"); err != nil {
			t.Fatal(err)
		}
		durs = append(durs, time.Since(start))
	}
	sort.Slice(durs, func(i, j int) bool { return durs[i] < durs[j] })
	if p95 := durs[len(durs)*95/100]; p95 > 40*time.Millisecond {
		t.Fatalf("p95 = %s on 20k rows", p95)
	}
}

func TestGermanCompoundsAreFoundBySubstring(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, []seed{
		{"4000000000101", "Brot Weizen", "Harry"},
		{"4000000000102", "Brotaufstrich Kräuter", "Alnatura"},
		{"4000000000103", "Vollkornbrot", "Mestemacher"},
		{"4000000000104", "Toastbrot Dinkel", "Golden Toast"},
		{"4000000000105", "Frischkäse natur", "Exquisa"},
		{"4000000000106", "Schmelzkäse Scheiben", "Ja!"},
		{"4000000000107", "Käse", "Hochland"},
		{"4000000000108", "Hirtenkäse", "Gut & Günstig"},
		{"4000000000109", "Nudeln", "Barilla"},
	})
	ctx := context.Background()

	res, _ := x.svc.Search(ctx, uid, "brot")
	got := topNames(res, 10)
	want := []string{"Brot Weizen", "Brotaufstrich Kräuter"}
	if !slices.Equal(got[:2], want) {
		t.Fatalf("whole-word then prefix come first, got %v", got)
	}
	for _, n := range []string{"Vollkornbrot", "Toastbrot Dinkel"} {
		if !slices.Contains(got, n) {
			t.Errorf("%q missing from %v: a compound must be found by its tail", n, got)
		}
	}
	if slices.Contains(got, "Nudeln") {
		t.Errorf("unrelated product returned: %v", got)
	}
	if slices.Index(got, "Vollkornbrot") < 2 {
		t.Errorf("substring hits rank after word hits: %v", got)
	}

	for q, must := range map[string][]string{
		"käse": {"Käse", "Frischkäse natur", "Schmelzkäse Scheiben", "Hirtenkäse"},
		"kase": {"Käse", "Frischkäse natur", "Hirtenkäse"},
		"KÄSE": {"Frischkäse natur"},
	} {
		res, _ := x.svc.Search(ctx, uid, q)
		got := topNames(res, 10)
		for _, n := range must {
			if !slices.Contains(got, n) {
				t.Errorf("%q: %q missing from %v", q, n, got)
			}
		}
		if got[0] != "Käse" {
			t.Errorf("%q: the exact word should lead, got %v", q, got)
		}
	}
	res, _ = x.svc.Search(ctx, uid, "schmelz käse")
	if len(res) == 0 || res[0].Name != "Schmelzkäse Scheiben" {
		t.Fatalf("two-token query across a compound: %v", topNames(res, 3))
	}
}

func TestInfixQueriesShorterThanThreeCharsNeverError(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, catalogSeed)
	for _, q := range []string{"ei", "ja", "ab ei", "a ei", "ö ü"} {
		if _, err := x.svc.Search(context.Background(), uid, q); err != nil {
			t.Errorf("%q: %v", q, err)
		}
	}
}

func TestTrigramIndexFollowsFoodChanges(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	f, err := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000f1", FoodInput{Name: "Roggenmischbrot", Per100: domain.Nutrients{Kcal: 200}})
	if err != nil {
		t.Fatal(err)
	}
	res, _ := x.svc.Search(ctx, uid, "mischbrot")
	if len(res) != 1 {
		t.Fatalf("a new food must be searchable by substring: %v", topNames(res, 3))
	}
	if _, err := x.svc.SaveCustom(ctx, uid, f.ID, FoodInput{Name: "Dinkelkeks", Per100: domain.Nutrients{Kcal: 400}}); err != nil {
		t.Fatal(err)
	}
	if res, _ := x.svc.Search(ctx, uid, "mischbrot"); len(res) != 0 {
		t.Fatalf("the old name must leave the index: %v", topNames(res, 3))
	}
	if res, _ := x.svc.Search(ctx, uid, "keks"); len(res) != 1 {
		t.Fatal("the new name must enter the index")
	}
}

func loadPopular(t *testing.T, x *fx, rows []struct {
	barcode, name, brand string
	scans                int64
}) {
	t.Helper()
	err := store.InTx(context.Background(), x.db, func(r *store.Repo) error {
		for _, c := range rows {
			if err := r.PutCatalogFood(context.Background(), domain.CatalogFood{
				Barcode: c.barcode, Name: c.name, Brand: c.brand, Scans: c.scans, Per100: domain.Nutrients{Kcal: 100},
				DatasetVersion: "v1", ImportedAt: stamp(now),
			}, stamp(now)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAPartialWordPutsTheWidelyScannedProductFirstEvenAmongHundredsOfMatches(t *testing.T) {
	x := newFx(t)
	var rows []struct {
		barcode, name, brand string
		scans                int64
	}
	// 200 obscure products that all start with "nut" and read better to the text ranker (shorter names), plus the one everybody scans.
	for i := 0; i < 200; i++ {
		rows = append(rows, struct {
			barcode, name, brand string
			scans                int64
		}{fmt.Sprintf("5%012d", i), fmt.Sprintf("Nut %d", i), "Obscure", 2})
	}
	rows = append(rows, struct {
		barcode, name, brand string
		scans                int64
	}{"3017620422003", "Nutella Nuss-Nougat-Creme", "Ferrero", 1683})
	loadPopular(t, x, rows)

	for _, q := range []string{"nut", "nute", "nutel"} {
		res, err := x.svc.Search(context.Background(), uid, q)
		if err != nil {
			t.Fatal(err)
		}
		pos := slices.IndexFunc(res, func(r Result) bool { return r.Barcode != nil && *r.Barcode == "3017620422003" })
		if pos < 0 || pos > 4 {
			t.Errorf("%q: Nutella at position %d of %d, want the top five", q, pos, len(res))
		}
	}
}

func TestGermanSpellingsWithoutUmlautKeysFindTheSameProducts(t *testing.T) {
	x := newFx(t)
	loadCatalog(t, x, []seed{
		{"4000000000101", "Käse mild", "Hochland"},
		{"4000000000102", "Gouda Käse", "Milbona"},
		{"4000000000103", "Müller Reis", "Müller"},
		{"4000000000104", "Hähnchenbrust", "Wiesenhof"},
		{"4000000000105", "Weißbrot", "Harry"},
		{"4000000000106", "Weissbrot Toast", "Golden Toast"},
		{"4000000000107", "Soße Bolognese", "Knorr"},
		{"4000000000108", "Sosse Hollandaise", "Maggi"},
	})
	cases := map[string]int{ // query -> products that must come back
		"kaese":      2,
		"käse":       2,
		"mueller":    1,
		"müller":     1,
		"haehnchen":  1,
		"weissbrot":  2,
		"weißbrot":   2,
		"sosse":      2,
		"soße":       2,
		"kaes milde": 0, // a typo is still a typo
	}
	for q, want := range cases {
		res, err := x.svc.Search(context.Background(), uid, q)
		if err != nil {
			t.Fatal(err)
		}
		if len(res) < want {
			t.Errorf("%q found %d, want at least %d: %v", q, len(res), want, resultNames(res))
		}
	}
}

func resultNames(res []Result) []string {
	out := make([]string, len(res))
	for i, r := range res {
		out[i] = r.Name
	}
	return out
}
