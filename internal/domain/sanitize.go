package domain

import (
	"fmt"
	"math"
	"strings"
)

const maxKcal100 = 1000

// SanitizeNutrients rejects impossible per-100 g data. Hard violations (kcal outside 0 to 1000, any value above 100 g,
// protein plus carbs plus fat above 105 g) return false. A saturated-fat or sugar value above its parent is dropped to NULL
// while the rest is kept.
func SanitizeNutrients(n Nutrients) (Nutrients, bool) {
	if math.IsNaN(n.Kcal) || math.IsInf(n.Kcal, 0) || n.Kcal < 0 || n.Kcal > maxKcal100 {
		return n, false
	}
	var sum float64
	for _, p := range []*float64{n.Protein, n.Carbs, n.Fat, n.Sugar, n.SatFat, n.Fiber, n.Salt} {
		if p != nil && (math.IsNaN(*p) || *p < 0 || *p > 100) {
			return n, false
		}
	}
	for _, p := range []*float64{n.Protein, n.Carbs, n.Fat} {
		if p != nil {
			sum += *p
		}
	}
	if sum > 105 {
		return n, false
	}
	if n.SatFat != nil && n.Fat != nil && *n.SatFat > *n.Fat+0.1 {
		n.SatFat = nil
	}
	if n.Sugar != nil && n.Carbs != nil && *n.Sugar > *n.Carbs+0.1 {
		n.Sugar = nil
	}
	return n, true
}

// NormalizeBarcode strips non-digits and returns the code plus the other forms worth trying for a 12-digit UPC or a
// 13-digit code with a leading zero. Codes of 6 to 14 digits are accepted.
func NormalizeBarcode(raw string) (code string, alternatives []string, err error) {
	var b strings.Builder
	for _, r := range raw {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	code = b.String()
	if len(code) < 6 || len(code) > 14 {
		return "", nil, fmt.Errorf("barcode %q must have 6 to 14 digits: %w", raw, ErrInvalid)
	}
	switch {
	case len(code) == 12:
		alternatives = append(alternatives, "0"+code)
	case len(code) == 13 && code[0] == '0':
		alternatives = append(alternatives, code[1:])
	}
	return code, alternatives, nil
}
