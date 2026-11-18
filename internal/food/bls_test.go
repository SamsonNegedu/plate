package food

import (
	"archive/zip"
	"context"
	"fmt"
	"html"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"plate/internal/domain"
)

// writeXLSX builds a minimal workbook the way Excel does: shared strings for text, numbers inline.
func writeXLSX(t *testing.T, rows [][]string) string {
	t.Helper()
	var shared []string
	idx := map[string]int{}
	var sheet strings.Builder
	sheet.WriteString(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for r, row := range rows {
		fmt.Fprintf(&sheet, `<row r="%d">`, r+1)
		for c, v := range row {
			if v == "" {
				continue // blank cells are absent, like in real files
			}
			ref := colName(c) + fmt.Sprint(r+1)
			if _, err := fmt.Sscanf(v, "%f", new(float64)); err == nil && !strings.ContainsAny(v, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
				fmt.Fprintf(&sheet, `<c r="%s"><v>%s</v></c>`, ref, v)
				continue
			}
			i, ok := idx[v]
			if !ok {
				i = len(shared)
				idx[v] = i
				shared = append(shared, v)
			}
			fmt.Fprintf(&sheet, `<c r="%s" t="s"><v>%d</v></c>`, ref, i)
		}
		sheet.WriteString(`</row>`)
	}
	sheet.WriteString(`</sheetData></worksheet>`)
	var ss strings.Builder
	ss.WriteString(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	for _, s := range shared {
		fmt.Fprintf(&ss, `<si><t>%s</t></si>`, html.EscapeString(s))
	}
	ss.WriteString(`</sst>`)

	path := filepath.Join(t.TempDir(), "bls.xlsx")
	fh, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(fh)
	for name, body := range map[string]string{"xl/worksheets/sheet1.xml": sheet.String(), "xl/sharedStrings.xml": ss.String()} {
		w, _ := zw.Create(name)
		_, _ = w.Write([]byte(body))
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	_ = fh.Close()
	return path
}

func colName(i int) string {
	s := ""
	for i++; i > 0; i = (i - 1) / 26 {
		s = string(rune('A'+(i-1)%26)) + s
	}
	return s
}

var blsHead = []string{
	"BLS Code", "Lebensmittelbezeichnung", "Food name",
	"ENERCJ Energie (Kilojoule) [kJ/100g]", "ENERCJ Datenherkunft", "ENERCJ Referenz",
	"ENERCC Energie (Kilokalorien) [kcal/100g]", "ENERCC Datenherkunft", "ENERCC Referenz",
	"PROT625 Protein (Nx6,25) [g/100g]", "PROT625 Datenherkunft",
	"FAT Fett [g/100g]", "FAT Datenherkunft",
	"CHO Kohlenhydrate, verfügbar [g/100g]", "CHO Datenherkunft",
	"FIBT Ballaststoffe, gesamt [g/100g]", "FIBT Datenherkunft",
	"NACL Salz (Natriumchlorid) [g/100g]", "NACL Datenherkunft",
	"NA Natrium [mg/100g]", "NA Datenherkunft",
	"SUGAR Zucker (Mono- und Disaccharide), gesamt [g/100g]", "SUGAR Datenherkunft",
	"FASAT Fettsäuren, gesättigt, gesamt [g/100g]", "FASAT Datenherkunft",
}

func blsRow(code, name, kj, kcal, protein, fat, carbs, fiber, nacl, na, sugar, sat string) []string {
	return []string{code, name, "", kj, "Formelberechnung", "-", kcal, "Formelberechnung", "-", protein, "Analyse", fat, "Analyse",
		carbs, "Formelberechnung", fiber, "Analyse", nacl, "Analyse", na, "Analyse", sugar, "Analyse", sat, "Analyse"}
}

func TestBLSImportMapsNutrientsAndKeepsGapsNull(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	path := writeXLSX(t, [][]string{
		blsHead,
		blsRow("C133000", "Hafer Flocken", "1465", "348", "13.22", "6.65", "53.3", "10.983", "", "5", "1.1", "1.2"),
		blsRow("B100000", "Apfel roh", "", "52", "", "", "11.4", "", "", "", "", ""), // only kcal and carbs reported
		blsRow("X999999", "Wasser", "0", "0", "0", "0", "0", "0", "0", "", "", ""),
	})
	res, err := ImportBLS(ctx, x.db, uid, path, quiet())
	if err != nil || res.Added != 3 || res.Skipped != 0 {
		t.Fatalf("res = %+v, %v", res, err)
	}
	oats, err := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "C133000")
	if err != nil {
		t.Fatal(err)
	}
	p := oats.Per100
	if oats.Name != "Hafer Flocken" || oats.Barcode != nil || p.Kcal != 348 || *p.Protein != 13.22 || *p.Carbs != 53.3 || *p.Fat != 6.65 ||
		*p.Fiber != 10.983 || *p.Sugar != 1.1 || *p.SatFat != 1.2 {
		t.Fatalf("oats = %+v %+v", oats, p)
	}
	if p.Salt == nil || *p.Salt != 0.0125 {
		t.Fatalf("salt = %v, want sodium 5 mg * 2.5 / 1000", p.Salt)
	}
	apple, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "B100000")
	if apple.Per100.Protein != nil || apple.Per100.Fat != nil || apple.Per100.Fiber != nil || apple.Per100.Salt != nil {
		t.Fatalf("missing BLS values must stay NULL: %+v", apple.Per100)
	}
	water, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "X999999")
	if water.Per100.Protein == nil || *water.Per100.Protein != 0 || water.Per100.Kcal != 0 {
		t.Fatalf("a reported zero stays zero: %+v", water.Per100)
	}
}

