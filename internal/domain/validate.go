package domain

import (
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

type FieldError struct {
	Field   string
	Message string
}

// ValidationError lists every field that failed. It matches ErrInvalid.
type ValidationError struct {
	Fields []FieldError
}

func (e *ValidationError) Error() string {
	parts := make([]string, 0, len(e.Fields))
	for _, f := range e.Fields {
		parts = append(parts, f.Field+": "+f.Message)
	}
	return "invalid: " + strings.Join(parts, "; ")
}

func (e *ValidationError) Unwrap() error { return ErrInvalid }

type validator struct{ fields []FieldError }

func (v *validator) add(field, msg string) { v.fields = append(v.fields, FieldError{field, msg}) }

func (v *validator) err() error {
	if len(v.fields) == 0 {
		return nil
	}
	return &ValidationError{Fields: v.fields}
}

const maxNutrient = 100000

func (v *validator) nutrient(field string, p *float64) {
	if p == nil {
		return
	}
	if math.IsNaN(*p) || math.IsInf(*p, 0) || *p < 0 || *p > maxNutrient {
		v.add(field, "must be between 0 and 100000, or null")
	}
}

func (v *validator) text(field, s string, max int, required bool) {
	if required && strings.TrimSpace(s) == "" {
		v.add(field, "is required")
	}
	if utf8.RuneCountInString(s) > max {
		v.add(field, fmt.Sprintf("must be at most %d characters", max))
	}
}

// ParseDay parses a plain calendar date.
func ParseDay(s string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", s)
	if err != nil || t.Format("2006-01-02") != s {
		return time.Time{}, fmt.Errorf("%q is not a date (YYYY-MM-DD): %w", s, ErrInvalid)
	}
	return t, nil
}

// ValidateEntry checks an entry at the boundary. now is the server clock; an entry may be dated up to the
// UTC date plus one day, which covers every timezone.
func ValidateEntry(e Entry, now time.Time) error {
	var v validator
	if _, err := uuid.Parse(e.ID); err != nil {
		v.add("id", "must be a UUID")
	}
	if day, err := ParseDay(e.EatenOn); err != nil {
		v.add("eaten_on", "must be a real date (YYYY-MM-DD)")
	} else {
		latest := time.Date(now.UTC().Year(), now.UTC().Month(), now.UTC().Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
		if day.After(latest) {
			v.add("eaten_on", "cannot be more than one day in the future")
		}
	}
	if !e.Meal.Valid() {
		v.add("meal", "must be breakfast, lunch, dinner or snack")
	}
	if !e.Unit.Valid() {
		v.add("unit", "must be g, ml, piece or serving")
	}
	if e.FoodID != nil {
		if _, err := uuid.Parse(*e.FoodID); err != nil {
			v.add("food_id", "must be a UUID")
		}
	}
	v.text("name", e.Name, 200, true)
	v.text("brand", e.Brand, 200, false)
	v.text("note", e.Note, 500, false)
	if e.Barcode != nil && !validBarcode(*e.Barcode) {
		v.add("barcode", "must be 8 to 14 digits")
	}
	if !(e.Amount > 0) || math.IsInf(e.Amount, 0) {
		v.add("amount", "must be greater than 0")
	}
	if !(e.Grams > 0) || math.IsInf(e.Grams, 0) {
		v.add("grams", "must be greater than 0")
	}
	if (e.Unit == Gram || e.Unit == Milli) && math.Abs(e.Grams-e.Amount) > 0.01 {
		v.add("grams", "must equal amount for g and ml")
	}
	if math.IsNaN(e.Snapshot.Kcal) || math.IsInf(e.Snapshot.Kcal, 0) || e.Snapshot.Kcal < 0 || e.Snapshot.Kcal > maxNutrient {
		v.add("kcal", "must be between 0 and 100000")
	}
	v.nutrient("protein", e.Snapshot.Protein)
	v.nutrient("carbs", e.Snapshot.Carbs)
	v.nutrient("fat", e.Snapshot.Fat)
	v.nutrient("sugar", e.Snapshot.Sugar)
	v.nutrient("satfat", e.Snapshot.SatFat)
	v.nutrient("fiber", e.Snapshot.Fiber)
	v.nutrient("salt", e.Snapshot.Salt)
	return v.err()
}

func validBarcode(s string) bool {
	if len(s) < 8 || len(s) > 14 {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ValidateSettings checks goals. A macro target of 0 means "not tracked".
func ValidateSettings(s Settings) error {
	var v validator
	if s.GoalKcal < 500 || s.GoalKcal > 9000 {
		v.add("goal_kcal", "must be between 500 and 9000")
	}
	for field, g := range map[string]int64{"protein_g": s.ProteinG, "carbs_g": s.CarbsG, "fat_g": s.FatG} {
		if g < 0 || g > 500 {
			v.add(field, "must be between 0 and 500")
		}
	}
	if s.DayStartHour < 0 || s.DayStartHour > 23 {
		v.add("day_start_hour", "must be between 0 and 23")
	}
	switch s.Theme {
	case "auto", "light", "dark":
	default:
		v.add("theme", "must be auto, light or dark")
	}
	return v.err()
}
