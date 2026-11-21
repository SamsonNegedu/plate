package food

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
	psync "plate/internal/sync"
)

const (
	negativeTTL      = 24 * time.Hour
	staleAfter       = 90 * 24 * time.Hour
	recentUseWindow  = 30 * 24 * time.Hour
	revalidateEvery  = 24 * time.Hour
	revalidateBudget = 20 * time.Second
)

// Service resolves barcodes and searches foods. Lookup order: the user's foods, the catalog seed, a negative
// cache, then Open Food Facts. No database transaction is open while the network is used.
type Service struct {
	db  *sql.DB
	off Fetcher
	log *slog.Logger
	now func() time.Time

	mu       sync.Mutex
	inflight map[string]bool
	lastTry  map[string]time.Time
	wg       sync.WaitGroup
}

func NewService(db *sql.DB, off Fetcher, log *slog.Logger) *Service {
	return &Service{
		db: db, off: off, log: log, now: time.Now,
		inflight: map[string]bool{}, lastTry: map[string]time.Time{},
	}
}

// SetClock replaces the clock for tests.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Wait blocks until background revalidations finish. Tests and graceful shutdown use it.
func (s *Service) Wait() { s.wg.Wait() }

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// Barcode returns a loggable food for a scanned or typed code.
// Errors: ErrInvalid (bad code), ErrNotFound (a miss), *NotLoggableError, ErrUpstream.
func (s *Service) Barcode(ctx context.Context, userID, raw string) (domain.Food, error) {
	code, alts, err := NormalizeBarcode(raw)
	if err != nil {
		return domain.Food{}, err
	}
	candidates := append([]string{code}, alts...)
	repo := store.NewRepo(s.db)

	if f, ok, err := s.cachedFood(ctx, repo, userID, candidates); err != nil || ok {
		if ok {
			s.maybeRevalidate(userID, f)
		}
		return f, err
	}
	if f, ok, err := s.fromFacts(ctx, userID, candidates); err != nil || ok {
		return f, err
	}
	if f, ok, err := s.fromCatalog(ctx, userID, candidates); err != nil || ok {
		return f, err
	}

	now := s.now()
	if _, miss, err := repo.SearchCacheGet(ctx, negativeKey(code), stamp(now)); err != nil {
		return domain.Food{}, err
	} else if miss {
		return domain.Food{}, fmt.Errorf("barcode %s: %w", code, domain.ErrNotFound)
	}

	for _, c := range candidates {
		p, err := s.off.Product(ctx, c)
		if errors.Is(err, ErrProductNotFound) {
			continue
		}
		if err != nil {
			return domain.Food{}, err
		}
		return s.saveFromOFF(ctx, userID, p)
	}
	if err := repo.SearchCachePut(ctx, negativeKey(code), "{}", stamp(now.Add(negativeTTL))); err != nil {
		s.log.WarnContext(ctx, "negative cache write failed", slog.String("error", err.Error()))
	}
	return domain.Food{}, fmt.Errorf("barcode %s: %w", code, domain.ErrNotFound)
}

func negativeKey(code string) string { return "barcode:" + code }

// cachedFood returns the best live food the user already has for any candidate barcode. A user row wins.
func (s *Service) cachedFood(ctx context.Context, repo *store.Repo, userID string, candidates []string) (domain.Food, bool, error) {
	foods, err := repo.FoodsByBarcodes(ctx, userID, candidates)
	if err != nil || len(foods) == 0 {
		return domain.Food{}, false, err
	}
	best := foods[0]
	for _, f := range foods[1:] {
		if rank(f) < rank(best) || (rank(f) == rank(best) && indexOf(candidates, f.Barcode) < indexOf(candidates, best.Barcode)) {
			best = f
		}
	}
	return best, true, nil
}

func rank(f domain.Food) int {
	switch f.Source {
	case domain.SourceUser:
		return 0
	case domain.SourceBLS:
		return 1
	default:
		return 2
	}
}

func indexOf(list []string, v *string) int {
	if v == nil {
		return len(list)
	}
	for i, c := range list {
		if c == *v {
			return i
		}
	}
	return len(list)
}

// fromCatalog materializes a seed row into the user's foods so entries, favorites and the food sheet share one model.
func (s *Service) fromCatalog(ctx context.Context, userID string, candidates []string) (domain.Food, bool, error) {
	repo := store.NewRepo(s.db)
	rows, err := repo.CatalogByBarcodes(ctx, candidates)
	if err != nil || len(rows) == 0 {
		return domain.Food{}, false, err
	}
	row := rows[0]
	for _, c := range rows[1:] {
		if indexOfStr(candidates, c.Barcode) < indexOfStr(candidates, row.Barcode) {
			row = c
		}
	}

	var out domain.Food
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		if f, ok, err := s.cachedFood(ctx, r, userID, candidates); err != nil || ok {
			out = f
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generating food id: %w", err)
		}
		now := stamp(s.now())
		bc := row.Barcode
		imageSource := ""
		if row.ImageSourceURL != nil {
			imageSource = *row.ImageSourceURL
		}
		out = domain.Food{
			ID: id.String(), UserID: userID, Barcode: &bc, Name: row.Name, Brand: row.Brand, Quantity: row.Quantity,
			ServingSize: row.ServingSize, ServingGrams: row.ServingGrams, Per100: row.Per100, Nutriscore: row.Nutriscore,
			Source: domain.SourceCatalog, SourceID: &bc, SourceCheckedAt: &row.ImportedAt, Category: row.Category,
			ImageKey: RegisterImage(ctx, r, imageSource, now), SearchName: domain.SearchName(row.Name + " " + row.Brand),
			CreatedAt: now, UpdatedAt: now,
		}
		return r.PutFood(ctx, out)
	})
	if err != nil {
		return domain.Food{}, false, err
	}
	return out, true, nil
}

