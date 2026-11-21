package food

import (
	"math"

	"plate/internal/domain"
)

// Codes returned by Plausibility. A revision that fails any of them is never accepted on its own.
const (
	IssueEnergyMismatch = "energy_mismatch"
	IssueMacrosOver100  = "macros_over_100"
	IssueSatOverFat     = "saturates_over_fat"
	IssueSugarOverCarbs = "sugars_over_carbohydrate"
	IssueKJMismatch     = "kj_kcal_mismatch"
	IssueOutOfRange     = "out_of_range"
)

const (
	energyTolerance = 0.15
	energyFloor     = 20.0 // kcal; small values would otherwise fail on rounding alone
	kjTolerance     = 0.05
	kjPerKcalExact  = 4.184
	rounding        = 0.05 // grams; labels round to 0.1
)

// Plausibility checks the arithmetic every nutrition label obeys: energy follows from fat, carbohydrate, protein and
// fibre; saturates sit inside fat; sugars inside carbohydrate; kJ and kcal agree. Missing nutrients are skipped, never
// treated as 0. An empty result means nothing contradicts itself, not that the numbers are right.
func Plausibility(n domain.Nutrients, kj *float64) []string {
	var issues []string
	if _, ok := domain.SanitizeNutrients(n); !ok {
		issues = append(issues, IssueOutOfRange)
	}
	if n.Protein != nil && n.Carbs != nil && n.Fat != nil {
		if *n.Protein+*n.Carbs+*n.Fat > 100+1 {
			issues = append(issues, IssueMacrosOver100)
		}
		fibre := 0.0
		if n.Fiber != nil {
			fibre = *n.Fiber
		}
		expected := 4**n.Protein + 4**n.Carbs + 9**n.Fat + 2*fibre
		if math.Abs(expected-n.Kcal) > math.Max(energyTolerance*n.Kcal, energyFloor) {
			issues = append(issues, IssueEnergyMismatch)
		}
	}
	if n.SatFat != nil && n.Fat != nil && *n.SatFat > *n.Fat+rounding {
		issues = append(issues, IssueSatOverFat)
	}
	if n.Sugar != nil && n.Carbs != nil && *n.Sugar > *n.Carbs+rounding {
		issues = append(issues, IssueSugarOverCarbs)
	}
	if kj != nil && math.Abs(*kj-kjPerKcalExact*n.Kcal) > math.Max(kjTolerance**kj, 5) {
		issues = append(issues, IssueKJMismatch)
	}
	return issues
}

// SameWithin reports whether two nutrient sets agree on every value both report, within a relative tolerance (plus a
// small absolute one for rounding). A value one side leaves blank does not count against the match.
func SameWithin(a, b domain.Nutrients, tol float64) bool {
	close := func(x, y float64) bool { return math.Abs(x-y) <= math.Max(tol*math.Max(x, y), 0.15) }
	pairs := [][2]*float64{
		{&a.Kcal, &b.Kcal}, {a.Protein, b.Protein}, {a.Carbs, b.Carbs}, {a.Fat, b.Fat}, {a.Sugar, b.Sugar},
		{a.SatFat, b.SatFat}, {a.Fiber, b.Fiber}, {a.Salt, b.Salt},
	}
	for _, p := range pairs {
		if p[0] != nil && p[1] != nil && !close(*p[0], *p[1]) {
			return false
		}
	}
	return true
}
