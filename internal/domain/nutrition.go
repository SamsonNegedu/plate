package domain

import (
	"fmt"
	"math"
)

// Portion is the nutrition of an eaten amount. Missing nutrients stay nil.
type Portion struct {
	Kcal    float64
	Protein *float64
	Carbs   *float64
	Fat     *float64
	Sugar   *float64
	SatFat  *float64
	Fiber   *float64
	Salt    *float64
}

// For scales per-100 g nutrients to the given grams. Values round to one decimal, kcal to the nearest whole.
func (n Nutrients) For(grams float64) Portion {
	k := grams / 100
	scale := func(p *float64) *float64 {
		if p == nil {
			return nil
		}
		v := round(*p*k, 1)
		return &v
	}
	return Portion{
		Kcal:    round(n.Kcal*k, 0),
		Protein: scale(n.Protein),
		Carbs:   scale(n.Carbs),
		Fat:     scale(n.Fat),
		Sugar:   scale(n.Sugar),
		SatFat:  scale(n.SatFat),
		Fiber:   scale(n.Fiber),
		Salt:    scale(n.Salt),
	}
}

func round(v float64, places int) float64 {
	p := math.Pow(10, float64(places))
	return math.Round(v*p) / p
}

// Loggable reports whether the nutrients can back an entry. Kcal is a plain float, so the real gate is
// at the boundaries that build Nutrients from external data; this guards impossible values.
func (n Nutrients) Loggable() error {
	if math.IsNaN(n.Kcal) || math.IsInf(n.Kcal, 0) || n.Kcal < 0 {
		return fmt.Errorf("kcal %v: %w", n.Kcal, ErrNotLoggable)
	}
	return nil
}

// Grams converts a displayed amount to grams. ml is treated as 1 g; a piece or serving needs the food's serving grams.
func Grams(amount float64, unit Unit, servingGrams *float64) (float64, error) {
	if amount <= 0 || math.IsNaN(amount) || math.IsInf(amount, 0) {
		return 0, fmt.Errorf("amount %v: %w", amount, ErrInvalid)
	}
	switch unit {
	case Gram, Milli:
		return amount, nil
	case Piece, Serving:
		if servingGrams == nil || *servingGrams <= 0 {
			return 0, fmt.Errorf("%s needs serving grams: %w", unit, ErrInvalid)
		}
		return amount * *servingGrams, nil
	}
	return 0, fmt.Errorf("unit %q: %w", unit, ErrInvalid)
}

// DayTotals sums entry portions without rounding each entry, then rounds once for display.
// A macro is nil when no live entry reported it; Missing lists macros that at least one entry lacks.
type DayTotals struct {
	Kcal    float64
	Protein *float64
	Carbs   *float64
	Fat     *float64
	Count   int
	Missing []string
}

func SumEntries(entries []Entry) DayTotals {
	var kcal float64
	var protein, carbs, fat *float64
	missing := map[string]bool{}
	count := 0

	add := func(name string, dst **float64, v *float64, grams float64) {
		if v == nil {
			missing[name] = true
			return
		}
		if *dst == nil {
			z := 0.0
			*dst = &z
		}
		**dst += *v * grams / 100
	}
	for _, e := range entries {
		if e.DeletedAt != nil {
			continue
		}
		count++
		kcal += e.Snapshot.Kcal * e.Grams / 100
		add("protein", &protein, e.Snapshot.Protein, e.Grams)
		add("carbs", &carbs, e.Snapshot.Carbs, e.Grams)
		add("fat", &fat, e.Snapshot.Fat, e.Grams)
	}

	r1 := func(p *float64) *float64 {
		if p == nil {
			return nil
		}
		v := round(*p, 1)
		return &v
	}
	out := DayTotals{Kcal: round(kcal, 0), Protein: r1(protein), Carbs: r1(carbs), Fat: r1(fat), Count: count, Missing: []string{}}
	for _, n := range []string{"protein", "carbs", "fat"} {
		if missing[n] {
			out.Missing = append(out.Missing, n)
		}
	}
	return out
}
