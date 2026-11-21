package main

import (
	"math"
	"slices"
	"strings"

	"plate/internal/domain"
	"plate/internal/food"
)

// minCategoryProducts is how many products a category needs before its ranges mean anything.
const minCategoryProducts = 30

// categoryStats computes, for every category tag with enough products, the 5th percentile, median and 95th percentile of
// kcal, fat, protein, carbohydrate and salt per 100 g. It is computed over every German product with energy, not only the ones
// the seed keeps: a category's shape comes from all of its products, popular or not.
func categoryStats(rows []domain.CatalogFood) []domain.CategoryStats {
	values := map[string]map[string][]float64{} // tag -> nutrient -> values
	count := map[string]int{}
	for _, c := range rows {
		got := map[string]*float64{
			"fat": c.Per100.Fat, "protein": c.Per100.Protein, "carbs": c.Per100.Carbs, "salt": c.Per100.Salt,
		}
		for _, tag := range c.Categories {
			count[tag]++
			m := values[tag]
			if m == nil {
				m = map[string][]float64{}
				values[tag] = m
			}
			m["kcal"] = append(m["kcal"], c.Per100.Kcal)
			for k, v := range got {
				if v != nil {
					m[k] = append(m[k], *v)
				}
			}
		}
	}
	var out []domain.CategoryStats
	for tag, n := range count {
		if n < minCategoryProducts || !validTag(tag) {
			continue
		}
		ranges := map[string][3]float64{}
		for _, k := range food.RangeKeys {
			xs := values[tag][k]
			if len(xs) < minCategoryProducts {
				continue
			}
			slices.Sort(xs)
			ranges[k] = [3]float64{round2(percentile(xs, 0.05)), round2(percentile(xs, 0.5)), round2(percentile(xs, 0.95))}
		}
		if len(ranges) > 0 {
			out = append(out, domain.CategoryStats{Category: tag, N: n, Ranges: ranges})
		}
	}
	slices.SortFunc(out, func(a, b domain.CategoryStats) int { return strings.Compare(a.Category, b.Category) })
	return out
}

func validTag(tag string) bool {
	return len(tag) > 3 && len(tag) <= 110 && !strings.ContainsAny(tag, " ,;\"'")
}

// percentile of a sorted slice, by linear interpolation.
func percentile(sorted []float64, p float64) float64 {
	k := float64(len(sorted)-1) * p
	f := math.Floor(k)
	c := math.Min(f+1, float64(len(sorted)-1))
	return sorted[int(f)] + (sorted[int(c)]-sorted[int(f)])*(k-f)
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// assignCategories gives each product the tag it is compared with: of its own tags that have ranges, the one covering the
// fewest products, which is the most specific (smoked salmons rather than seafood). Open Food Facts lists a product's tags
// from general to specific, so when two cover the same products the later one wins.
func assignCategories(rows []domain.CatalogFood, stats []domain.CategoryStats) {
	size := make(map[string]int, len(stats))
	for _, s := range stats {
		size[s.Category] = s.N
	}
	for i := range rows {
		row := &rows[i]
		best, bestN := "", math.MaxInt
		for _, tag := range row.Categories {
			if n, ok := size[tag]; ok && n <= bestN {
				best, bestN = tag, n
			}
		}
		row.Category = best
	}
}
