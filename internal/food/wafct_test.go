package food

import (
	"archive/zip"
	"context"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

// writeWAFCTXLSX wraps writeXLSX's sheet in a workbook that names it like the real file does.
func writeWAFCTXLSX(t *testing.T, rows [][]string) string {
	t.Helper()
	src, err := zip.OpenReader(writeXLSX(t, rows))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = src.Close() }()
	path := filepath.Join(t.TempDir(), "wafct.xlsx")
	fh, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(fh)
	for _, f := range src.File {
		w, _ := zw.Create(f.Name)
		rc, _ := f.Open()
		_, _ = io.Copy(w, rc)
		_ = rc.Close()
	}
	extra := map[string]string{
		"xl/workbook.xml":            `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="01 Introduction" sheetId="1" r:id="rId9"/><sheet name="` + wafctSheet + `" sheetId="2" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId9" Target="worksheets/sheet9.xml"/></Relationships>`,
	}
	for name, body := range extra {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	_ = fh.Close()
	return path
}

var wafctHead = []string{"Code", "Food name in English", "Food name in French", "Scientific name", "BiblioID/Source", "Edible portion coefficient 1",
	"Energy\n(kJ)", "Energy\n(kcal)", "Water\n(g)", "Protein, total\n(g)", "Fat, total or [fat, derived by analysis using continuous extraction]\n(g)",
	"Carbohydrate, available; calculated by difference\n(g)", "Fibre, total dietary or [fibre, crude]\n(g)", "Ash\n(g)", "Calcium\n(mg)", "Iron\n(mg)",
	"Magnesium\n(mg)", "Phosphorus\n(mg)", "Potassium\n(mg)", "Sodium\n(mg)", "Zinc\n(mg)", "Copper\n(mg)", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "Fatty acids, total saturated\n(g)"}

func wafctRow(code, name, french, sci, src, kj, kcal, protein, fat, carbs, fiber, sodium, sat string) []string {
	r := make([]string, len(wafctHead))
	r[0], r[1], r[2], r[3], r[4], r[6], r[7], r[9], r[10], r[11], r[12], r[19], r[len(r)-1] = code, name, french, sci, src, kj, kcal, protein, fat, carbs, fiber, sodium, sat
	return r
}

var fixtureAliases = map[string]string{"06_008": "ogbono apon"}

func loadFixtureReference(t *testing.T, x *fx) {
	t.Helper()
	foods, _, err := ParseWAFCT(wafctFixture(t), time.Now(), fixtureAliases)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.InTx(context.Background(), x.db, func(r *store.Repo) error {
		return r.ReplaceReference(context.Background(), foods)
	}); err != nil {
		t.Fatal(err)
	}
}

func wafctFixture(t *testing.T) string {
	return writeWAFCTXLSX(t, [][]string{
		{"Title row"},
		wafctHead,
		{"Nuts, seeds and their products/Noix, graines et produits dérivés"},
		wafctRow("06_008", "Dikanut, kernel, dried, raw", "Noix dika", "Irvingia gabonensis", "GH_01", "2720", "650", "7.6", "[62.6]", "5.5", "17.3", "2", ""),
		wafctRow("02_005", "Cocoyam, tuber, white, raw", "Chou caraïbe", "Xanthosoma sagittifolium", "calc. from / de x", "570", "136", "3.3", "0.3", "28.9", "2", "9", "7.0000000000000007E-2"),
		wafctRow("09_099", "Fish, trace fat", "", "", "x", "300", "72", "17", "tr", "0", "0", "60", ""),
		wafctRow("09_098", "No energy", "", "", "x", "", "", "1", "1", "1", "1", "1", ""),
		wafctRow("09_097", "Impossible", "", "", "x", "", "9000", "1", "1", "1", "1", "1", ""),
	})
}

func TestParseWAFCTMapsNutrientsAndKeepsGapsNull(t *testing.T) {
	foods, res, err := ParseWAFCT(wafctFixture(t), time.Date(2026, 11, 22, 0, 0, 0, 0, time.UTC), fixtureAliases)
	if err != nil {
		t.Fatal(err)
	}
	if res.Imported != 3 || res.Skipped != 2 {
		t.Fatalf("result = %+v, want 3 imported and 2 skipped (no energy, impossible)", res)
	}
	byID := map[string]int{}
	for i, f := range foods {
		byID[f.RefID] = i
	}
	dika := foods[byID["wafct:06_008"]]
	if dika.Per100.Kcal != 650 || *dika.Per100.Fat != 62.6 || dika.Per100.Sugar != nil || dika.Per100.SatFat != nil {
		t.Fatalf("dika = %+v", dika.Per100)
	}
	if dika.Category != "Nuts, seeds and their products" || dika.ScientificName != "Irvingia gabonensis" {
		t.Fatalf("dika meta = %q / %q", dika.Category, dika.ScientificName)
	}
	if dika.LocalNames == "" || dika.Estimated {
		t.Fatalf("dika names = %q, estimated = %v", dika.LocalNames, dika.Estimated)
	}
	cocoyam := foods[byID["wafct:02_005"]]
	if !cocoyam.Estimated || math.Abs(*cocoyam.Per100.Salt-0.0225) > 1e-9 || math.Abs(*cocoyam.Per100.SatFat-0.07) > 1e-9 {
		t.Fatalf("cocoyam = %+v estimated=%v", cocoyam.Per100, cocoyam.Estimated)
	}
	if fat := foods[byID["wafct:09_099"]].Per100.Fat; fat == nil || *fat != 0 {
		t.Fatalf("a trace stays a measured near-zero value, got %v", fat)
	}
}

func TestParseWAFCTRejectsOtherFiles(t *testing.T) {
	if _, _, err := ParseWAFCT(writeXLSX(t, [][]string{{"a"}}), time.Now(), nil); err == nil {
		t.Fatal("a workbook without the table sheet must fail")
	}
}

func TestImportedReferenceFoodsAreSearchableByLocalName(t *testing.T) {
	x := newFx(t)
	loadFixtureReference(t, x)
	hits, err := x.svc.Search(context.Background(), uid, "ogbono")
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) == 0 || hits[0].Name != "Dikanut, kernel, dried, raw" || hits[0].RefID == nil || *hits[0].RefID != "wafct:06_008" {
		t.Fatalf("hits = %v", topNames(hits, 3))
	}
	if hits[0].ID != nil || hits[0].Barcode != nil {
		t.Fatal("a reference hit has neither a food id nor a barcode until it is selected")
	}
}

