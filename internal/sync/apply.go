package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

const timeLayout = time.RFC3339

func stamp(t time.Time) string { return t.UTC().Format(timeLayout) }

// Service applies writes. Each method is one BEGIN IMMEDIATE transaction; nothing here touches the network.
type Service struct {
	db          *sql.DB
	now         func() time.Time
	attribution []string
}

// SetAttribution sets the source credits written into every export.
func (s *Service) SetAttribution(lines []string) { s.attribution = lines }

func NewService(db *sql.DB) *Service { return &Service{db: db, now: time.Now} }

// SetClock replaces the clock; tests use it to make timestamps deterministic.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

// Now returns the service clock.
func (s *Service) Now() time.Time { return s.now() }

// PutEntry validates and applies an entry create or update. A tombstoned entry returns ErrTombstoned.
func (s *Service) PutEntry(ctx context.Context, userID, id string, body EntryBody) (EntryDoc, error) {
	now := s.now()
	e := entryFromBody(body, id, userID)
	if err := domain.ValidateEntry(e, now); err != nil {
		return EntryDoc{}, err
	}
	var out domain.Entry
	err := store.InTx(ctx, s.db, func(r *store.Repo) error {
		var err error
		out, err = ApplyEntry(ctx, r, userID, e, now)
		return err
	})
	if err != nil {
		return EntryDoc{}, err
	}
	return EntryToDoc(out), nil
}

// DeleteEntry tombstones an entry. Deleting an already-deleted entry succeeds without a new change.
func (s *Service) DeleteEntry(ctx context.Context, userID, id string) error {
	now := s.now()
	return store.InTx(ctx, s.db, func(r *store.Repo) error {
		_, err := ApplyEntryDelete(ctx, r, userID, id, now)
		return err
	})
}

// PutSettings validates and replaces the settings object.
func (s *Service) PutSettings(ctx context.Context, userID string, body SettingsBody) (SettingsDoc, error) {
	now := s.now()
	in := settingsFromBody(body, userID)
	if err := domain.ValidateSettings(in); err != nil {
		return SettingsDoc{}, err
	}
	var out domain.Settings
	err := store.InTx(ctx, s.db, func(r *store.Repo) error {
		var err error
		out, err = ApplySettings(ctx, r, userID, in, now)
		return err
	})
	if err != nil {
		return SettingsDoc{}, err
	}
	return SettingsToDoc(out), nil
}

// ApplyEntry writes an entry inside the caller's transaction and records the change.
// It returns ErrTombstoned (with the stored row) when the entry was deleted.
func ApplyEntry(ctx context.Context, r *store.Repo, userID string, e domain.Entry, now time.Time) (domain.Entry, error) {
	existing, err := r.Entry(ctx, userID, e.ID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		if err := checkEntryRoom(ctx, r, userID); err != nil {
			return domain.Entry{}, err
		}
		e.CreatedAt = stamp(now)
	case err != nil:
		return domain.Entry{}, err
	case existing.DeletedAt != nil:
		return existing, fmt.Errorf("entry %s: %w", e.ID, domain.ErrTombstoned)
	default:
		e.CreatedAt = existing.CreatedAt
	}
	if e.FoodID != nil {
		ok, err := r.FoodExists(ctx, userID, *e.FoodID)
		if err != nil {
			return domain.Entry{}, err
		}
		if !ok {
			return domain.Entry{}, &domain.ValidationError{Fields: []domain.FieldError{{Field: "food_id", Message: "food does not exist"}}}
		}
	}
	e.UserID = userID
	e.UpdatedAt = stamp(now)
	e.DeletedAt = nil
	return writeEntry(ctx, r, e, "upsert", now)
}

// ApplyEntryDelete tombstones an entry inside the caller's transaction. changed is false when it was already deleted.
func ApplyEntryDelete(ctx context.Context, r *store.Repo, userID, id string, now time.Time) (changed bool, err error) {
	e, err := r.Entry(ctx, userID, id)
	if err != nil {
		return false, err
	}
	if e.DeletedAt != nil {
		return false, nil
	}
	t := stamp(now)
	e.DeletedAt, e.UpdatedAt = &t, t
	if _, err := writeEntry(ctx, r, e, "delete", now); err != nil {
		return false, err
	}
	return true, nil
}

