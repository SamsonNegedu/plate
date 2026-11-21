// Package search builds FTS5 queries from user input and ranks merged results.
package search

import (
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"plate/internal/domain"
)

var tokenRe = regexp.MustCompile(`[\p{L}\p{N}]+`)

// Tokens extracts letters and digits. Every character with FTS syntax meaning (quotes, *, parentheses, colon, caret,
// minus, ampersand) is a separator, so user input can never become query syntax.
func Tokens(q string) []string {
	toks := tokenRe.FindAllString(q, -1)
	if len(toks) > 8 {
		toks = toks[:8]
	}
	return toks
}

// InfixTokens returns the tokens usable for a substring search: the trigram index needs three or more characters.
func InfixTokens(tokens []string) []string {
	var out []string
	for _, t := range tokens {
		if utf8.RuneCountInString(t) >= 3 {
			out = append(out, t)
		}
	}
	return out
}

// MinLength is the shortest query (in letters and digits) that is searched.
const MinLength = 2

// Long reports whether the tokens are long enough to search.
func Long(tokens []string) bool {
	n := 0
	for _, t := range tokens {
		n += utf8.RuneCountInString(t)
	}
	return n >= MinLength
}

var umlautPairs = strings.NewReplacer("ae", "a", "oe", "o", "ue", "u")

// Variants returns the spellings of one query word that should all count. Both indexes fold ä ö ü to a o u but keep ß, so a
// person typing without those keys (kaese, mueller, weissbrot) must also match what the index holds (kase, muller, weißbrot).
// The original spelling comes first. A word with a natural "ue" or "ss" gains a variant that matches nothing, which is harmless.
func Variants(token string) []string {
	lower := strings.ToLower(token)
	out := []string{token}
	add := func(v string) {
		if v != "" && v != lower && !slices.Contains(out, v) {
			out = append(out, v)
		}
	}
	plain := umlautPairs.Replace(lower)
	add(plain)
	for _, base := range []string{lower, plain} {
		if strings.Contains(base, "ss") {
			add(strings.ReplaceAll(base, "ss", "ß"))
		}
		if strings.Contains(base, "ß") {
			add(strings.ReplaceAll(base, "ß", "ss"))
		}
	}
	return out
}

// Match renders a bound FTS5 MATCH string. Every token is quoted, and a word with spelling variants becomes an OR group.
// With prefix, the last token also matches word starts.
func Match(tokens []string, prefix bool) string {
	parts := make([]string, len(tokens))
	grouped := false
	for i, t := range tokens {
		star := ""
		if prefix && i == len(tokens)-1 {
			star = "*"
		}
		vs := Variants(t)
		quoted := make([]string, len(vs))
		for j, v := range vs {
			quoted[j] = `"` + strings.ReplaceAll(v, `"`, `""`) + `"` + star
		}
		if len(quoted) == 1 {
			parts[i] = quoted[0]
		} else {
			parts[i] = "(" + strings.Join(quoted, " OR ") + ")"
			grouped = true
		}
	}
	if grouped {
		return strings.Join(parts, " AND ") // FTS5 does not read a group followed by a phrase as an implicit AND
	}
	return strings.Join(parts, " ")
}

// PopularScans is how many scans make a product one that people mean when they type a few letters. Such a product ranks above
// obscure whole-word matches: "nut" should offer Nutella before the hundred products that happen to be called "Nut".
const PopularScans = 100

// Item is one candidate from any source.
type Item struct {
	Key       string // stable identity for de-duplication: barcode, else id
	Name      string
	Brand     string
	Source    domain.Source
	WholeWord bool // matched the whole-word query, not only the prefix query
	Infix     bool // matched only as a substring (a German compound), through the trigram index
	Favorite  bool
	Recent    bool
	Scans     int64 // how often the catalog saw this product scanned; 0 for the person's own foods
	Order     int   // position in the source's bm25 order; lower is better
}

// Rank orders items: favorite, recent, exact name, widely scanned, whole-word before prefix-only, name prefix, source, then bm25.
// A single prefix query cannot tell `Ja!` from `Jana`, which is why the whole-word tier exists (Spike F).
func Rank(items []Item, query string) []Item {
	forms := queryForms(query)
	out := slices.Clone(items)
	slices.SortStableFunc(out, func(a, b Item) int {
		for _, k := range []func(Item) int{
			func(i Item) int { return boolRank(i.Favorite) },
			func(i Item) int { return boolRank(i.Recent) },
			func(i Item) int { return boolRank(matchesAny(forms, domain.SearchName(i.Name), false)) },
			func(i Item) int { return boolRank(i.Scans >= PopularScans) },
			func(i Item) int { return boolRank(i.WholeWord) },
			func(i Item) int { return boolRank(!i.Infix) },
			func(i Item) int { return boolRank(matchesAny(forms, domain.SearchName(i.Name), true)) },
			func(i Item) int { return sourceRank(i.Source) },
			func(i Item) int { return i.Order },
		} {
			if d := k(a) - k(b); d != 0 {
				return d
			}
		}
		return 0
	})
	return out
}

// queryForms is the query as the index folds it, and again with ae/oe/ue read as umlauts, so "Haehnchen" ranks like "Hähnchen".
func queryForms(query string) []string {
	q := domain.SearchName(query)
	forms := []string{q}
	if plain := umlautPairs.Replace(q); plain != q {
		forms = append(forms, plain)
	}
	return forms
}

func matchesAny(forms []string, name string, prefix bool) bool {
	for _, f := range forms {
		if (prefix && strings.HasPrefix(name, f)) || (!prefix && name == f) {
			return true
		}
	}
	return false
}

func boolRank(b bool) int {
	if b {
		return 0
	}
	return 1
}

func sourceRank(s domain.Source) int {
	switch s {
	case domain.SourceUser:
		return 0
	case domain.SourceBLS:
		return 1
	default:
		return 2
	}
}
