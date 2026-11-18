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

// Match renders a bound FTS5 MATCH string. Every token is quoted. With prefix, the last token also matches word starts.
func Match(tokens []string, prefix bool) string {
	parts := make([]string, len(tokens))
	for i, t := range tokens {
		parts[i] = `"` + strings.ReplaceAll(t, `"`, `""`) + `"`
		if prefix && i == len(tokens)-1 {
			parts[i] += "*"
		}
	}
	return strings.Join(parts, " ")
}

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
	Order     int // position in the source's bm25 order; lower is better
}

// Rank orders items: favorite, recent, exact name, whole-word before prefix-only, name prefix, source, then bm25.
// A single prefix query cannot tell `Ja!` from `Jana`, which is why the whole-word tier exists (Spike F).
func Rank(items []Item, query string) []Item {
	q := domain.SearchName(query)
	out := slices.Clone(items)
	slices.SortStableFunc(out, func(a, b Item) int {
		for _, k := range []func(Item) int{
			func(i Item) int { return boolRank(i.Favorite) },
			func(i Item) int { return boolRank(i.Recent) },
			func(i Item) int { return boolRank(domain.SearchName(i.Name) == q) },
			func(i Item) int { return boolRank(i.WholeWord) },
			func(i Item) int { return boolRank(!i.Infix) },
			func(i Item) int { return boolRank(strings.HasPrefix(domain.SearchName(i.Name), q)) },
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
