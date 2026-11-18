package sync

import (
	"context"
	"errors"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

func orNow(s string, now time.Time) string {
	if s == "" {
		return stamp(now)
	}
	return s
}

// restoreFoods upserts the backup's foods and returns a map from backup id to the id actually stored.
// A cached (non-user) food whose barcode is already live under another id is mapped to the existing row.
func restoreFoods(ctx context.Context, r *store.Repo, userID string, docs []FoodDoc, now time.Time, res *ImportResult) (map[string]string, error) {
	ids := make(map[string]string, len(docs))
	inDoc := make(map[string]bool, len(docs))
	for _, d := range docs {
		inDoc[d.ID] = true
	}
	existing, err := r.UserFoods(ctx, userID)
	if err != nil {
		return nil, err
	}
	for _, f := range existing {
		if inDoc[f.ID] || f.DeletedAt != nil {
			continue
		}
		t := stamp(now)
		f.DeletedAt, f.UpdatedAt = &t, t
		if err := writeFood(ctx, r, f, "delete", now); err != nil {
			return nil, err
		}
		res.Removed++
	}

	for _, d := range docs {
		f := DocToFood(d, userID)
		f.CreatedAt = orNow(f.CreatedAt, now)
		f.UpdatedAt = stamp(now)
		isUser := f.Source == domain.SourceUser

		if f.Barcode != nil && f.DeletedAt == nil {
			other, err := r.FoodByBarcode(ctx, userID, *f.Barcode)
			switch {
			case errors.Is(err, domain.ErrNotFound):
			case err != nil:
				return nil, err
			case other.ID != f.ID && isUser:
				t := stamp(now)
				other.DeletedAt, other.UpdatedAt = &t, t
				if other.Source == domain.SourceUser {
					if err := writeFood(ctx, r, other, "delete", now); err != nil {
						return nil, err
					}
				} else if err := r.PutFood(ctx, other); err != nil {
					return nil, err
				}
			case other.ID != f.ID:
				ids[d.ID] = other.ID
				continue
			}
		}
		ids[d.ID] = f.ID
		op := "upsert"
		if f.DeletedAt != nil {
			op = "delete"
		}
		if isUser {
			if err := writeFood(ctx, r, f, op, now); err != nil {
				return nil, err
			}
		} else {
			f.ServerSeq = 0
			if err := r.PutFood(ctx, f); err != nil {
				return nil, err
			}
		}
		res.Foods++
	}
	return ids, nil
}

func writeFood(ctx context.Context, r *store.Repo, f domain.Food, op string, now time.Time) error {
	seq, err := r.AppendChange(ctx, f.UserID, store.ChangeFood, f.ID, op, stamp(now))
	if err != nil {
		return err
	}
	f.ServerSeq = seq
	if err := r.PutFood(ctx, f); err != nil {
		return err
	}
	return storePayload(ctx, r, f.UserID, seq, FoodToDoc(f))
}

func mapFood(ids map[string]string, id *string) *string {
	if id == nil {
		return nil
	}
	if m, ok := ids[*id]; ok {
		return &m
	}
	return id
}

func restoreEntries(ctx context.Context, r *store.Repo, userID string, doc ExportDoc, foodIDs map[string]string, now time.Time, res *ImportResult) error {
	inDoc := make(map[string]bool, len(doc.Entries))
	for _, d := range doc.Entries {
		inDoc[d.ID] = true
	}
	existing, err := r.AllEntries(ctx, userID)
	if err != nil {
		return err
	}
	for _, e := range existing {
		if inDoc[e.ID] || e.DeletedAt != nil {
			continue
		}
		if _, err := ApplyEntryDelete(ctx, r, userID, e.ID, now); err != nil {
			return err
		}
		res.Removed++
	}
	for _, d := range doc.Entries {
		e := DocToEntry(d, userID)
		e.FoodID = mapFood(foodIDs, e.FoodID)
		e.CreatedAt = orNow(e.CreatedAt, now)
		e.UpdatedAt = stamp(now)
		e.DeletedAt = nil
		if _, err := writeEntry(ctx, r, e, "upsert", now); err != nil {
			return err
		}
		res.Entries++
	}
	return nil
}

func restoreMeals(ctx context.Context, r *store.Repo, userID string, docs []SavedMealDoc, foodIDs map[string]string, now time.Time, res *ImportResult) error {
	inDoc := make(map[string]bool, len(docs))
	for _, d := range docs {
		inDoc[d.ID] = true
	}
	existing, err := r.AllSavedMeals(ctx, userID)
	if err != nil {
		return err
	}
	for _, m := range existing {
		if inDoc[m.ID] || m.DeletedAt != nil {
			continue
		}
		t := stamp(now)
		m.DeletedAt, m.UpdatedAt = &t, t
		if err := writeMeal(ctx, r, m, "delete", now); err != nil {
			return err
		}
		res.Removed++
	}
	for _, d := range docs {
		m := DocToMeal(d, userID)
		m.CreatedAt = orNow(m.CreatedAt, now)
		m.UpdatedAt = stamp(now)
		for i := range m.Items {
			m.Items[i].FoodID = mapFood(foodIDs, m.Items[i].FoodID)
		}
		op := "upsert"
		if m.DeletedAt != nil {
			op = "delete"
		}
		if err := writeMeal(ctx, r, m, op, now); err != nil {
			return err
		}
		res.SavedMeals++
	}
	return nil
}

func writeMeal(ctx context.Context, r *store.Repo, m domain.SavedMeal, op string, now time.Time) error {
	seq, err := r.AppendChange(ctx, m.UserID, store.ChangeSavedMeal, m.ID, op, stamp(now))
	if err != nil {
		return err
	}
	m.ServerSeq = seq
	if err := r.PutSavedMeal(ctx, m); err != nil {
		return err
	}
	return storePayload(ctx, r, m.UserID, seq, MealToDoc(m))
}

func restoreFavorites(ctx context.Context, r *store.Repo, userID string, docs []FavoriteDoc, foodIDs map[string]string, now time.Time, res *ImportResult) error {
	keep := make(map[string]bool, len(docs))
	for _, d := range docs {
		if m, ok := foodIDs[d.FoodID]; ok {
			keep[m] = true
		}
	}
	existing, err := r.AllFavorites(ctx, userID)
	if err != nil {
		return err
	}
	for _, f := range existing {
		if keep[f.FoodID] || f.DeletedAt != nil {
			continue
		}
		t := stamp(now)
		f.DeletedAt, f.UpdatedAt = &t, t
		if err := writeFavorite(ctx, r, f, "delete", now); err != nil {
			return err
		}
		res.Removed++
	}
	for _, d := range docs {
		f := DocToFavorite(d, userID)
		if m, ok := foodIDs[f.FoodID]; ok {
			f.FoodID = m
		}
		f.CreatedAt = orNow(f.CreatedAt, now)
		f.UpdatedAt = stamp(now)
		op := "upsert"
		if f.DeletedAt != nil {
			op = "delete"
		}
		if err := writeFavorite(ctx, r, f, op, now); err != nil {
			return err
		}
		res.Favorites++
	}
	return nil
}

func writeFavorite(ctx context.Context, r *store.Repo, f domain.Favorite, op string, now time.Time) error {
	seq, err := r.AppendChange(ctx, f.UserID, store.ChangeFavorite, f.FoodID, op, stamp(now))
	if err != nil {
		return err
	}
	f.ServerSeq = seq
	if err := r.PutFavorite(ctx, f); err != nil {
		return err
	}
	return storePayload(ctx, r, f.UserID, seq, FavoriteToDoc(f))
}
