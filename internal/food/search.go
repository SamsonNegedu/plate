package food

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/search"
	"plate/internal/store"
)

const (
	candidatePool   = 150
	maxResults      = 30
	localEnough     = 5
	offMinQueryLen  = 3
	searchHitTTL    = 24 * time.Hour
	searchEmptyTTL  = time.Hour
	recentPoolLimit = 50
)

// Result is one loggable search hit. A catalog hit has no ID until it is selected: the client then resolves its
// barcode, which materializes the row.
type Result struct {
	ID           *string
	Barcode      *string
	Name         string
	Brand        string
	Kcal100      float64
	ServingSize  string
	ServingGrams *float64
	// RefID is set for a hit from the shared reference foods (no barcode, no food id until it is selected).
	RefID      *string
	Source     domain.Source
	ImageKey   *string
	Nutriscore *string
	Favorite   bool
	// CatalogImage is true when a catalog hit has an image the proxy can serve by barcode.
	CatalogImage bool
	// Scans is the catalog's scan count for this product, used only to rank it.
	Scans int64
}

// Search finds foods: exact barcode, then FTS over the user's foods and the catalog, then Open Food Facts when
// fewer than five local hits exist. Every result is loggable.
func (s *Service) Search(ctx context.Context, userID, query string) ([]Result, error) {
	repo := store.NewRepo(s.db)
	query = strings.TrimSpace(query)
	toks := search.Tokens(query)
	if !search.Long(toks) {
		return []Result{}, nil
	}

	var items []search.Item
	byKey := map[string]Result{}
	add := func(r Result, tier tier, order int) {
		key := resultKey(r)
		if existing, ok := byKey[key]; ok {
			if existing.ID != nil || r.ID == nil {
				return
			}
		}
		byKey[key] = r
		items = append(items, search.Item{
			Key: key, Name: r.Name, Brand: r.Brand, Source: r.Source, WholeWord: tier == tierWhole, Infix: tier == tierInfix, Scans: r.Scans, Order: order,
		})
	}

	if err := s.local(ctx, repo, userID, toks, add); err != nil {
		return nil, err
	}

	if len(byKey) < localEnough && len(strings.Join(toks, "")) >= offMinQueryLen {
		if s.searchOFF(ctx, userID, toks) {
			items, byKey = items[:0], map[string]Result{}
			if err := s.local(ctx, repo, userID, toks, add); err != nil {
				return nil, err
			}
		}
	}
	return s.rankResults(ctx, repo, userID, query, items, byKey)
}

// local gathers whole-word hits first, then prefix-only hits, from the user's foods and the catalog.
func (s *Service) local(ctx context.Context, repo *store.Repo, userID string, toks []string, add func(Result, tier, int)) error {
	order := 0
	// A reference food the account already selected shows as its own row, so the shared row is not listed twice.
	owned := map[string]bool{}
	for _, whole := range []bool{true, false} {
		match := search.Match(toks, !whole)
		t := tierPrefix
		if whole {
			t = tierWhole
		}
		foods, err := repo.SearchFoods(ctx, userID, match, candidatePool)
		if err != nil {
			return err
		}
		for _, f := range foods {
			if f.Barcode == nil && f.Source == domain.SourceCatalog && f.SourceID != nil {
				owned[*f.SourceID] = true
			}
			add(foodResult(f), t, order)
			order++
		}
		refs, err := repo.SearchReference(ctx, match, candidatePool)
		if err != nil {
			return err
		}
		for _, ref := range refs {
			if !owned[ref.RefID] {
				add(referenceResult(ref), t, order)
				order++
			}
		}
		cats, err := repo.SearchCatalog(ctx, match, candidatePool)
		if err != nil {
			return err
		}
		overlay := s.factKcal(ctx, repo, cats)
		for _, c := range cats {
			add(overlayKcal(catalogResult(c), overlay), t, order)
			order++
		}
	}
	return s.localInfix(ctx, repo, userID, toks, add, order)
}

type tier int

