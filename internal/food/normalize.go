package food

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"plate/internal/domain"
)

// NotLoggable reasons.
const (
	ReasonNoNutrition = "no_nutrition"
	ReasonNoName      = "no_name"
	ReasonImplausible = "implausible_nutrition"
)

// NotLoggableError says why a product cannot back an entry. It matches domain.ErrNotLoggable.
type NotLoggableError struct {
	Reason   string
	Name     string
	ImageURL string
}

func (e *NotLoggableError) Error() string {
	return fmt.Sprintf("product %q is not loggable (%s)", e.Name, e.Reason)
}

func (e *NotLoggableError) Unwrap() error { return domain.ErrNotLoggable }

// Normalized is a loggable food plus the upstream image URL, which only the image proxy may use.
type Normalized struct {
	Food     domain.Food
	ImageURL string
}

const (
	kjPerKcal     = 4.184
	maxNameRunes  = 200
	maxLongText   = 2000
	kjUnit        = "kj"
	kcalUnit      = "kcal"
	energyKcal100 = "energy-kcal_100g"
)

var servingGramsRe = regexp.MustCompile(`(?i)(\d+(?:[.,]\d+)?)\s*(g|ml)\b`)

// Normalize turns an OFF product into a food. It never reads a per-serving value as per-100 g and never turns a
// missing nutrient into zero. A product without usable kcal or a name returns *NotLoggableError.
func Normalize(p OFFProduct, now time.Time) (Normalized, error) {
	name := cleanName(firstNonEmpty(p.ProductNameDE, p.ProductName, p.GenericName))
	brand := cleanName(firstBrand(p.Brands))
	if name == "" {
		name = brand
	}
	img := firstNonEmpty(p.ImageFrontURL, p.ImageURL)
	if name == "" {
		return Normalized{}, &NotLoggableError{Reason: ReasonNoName, ImageURL: img}
	}

	servingGrams := ParseServingGrams(p.ServingSize, p.ServingQuantity.v)
	kcal := kcalPer100(p, servingGrams)
	if kcal == nil {
		return Normalized{}, &NotLoggableError{Reason: ReasonNoNutrition, Name: name, ImageURL: img}
	}

	salt := p.nutriment("salt_100g")
	if salt == nil {
		if sodium := p.nutriment("sodium_100g"); sodium != nil {
			v := *sodium * 2.5
			salt = &v
		}
	}
	n, ok := SanitizeNutrients(domain.Nutrients{
		Kcal: *kcal, Protein: p.nutriment("proteins_100g"), Carbs: p.nutriment("carbohydrates_100g"),
		Fat: p.nutriment("fat_100g"), Sugar: p.nutriment("sugars_100g"), SatFat: p.nutriment("saturated-fat_100g"),
		Fiber: p.nutriment("fiber_100g"), Salt: salt,
	})
	if !ok {
		return Normalized{}, &NotLoggableError{Reason: ReasonImplausible, Name: name, ImageURL: img}
	}

	code, _, err := NormalizeBarcode(p.Code)
	var barcode *string
	if err == nil {
		barcode = &code
	}
	f := domain.Food{
		Barcode: barcode, Name: name, Brand: brand, Quantity: truncate(strings.TrimSpace(p.Quantity), 100),
		ServingSize: truncate(strings.TrimSpace(p.ServingSize), 100), ServingGrams: servingGrams, Per100: n,
		Nutriscore: nutriscore(p.NutriscoreGrade), Source: domain.SourceOFF, SourceID: barcode,
		Ingredients: truncate(strings.TrimSpace(p.IngredientsText), maxLongText),
		Allergens:   cleanAllergens(p.Allergens), SearchName: domain.SearchName(name + " " + brand),
	}
	if t := p.LastModifiedT.v; t != nil && *t > 0 {
		s := time.Unix(int64(*t), 0).UTC().Format(time.RFC3339)
		f.SourceUpdatedAt = &s
	}
	checked := now.UTC().Format(time.RFC3339)
	f.SourceCheckedAt = &checked
	return Normalized{Food: f, ImageURL: img}, nil
}

