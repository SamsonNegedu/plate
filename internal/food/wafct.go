package food

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"plate/internal/domain"
)

const (
	wafctSheet    = "03 NV_sum_39 (per 100g EP)"
	wafctVersion  = "wafct-2019"
	maxWAFCTBytes = 50 << 20
)

var wafctCodeRe = regexp.MustCompile(`^\d\d_\d+$`)

// WAFCTImport reports a read of the FAO/INFOODS Food Composition Table for Western Africa.
type WAFCTImport struct {
	// Imported foods were kept; Skipped had no usable energy or failed the sanity checks; Merged were duplicates of a
	// cleaner row ("boiled as part of a recipe" next to "boiled, drained").
	Imported, Skipped, Merged, Dropped int
}

type wafctColumns struct {
	name, french, scientific, source                     int
	kcal, kj, protein, fat, carbs, fiber, sodium, satfat int
}

func findWAFCTColumns(head []string) (wafctColumns, error) {
	c := wafctColumns{name: -1, french: -1, scientific: -1, source: -1, kcal: -1, kj: -1, protein: -1, fat: -1, carbs: -1, fiber: -1, sodium: -1, satfat: -1}
	for i, h := range head {
		h = strings.ToLower(strings.Join(strings.Fields(h), " "))
		switch {
		case h == "food name in english":
			c.name = i
		case h == "food name in french":
			c.french = i
		case h == "scientific name":
			c.scientific = i
		case strings.HasPrefix(h, "biblioid"):
			c.source = i
		case strings.HasPrefix(h, "energy") && strings.Contains(h, "(kcal)"):
			c.kcal = i
		case strings.HasPrefix(h, "energy") && strings.Contains(h, "(kj)"):
			c.kj = i
		case strings.HasPrefix(h, "protein, total"):
			c.protein = i
		case strings.HasPrefix(h, "fat, total"):
			c.fat = i
		case strings.HasPrefix(h, "carbohydrate, available"):
			c.carbs = i
		case strings.HasPrefix(h, "fibre, total"):
			c.fiber = i
		case strings.HasPrefix(h, "sodium"):
			c.sodium = i
		case strings.HasPrefix(h, "fatty acids, total saturated"):
			c.satfat = i
		}
	}
	if c.name < 0 || (c.kcal < 0 && c.kj < 0) {
		return c, errors.New("worksheet lacks the food name or energy columns; is this the WAFCT 2019 file?")
	}
	return c, nil
}

// wafctCell reads one value. Square brackets only mark a value taken from another analytical method, so they are
// stripped. "tr" is a trace below the detection limit, which is a measured amount near zero, not a gap. Anything else
// that is not a number stays nil.
func wafctCell(row []string, i int) *float64 {
	if i < 0 || i >= len(row) {
		return nil
	}
	s := strings.TrimSpace(strings.Trim(strings.TrimSpace(row[i]), "[]"))
	if strings.EqualFold(s, "tr") {
		zero := 0.0
		return &zero
	}
	v, err := strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
	if err != nil || v < 0 {
		return nil
	}
	return &v
}

func wafctText(row []string, i int) string {
	if i < 0 || i >= len(row) {
		return ""
	}
	return cleanName(row[i])
}