const (
	tierWhole tier = iota
	tierPrefix
	tierInfix
)

// localInfix adds substring matches (Vollkornbrot for "brot"). Every long token must appear somewhere in the name or brand.
func (s *Service) localInfix(ctx context.Context, repo *store.Repo, userID string, toks []string, add func(Result, tier, int), order int) error {
	long := search.InfixTokens(toks)
	if len(long) == 0 {
		return nil
	}
	match := search.Match(long, false)
	foods, err := repo.SearchFoodsInfix(ctx, userID, match, candidatePool)
	if err != nil {
		return err
	}
	for _, f := range foods {
		add(foodResult(f), tierInfix, order)
		order++
	}
	cats, err := repo.SearchCatalogInfix(ctx, match, candidatePool)
	if err != nil {
		return err
	}
	overlay := s.factKcal(ctx, repo, cats)
	for _, c := range cats {
		add(overlayKcal(catalogResult(c), overlay), tierInfix, order)
		order++
	}
	return nil
}

// factKcal returns the served community calories for catalog hits that have a fact, keyed by barcode.
func (s *Service) factKcal(ctx context.Context, repo *store.Repo, cats []domain.CatalogFood) map[string]float64 {
	codes := make([]string, len(cats))
	for i, c := range cats {
		codes[i] = c.Barcode
	}
	revs, err := repo.AcceptedFacts(ctx, codes)
	if err != nil || len(revs) == 0 {
		return nil
	}
	out := make(map[string]float64, len(revs))
	for _, v := range revs {
		out[v.Barcode] = v.Per100.Kcal
	}
	return out
}

func overlayKcal(r Result, overlay map[string]float64) Result {
	if r.Barcode != nil {
		if k, ok := overlay[*r.Barcode]; ok {
			r.Kcal100 = k
		}
	}
	return r
}

func (s *Service) rankResults(ctx context.Context, repo *store.Repo, userID, query string, items []search.Item, byKey map[string]Result) ([]Result, error) {
	favIDs, err := repo.FavoriteFoodIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	recents, err := repo.RecentFoods(ctx, userID, recentPoolLimit)
	if err != nil {
		return nil, err
	}
	fav := map[string]bool{}
	for _, id := range favIDs {
		fav[id] = true
	}
	recent := map[string]bool{}
	for _, f := range recents {
		recent[f.ID] = true
	}
	for i := range items {
		r := byKey[items[i].Key]
		if r.ID != nil {
			items[i].Favorite = fav[*r.ID]
			items[i].Recent = recent[*r.ID]
		}
	}
	ranked := search.Rank(items, query)
	if code, _, err := NormalizeBarcode(query); err == nil {
		for i, it := range ranked { // an exact barcode match always comes first
			if r := byKey[it.Key]; r.Barcode != nil && *r.Barcode == code {
				ranked = append([]search.Item{it}, append(ranked[:i:i], ranked[i+1:]...)...)
				break
			}
		}
	}
	out := make([]Result, 0, min(len(ranked), maxResults))
	for _, it := range ranked {
		r := byKey[it.Key]
		if r.ID != nil && fav[*r.ID] {
			r.Favorite = true
		}
		out = append(out, r)
		if len(out) == maxResults {
			break
		}
	}
	return out, nil
}

func resultKey(r Result) string {
	if r.Barcode != nil {
		return "b:" + *r.Barcode
	}
	if r.ID != nil {
		return "i:" + *r.ID
	}
	if r.RefID != nil {
		return "r:" + *r.RefID
	}
	return "n:" + r.Name
}

func foodResult(f domain.Food) Result {
	return Result{
		ID: &f.ID, Barcode: f.Barcode, Name: f.Name, Brand: f.Brand, Kcal100: f.Per100.Kcal, ServingSize: f.ServingSize,
		ServingGrams: f.ServingGrams, Source: f.Source, ImageKey: f.ImageKey, Nutriscore: f.Nutriscore,
	}
}