func indexOfStr(list []string, v string) int {
	for i, c := range list {
		if c == v {
			return i
		}
	}
	return len(list)
}

// saveFromOFF normalizes and stores an upstream product. A product without usable kcal returns *NotLoggableError and
// is not stored. A user row for the same barcode is never overwritten.
func (s *Service) saveFromOFF(ctx context.Context, userID string, p OFFProduct) (domain.Food, error) {
	n, err := Normalize(p, s.now())
	if err != nil {
		var nl *NotLoggableError
		if errors.As(err, &nl) {
			s.registerOnly(ctx, nl)
		}
		return domain.Food{}, err
	}
	var out domain.Food
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		var err error
		out, err = upsertOFFFood(ctx, r, userID, n, s.now())
		return err
	})
	return out, err
}

// registerOnly lets the client show the product image of a not-loggable product; it stores no food.
func (s *Service) registerOnly(ctx context.Context, nl *NotLoggableError) {
	if nl.ImageURL == "" {
		return
	}
	_ = store.InTx(ctx, s.db, func(r *store.Repo) error {
		RegisterImage(ctx, r, nl.ImageURL, stamp(s.now()))
		return nil
	})
}

// ImageKeyFor returns the proxy key for an upstream URL, or "" when the URL is not allowlisted.
func ImageKeyFor(url string) string {
	if !AllowedImageURL(url) {
		return ""
	}
	return imageKey(url)
}

// maybeRevalidate refreshes an old OFF row in the background when it was logged recently. It never blocks the caller,
// runs at most once per food per day and never touches user rows.
func (s *Service) maybeRevalidate(userID string, f domain.Food) {
	if f.Source != domain.SourceOFF || f.DeletedAt != nil || f.Barcode == nil || f.CommunityRev != nil {
		return
	}
	now := s.now()
	if f.SourceCheckedAt != nil {
		if t, err := time.Parse(time.RFC3339, *f.SourceCheckedAt); err == nil && now.Sub(t) < staleAfter {
			return
		}
	}
	key := userID + "/" + f.ID
	s.mu.Lock()
	if s.inflight[key] || now.Sub(s.lastTry[key]) < revalidateEvery {
		s.mu.Unlock()
		return
	}
	s.inflight[key] = true
	s.lastTry[key] = now
	s.mu.Unlock()

	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		defer func() {
			s.mu.Lock()
			delete(s.inflight, key)
			s.mu.Unlock()
		}()
		ctx, cancel := context.WithTimeout(context.Background(), revalidateBudget)
		defer cancel()
		s.revalidate(ctx, userID, f)
	}()
}

func (s *Service) revalidate(ctx context.Context, userID string, f domain.Food) {
	repo := store.NewRepo(s.db)
	since := stamp(s.now().Add(-recentUseWindow))
	if n, err := repo.FoodUsesSince(ctx, userID, f.ID, since); err != nil || n == 0 {
		return
	}
	p, err := s.off.Product(ctx, *f.Barcode)
	if err != nil {
		s.log.InfoContext(ctx, "revalidation skipped", slog.String("reason", err.Error()))
		return
	}
	n, err := Normalize(p, s.now())
	if err != nil {
		return
	}
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		cur, err := r.Food(ctx, userID, f.ID)
		if err != nil || cur.Source != domain.SourceOFF || cur.CommunityRev != nil {
			return err // a correction made meanwhile wins
		}
		u := n.Food
		u.ID, u.UserID, u.CreatedAt, u.Source = cur.ID, userID, cur.CreatedAt, domain.SourceOFF
		u.UpdatedAt = stamp(s.now())
		u.ImageKey = cur.ImageKey
		u.Category = cur.Category
		if c, err := r.MostSpecificCategory(ctx, n.CategoryTags); err == nil && c != "" {
			u.Category = c
		}
		if k := RegisterImage(ctx, r, n.ImageURL, u.UpdatedAt); k != nil {
			u.ImageKey = k
		}
		return r.PutFood(ctx, u)
	})
	if err != nil {
		s.log.WarnContext(ctx, "revalidation failed", slog.String("error", err.Error()))
	}
}

