package food

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
)

var now = time.Date(2026, 11, 13, 9, 0, 0, 0, time.UTC)

func product(t *testing.T, js string) OFFProduct {
	t.Helper()
	var p OFFProduct
	if err := json.Unmarshal([]byte(js), &p); err != nil {
		t.Fatal(err)
	}
	return p
}

func f(v float64) *float64 { return &v }

func TestNormalizeRealNutellaResponse(t *testing.T) {
	raw, err := os.ReadFile("testdata/product_nutella.json")
	if err != nil {
		t.Fatal(err)
	}
	var env struct {
		Product OFFProduct `json:"product"`
	}
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	n, err := Normalize(env.Product, now)
	if err != nil {
		t.Fatal(err)
	}
	fd := n.Food
	if fd.Per100.Kcal != 539 || fd.Per100.Protein == nil || *fd.Per100.Protein != 6.3 || fd.Per100.Fat == nil || *fd.Per100.Fat != 30.9 {
		t.Fatalf("nutrients = %+v", fd.Per100)
	}
	if fd.Barcode == nil || *fd.Barcode != "3017620422003" || fd.Source != domain.SourceOFF || fd.SourceCheckedAt == nil {
		t.Fatalf("food = %+v", fd)
	}
	if fd.Per100.Salt == nil || *fd.Per100.Salt != 0.107 {
		t.Fatalf("salt = %v", fd.Per100.Salt)
	}
	if fd.Name == "" || fd.SearchName == "" || fd.SourceUpdatedAt == nil {
		t.Fatalf("name/search/updated missing: %+v", fd)
	}
}

func TestPerServingEnergyIsNeverReadAsPer100g(t *testing.T) {
	// Only per-serving data and no serving weight: kcal must stay missing, not become 180.
	_, err := Normalize(product(t, `{"code":"4000000000011","product_name":"Riegel",
		"nutriments":{"energy-kcal_serving":180,"energy-kcal":180,"energy-kj_serving":753}}`), now)
	nl, ok := IsNotLoggable(err)
	if !ok || nl.Reason != ReasonNoNutrition || !errors.Is(err, domain.ErrNotLoggable) {
		t.Fatalf("err = %v", err)
	}
}

func TestPerServingEnergyConvertsWhenServingWeightIsKnown(t *testing.T) {
	n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"Riegel","serving_quantity":"30",
		"nutriments":{"energy-kcal_serving":150}}`), now)
	if err != nil {
		t.Fatal(err)
	}
	if n.Food.Per100.Kcal != 500 {
		t.Fatalf("kcal = %v, want 150 / 30 g * 100 = 500", n.Food.Per100.Kcal)
	}
	if n.Food.Per100.Protein != nil {
		t.Fatal("macros are never taken from per-serving fields")
	}
}

func TestKilojouleFallbacks(t *testing.T) {
	cases := map[string]struct {
		nutr string
		want float64
	}{
		"kj_100g":                {`{"energy-kj_100g":2252}`, 2252 / 4.184},
		"energy_100g default kJ": {`{"energy_100g":418.4}`, 100},
		"energy_100g with kcal":  {`{"energy_100g":250,"energy_unit":"kcal"}`, 250},
		"kcal wins over kj":      {`{"energy-kcal_100g":100,"energy-kj_100g":9999}`, 100},
		"string numbers":         {`{"energy-kcal_100g":"61,5"}`, 61.5},
	}
	for name, c := range cases {
		n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriments":`+c.nutr+`}`), now)
		if err != nil || (n.Food.Per100.Kcal-c.want) > 0.001 || (c.want-n.Food.Per100.Kcal) > 0.001 {
			t.Errorf("%s: kcal = %v, %v; want %v", name, n.Food.Per100.Kcal, err, c.want)
		}
	}
	if _, err := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriments":{"energy_100g":250,"energy_unit":"mystery"}}`), now); err == nil {
		t.Error("an energy field of unknown unit must not be guessed")
	}
}

func TestMissingNutrientsStayNull(t *testing.T) {
	n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"Joghurt","brands":"ja!, Rewe",
		"nutriments":{"energy-kcal_100g":61,"fat_100g":3.5}}`), now)
	if err != nil {
		t.Fatal(err)
	}
	p := n.Food.Per100
	if p.Protein != nil || p.Carbs != nil || p.Sugar != nil || p.Salt != nil || p.Fiber != nil {
		t.Fatalf("missing nutrients must be nil: %+v", p)
	}
	if n.Food.Brand != "ja!" {
		t.Fatalf("brand = %q, want the first brand", n.Food.Brand)
	}
}

func TestZeroKcalProductIsLoggable(t *testing.T) {
	n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"Wasser","nutriments":{"energy-kcal_100g":0}}`), now)
	if err != nil || n.Food.Per100.Kcal != 0 {
		t.Fatalf("water: %v %v", n.Food.Per100.Kcal, err)
	}
}

func TestSaltFallsBackToSodium(t *testing.T) {
	n, _ := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriments":{"energy-kcal_100g":10,"sodium_100g":0.4}}`), now)
	if n.Food.Per100.Salt == nil || *n.Food.Per100.Salt != 1 {
		t.Fatalf("salt = %v, want 0.4 * 2.5", n.Food.Per100.Salt)
	}
}