func TestBLSImportTwiceYieldsTheSameRows(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	path := writeXLSX(t, [][]string{blsHead, blsRow("C133000", "Hafer Flocken", "", "348", "13", "6", "53", "", "", "", "", "")})
	first, _ := ImportBLS(ctx, x.db, uid, path, quiet())
	before, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "C133000")
	second, err := ImportBLS(ctx, x.db, uid, path, quiet())
	if err != nil || first.Added != 1 || second.Added != 0 || second.Updated != 1 {
		t.Fatalf("first %+v second %+v %v", first, second, err)
	}
	after, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "C133000")
	if after.ID != before.ID || x.foodsCount(t) != 1 {
		t.Fatalf("foods = %d, id changed = %v", x.foodsCount(t), after.ID != before.ID)
	}
}

func TestBLSReimportNeverOverwritesAUserCorrection(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	path := writeXLSX(t, [][]string{blsHead, blsRow("C133000", "Hafer Flocken", "", "348", "13", "6", "53", "", "", "", "", "")})
	if _, err := ImportBLS(ctx, x.db, uid, path, quiet()); err != nil {
		t.Fatal(err)
	}
	row, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "C133000")
	if _, err := x.svc.SaveCustom(ctx, uid, row.ID, FoodInput{Name: "Meine Haferflocken", Per100: domain.Nutrients{Kcal: 360}}); err != nil {
		t.Fatal(err)
	}
	res, err := ImportBLS(ctx, x.db, uid, path, quiet())
	if err != nil || res.Protected != 1 || res.Added != 0 {
		t.Fatalf("res = %+v, %v", res, err)
	}
	got, _ := x.r.Food(ctx, uid, row.ID)
	if got.Name != "Meine Haferflocken" || got.Per100.Kcal != 360 || got.Source != domain.SourceUser {
		t.Fatalf("the correction was overwritten: %+v", got)
	}
	if x.foodsCount(t) != 1 {
		t.Fatalf("foods = %d; a corrected food must not be re-added", x.foodsCount(t))
	}
}