// FoodInput is a manual food or a correction. kcal is mandatory.
type FoodInput struct {
	Barcode      *string
	Name         string
	Brand        string
	Quantity     string
	ServingSize  string
	ServingGrams *float64
	Per100       domain.Nutrients
	Nutriscore   *string
}

// SaveCustom creates a user food or corrects an existing row in place. A correction sets source='user', keeps source_id,
// and is synced. If a live row already owns the barcode, that row is corrected rather than duplicated.
func (s *Service) SaveCustom(ctx context.Context, userID, id string, in FoodInput) (domain.Food, error) {
	n, err := validateFoodInput(id, &in)
	if err != nil {
		return domain.Food{}, err
	}
	in.Per100 = n
	var out domain.Food
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		now := s.now()
		f, err := r.Food(ctx, userID, id)
		switch {
		case err == nil && f.DeletedAt != nil:
			return fmt.Errorf("food %s: %w", id, domain.ErrTombstoned)
		case errors.Is(err, domain.ErrNotFound):
			f = domain.Food{ID: id, UserID: userID, CreatedAt: stamp(now)}
			if in.Barcode != nil {
				if owner, err := r.FoodByBarcode(ctx, userID, *in.Barcode); err == nil {
					f = owner
				} else if !errors.Is(err, domain.ErrNotFound) {
					return err
				}
			}
		case err != nil:
			return err
		}
		if in.Barcode != nil && (f.Barcode == nil || *f.Barcode != *in.Barcode) {
			if owner, err := r.FoodByBarcode(ctx, userID, *in.Barcode); err == nil && owner.ID != f.ID {
				return fmt.Errorf("barcode %s already belongs to %q: %w", *in.Barcode, owner.Name, domain.ErrConflict)
			}
		}
		f.Barcode = in.Barcode
		f.Name, f.Brand, f.Quantity, f.ServingSize = in.Name, in.Brand, in.Quantity, in.ServingSize
		f.ServingGrams, f.Per100 = in.ServingGrams, in.Per100
		if in.Nutriscore != nil {
			f.Nutriscore = in.Nutriscore
		}
		f.Source = domain.SourceUser
		f.SearchName = domain.SearchName(f.Name + " " + f.Brand)
		f.DeletedAt = nil
		out, err = psync.ApplyFood(ctx, r, f, now)
		return err
	})
	return out, err
}

func validateFoodInput(id string, in *FoodInput) (domain.Nutrients, error) {
	var fields []domain.FieldError
	add := func(f, m string) { fields = append(fields, domain.FieldError{Field: f, Message: m}) }
	if _, err := uuid.Parse(id); err != nil {
		add("id", "must be a UUID")
	}
	in.Name = cleanName(in.Name)
	in.Brand = cleanName(in.Brand)
	if in.Name == "" {
		add("name", "is required")
	}
	if in.Barcode != nil {
		code, _, err := NormalizeBarcode(*in.Barcode)
		if err != nil {
			add("barcode", "must have 6 to 14 digits")
		} else {
			in.Barcode = &code
		}
	}
	if in.ServingGrams != nil && (*in.ServingGrams <= 0 || *in.ServingGrams > 5000) {
		add("serving_grams", "must be between 0 and 5000")
	}
	if in.Nutriscore != nil {
		in.Nutriscore = nutriscore(*in.Nutriscore)
	}
	n, ok := SanitizeNutrients(in.Per100)
	if !ok {
		add("kcal", "nutrition values are not plausible per 100 g")
	}
	if len(fields) > 0 {
		return domain.Nutrients{}, &domain.ValidationError{Fields: fields}
	}
	return n, nil
}

// SetFavorite sets or clears a favorite. The food must exist for the user.
func (s *Service) SetFavorite(ctx context.Context, userID, foodID string, on bool) (domain.Favorite, error) {
	var out domain.Favorite
	err := store.InTx(ctx, s.db, func(r *store.Repo) error {
		if ok, err := r.FoodExists(ctx, userID, foodID); err != nil {
			return err
		} else if !ok {
			return fmt.Errorf("food %s: %w", foodID, domain.ErrNotFound)
		}
		var err error
		out, _, err = psync.ApplyFavorite(ctx, r, userID, foodID, on, s.now())
		return err
	})
	return out, err
}

// IsFavorite reports whether the food is currently a favorite.
func (s *Service) IsFavorite(ctx context.Context, userID, foodID string) (bool, error) {
	f, err := store.NewRepo(s.db).Favorite(ctx, userID, foodID)
	if errors.Is(err, domain.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return f.DeletedAt == nil, nil
}

// Recent lists distinct foods the user logged most recently.
func (s *Service) Recent(ctx context.Context, userID string, limit int) ([]domain.Food, error) {
	return store.NewRepo(s.db).RecentFoods(ctx, userID, limit)
}

// PruneCaches removes expired search and negative cache rows.
func (s *Service) PruneCaches(ctx context.Context) (int64, error) {
	return store.NewRepo(s.db).PruneSearchCache(ctx, stamp(s.now()))
}

// jsonOf is a tiny helper for cache payloads.
func jsonOf(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}
