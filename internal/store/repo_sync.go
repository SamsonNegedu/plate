package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store/sqlc"
)

// ChangeEntity names a syncable entity in the change log.
type ChangeEntity string

const (
	ChangeSettings  ChangeEntity = "settings"
	ChangeFood      ChangeEntity = "food"
	ChangeEntry     ChangeEntity = "entry"
	ChangeSavedMeal ChangeEntity = "saved_meal"
	ChangeFavorite  ChangeEntity = "favorite"
	ChangeHealth    ChangeEntity = "health_record"
)

// AppendChange reserves the next change-log sequence for the user. The payload is filled in by SetChangePayload
// once the row carries its server_seq. Both calls must run in the same transaction as the row write.
func (r *Repo) AppendChange(ctx context.Context, userID string, entity ChangeEntity, entityID, op, now string) (int64, error) {
	seq, err := r.q.AppendChange(ctx, sqlc.AppendChangeParams{
		UserID: userID, Entity: string(entity), EntityID: entityID, Op: op, Payload: "{}", CreatedAt: now,
	})
	if err != nil {
		return 0, fmt.Errorf("appending change: %w", err)
	}
	st, err := r.q.GetSyncState(ctx, userID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("reading sync state: %w", err)
	}
	err = r.q.UpsertSyncState(ctx, sqlc.UpsertSyncStateParams{UserID: userID, MinSeq: st.MinSeq, HeadSeq: seq, UpdatedAt: now})
	if err != nil {
		return 0, fmt.Errorf("advancing sync head: %w", err)
	}
	return seq, nil
}

func (r *Repo) SetChangePayload(ctx context.Context, userID string, seq int64, payload string) error {
	if err := r.q.SetChangePayload(ctx, sqlc.SetChangePayloadParams{Payload: payload, Seq: seq, UserID: userID}); err != nil {
		return fmt.Errorf("storing change payload: %w", err)
	}
	return nil
}

func (r *Repo) FoodExists(ctx context.Context, userID, id string) (bool, error) {
	n, err := r.q.FoodExists(ctx, sqlc.FoodExistsParams{ID: id, UserID: userID})
	if err != nil {
		return false, fmt.Errorf("checking food: %w", err)
	}
	return n > 0, nil
}

func (r *Repo) AllEntries(ctx context.Context, userID string) ([]domain.Entry, error) {
	rows, err := r.q.ListAllEntries(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing entries: %w", err)
	}
	return toEntries(rows), nil
}

func (r *Repo) UserFoods(ctx context.Context, userID string) ([]domain.Food, error) {
	rows, err := r.q.ListUserFoods(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing user foods: %w", err)
	}
	return toFoods(rows), nil
}

func (r *Repo) FoodsByIDs(ctx context.Context, userID string, ids []string) ([]domain.Food, error) {
	if len(ids) == 0 {
		return []domain.Food{}, nil
	}
	rows, err := r.q.ListFoodsByIDs(ctx, sqlc.ListFoodsByIDsParams{UserID: userID, Ids: ids})
	if err != nil {
		return nil, fmt.Errorf("listing foods: %w", err)
	}
	return toFoods(rows), nil
}

func toFoods(rows []sqlc.Food) []domain.Food {
	out := make([]domain.Food, 0, len(rows))
	for _, f := range rows {
		out = append(out, toFood(f))
	}
	return out
}

func (r *Repo) SavedMeal(ctx context.Context, userID, id string) (domain.SavedMeal, error) {
	m, err := r.q.GetSavedMeal(ctx, sqlc.GetSavedMealParams{ID: id, UserID: userID})
	if err != nil {
		return domain.SavedMeal{}, notFound(err, "saved meal")
	}
	return r.withItems(ctx, m)
}

