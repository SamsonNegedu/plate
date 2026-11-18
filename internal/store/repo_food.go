package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store/sqlc"
)

// SearchCacheGet returns an unexpired cached response.
func (r *Repo) SearchCacheGet(ctx context.Context, key, now string) (string, bool, error) {
	v, err := r.q.GetSearchCache(ctx, sqlc.GetSearchCacheParams{Key: key, ExpiresAt: now})
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("reading search cache: %w", err)
	}
	return v, true, nil
}

func (r *Repo) SearchCachePut(ctx context.Context, key, response, expiresAt string) error {
	if err := r.q.PutSearchCache(ctx, sqlc.PutSearchCacheParams{Key: key, Response: response, ExpiresAt: expiresAt}); err != nil {
		return fmt.Errorf("writing search cache: %w", err)
	}
	return nil
}

func (r *Repo) PruneSearchCache(ctx context.Context, now string) (int64, error) {
	n, err := r.q.PruneSearchCache(ctx, now)
	if err != nil {
		return 0, fmt.Errorf("pruning search cache: %w", err)
	}
	return n, nil
}

func (r *Repo) FoodBySource(ctx context.Context, userID string, source domain.Source, sourceID string) (domain.Food, error) {
	f, err := r.q.GetFoodBySource(ctx, sqlc.GetFoodBySourceParams{UserID: userID, Source: string(source), SourceID: &sourceID})
	if err != nil {
		return domain.Food{}, notFound(err, "food by source")
	}
	return toFood(f), nil
}

