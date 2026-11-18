package domain

import (
	"errors"
	"math"
	"strings"
	"testing"
	"time"
)

func f(v float64) *float64 { return &v }

func TestSearchName(t *testing.T) {
	cases := map[string]string{
		"Gut & Günstig":    "gut gunstig",
		"Käse":             "kase",
		"Hähnchenbrust":    "hahnchenbrust",
		"Ja!":              "ja",
		"  Dr. Oetker  ":   "dr oetker",
		"Weißbrot":         "weissbrot",
		"Müllermilch 3,5%": "mullermilch 3 5",
	}
	for in, want := range cases {
		if got := SearchName(in); got != want {
			t.Errorf("SearchName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPortionScalesAndKeepsMissingNil(t *testing.T) {
	n := Nutrients{Kcal: 539, Protein: f(6.3), Fat: f(30.9)}
	p := n.For(15)
	if p.Kcal != 81 {
		t.Errorf("kcal = %v, want 81", p.Kcal)
	}
	if p.Protein == nil || *p.Protein != 0.9 {
		t.Errorf("protein = %v, want 0.9", p.Protein)
	}
	if p.Carbs != nil || p.Sugar != nil || p.Salt != nil {
		t.Error("missing nutrients must stay nil, not become zero")
	}
}

func TestZeroKcalFoodIsLoggableButNegativeIsNot(t *testing.T) {
	if err := (Nutrients{Kcal: 0}).Loggable(); err != nil {
		t.Errorf("water has 0 kcal and is loggable: %v", err)
	}
	if err := (Nutrients{Kcal: -1}).Loggable(); !errors.Is(err, ErrNotLoggable) {
		t.Errorf("err = %v", err)
	}
}

func TestGrams(t *testing.T) {
	serving := f(30)
	cases := []struct {
		name    string
		amount  float64
		unit    Unit
		serving *float64
		want    float64
		wantErr bool
	}{
		{"grams", 250, Gram, nil, 250, false},
		{"ml counts as grams", 200, Milli, nil, 200, false},
		{"servings", 2, Serving, serving, 60, false},
		{"pieces", 3, Piece, serving, 90, false},
		{"serving without grams is invalid, never per-100 g", 1, Serving, nil, 0, true},
		{"zero", 0, Gram, nil, 0, true},
		{"negative", -5, Gram, nil, 0, true},
		{"bad unit", 1, Unit("cup"), nil, 0, true},
	}
	for _, c := range cases {
		got, err := Grams(c.amount, c.unit, c.serving)
		if (err != nil) != c.wantErr || got != c.want {
			t.Errorf("%s: got %v, %v", c.name, got, err)
		}
	}
}

func TestSumEntriesSumsUnroundedAndSkipsTombstones(t *testing.T) {
	del := "2026-11-13T00:00:00Z"
	entries := []Entry{
		{Grams: 100, Snapshot: Nutrients{Kcal: 200, Protein: f(10)}},
		{Grams: 50, Snapshot: Nutrients{Kcal: 100}},
		{Grams: 100, Snapshot: Nutrients{Kcal: 999}, DeletedAt: &del},
	}
	got := SumEntries(entries)
	if got.Kcal != 250 || got.Count != 2 {
		t.Errorf("kcal = %v count = %d, want 250 and 2", got.Kcal, got.Count)
	}
	if got.Protein == nil || *got.Protein != 10 {
		t.Errorf("protein = %v", got.Protein)
	}
	if got.Carbs != nil {
		t.Error("carbs reported by no entry must be nil")
	}
	want := []string{"protein", "carbs", "fat"}
	if len(got.Missing) != 3 || got.Missing[0] != want[0] || got.Missing[1] != want[1] || got.Missing[2] != want[2] {
		t.Errorf("missing = %v", got.Missing)
	}
}

func TestSumRoundsOnceNotPerEntry(t *testing.T) {
	// three entries of 0.4 kcal each: per-entry rounding would give 0, a single rounding gives 1.
	e := Entry{Grams: 100, Snapshot: Nutrients{Kcal: 0.4}}
	if got := SumEntries([]Entry{e, e, e}); got.Kcal != 1 {
		t.Fatalf("kcal = %v, want 1", got.Kcal)
	}
}

func TestZeroKcalEntryCountsAndIsNotMissing(t *testing.T) {
	got := SumEntries([]Entry{{Grams: 250, Snapshot: Nutrients{Kcal: 0, Protein: f(0), Carbs: f(0), Fat: f(0)}}})
	if got.Kcal != 0 || got.Count != 1 || len(got.Missing) != 0 {
		t.Fatalf("got %+v; a 0 kcal entry is a value, not a gap", got)
	}
}

func TestEnums(t *testing.T) {
	if !Lunch.Valid() || Meal("brunch").Valid() || !Piece.Valid() || Unit("cup").Valid() || !SourceUser.Valid() || Source("x").Valid() {
		t.Fatal("enum validation wrong")
	}
}

func validEntry() Entry {
	return Entry{
		ID: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b", EatenOn: "2026-11-13", Meal: Lunch, Name: "Oats",
		Amount: 40, Unit: Gram, Grams: 40, Snapshot: Nutrients{Kcal: 370},
	}
}

var clock = time.Date(2026, 11, 13, 10, 0, 0, 0, time.UTC)

func fieldsOf(err error) map[string]bool {
	out := map[string]bool{}
	var ve *ValidationError
	if errors.As(err, &ve) {
		for _, f := range ve.Fields {
			out[f.Field] = true
		}
	}
	return out
}

func TestValidateEntryAcceptsAGoodEntry(t *testing.T) {
	if err := ValidateEntry(validEntry(), clock); err != nil {
		t.Fatal(err)
	}
}

func TestValidateEntryRules(t *testing.T) {
	cases := map[string]struct {
		mutate func(*Entry)
		field  string
	}{
		"non-UUID id":                {func(e *Entry) { e.ID = "123" }, "id"},
		"impossible date":            {func(e *Entry) { e.EatenOn = "2026-02-30" }, "eaten_on"},
		"not iso":                    {func(e *Entry) { e.EatenOn = "13.11.2026" }, "eaten_on"},
		"two days ahead":             {func(e *Entry) { e.EatenOn = "2026-11-15" }, "eaten_on"},
		"bad meal":                   {func(e *Entry) { e.Meal = "brunch" }, "meal"},
		"bad unit":                   {func(e *Entry) { e.Unit = "cup" }, "unit"},
		"zero amount":                {func(e *Entry) { e.Amount = 0 }, "amount"},
		"zero grams":                 {func(e *Entry) { e.Grams = 0 }, "grams"},
		"grams must equal amount":    {func(e *Entry) { e.Grams = 41 }, "grams"},
		"negative kcal":              {func(e *Entry) { e.Snapshot.Kcal = -1 }, "kcal"},
		"NaN kcal":                   {func(e *Entry) { e.Snapshot.Kcal = math.NaN() }, "kcal"},
		"negative protein":           {func(e *Entry) { e.Snapshot.Protein = f(-1) }, "protein"},
		"empty name":                 {func(e *Entry) { e.Name = "  " }, "name"},
		"note too long":              {func(e *Entry) { e.Note = strings.Repeat("a", 501) }, "note"},
		"short barcode":              {func(e *Entry) { b := "123"; e.Barcode = &b }, "barcode"},
		"letters in barcode":         {func(e *Entry) { b := "30176204220ab"; e.Barcode = &b }, "barcode"},
		"food id that is not a UUID": {func(e *Entry) { id := "x"; e.FoodID = &id }, "food_id"},
	}
	for name, c := range cases {
		e := validEntry()
		c.mutate(&e)
		err := ValidateEntry(e, clock)
		if !errors.Is(err, ErrInvalid) || !fieldsOf(err)[c.field] {
			t.Errorf("%s: err = %v, want a %q field error", name, err, c.field)
		}
	}
}

func TestValidateEntryBoundaries(t *testing.T) {
	e := validEntry()
	e.EatenOn = "2026-11-14" // tomorrow in UTC: fine for a device ahead of UTC
	if err := ValidateEntry(e, clock); err != nil {
		t.Errorf("tomorrow: %v", err)
	}
	e = validEntry()
	e.Unit, e.Amount, e.Grams = Serving, 2, 60
	if err := ValidateEntry(e, clock); err != nil {
		t.Errorf("serving grams are trusted: %v", err)
	}
	e = validEntry()
	e.Grams = 40.009
	if err := ValidateEntry(e, clock); err != nil {
		t.Errorf("0.01 tolerance: %v", err)
	}
	e = validEntry()
	e.Snapshot.Kcal = 0
	if err := ValidateEntry(e, clock); err != nil {
		t.Errorf("0 kcal is allowed: %v", err)
	}
}

func TestValidateSettings(t *testing.T) {
	ok := Settings{GoalKcal: 2000, ProteinG: 0, DayStartHour: 4, Theme: "auto"}
	if err := ValidateSettings(ok); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*Settings){
		"goal_kcal":      func(s *Settings) { s.GoalKcal = 499 },
		"protein_g":      func(s *Settings) { s.ProteinG = 501 },
		"carbs_g":        func(s *Settings) { s.CarbsG = -1 },
		"day_start_hour": func(s *Settings) { s.DayStartHour = 24 },
		"theme":          func(s *Settings) { s.Theme = "blue" },
	}
	for field, mutate := range cases {
		s := ok
		mutate(&s)
		if err := ValidateSettings(s); !fieldsOf(err)[field] {
			t.Errorf("%s: err = %v", field, err)
		}
	}
}

func TestParseDay(t *testing.T) {
	for _, bad := range []string{"", "2026-1-1", "2026-13-01", "2026-02-29", "tomorrow"} {
		if _, err := ParseDay(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
	if d, err := ParseDay("2028-02-29"); err != nil || d.Day() != 29 {
		t.Errorf("leap day: %v %v", d, err)
	}
}