func TestNutriscoreOnlyAToE(t *testing.T) {
	for in, want := range map[string]string{"a": "a", "E": "e", "unknown": "", "": "", "not-applicable": "", "f": ""} {
		n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriscore_grade":"`+in+`","nutriments":{"energy-kcal_100g":10}}`), now)
		if err != nil {
			t.Fatal(err)
		}
		got := ""
		if n.Food.Nutriscore != nil {
			got = *n.Food.Nutriscore
		}
		if got != want {
			t.Errorf("nutriscore %q -> %q, want %q", in, got, want)
		}
	}
}

func TestServingGrams(t *testing.T) {
	cases := []struct {
		size string
		qty  *float64
		want *float64
	}{
		{"1 Riegel", nil, nil},
		{"30 g", nil, f(30)},
		{"1 Glas (250 ml)", nil, f(250)},
		{"1,5 g", nil, f(1.5)},
		{"1 Riegel", f(35), f(35)},
		{"30 g", f(25), f(25)},
		{"", nil, nil},
		{"0 g", nil, nil},
	}
	for _, c := range cases {
		got := ParseServingGrams(c.size, c.qty)
		if (got == nil) != (c.want == nil) || (got != nil && *got != *c.want) {
			t.Errorf("%q %v -> %v, want %v", c.size, c.qty, got, c.want)
		}
	}
}

func TestNameFallbacksAndUnnamedProducts(t *testing.T) {
	cases := map[string]struct {
		js   string
		want string
		ok   bool
	}{
		"german name wins":     {`{"product_name":"Cheese","product_name_de":"Käse","nutriments":{"energy-kcal_100g":1}}`, "Käse", true},
		"generic name":         {`{"generic_name":"Joghurt","nutriments":{"energy-kcal_100g":1}}`, "Joghurt", true},
		"brand as last resort": {`{"brands":"Milbona","nutriments":{"energy-kcal_100g":1}}`, "Milbona", true},
		"search array brands":  {`{"product_name":"Joghurt","brands":["Land Joghurt"],"nutriments":{"energy-kcal_100g":1}}`, "Joghurt", true},
		"unnamed":              {`{"nutriments":{"energy-kcal_100g":1}}`, "", false},
		"whitespace name":      {`{"product_name":"   ","nutriments":{"energy-kcal_100g":1}}`, "", false},
	}
	for name, c := range cases {
		js := strings.Replace(c.js, "{", `{"code":"4000000000011",`, 1)
		n, err := Normalize(product(t, js), now)
		if c.ok != (err == nil) || (c.ok && n.Food.Name != c.want) {
			t.Errorf("%s: %q, %v", name, n.Food.Name, err)
		}
		if !c.ok {
			if nl, _ := IsNotLoggable(err); nl == nil || nl.Reason != ReasonNoName {
				t.Errorf("%s: err = %v", name, err)
			}
		}
	}
}

func TestImplausibleNutritionIsRejected(t *testing.T) {
	bad := []string{
		`{"energy-kcal_100g":5000}`,
		`{"energy-kcal_100g":100,"fat_100g":101}`,
		`{"energy-kcal_100g":100,"fat_100g":60,"carbohydrates_100g":60}`,
		`{"energy-kcal_100g":-5}`,
	}
	for _, nutr := range bad {
		_, err := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriments":`+nutr+`}`), now)
		if nl, ok := IsNotLoggable(err); !ok || nl.Reason != ReasonImplausible {
			t.Errorf("%s: err = %v", nutr, err)
		}
	}
	n, err := Normalize(product(t, `{"code":"4000000000011","product_name":"X","nutriments":{"energy-kcal_100g":100,"fat_100g":5,"saturated-fat_100g":9,"carbohydrates_100g":10,"sugars_100g":12}}`), now)
	if err != nil || n.Food.Per100.SatFat != nil || n.Food.Per100.Sugar != nil || n.Food.Per100.Fat == nil {
		t.Fatalf("sub-values above their parent are dropped, the rest kept: %+v %v", n.Food.Per100, err)
	}
}

func TestNormalizeBarcode(t *testing.T) {
	code, alts, err := NormalizeBarcode(" 4 000000-000011 ")
	if err != nil || code != "4000000000011" || len(alts) != 0 {
		t.Fatalf("%q %v %v", code, alts, err)
	}
	if _, alts, _ := NormalizeBarcode("012345678905"); len(alts) != 1 || alts[0] != "0012345678905" {
		t.Fatalf("12 digits should also try the 13-digit form: %v", alts)
	}
	if _, alts, _ := NormalizeBarcode("0012345678905"); len(alts) != 1 || alts[0] != "012345678905" {
		t.Fatalf("13 digits with a leading zero should also try the stripped form: %v", alts)
	}
	for _, bad := range []string{"", "12345", "123456789012345", "abc"} {
		if _, _, err := NormalizeBarcode(bad); !errors.Is(err, domain.ErrInvalid) {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestFlexibleJSONTypes(t *testing.T) {
	p := product(t, `{"code":"1","serving_quantity":"abc","last_modified_t":"1700000000","brands":null,"nutriments":{"fat_100g":"x","proteins_100g":null}}`)
	if p.ServingQuantity.v != nil || p.LastModifiedT.v == nil || len(p.Brands) != 0 || p.nutriment("fat_100g") != nil || p.nutriment("proteins_100g") != nil {
		t.Fatalf("p = %+v", p)
	}
}