func (r *Repo) AllSavedMeals(ctx context.Context, userID string) ([]domain.SavedMeal, error) {
	rows, err := r.q.ListAllSavedMeals(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing saved meals: %w", err)
	}
	out := make([]domain.SavedMeal, 0, len(rows))
	for _, m := range rows {
		sm, err := r.withItems(ctx, m)
		if err != nil {
			return nil, err
		}
		out = append(out, sm)
	}
	return out, nil
}

func (r *Repo) withItems(ctx context.Context, m sqlc.SavedMeal) (domain.SavedMeal, error) {
	items, err := r.q.ListSavedMealItems(ctx, m.ID)
	if err != nil {
		return domain.SavedMeal{}, fmt.Errorf("listing saved meal items: %w", err)
	}
	sm := domain.SavedMeal{
		ID: m.ID, UserID: m.UserID, Name: m.Name, Servings: m.Servings, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
		DeletedAt: m.DeletedAt, ServerSeq: m.ServerSeq, Items: make([]domain.SavedMealItem, 0, len(items)),
	}
	for _, it := range items {
		sm.Items = append(sm.Items, domain.SavedMealItem{
			ID: it.ID, SavedMealID: it.SavedMealID, FoodID: it.FoodID, Name: it.Name, Brand: it.Brand,
			Amount: it.Amount, Unit: domain.Unit(it.Unit), Grams: it.Grams, Position: it.Position,
			Snapshot: domain.Nutrients{
				Kcal: it.Kcal100g, Protein: it.Protein100g, Carbs: it.Carbs100g, Fat: it.Fat100g,
				Sugar: it.Sugar100g, SatFat: it.Satfat100g, Fiber: it.Fiber100g, Salt: it.Salt100g,
			},
		})
	}
	return sm, nil
}