func TestBLSSkipsUnusableRowsAndRejectsWrongFiles(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	path := writeXLSX(t, [][]string{
		blsHead,
		blsRow("C133000", "Gut", "", "348", "13", "6", "53", "", "", "", "", ""),
		blsRow("BAD", "Falscher Code", "", "10", "", "", "", "", "", "", "", ""),
		blsRow("C100001", "Ohne Energie", "", "", "1", "", "", "", "", "", "", ""),
		blsRow("C100002", "", "", "10", "", "", "", "", "", "", "", ""),
		blsRow("C100003", "Absurd", "", "9999", "", "", "", "", "", "", "", ""),
		blsRow("C100004", "Kj nur", "418.4", "", "", "", "", "", "", "", "", ""),
	})
	res, err := ImportBLS(ctx, x.db, uid, path, quiet())
	if err != nil || res.Added != 2 || res.Skipped != 4 {
		t.Fatalf("res = %+v, %v", res, err)
	}
	kj, _ := x.r.FoodBySource(ctx, uid, domain.SourceBLS, "C100004")
	if math.Abs(kj.Per100.Kcal-100) > 0.001 {
		t.Fatalf("kj fallback = %v", kj.Per100.Kcal)
	}

	wrong := writeXLSX(t, [][]string{{"foo", "bar"}, {"1", "2"}})
	if _, err := ImportBLS(ctx, x.db, uid, wrong, quiet()); err == nil {
		t.Fatal("a file without BLS columns must be rejected")
	}
	notZip := filepath.Join(t.TempDir(), "x.xlsx")
	_ = os.WriteFile(notZip, []byte("not a zip"), 0o600)
	if _, err := ImportBLS(ctx, x.db, uid, notZip, quiet()); err == nil {
		t.Fatal("a non-xlsx file must be rejected")
	}
	if _, err := ImportBLS(ctx, x.db, uid, filepath.Join(t.TempDir(), "missing.xlsx"), quiet()); err == nil {
		t.Fatal("a missing file must be rejected")
	}
	if x.foodsCount(t) != 2 {
		t.Fatalf("rejected files changed the data: %d foods", x.foodsCount(t))
	}
}

func TestBLSFoodsAreSearchableByGermanName(t *testing.T) {
	x := newFx(t)
	path := writeXLSX(t, [][]string{blsHead,
		blsRow("C133000", "Hafer Flocken", "", "348", "13", "6", "53", "", "", "", "", ""),
		blsRow("F100000", "Äpfel, roh", "", "52", "", "", "", "", "", "", "", ""),
	})
	if _, err := ImportBLS(context.Background(), x.db, uid, path, quiet()); err != nil {
		t.Fatal(err)
	}
	res, err := x.svc.Search(context.Background(), uid, "apfel")
	if err != nil || len(res) == 0 || res[0].Name != "Äpfel, roh" || res[0].Source != domain.SourceBLS || res[0].Barcode != nil {
		t.Fatalf("res = %+v, %v", res, err)
	}
}

func TestBLSRealFile(t *testing.T) {
	path := os.Getenv("PLATE_TEST_BLS_FILE")
	if path == "" {
		t.Skip("set PLATE_TEST_BLS_FILE to the BLS 4.0 data file to run this")
	}
	x := newFx(t)
	res, err := ImportBLS(context.Background(), x.db, uid, path, quiet())
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("real BLS import: %+v", res)
	if res.Added < 7000 {
		t.Fatalf("added = %d, want about 7140", res.Added)
	}
	for q, want := range map[string]string{"Hafer Flocken": "Hafer Flocken", "Apfel": "Apfel", "Kartoffel": "Kartoffel", "Ei": ""} {
		hits, _ := x.svc.Search(context.Background(), uid, q)
		t.Logf("%q -> %v", q, topNames(hits, 3))
		if want != "" && len(hits) == 0 {
			t.Errorf("%q found nothing", q)
		}
	}
}
