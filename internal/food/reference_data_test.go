package food

import (
	"bytes"
	"context"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
)

func TestShippedReferenceFoodsAreValidAndSearchable(t *testing.T) {
	var foods []domain.ReferenceFood
	for _, data := range [][]byte{wafctCSV, usdaCSV} {
		part, err := ReadReferenceCSV(bytes.NewReader(data), "test", time.Now())
		if err != nil {
			t.Fatal(err)
		}
		foods = append(foods, part...)
	}
	if len(foods) < 700 {
		t.Fatalf("shipped %d foods, want about 750", len(foods))
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for _, f := range foods {
		if ids[f.RefID] || names[f.Name] {
			t.Errorf("%s %q repeats an id or a name", f.RefID, f.Name)
		}
		ids[f.RefID], names[f.Name] = true, true
		if strings.ContainsAny(f.Name, "*") || strings.Contains(f.Name, "n=") || strings.Contains(f.Name, "as part of a recipe") {
			t.Errorf("%s: name %q is not cleaned", f.RefID, f.Name)
		}
	}

	x := newFx(t)
	ctx := context.Background()
	if err := EnsureReference(ctx, x.db, quiet()); err != nil {
		t.Fatal(err)
	}
	// What a person types for Nigerian soups must find the right food among the first results.
	for q, want := range map[string]string{
		"egusi": "Melon seed", "ogbono": "Dikanut", "okro": "Okra", "bitterleaf": "Vernonia", "ewedu": "Jute mallow",
		"iru": "African locust bean, fermented", "afang": "Wild spinach", "shaki": "Beef tripe", "garri": "white gari",
		"cocoyam": "Cocoyam", "plantain": "Plantain", "crayfish": "Shrimp (crayfish)", "ehuru": "Calabash nutmeg",
		"waterleaf": "Waterleaf", "isu": "Yam, tuber", "ogi": "ogi", "turkey": "Turkey, meat", "semo": "Semolina",
	} {
		hits, err := x.svc.Search(ctx, uid, q)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, h := range topNames(hits, 6) {
			found = found || strings.Contains(strings.ToLower(h), strings.ToLower(want))
		}
		if !found {
			t.Errorf("%q -> %v, want a hit containing %q", q, topNames(hits, 6), want)
		}
	}
}

func TestEnsureReferenceLoadsOnceAndReloadsOnANewVersion(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	csv1 := []byte("ref_id,name,local_names,scientific_name,category,kcal,protein,carbs,sugar,fat,satfat,fiber,salt,estimated,source\nwafct:1,Okra,okro,,Veg,30,2,7,,0.1,,3,,0,wafct-2019\n")
	if err := ensureReference(ctx, x.db, [][]byte{csv1}, "v1", quiet()); err != nil {
		t.Fatal(err)
	}
	// The same version is left alone, even with different rows on offer.
	csv2 := []byte("ref_id,name,local_names,scientific_name,category,kcal,protein,carbs,sugar,fat,satfat,fiber,salt,estimated,source\nwafct:2,Yam,isu,,Veg,118,1.5,28,,0.2,,4,,0,wafct-2019\n")
	if err := ensureReference(ctx, x.db, [][]byte{csv2}, "v1", quiet()); err != nil {
		t.Fatal(err)
	}
	if hits, _ := x.svc.Search(ctx, uid, "okra"); len(hits) != 1 {
		t.Fatalf("v1 should still hold okra: %v", topNames(hits, 3))
	}
	if err := ensureReference(ctx, x.db, [][]byte{csv2}, "v2", quiet()); err != nil {
		t.Fatal(err)
	}
	if hits, _ := x.svc.Search(ctx, uid, "okra"); len(hits) != 0 {
		t.Fatalf("v2 replaces the table: %v", topNames(hits, 3))
	}
	if hits, _ := x.svc.Search(ctx, uid, "isu"); len(hits) != 1 {
		t.Fatalf("v2 holds yam: %v", topNames(hits, 3))
	}
}

func TestReferenceCSVRoundTripKeepsGapsEmpty(t *testing.T) {
	n := func(v float64) *float64 { return &v }
	in := []domain.ReferenceFood{{
		RefID: "wafct:9", Name: `Odd, "quoted" name`, LocalNames: "a b", Category: "Veg",
		Per100: domain.Nutrients{Kcal: 12.5, Protein: n(0), Sugar: n(1.5), Fat: n(0.3)}, Estimated: true, Source: "s",
	}}
	var buf bytes.Buffer
	if err := WriteReferenceCSV(&buf, in); err != nil {
		t.Fatal(err)
	}
	out, err := ReadReferenceCSV(&buf, "v", time.Now())
	if err != nil || len(out) != 1 {
		t.Fatalf("%v %v", out, err)
	}
	f := out[0]
	if f.Name != in[0].Name || f.Per100.Kcal != 12.5 || f.Per100.Carbs != nil || f.Per100.Sugar == nil || *f.Per100.Sugar != 1.5 || f.Source != "s" || f.Per100.Protein == nil || *f.Per100.Protein != 0 || !f.Estimated {
		t.Fatalf("round trip lost something: %+v", f)
	}
}

func TestReadReferenceCSVRejectsBadRows(t *testing.T) {
	head := "ref_id,name,local_names,scientific_name,category,kcal,protein,carbs,sugar,fat,satfat,fiber,salt,estimated,source\n"
	for name, body := range map[string]string{
		"no energy":  "wafct:1,A,,,,,1,1,,1,,,,0,s\n",
		"impossible": "wafct:1,A,,,,9000,1,1,,1,,,,0,s\n",
		"not number": "wafct:1,A,,,,x,1,1,,1,,,,0,s\n",
		"no name":    "wafct:1,,,,,10,1,1,,1,,,,0,s\n",
		"no source":  "wafct:1,A,,,,10,1,1,,1,,,,0,\n",
	} {
		if _, err := ReadReferenceCSV(strings.NewReader(head+body), "v", time.Now()); err == nil {
			t.Errorf("%s: want an error", name)
		}
	}
	if _, err := ReadReferenceCSV(strings.NewReader("a,b\n"), "v", time.Now()); err == nil {
		t.Error("a wrong header must fail")
	}
}