// PutSavedMeal replaces the meal and its nested items. Items are not syncable rows of their own.
func (r *Repo) PutSavedMeal(ctx context.Context, m domain.SavedMeal) error {
	n, err := r.q.UpsertSavedMeal(ctx, sqlc.UpsertSavedMealParams{
		ID: m.ID, UserID: m.UserID, Name: m.Name, Servings: m.Servings, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
		DeletedAt: m.DeletedAt, ServerSeq: m.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving saved meal: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("saved meal %s belongs to another user: %w", m.ID, domain.ErrConflict)
	}
	if err := r.q.DeleteSavedMealItems(ctx, m.ID); err != nil {
		return fmt.Errorf("replacing saved meal items: %w", err)
	}
	for _, it := range m.Items {
		err := r.q.InsertSavedMealItem(ctx, sqlc.InsertSavedMealItemParams{
			ID: it.ID, SavedMealID: m.ID, FoodID: it.FoodID, Name: it.Name, Brand: it.Brand, Amount: it.Amount,
			Unit: string(it.Unit), Grams: it.Grams, Kcal100g: it.Snapshot.Kcal, Protein100g: it.Snapshot.Protein,
			Carbs100g: it.Snapshot.Carbs, Fat100g: it.Snapshot.Fat, Sugar100g: it.Snapshot.Sugar,
			Satfat100g: it.Snapshot.SatFat, Fiber100g: it.Snapshot.Fiber, Salt100g: it.Snapshot.Salt, Position: it.Position,
		})
		if err != nil {
			return fmt.Errorf("saving saved meal item: %w", err)
		}
	}
	return nil
}

func (r *Repo) Favorite(ctx context.Context, userID, foodID string) (domain.Favorite, error) {
	f, err := r.q.GetFavorite(ctx, sqlc.GetFavoriteParams{UserID: userID, FoodID: foodID})
	if err != nil {
		return domain.Favorite{}, notFound(err, "favorite")
	}
	return toFavorite(f), nil
}

func (r *Repo) AllFavorites(ctx context.Context, userID string) ([]domain.Favorite, error) {
	rows, err := r.q.ListAllFavorites(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing favorites: %w", err)
	}
	out := make([]domain.Favorite, 0, len(rows))
	for _, f := range rows {
		out = append(out, toFavorite(f))
	}
	return out, nil
}

func (r *Repo) PutFavorite(ctx context.Context, f domain.Favorite) error {
	err := r.q.UpsertFavorite(ctx, sqlc.UpsertFavoriteParams{
		UserID: f.UserID, FoodID: f.FoodID, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt,
		DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving favorite: %w", err)
	}
	return nil
}

func toFavorite(f sqlc.Favorite) domain.Favorite {
	return domain.Favorite{
		UserID: f.UserID, FoodID: f.FoodID, CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt,
		DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq,
	}
}

// SchemaVersion returns the highest applied migration.
func SchemaVersion(ctx context.Context, d *sql.DB) (int64, error) {
	var v sql.NullInt64
	err := d.QueryRowContext(ctx, `SELECT max(version_id) FROM goose_db_version WHERE is_applied`).Scan(&v)
	if err != nil {
		return 0, fmt.Errorf("reading schema version: %w", err)
	}
	return v.Int64, nil
}

// SyncState returns the user's change-stream bounds. A user with no changes yet has zeros.
func (r *Repo) SyncState(ctx context.Context, userID string) (SyncState, error) {
	st, err := r.q.GetSyncState(ctx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return SyncState{}, nil
	}
	if err != nil {
		return SyncState{}, fmt.Errorf("reading sync state: %w", err)
	}
	return SyncState{MinSeq: st.MinSeq, HeadSeq: st.HeadSeq}, nil
}

type SyncState struct {
	MinSeq  int64
	HeadSeq int64
}

// StoredOp is the recorded outcome of an applied sync op.
type StoredOp struct {
	Result    string
	ServerSeq int64
}

// SyncOp returns the recorded outcome of an op id for this user.
func (r *Repo) SyncOp(ctx context.Context, userID, opID string) (StoredOp, bool, error) {
	op, err := r.q.GetSyncOp(ctx, sqlc.GetSyncOpParams{OpID: opID, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		return StoredOp{}, false, nil
	}
	if err != nil {
		return StoredOp{}, false, fmt.Errorf("reading sync op: %w", err)
	}
	return StoredOp{Result: op.Result, ServerSeq: op.ServerSeq}, true, nil
}

func (r *Repo) PutSyncOp(ctx context.Context, userID, opID, clientID, result string, seq int64, now string) error {
	err := r.q.InsertSyncOp(ctx, sqlc.InsertSyncOpParams{
		OpID: opID, UserID: userID, ClientID: clientID, Result: result, AppliedAt: now, ServerSeq: seq,
	})
	if err != nil {
		return fmt.Errorf("recording sync op: %w", err)
	}
	return nil
}

// Change is one change-log row.
type Change struct {
	Seq      int64
	Entity   string
	EntityID string
	Op       string
	Payload  string
}

// ChangesSince returns up to limit changes with seq greater than since, oldest first.
func (r *Repo) ChangesSince(ctx context.Context, userID string, since int64, limit int) ([]Change, error) {
	rows, err := r.q.ListChangesSince(ctx, sqlc.ListChangesSinceParams{UserID: userID, Seq: since, Limit: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("listing changes: %w", err)
	}
	out := make([]Change, 0, len(rows))
	for _, c := range rows {
		out = append(out, Change{Seq: c.Seq, Entity: c.Entity, EntityID: c.EntityID, Op: c.Op, Payload: c.Payload})
	}
	return out, nil
}

func (r *Repo) UserIDs(ctx context.Context) ([]string, error) {
	ids, err := r.q.ListUserIDs(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing users: %w", err)
	}
	return ids, nil
}

// PruneChanges deletes a user's change-log rows older than cutoff and raises min_seq to the highest pruned seq, so a
// client whose cursor is below it must take a snapshot. Other users are untouched. It returns how many rows were removed.
func (r *Repo) PruneChanges(ctx context.Context, userID, cutoff, now string) (int64, error) {
	top, err := r.q.MaxChangeSeqBefore(ctx, sqlc.MaxChangeSeqBeforeParams{UserID: userID, CreatedAt: cutoff})
	if err != nil {
		return 0, fmt.Errorf("finding prune boundary: %w", err)
	}
	n, err := r.q.PruneChangeLog(ctx, sqlc.PruneChangeLogParams{UserID: userID, CreatedAt: cutoff})
	if err != nil {
		return 0, fmt.Errorf("pruning change log: %w", err)
	}
	if n == 0 {
		return 0, nil
	}
	st, err := r.q.GetSyncState(ctx, userID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, fmt.Errorf("reading sync state: %w", err)
	}
	head, err := r.q.MaxChangeSeq(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("reading head seq: %w", err)
	}
	st.MinSeq = max(st.MinSeq, top)
	st.HeadSeq = max(st.HeadSeq, head)
	if err := r.q.UpsertSyncState(ctx, sqlc.UpsertSyncStateParams{UserID: userID, MinSeq: st.MinSeq, HeadSeq: st.HeadSeq, UpdatedAt: now}); err != nil {
		return 0, fmt.Errorf("updating sync state: %w", err)
	}
	return n, nil
}

func (r *Repo) PruneSyncOps(ctx context.Context, cutoff string) (int64, error) {
	n, err := r.q.PruneSyncOps(ctx, cutoff)
	if err != nil {
		return 0, fmt.Errorf("pruning sync ops: %w", err)
	}
	return n, nil
}

func (r *Repo) HealthRecord(ctx context.Context, userID, id string) (domain.HealthRecord, error) {
	h, err := r.q.GetHealthRecord(ctx, sqlc.GetHealthRecordParams{ID: id, UserID: userID})
	if err != nil {
		return domain.HealthRecord{}, notFound(err, "health record")
	}
	return toHealthRecord(h), nil
}

func (r *Repo) AllHealthRecords(ctx context.Context, userID string) ([]domain.HealthRecord, error) {
	rows, err := r.q.ListAllHealthRecords(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("listing health records: %w", err)
	}
	out := make([]domain.HealthRecord, 0, len(rows))
	for _, h := range rows {
		out = append(out, toHealthRecord(h))
	}
	return out, nil
}

func (r *Repo) CountLiveHealthRecords(ctx context.Context, userID string) (int64, error) {
	n, err := r.q.CountLiveHealthRecords(ctx, userID)
	if err != nil {
		return 0, fmt.Errorf("counting health records: %w", err)
	}
	return n, nil
}

func (r *Repo) PutHealthRecord(ctx context.Context, h domain.HealthRecord) error {
	n, err := r.q.UpsertHealthRecord(ctx, sqlc.UpsertHealthRecordParams{
		ID: h.ID, UserID: h.UserID, Kind: string(h.Kind), RecordedOn: h.RecordedOn, RecordedAt: h.RecordedAt,
		Value: h.Value, Medication: h.Medication, Site: h.Site, Note: h.Note, CreatedAt: h.CreatedAt,
		UpdatedAt: h.UpdatedAt, DeletedAt: h.DeletedAt, ServerSeq: h.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving health record: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("health record %s belongs to another user: %w", h.ID, domain.ErrConflict)
	}
	return nil
}

func toHealthRecord(h sqlc.HealthRecord) domain.HealthRecord {
	return domain.HealthRecord{
		ID: h.ID, UserID: h.UserID, Kind: domain.HealthKind(h.Kind), RecordedOn: h.RecordedOn, RecordedAt: h.RecordedAt,
		Value: h.Value, Medication: h.Medication, Site: h.Site, Note: h.Note, CreatedAt: h.CreatedAt,
		UpdatedAt: h.UpdatedAt, DeletedAt: h.DeletedAt, ServerSeq: h.ServerSeq,
	}
}