// kcalPer100 prefers the per-100 g energy fields. Per-serving energy is converted only when the serving weight is known.
func kcalPer100(p OFFProduct, servingGrams *float64) *float64 {
	if v := p.nutriment(energyKcal100); v != nil {
		return v
	}
	if v := p.nutriment("energy-kj_100g"); v != nil {
		k := *v / kjPerKcal
		return &k
	}
	if v := p.nutriment("energy_100g"); v != nil {
		switch strings.ToLower(p.nutrimentText("energy_unit")) {
		case kcalUnit:
			return v
		case kjUnit, "":
			k := *v / kjPerKcal
			return &k
		}
		return nil
	}
	if servingGrams == nil || *servingGrams <= 0 {
		return nil
	}
	if v := p.nutriment("energy-kcal_serving"); v != nil {
		k := *v / *servingGrams * 100
		return &k
	}
	if v := p.nutriment("energy-kj_serving"); v != nil {
		k := *v / kjPerKcal / *servingGrams * 100
		return &k
	}
	return nil
}

// SanitizeNutrients rejects impossible data; see domain.SanitizeNutrients.
func SanitizeNutrients(n domain.Nutrients) (domain.Nutrients, bool) {
	return domain.SanitizeNutrients(n)
}

// ParseServingGrams reads the serving weight from serving_quantity, else from a "30 g" or "250 ml" inside the label text.
// A serving like "1 Riegel" with no weight stays unavailable.
func ParseServingGrams(servingSize string, servingQuantity *float64) *float64 {
	if servingQuantity != nil && *servingQuantity > 0 {
		v := *servingQuantity
		return &v
	}
	m := servingGramsRe.FindStringSubmatch(servingSize)
	if m == nil {
		return nil
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
	if err != nil || v <= 0 {
		return nil
	}
	return &v
}

// NormalizeBarcode strips non-digits and returns the code plus the other forms worth trying.
func NormalizeBarcode(raw string) (code string, alternatives []string, err error) {
	return domain.NormalizeBarcode(raw)
}

var spaceRe = regexp.MustCompile(`\s+`)

func cleanName(s string) string {
	s = strings.TrimSpace(spaceRe.ReplaceAllString(s, " "))
	return truncate(s, maxNameRunes)
}

func truncate(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max])
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func firstBrand(b textList) string {
	for _, s := range b {
		first, _, _ := strings.Cut(s, ",")
		if first = strings.TrimSpace(first); first != "" {
			return first
		}
	}
	return ""
}

func nutriscore(g string) *string {
	g = strings.ToLower(strings.TrimSpace(g))
	if len(g) == 1 && g[0] >= 'a' && g[0] <= 'e' {
		return &g
	}
	return nil
}

func cleanAllergens(s string) string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if i := strings.Index(p, ":"); i >= 0 {
			p = p[i+1:]
		}
		if p != "" {
			out = append(out, p)
		}
	}
	return truncate(strings.Join(out, ", "), 300)
}

// IsNotLoggable extracts the typed error.
func IsNotLoggable(err error) (*NotLoggableError, bool) {
	var nl *NotLoggableError
	if errors.As(err, &nl) {
		return nl, true
	}
	return nil, false
}

var junkName = regexp.MustCompile(`(?i)(https?:|www\.|\.de/|\.com\b|nutri-?score\s+[a-e]{3,}|\bn/a\b)`)

// CleanProductName tidies a catalog name and returns "" for junk: URLs, scraped label text, absurd length.
func CleanProductName(s string) string {
	s = cleanName(s)
	if s == "" || utf8.RuneCountInString(s) > 120 || junkName.MatchString(s) {
		return ""
	}
	letters := 0
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r > 127 {
			letters++
		}
	}
	if letters < 2 {
		return ""
	}
	return s
}