func writeEntry(ctx context.Context, r *store.Repo, e domain.Entry, op string, now time.Time) (domain.Entry, error) {
	seq, err := r.AppendChange(ctx, e.UserID, store.ChangeEntry, e.ID, op, stamp(now))
	if err != nil {
		return domain.Entry{}, err
	}
	e.ServerSeq = seq
	if err := r.PutEntry(ctx, e); err != nil {
		return domain.Entry{}, err
	}
	if err := storePayload(ctx, r, e.UserID, seq, EntryToDoc(e)); err != nil {
		return domain.Entry{}, err
	}
	return e, nil
}

// ApplyHealthRecord writes a health record inside the caller's transaction and records the change. A deleted record
// returns ErrTombstoned (with the stored row).
func ApplyHealthRecord(ctx context.Context, r *store.Repo, userID string, h domain.HealthRecord, now time.Time) (domain.HealthRecord, error) {
	existing, err := r.HealthRecord(ctx, userID, h.ID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		if err := checkHealthRoom(ctx, r, userID); err != nil {
			return domain.HealthRecord{}, err
		}
		h.CreatedAt = stamp(now)
	case err != nil:
		return domain.HealthRecord{}, err
	case existing.DeletedAt != nil:
		return existing, fmt.Errorf("health record %s: %w", h.ID, domain.ErrTombstoned)
	default:
		h.CreatedAt = existing.CreatedAt
	}
	h.UserID = userID
	h.UpdatedAt = stamp(now)
	h.DeletedAt = nil
	return writeHealth(ctx, r, h, "upsert", now)
}

// ApplyHealthDelete tombstones a health record. changed is false when it was already deleted.
func ApplyHealthDelete(ctx context.Context, r *store.Repo, userID, id string, now time.Time) (changed bool, err error) {
	h, err := r.HealthRecord(ctx, userID, id)
	if err != nil {
		return false, err
	}
	if h.DeletedAt != nil {
		return false, nil
	}
	t := stamp(now)
	h.DeletedAt, h.UpdatedAt = &t, t
	if _, err := writeHealth(ctx, r, h, "delete", now); err != nil {
		return false, err
	}
	return true, nil
}

func writeHealth(ctx context.Context, r *store.Repo, h domain.HealthRecord, op string, now time.Time) (domain.HealthRecord, error) {
	seq, err := r.AppendChange(ctx, h.UserID, store.ChangeHealth, h.ID, op, stamp(now))
	if err != nil {
		return domain.HealthRecord{}, err
	}
	h.ServerSeq = seq
	if err := r.PutHealthRecord(ctx, h); err != nil {
		return domain.HealthRecord{}, err
	}
	if err := storePayload(ctx, r, h.UserID, seq, HealthToDoc(h)); err != nil {
		return domain.HealthRecord{}, err
	}
	return h, nil
}

// ApplySettings replaces the settings row inside the caller's transaction.
func ApplySettings(ctx context.Context, r *store.Repo, userID string, in domain.Settings, now time.Time) (domain.Settings, error) {
	existing, err := r.Settings(ctx, userID)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		in.CreatedAt = stamp(now)
	case err != nil:
		return domain.Settings{}, err
	default:
		in.CreatedAt = existing.CreatedAt
	}
	in.UserID = userID
	in.UpdatedAt = stamp(now)
	seq, err := r.AppendChange(ctx, userID, store.ChangeSettings, userID, "upsert", in.UpdatedAt)
	if err != nil {
		return domain.Settings{}, err
	}
	in.ServerSeq = seq
	if err := r.PutSettings(ctx, in); err != nil {
		return domain.Settings{}, err
	}
	if err := storePayload(ctx, r, userID, seq, SettingsToDoc(in)); err != nil {
		return domain.Settings{}, err
	}
	return in, nil
}

func storePayload(ctx context.Context, r *store.Repo, userID string, seq int64, doc any) error {
	b, err := json.Marshal(doc)
	if err != nil {
		return fmt.Errorf("encoding change payload: %w", err)
	}
	return r.SetChangePayload(ctx, userID, seq, string(b))
}

func isNotFound(err error) bool { return errors.Is(err, domain.ErrNotFound) }