func (r *Repo) RecentFoods(ctx context.Context, userID string, limit int) ([]domain.Food, error) {
	rows, err := r.q.ListRecentFoods(ctx, sqlc.ListRecentFoodsParams{UserID: userID, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("listing recent foods: %w", err)
	}
	return toFoods(rows), nil
}

func (r *Repo) FavoriteFoodIDs(ctx context.Context, userID string) ([]string, error) {
	ids, err := r.q.ListFavoriteFoodIDs(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing favorites: %w", err)
	}
	return ids, nil
}

// FoodUsesSince counts live entries that logged the food at or after since.
func (r *Repo) FoodUsesSince(ctx context.Context, userID, foodID, since string) (int64, error) {
	id := foodID
	n, err := r.q.CountFoodUsesSince(ctx, sqlc.CountFoodUsesSinceParams{UserID: userID, FoodID: &id, CreatedAt: since})
	if err != nil {
		return 0, fmt.Errorf("counting food uses: %w", err)
	}
	return n, nil
}

func (r *Repo) FoodsByBarcodes(ctx context.Context, userID string, barcodes []string) ([]domain.Food, error) {
	if len(barcodes) == 0 {
		return []domain.Food{}, nil
	}
	bc := make([]*string, len(barcodes))
	for i := range barcodes {
		bc[i] = &barcodes[i]
	}
	rows, err := r.q.ListFoodsByBarcodes(ctx, sqlc.ListFoodsByBarcodesParams{UserID: userID, Barcodes: bc})
	if err != nil {
		return nil, fmt.Errorf("listing foods by barcode: %w", err)
	}
	return toFoods(rows), nil
}

// SearchFoods runs a bound FTS5 MATCH over the user's foods, best bm25 first.
func (r *Repo) SearchFoods(ctx context.Context, userID, match string, limit int) ([]domain.Food, error) {
	rows, err := r.q.SearchFoods(ctx, sqlc.SearchFoodsParams{Match: &match, UserID: userID, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("searching foods: %w", err)
	}
	return toFoods(rows), nil
}

// SearchFoodsInfix matches substrings (German compounds) through the trigram index.
func (r *Repo) SearchFoodsInfix(ctx context.Context, userID, match string, limit int) ([]domain.Food, error) {
	rows, err := r.q.SearchFoodsInfix(ctx, sqlc.SearchFoodsInfixParams{Match: &match, UserID: userID, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("searching foods by substring: %w", err)
	}
	return toFoods(rows), nil
}

func (r *Repo) SearchCatalogInfix(ctx context.Context, match string, limit int) ([]domain.CatalogFood, error) {
	rows, err := r.q.SearchCatalogInfix(ctx, sqlc.SearchCatalogInfixParams{Match: &match, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("searching catalog by substring: %w", err)
	}
	return toCatalogFoods(rows), nil
}

func (r *Repo) SearchCatalog(ctx context.Context, match string, limit int) ([]domain.CatalogFood, error) {
	rows, err := r.q.SearchCatalog(ctx, sqlc.SearchCatalogParams{Match: &match, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("searching catalog: %w", err)
	}
	return toCatalogFoods(rows), nil
}

func (r *Repo) CatalogByBarcode(ctx context.Context, barcode string) (domain.CatalogFood, error) {
	c, err := r.q.GetCatalogFoodByBarcode(ctx, barcode)
	if err != nil {
		return domain.CatalogFood{}, notFound(err, "catalog food")
	}
	return toCatalogFood(c), nil
}

func (r *Repo) CatalogByBarcodes(ctx context.Context, barcodes []string) ([]domain.CatalogFood, error) {
	if len(barcodes) == 0 {
		return []domain.CatalogFood{}, nil
	}
	rows, err := r.q.ListCatalogByBarcodes(ctx, barcodes)
	if err != nil {
		return nil, fmt.Errorf("listing catalog rows: %w", err)
	}
	return toCatalogFoods(rows), nil
}

func (r *Repo) CountCatalog(ctx context.Context) (int64, error) {
	n, err := r.q.CountCatalogFoods(ctx)
	if err != nil {
		return 0, fmt.Errorf("counting catalog: %w", err)
	}
	return n, nil
}

func (r *Repo) CatalogMeta(ctx context.Context, key string) (string, error) {
	v, err := r.q.GetCatalogMeta(ctx, key)
	if err != nil {
		return "", notFound(err, "catalog meta "+key)
	}
	return v, nil
}

func (r *Repo) SetCatalogMeta(ctx context.Context, key, value string) error {
	if err := r.q.SetCatalogMeta(ctx, sqlc.SetCatalogMetaParams{Key: key, Value: value}); err != nil {
		return fmt.Errorf("writing catalog meta: %w", err)
	}
	return nil
}

func (r *Repo) ClearCatalog(ctx context.Context) error {
	if err := r.q.DeleteAllCatalogFoods(ctx); err != nil {
		return fmt.Errorf("clearing catalog: %w", err)
	}
	return nil
}

func (r *Repo) PutCatalogFood(ctx context.Context, c domain.CatalogFood, now string) error {
	err := r.q.InsertCatalogFood(ctx, sqlc.InsertCatalogFoodParams{
		Barcode: c.Barcode, Name: c.Name, Brand: c.Brand, Quantity: c.Quantity, ServingSize: c.ServingSize,
		ServingGrams: c.ServingGrams, Kcal100g: c.Per100.Kcal, Protein100g: c.Per100.Protein, Carbs100g: c.Per100.Carbs,
		Fat100g: c.Per100.Fat, Sugar100g: c.Per100.Sugar, Satfat100g: c.Per100.SatFat, Fiber100g: c.Per100.Fiber,
		Salt100g: c.Per100.Salt, Nutriscore: c.Nutriscore, ImageSourceUrl: c.ImageSourceURL, Scans: c.Scans,
		DatasetVersion: c.DatasetVersion, ImportedAt: c.ImportedAt, UpdatedAt: now,
	})
	if err != nil {
		return fmt.Errorf("saving catalog food: %w", err)
	}
	return nil
}

func toCatalogFoods(rows []sqlc.CatalogFood) []domain.CatalogFood {
	out := make([]domain.CatalogFood, 0, len(rows))
	for _, c := range rows {
		out = append(out, toCatalogFood(c))
	}
	return out
}

func toCatalogFood(c sqlc.CatalogFood) domain.CatalogFood {
	return domain.CatalogFood{
		Barcode: c.Barcode, Name: c.Name, Brand: c.Brand, Quantity: c.Quantity, ServingSize: c.ServingSize,
		ServingGrams: c.ServingGrams,
		Per100: domain.Nutrients{
			Kcal: c.Kcal100g, Protein: c.Protein100g, Carbs: c.Carbs100g, Fat: c.Fat100g,
			Sugar: c.Sugar100g, SatFat: c.Satfat100g, Fiber: c.Fiber100g, Salt: c.Salt100g,
		},
		Nutriscore: c.Nutriscore, ImageSourceURL: c.ImageSourceUrl, Scans: c.Scans,
		DatasetVersion: c.DatasetVersion, ImportedAt: c.ImportedAt,
	}
}

func (r *Repo) Image(ctx context.Context, key string) (domain.ImageRecord, error) {
	i, err := r.q.GetImage(ctx, key)
	if err != nil {
		return domain.ImageRecord{}, notFound(err, "image")
	}
	return domain.ImageRecord{
		Key: i.Key, ContentType: i.ContentType, Bytes: i.Bytes, FetchedAt: i.FetchedAt, LastUsedAt: i.LastUsedAt, SourceURL: i.SourceUrl,
	}, nil
}

func (r *Repo) RegisterImage(ctx context.Context, key, sourceURL, now string) error {
	err := r.q.RegisterImage(ctx, sqlc.RegisterImageParams{Key: key, LastUsedAt: now, SourceUrl: sourceURL})
	if err != nil {
		return fmt.Errorf("registering image: %w", err)
	}
	return nil
}

func (r *Repo) MarkImageFetched(ctx context.Context, key, contentType string, bytes int64, now string) error {
	err := r.q.MarkImageFetched(ctx, sqlc.MarkImageFetchedParams{ContentType: contentType, Bytes: bytes, FetchedAt: now, LastUsedAt: now, Key: key})
	if err != nil {
		return fmt.Errorf("recording image: %w", err)
	}
	return nil
}

func (r *Repo) TouchImage(ctx context.Context, key, now string) error {
	if err := r.q.TouchImage(ctx, sqlc.TouchImageParams{LastUsedAt: now, Key: key}); err != nil {
		return fmt.Errorf("touching image: %w", err)
	}
	return nil
}

func (r *Repo) ClearImage(ctx context.Context, key string) error {
	if err := r.q.ClearImage(ctx, key); err != nil {
		return fmt.Errorf("clearing image: %w", err)
	}
	return nil
}

func (r *Repo) ImageCacheBytes(ctx context.Context) (int64, error) {
	v, err := r.q.ImageCacheBytes(ctx)
	if err != nil {
		return 0, fmt.Errorf("summing image cache: %w", err)
	}
	switch n := v.(type) {
	case int64:
		return n, nil
	case float64:
		return int64(n), nil
	}
	return 0, nil
}

type LRUImage struct {
	Key   string
	Bytes int64
}

func (r *Repo) ImagesLRU(ctx context.Context, limit int) ([]LRUImage, error) {
	rows, err := r.q.ListImagesLRU(ctx, int64(limit))
	if err != nil {
		return nil, fmt.Errorf("listing images: %w", err)
	}
	out := make([]LRUImage, 0, len(rows))
	for _, i := range rows {
		out = append(out, LRUImage{Key: i.Key, Bytes: i.Bytes})
	}
	return out, nil
}