// ParseWAFCT reads the condensed table (39 components, per 100 g edible portion) into reference foods, with names
// cleaned for people and `aliases` (WAFCT code to local names) added for search. Rows without usable energy, or whose
// numbers fail the sanity checks, are counted as skipped, never kept. The tool in tools/wafct writes the result as the
// CSV the app ships.
func ParseWAFCT(path string, now time.Time, aliases map[string]string) ([]domain.ReferenceFood, WAFCTImport, error) {
	info, err := os.Stat(path) // #nosec G703 -- the path is the operator's PLATE_IMPORT_WAFCT_PATH
	if err != nil {
		return nil, WAFCTImport{}, fmt.Errorf("WAFCT file: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxWAFCTBytes {
		return nil, WAFCTImport{}, errors.New("WAFCT file is not a regular file under the size limit")
	}

	var cols wafctColumns
	haveHead := false
	category := ""
	var out []domain.ReferenceFood
	var res WAFCTImport
	ts := now.UTC().Format(time.RFC3339)
	err = xlsxSheetRows(path, wafctSheet, func(row []string) error {
		if !haveHead {
			if len(row) > 0 && strings.TrimSpace(row[0]) == "Code" {
				var err error
				cols, err = findWAFCTColumns(row)
				haveHead = err == nil
				return err
			}
			return nil
		}
		code := ""
		if len(row) > 0 {
			code = strings.TrimSpace(row[0])
		}
		if !wafctCodeRe.MatchString(code) {
			if c := categoryOf(row); c != "" {
				category = c
			}
			return nil
		}
		f, ok := wafctFood(row, cols, code, category, ts, aliases)
		if !ok {
			res.Skipped++
			return nil
		}
		out = append(out, f)
		res.Imported++
		return nil
	})
	if err != nil {
		return nil, WAFCTImport{}, fmt.Errorf("reading WAFCT file: %w", err)
	}
	if !haveHead || len(out) == 0 {
		return nil, WAFCTImport{}, errors.New("WAFCT file contains no usable foods")
	}
	kept, dropped := dropNotWeighed(out)
	out, merged := finishWAFCT(kept)
	res.Merged, res.Dropped = merged, dropped
	res.Imported = len(out)
	return out, res, nil
}

var (
	partOfRecipeRe = regexp.MustCompile(`\s*\(as part of a recipe\)`)
	boiledRe       = regexp.MustCompile(`,?\s*(boiled|steamed|fried|roasted|grilled|stewed|cooked)\*?\s*\(without salt\),\s*drained`)
	sampleRe       = regexp.MustCompile(`,\s*n=\d+\s*$`)
	dishRe         = regexp.MustCompile(`^(.+?)\s*\(([^()]*?)\)\*?:\s*(.+)$`)
	starRe         = regexp.MustCompile(`\*`)
)

// wafctDisplayName turns a table name into one a person would recognise: no footnote stars, no sample counts, "boiled,
// drained" for "boiled* (without salt), drained", and a Burkinabè dish named by what it is, with its local name after.
func wafctDisplayName(name string) string {
	name = sampleRe.ReplaceAllString(name, "")
	if m := dishRe.FindStringSubmatch(name); m != nil {
		desc := strings.TrimSpace(m[3])
		if desc != "" {
			desc = strings.ToUpper(desc[:1]) + desc[1:]
		}
		return strings.TrimSpace(desc + " (" + strings.TrimSpace(m[1]) + ", " + strings.TrimSpace(m[2]) + ")")
	}
	name = boiledRe.ReplaceAllStringFunc(name, func(s string) string {
		verb := strings.Trim(strings.Fields(strings.NewReplacer(",", " ", "*", " ").Replace(s))[0], " ")
		return ", " + verb + ", drained"
	})
	name = starRe.ReplaceAllString(name, "")
	return strings.TrimSpace(strings.Join(strings.Fields(name), " "))
}

var (
	variantSampleRe = regexp.MustCompile(`n=\d+\s*$`)
	notWeighedRe    = regexp.MustCompile(`(?i)fortified|canned|instant noodles|burkina faso\)`)
)

// dropNotWeighed keeps what a person weighs at a stall or a butcher and cuts the rest: prepared dishes and sauces,
// beverages, vitamin-fortified and canned variants (which are packaged and carry a barcode), and one-sample varieties
// from Ghana and Benin. The Nigerian one-sample yam cultivars stay. It returns what is kept and how many were cut.
func dropNotWeighed(in []domain.ReferenceFood) ([]domain.ReferenceFood, int) {
	var out []domain.ReferenceFood
	for _, f := range in {
		switch {
		case strings.HasPrefix(f.Category, "Soups and sauces"), strings.HasPrefix(f.Category, "Beverages"):
		case notWeighedRe.MatchString(f.Name):
		case variantSampleRe.MatchString(strings.TrimSpace(f.Name)) && !strings.Contains(f.Name, "Nigeria"):
		default:
			out = append(out, f)
			continue
		}
	}
	return out, len(in) - len(out)
}

// finishWAFCT cleans the names, drops a "(as part of a recipe)" row when its plain "(without salt), drained" twin is
// there, and makes every name unique by adding the code to a repeat. It returns the foods and how many were merged.
func finishWAFCT(in []domain.ReferenceFood) ([]domain.ReferenceFood, int) {
	raw := map[string]bool{}
	for _, f := range in {
		raw[f.Name] = true
	}
	var out []domain.ReferenceFood
	merged := 0
	for _, f := range in {
		if partOfRecipeRe.MatchString(f.Name) {
			twin := partOfRecipeRe.ReplaceAllString(f.Name, " (without salt), drained")
			if raw[twin] {
				merged++
				continue
			}
		}
		f.Name = wafctDisplayName(partOfRecipeRe.ReplaceAllString(f.Name, ""))
		out = append(out, f)
	}
	seen := map[string]int{}
	for _, f := range out {
		seen[f.Name]++
	}
	for i, f := range out {
		if seen[f.Name] > 1 {
			out[i].Name = f.Name + " [" + strings.TrimPrefix(f.RefID, "wafct:") + "]"
		}
	}
	return out, merged
}

// categoryOf reads a section row such as "Fish and its products/Poisson et produits dérivés": its English half.
func categoryOf(row []string) string {
	filled := 0
	for _, c := range row {
		if strings.TrimSpace(c) != "" {
			filled++
		}
	}
	if filled != 1 || len(row) == 0 || strings.TrimSpace(row[0]) == "" {
		return ""
	}
	english, _, _ := strings.Cut(row[0], "/")
	return cleanName(english)
}

func wafctFood(row []string, c wafctColumns, code, category, ts string, aliases map[string]string) (domain.ReferenceFood, bool) {
	name := wafctText(row, c.name)
	if name == "" {
		return domain.ReferenceFood{}, false
	}
	kcal := wafctCell(row, c.kcal)
	if kcal == nil {
		if kj := wafctCell(row, c.kj); kj != nil {
			k := *kj / kjPerKcal
			kcal = &k
		}
	}
	if kcal == nil {
		return domain.ReferenceFood{}, false
	}
	var salt *float64
	if na := wafctCell(row, c.sodium); na != nil {
		s := *na / 1000 * 2.5
		salt = &s
	}
	n, ok := SanitizeNutrients(domain.Nutrients{
		Kcal: *kcal, Protein: wafctCell(row, c.protein), Carbs: wafctCell(row, c.carbs), Fat: wafctCell(row, c.fat),
		SatFat: wafctCell(row, c.satfat), Fiber: wafctCell(row, c.fiber), Salt: salt,
	})
	if !ok {
		return domain.ReferenceFood{}, false
	}
	names := []string{aliases[code]}
	if fr := strings.TrimSpace(strings.ReplaceAll(wafctText(row, c.french), "*", "")); fr != "" {
		names = append(names, fr)
	}
	return domain.ReferenceFood{
		RefID: "wafct:" + code, Name: name, // cleaned in finishWAFCT, once every row is known
		LocalNames:     strings.TrimSpace(strings.Join(names, " ")),
		ScientificName: wafctText(row, c.scientific), Category: category, Per100: n,
		// A value calculated from other foods or a recipe is a good estimate, not an analysis.
		Estimated: strings.HasPrefix(strings.ToLower(wafctText(row, c.source)), "calc."),
		Source:    wafctVersion, DatasetVersion: wafctVersion, ImportedAt: ts,
	}, true
}
