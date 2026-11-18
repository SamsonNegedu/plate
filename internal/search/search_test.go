package search

import (
	"slices"
	"strings"
	"testing"

	"plate/internal/domain"
)

func TestTokensStripSyntaxAndPunctuation(t *testing.T) {
	cases := map[string][]string{
		"ja!":                 {"ja"},
		"Gut & Günstig":       {"Gut", "Günstig"},
		`"quoted" (x) a:b ^c`: {"quoted", "x", "a", "b", "c"},
		"foo*":                {"foo"},
		"-bar":                {"bar"},
		"   ":                 nil,
		"3,5% Fett":           {"3", "5", "Fett"},
		"AND OR NOT NEAR":     {"AND", "OR", "NOT", "NEAR"},
	}
	for in, want := range cases {
		if got := Tokens(in); !slices.Equal(got, want) {
			t.Errorf("Tokens(%q) = %v, want %v", in, got, want)
		}
	}
	if got := Tokens(strings.Repeat("a ", 30)); len(got) != 8 {
		t.Errorf("token cap = %d", len(got))
	}
}

func TestMatchQuotesEveryTokenSoOperatorsAreLiterals(t *testing.T) {
	if got := Match([]string{"AND", "OR"}, true); got != `"AND" "OR"*` {
		t.Fatalf("got %s", got)
	}
	if got := Match([]string{"gut", "günstig"}, false); got != `"gut" "günstig"` {
		t.Fatalf("got %s", got)
	}
	if got := Match([]string{`a"b`}, false); got != `"a""b"` {
		t.Fatalf("embedded quote not escaped: %s", got)
	}
}

func TestLong(t *testing.T) {
	if Long(nil) || Long([]string{"a"}) || !Long([]string{"ja"}) || !Long([]string{"a", "b"}) {
		t.Fatal("length rule wrong")
	}
}

func names(items []Item) []string {
	out := make([]string, len(items))
	for i, it := range items {
		out[i] = it.Name
	}
	return out
}

func TestWholeWordBeatsPrefixOnly(t *testing.T) {
	// Spike F: a prefix query ranked "Jana jagoda guava" above the Ja! products.
	items := []Item{
		{Name: "Jana jagoda guava", Brand: "Jana", Source: domain.SourceCatalog, Order: 0},
		{Name: "Ja Erdnüsse", Brand: "Ja!", Source: domain.SourceCatalog, WholeWord: true, Order: 1},
		{Name: "Jägermeister", Brand: "Jägermeister", Source: domain.SourceCatalog, Order: 2},
	}
	got := Rank(items, "ja!")
	if got[0].Name != "Ja Erdnüsse" {
		t.Fatalf("order = %v", names(got))
	}
}

func TestRankOrder(t *testing.T) {
	items := []Item{
		{Name: "Joghurt Natur", Source: domain.SourceCatalog, WholeWord: true, Order: 0},
		{Name: "Joghurt", Source: domain.SourceCatalog, WholeWord: true, Order: 5},
		{Name: "Fruchtjoghurt", Source: domain.SourceCatalog, Order: 1},
		{Name: "Mein Joghurt", Source: domain.SourceUser, WholeWord: true, Order: 9},
		{Name: "Skyr", Source: domain.SourceCatalog, Favorite: true, Order: 10},
		{Name: "Quark", Source: domain.SourceCatalog, Recent: true, Order: 11},
	}
	got := names(Rank(items, "Joghurt"))
	want := []string{"Skyr", "Quark", "Joghurt", "Joghurt Natur", "Mein Joghurt", "Fruchtjoghurt"}
	if !slices.Equal(got, want) {
		t.Fatalf("got  %v\nwant %v", got, want)
	}
}

func TestRankIsStableAndDoesNotMutateInput(t *testing.T) {
	items := []Item{{Name: "B", Order: 1}, {Name: "A", Order: 0}}
	_ = Rank(items, "x")
	if items[0].Name != "B" {
		t.Fatal("input was reordered")
	}
	tied := []Item{{Name: "X1"}, {Name: "X2"}, {Name: "X3"}}
	if got := names(Rank(tied, "y")); !slices.Equal(got, []string{"X1", "X2", "X3"}) {
		t.Fatalf("ties reordered: %v", got)
	}
}

func TestExactNameIgnoresCaseAndUmlauts(t *testing.T) {
	items := []Item{{Name: "Käsekuchen", WholeWord: true}, {Name: "Käse", WholeWord: true, Order: 3}}
	if got := Rank(items, "kase"); got[0].Name != "Käse" {
		t.Fatalf("got %v", names(got))
	}
}