func referenceResult(f domain.ReferenceFood) Result {
	id := f.RefID
	return Result{RefID: &id, Name: f.Name, Kcal100: f.Per100.Kcal, Source: domain.SourceCatalog}
}

func catalogResult(c domain.CatalogFood) Result {
	bc := c.Barcode
	return Result{
		Barcode: &bc, Name: c.Name, Brand: c.Brand, Kcal100: c.Per100.Kcal, ServingSize: c.ServingSize,
		ServingGrams: c.ServingGrams, Source: domain.SourceCatalog, Nutriscore: c.Nutriscore,
		CatalogImage: c.ImageSourceURL != nil, Scans: c.Scans,
	}
}

func searchCacheKey(toks []string) string {
	h := sha256.Sum256([]byte(strings.ToLower(strings.Join(toks, " ")) + "|de"))
	return "search:" + hex.EncodeToString(h[:12])
}

// searchOFF asks Open Food Facts and stores the loggable hits so the next query is local. It returns true when the
// local index changed and should be queried again. An upstream failure only means the local results stand.
func (s *Service) searchOFF(ctx context.Context, userID string, toks []string) bool {
	repo := store.NewRepo(s.db)
	key := searchCacheKey(toks)
	now := s.now()
	if _, ok, err := repo.SearchCacheGet(ctx, key, stamp(now)); err == nil && ok {
		return false
	}
	hits, err := s.off.Search(ctx, strings.Join(toks, " "))
	if err != nil {
		if !errors.Is(err, ErrUpstream) {
			s.log.WarnContext(ctx, "off search failed", slog.String("error", err.Error()))
		}
		return false
	}

	var saved []string
	changed := false
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		for _, p := range hits {
			n, err := Normalize(p, now)
			if err != nil || n.Food.Barcode == nil {
				continue // hits without kcal are dropped, never shown as zero-calorie products
			}
			if _, err := upsertOFFFood(ctx, r, userID, n, now); err != nil {
				return err
			}
			saved = append(saved, *n.Food.Barcode)
			changed = true
		}
		ttl := searchHitTTL
		if len(saved) == 0 {
			ttl = searchEmptyTTL
		}
		return r.SearchCachePut(ctx, key, jsonOf(saved), stamp(now.Add(ttl)))
	})
	if err != nil {
		s.log.WarnContext(ctx, "storing off search results failed", slog.String("error", err.Error()))
		return false
	}
	return changed
}

// upsertOFFFood stores a normalized OFF product without ever overwriting a user row.
func upsertOFFFood(ctx context.Context, r *store.Repo, userID string, n Normalized, now time.Time) (domain.Food, error) {
	f := n.Food
	f.UserID = userID
	ts := stamp(now)
	category, err := r.MostSpecificCategory(ctx, n.CategoryTags)
	if err != nil {
		return domain.Food{}, err
	}
	f.Category = category
	f.ImageKey = RegisterImage(ctx, r, n.ImageURL, ts)
	if f.Barcode != nil {
		existing, err := r.FoodByBarcode(ctx, userID, *f.Barcode)
		switch {
		case err == nil && existing.Source == domain.SourceUser:
			return existing, nil
		case err == nil:
			f.ID, f.CreatedAt = existing.ID, existing.CreatedAt
		case !errors.Is(err, domain.ErrNotFound):
			return domain.Food{}, err
		}
	}
	if f.ID == "" {
		id, err := uuid.NewV7()
		if err != nil {
			return domain.Food{}, fmt.Errorf("generating food id: %w", err)
		}
		f.ID, f.CreatedAt = id.String(), ts
	}
	f.UpdatedAt = ts
	if f.Barcode != nil {
		// An accepted community fact outranks what Open Food Facts says (ADR-020).
		if rev, err := r.AcceptedFact(ctx, *f.Barcode); err == nil {
			applyRevision(&f, rev, now)
		} else if !errors.Is(err, domain.ErrNotFound) {
			return domain.Food{}, err
		}
	}
	if err := r.PutFood(ctx, f); err != nil {
		return domain.Food{}, err
	}
	return f, nil
}