func TestSelectingAReferenceFoodMaterializesOneRowPerAccount(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	loadFixtureReference(t, x)
	a, err := x.svc.Reference(ctx, uid, "wafct:02_005")
	if err != nil {
		t.Fatal(err)
	}
	again, err := x.svc.Reference(ctx, uid, "wafct:02_005")
	if err != nil || again.ID != a.ID {
		t.Fatalf("a second selection must return the same row: %v / %v", err, again.ID)
	}
	if a.UserID != uid || a.Barcode != nil || a.Per100.Kcal != 136 {
		t.Fatalf("food = %+v", a)
	}
	// The search now shows the account's own row once, not the reference row as well.
	hits, _ := x.svc.Search(ctx, uid, "cocoyam")
	n := 0
	for _, h := range hits {
		if h.Name == "Cocoyam, tuber, white, raw" {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("cocoyam appears %d times in %v, want once", n, topNames(hits, 5))
	}
	if _, err := x.svc.Reference(ctx, uid, "wafct:nope"); err == nil {
		t.Fatal("an unknown id must be a not-found error")
	}
}

func TestNamesAreCleanedForPeople(t *testing.T) {
	cases := map[string]string{
		"Fonio, black, whole grains, boiled* (without salt), drained":           "Fonio, black, whole grains, boiled, drained",
		"Maize, Gougba variety, whole kernel, dry, raw (Benin), n=1":            "Maize, Gougba variety, whole kernel, dry, raw (Benin)",
		"Gappal (Burkina Faso)*: pearl millet porridge with milk and sugar":     "Pearl millet porridge with milk and sugar (Gappal, Burkina Faso)",
		"Cantonese rice with fish and noodles (Burkina Faso)*":                  "Cantonese rice with fish and noodles (Burkina Faso)",
		"Cocoyam, tuber, white, raw":                                            "Cocoyam, tuber, white, raw",
		"Instant noodles (Indomie), made from wheat flour, boiled and drained*": "Instant noodles (Indomie), made from wheat flour, boiled and drained",
	}
	for in, want := range cases {
		if got := wafctDisplayName(in); got != want {
			t.Errorf("wafctDisplayName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestARecipeRowIsDroppedOnlyWhenItsPlainTwinExists(t *testing.T) {
	mk := func(code, name string) domain.ReferenceFood {
		return domain.ReferenceFood{RefID: "wafct:" + code, Name: name}
	}
	got, merged := finishWAFCT([]domain.ReferenceFood{
		mk("1", "Yam, boiled* (as part of a recipe)"), mk("2", "Yam, boiled* (without salt), drained"),
		mk("3", "Cocoyam, boiled* (as part of a recipe)"),
	})
	if merged != 1 || len(got) != 2 || got[0].Name != "Yam, boiled, drained" || got[1].Name != "Cocoyam, boiled" {
		t.Fatalf("got %v merged %d", got, merged)
	}
}

func TestRepeatedNamesGetTheirCode(t *testing.T) {
	got, _ := finishWAFCT([]domain.ReferenceFood{
		{RefID: "wafct:1", Name: "Rice, raw"}, {RefID: "wafct:2", Name: "Rice, raw*"}, {RefID: "wafct:3", Name: "Yam"},
	})
	if got[0].Name != "Rice, raw [1]" || got[1].Name != "Rice, raw [2]" || got[2].Name != "Yam" {
		t.Fatalf("got %v", got)
	}
}

func TestOnlyWeighedFoodsAreKept(t *testing.T) {
	mk := func(name, category string) domain.ReferenceFood {
		return domain.ReferenceFood{RefID: "wafct:" + name, Name: name, Category: category}
	}
	kept, dropped := dropNotWeighed([]domain.ReferenceFood{
		mk("Cocoyam, tuber, white, raw", "Starchy roots"),
		mk("Gappal (Burkina Faso)*: pearl millet porridge", "Cereals"),
		mk("Babenda sauce", "Soups and sauces"),
		mk("Orange juice", "Beverages"),
		mk("Wheat flour, white, fortified with iron", "Cereals"),
		mk("Sardine, canned in oil, drained", "Fish"),
		mk("Maize, Gougba variety, raw (Benin), n=1", "Cereals"),
		mk("Yam, tuber, Isu akoko, raw (Nigeria), n=1", "Starchy roots"),
	})
	if dropped != 6 || len(kept) != 2 || kept[0].Name != "Cocoyam, tuber, white, raw" || kept[1].Name != "Yam, tuber, Isu akoko, raw (Nigeria), n=1" {
		t.Fatalf("kept %v, dropped %d", kept, dropped)
	}
}
