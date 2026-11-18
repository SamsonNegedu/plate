package sync

import (
	"context"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

// ApplyFood writes a user food inside the caller's transaction and records the change. Only source='user'
// foods are synced; the caller must not pass cached OFF, BLS or catalog rows.
func ApplyFood(ctx context.Context, r *store.Repo, f domain.Food, now time.Time) (domain.Food, error) {
	f.UpdatedAt = stamp(now)
	if f.CreatedAt == "" {
		f.CreatedAt = f.UpdatedAt
	}
	op := "upsert"
	if f.DeletedAt != nil {
		op = "delete"
	}
	seq, err := r.AppendChange(ctx, f.UserID, store.ChangeFood, f.ID, op, f.UpdatedAt)
	if err != nil {
		return domain.Food{}, err
	}
	f.ServerSeq = seq
	if err := r.PutFood(ctx, f); err != nil {
		return domain.Food{}, err
	}
	if err := storePayload(ctx, r, f.UserID, seq, FoodToDoc(f)); err != nil {
		return domain.Food{}, err
	}
	return f, nil
}

// ApplyFavorite sets or clears a favorite inside the caller's transaction. Clearing writes a tombstone.
func ApplyFavorite(ctx context.Context, r *store.Repo, userID, foodID string, on bool, now time.Time) (domain.Favorite, bool, error) {
	existing, err := r.Favorite(ctx, userID, foodID)
	switch {
	case err != nil && !isNotFound(err):
		return domain.Favorite{}, false, err
	case err == nil && (existing.DeletedAt == nil) == on:
		return existing, false, nil // already in the requested state
	case err != nil && !on:
		return domain.Favorite{}, false, nil // never a favorite, nothing to clear
	}
	fav := existing
	fav.UserID, fav.FoodID = userID, foodID
	if fav.CreatedAt == "" {
		fav.CreatedAt = stamp(now)
	}
	fav.UpdatedAt = stamp(now)
	fav.DeletedAt = nil
	op := "upsert"
	if !on {
		t := stamp(now)
		fav.DeletedAt = &t
		op = "delete"
	}
	if err := writeFavorite(ctx, r, fav, op, now); err != nil {
		return domain.Favorite{}, false, err
	}
	out, err := r.Favorite(ctx, userID, foodID)
	return out, true, err
}
