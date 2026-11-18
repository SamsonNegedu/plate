package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"plate/internal/store"
)

// Pull returns changes after since, oldest first. A cursor below the user's min_seq returns *ResyncError.
func (s *Service) Pull(ctx context.Context, userID string, since int64, limit int) (PullResponse, error) {
	if limit <= 0 {
		limit = DefaultPull
	}
	limit = min(limit, MaxPullLimit)
	repo := store.NewRepo(s.db)
	st, err := repo.SyncState(ctx, userID)
	if err != nil {
		return PullResponse{}, err
	}
	if since < st.MinSeq {
		return PullResponse{}, &ResyncError{MinSeq: st.MinSeq}
	}
	rows, err := repo.ChangesSince(ctx, userID, since, limit+1)
	if err != nil {
		return PullResponse{}, err
	}
	resp := PullResponse{Changes: make([]PullChange, 0, min(len(rows), limit)), Next: since}
	if len(rows) > limit {
		resp.HasMore = true
		rows = rows[:limit]
	}
	for _, c := range rows {
		data := json.RawMessage(c.Payload)
		if c.Op == "delete" {
			data = deletedAt(c.Payload)
		}
		resp.Changes = append(resp.Changes, PullChange{Seq: c.Seq, Entity: c.Entity, ID: c.EntityID, Op: c.Op, Data: data})
		resp.Next = c.Seq
	}
	return resp, nil
}

// deletedAt reduces a deleted row's payload to {"deleted_at": ...}.
func deletedAt(payload string) json.RawMessage {
	var p struct {
		DeletedAt *string `json:"deleted_at"`
	}
	_ = json.Unmarshal([]byte(payload), &p)
	b, _ := json.Marshal(map[string]*string{"deleted_at": p.DeletedAt})
	return b
}

// Snapshot returns every live syncable row for the user in one consistent read, with the cursor to continue pulling from.
func (s *Service) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return Snapshot{}, fmt.Errorf("starting snapshot read: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	r := store.NewRepo(tx)

	st, err := r.SyncState(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{
		Cursor: st.HeadSeq, MinSeq: st.MinSeq, Foods: []FoodDoc{}, Entries: []EntryDoc{}, SavedMeals: []SavedMealDoc{}, Favorites: []FavoriteDoc{},
	}
	if set, err := r.Settings(ctx, userID); err == nil {
		d := SettingsToDoc(set)
		snap.Settings = &d
	}
	foods, err := r.UserFoods(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	for _, f := range foods {
		if f.DeletedAt == nil {
			snap.Foods = append(snap.Foods, FoodToDoc(f))
		}
	}
	entries, err := r.AllEntries(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	for _, e := range entries {
		if e.DeletedAt == nil {
			snap.Entries = append(snap.Entries, EntryToDoc(e))
		}
	}
	meals, err := r.AllSavedMeals(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	for _, m := range meals {
		if m.DeletedAt == nil {
			snap.SavedMeals = append(snap.SavedMeals, MealToDoc(m))
		}
	}
	favs, err := r.AllFavorites(ctx, userID)
	if err != nil {
		return Snapshot{}, err
	}
	for _, f := range favs {
		if f.DeletedAt == nil {
			snap.Favorites = append(snap.Favorites, FavoriteToDoc(f))
		}
	}
	return snap, nil
}

// Meta returns the stream bounds. The caller sets Enabled from configuration.
func (s *Service) Meta(ctx context.Context, userID string, enabled bool) (Meta, error) {
	st, err := store.NewRepo(s.db).SyncState(ctx, userID)
	if err != nil {
		return Meta{}, err
	}
	return Meta{Enabled: enabled, Head: st.HeadSeq, MinSeq: st.MinSeq, ServerTime: stamp(s.now())}, nil
}

// Retention is how long change-log and sync-op rows are kept.
const Retention = 180 * 24 * time.Hour

// PruneRetention removes change-log rows and sync ops older than the retention window and moves each affected user's
// min_seq. Tombstones in the entity tables stay.
func (s *Service) PruneRetention(ctx context.Context) (int64, error) {
	cutoff := stamp(s.now().Add(-Retention))
	now := stamp(s.now())
	var total int64
	err := store.InTx(ctx, s.db, func(r *store.Repo) error {
		ids, err := r.UserIDs(ctx)
		if err != nil {
			return err
		}
		for _, id := range ids {
			n, err := r.PruneChanges(ctx, id, cutoff, now)
			if err != nil {
				return err
			}
			total += n
		}
		n, err := r.PruneSyncOps(ctx, cutoff)
		total += n
		return err
	})
	return total, err
}
