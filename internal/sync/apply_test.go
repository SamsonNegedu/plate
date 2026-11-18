package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

const (
	uid   = "0190a1b2-0000-7000-8000-000000000001"
	eid   = "0190a1b2-0000-7000-8000-0000000000e1"
	eid2  = "0190a1b2-0000-7000-8000-0000000000e2"
	food1 = "0190a1b2-0000-7000-8000-0000000000f1"
)

var t0 = time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)

func fp(v float64) *float64 { return &v }

type fx struct {
	db  *sql.DB
	svc *Service
	r   *store.Repo
	now time.Time
}

func newFx(t *testing.T) *fx {
	t.Helper()
	d, err := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	ctx := context.Background()
	if err := store.Migrate(ctx, d, ""); err != nil {
		t.Fatal(err)
	}
	r := store.NewRepo(d)
	if err := r.CreateUser(ctx, domain.User{ID: uid, Email: "a@b.c", PasswordHash: "h", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}); err != nil {
		t.Fatal(err)
	}
	f := &fx{db: d, svc: NewService(d), r: r, now: t0}
	f.svc.SetClock(func() time.Time { return f.now })
	return f
}

func (f *fx) tick() { f.now = f.now.Add(time.Minute) }

func body() EntryBody {
	return EntryBody{
		EatenOn: "2026-11-13", Meal: "lunch", Name: "Oats", Amount: 40, Unit: "g", Grams: 40, Kcal: 370,
		Protein: fp(13), ClientUpdatedAt: "2026-11-13T08:00:00Z",
	}
}

func (f *fx) changes(t *testing.T) int {
	t.Helper()
	var n int
	if err := f.db.QueryRow(`SELECT count(*) FROM change_log WHERE user_id = ?`, uid).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPutEntryTwiceCreatesOneRowAndKeepsCreatedAt(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	first, err := f.svc.PutEntry(ctx, uid, eid, body())
	if err != nil {
		t.Fatal(err)
	}
	f.tick()
	second, err := f.svc.PutEntry(ctx, uid, eid, body())
	if err != nil {
		t.Fatal(err)
	}
	var n int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("rows = %d", n)
	}
	if second.CreatedAt != first.CreatedAt || second.UpdatedAt == first.UpdatedAt || second.ServerSeq <= first.ServerSeq {
		t.Fatalf("first %+v second %+v", first, second)
	}
}

func TestUpdateAppendsExactlyOneChangeWithTheFinalRow(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	if _, err := f.svc.PutEntry(ctx, uid, eid, body()); err != nil {
		t.Fatal(err)
	}
	before := f.changes(t)
	f.tick()
	b := body()
	b.Amount, b.Grams = 80, 80
	doc, err := f.svc.PutEntry(ctx, uid, eid, b)
	if err != nil {
		t.Fatal(err)
	}
	if f.changes(t)-before != 1 {
		t.Fatalf("changes added = %d", f.changes(t)-before)
	}
	var payload string
	if err := f.db.QueryRow(`SELECT payload FROM change_log WHERE seq = ?`, doc.ServerSeq).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var got EntryDoc
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatal(err)
	}
	if got.Amount != 80 || got.ServerSeq != doc.ServerSeq || got.ID != eid {
		t.Fatalf("payload = %+v; it must carry the row exactly as stored, including server_seq", got)
	}
}

func TestServerSeqComesFromTheChangeLogAndNeverRepeats(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	seen := map[int64]bool{}
	var last int64
	for range 10 {
		doc, err := f.svc.PutEntry(ctx, uid, uuid.Must(uuid.NewV7()).String(), body())
		if err != nil {
			t.Fatal(err)
		}
		if seen[doc.ServerSeq] || doc.ServerSeq <= last {
			t.Fatalf("seq %d after %d", doc.ServerSeq, last)
		}
		seen[doc.ServerSeq], last = true, doc.ServerSeq
	}
	st, err := f.r.SyncState(ctx, uid)
	if err != nil || st.HeadSeq != last || st.MinSeq != 0 {
		t.Fatalf("sync state %+v, %v", st, err)
	}
}

func TestDeleteTombstonesOnceAndIsIdempotent(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	if _, err := f.svc.PutEntry(ctx, uid, eid, body()); err != nil {
		t.Fatal(err)
	}
	f.tick()
	if err := f.svc.DeleteEntry(ctx, uid, eid); err != nil {
		t.Fatal(err)
	}
	n := f.changes(t)
	f.tick()
	if err := f.svc.DeleteEntry(ctx, uid, eid); err != nil {
		t.Fatalf("second delete: %v", err)
	}
	if f.changes(t) != n {
		t.Fatal("a repeated delete must not append another change")
	}
	e, _ := f.r.Entry(ctx, uid, eid)
	if e.DeletedAt == nil {
		t.Fatal("not tombstoned")
	}
	var rows int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&rows)
	if rows != 1 {
		t.Fatal("a delete must never remove the row")
	}
	if err := f.svc.DeleteEntry(ctx, uid, "0190a1b2-0000-7000-8000-0000000000ff"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown id: %v", err)
	}
}

func TestTombstonedEntryCannotBeUpdated(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	_, _ = f.svc.PutEntry(ctx, uid, eid, body())
	_ = f.svc.DeleteEntry(ctx, uid, eid)
	before := f.changes(t)
	_, err := f.svc.PutEntry(ctx, uid, eid, body())
	if !errors.Is(err, domain.ErrTombstoned) {
		t.Fatalf("err = %v", err)
	}
	if f.changes(t) != before {
		t.Fatal("a rejected write must not touch the change log")
	}
	if e, _ := f.r.Entry(ctx, uid, eid); e.DeletedAt == nil {
		t.Fatal("the entry was resurrected")
	}
}

func TestValidationFailureWritesNothing(t *testing.T) {
	f := newFx(t)
	b := body()
	b.Grams = 41
	if _, err := f.svc.PutEntry(context.Background(), uid, eid, b); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
	if f.changes(t) != 0 {
		t.Fatal("change log touched by an invalid write")
	}
}

func TestFoodIDMustExist(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	b := body()
	id := food1
	b.FoodID = &id
	if _, err := f.svc.PutEntry(ctx, uid, eid, b); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("missing food: %v", err)
	}
	if f.changes(t) != 0 {
		t.Fatal("a rolled-back write left a change behind")
	}
	if err := f.r.PutFood(ctx, domain.Food{
		ID: food1, UserID: uid, Name: "Oats", Per100: domain.Nutrients{Kcal: 370}, Source: domain.SourceUser,
		SearchName: "oats", CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PutEntry(ctx, uid, eid, b); err != nil {
		t.Fatalf("existing food: %v", err)
	}
}

func TestFoodCorrectionNeverRewritesHistory(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	if err := f.r.PutFood(ctx, domain.Food{
		ID: food1, UserID: uid, Name: "Nutella", Per100: domain.Nutrients{Kcal: 539}, Source: domain.SourceUser,
		SearchName: "nutella", CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
	}); err != nil {
		t.Fatal(err)
	}
	b := body()
	b.Name, b.Kcal, b.Protein = "Nutella", 539, nil
	id := food1
	b.FoodID = &id
	if _, err := f.svc.PutEntry(ctx, uid, eid, b); err != nil {
		t.Fatal(err)
	}
	food, _ := f.r.Food(ctx, uid, food1)
	food.Per100.Kcal = 400
	food.UpdatedAt = stamp(t0.Add(time.Hour))
	if err := f.r.PutFood(ctx, food); err != nil {
		t.Fatal(err)
	}
	e, _ := f.r.Entry(ctx, uid, eid)
	if e.Snapshot.Kcal != 539 {
		t.Fatalf("entry kcal = %v after a food edit, want the 539 snapshot", e.Snapshot.Kcal)
	}
}

func TestAnotherUsersEntryIsNeverOverwritten(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	other := "0190a1b2-0000-7000-8000-000000000002"
	if err := f.r.CreateUser(ctx, domain.User{ID: other, Email: "o@b.c", PasswordHash: "h", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PutEntry(ctx, other, eid, body()); err != nil {
		t.Fatal(err)
	}
	b := body()
	b.Name = "Hijack"
	if _, err := f.svc.PutEntry(ctx, uid, eid, b); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("err = %v, want ErrConflict", err)
	}
	e, _ := f.r.Entry(ctx, other, eid)
	if e.Name != "Oats" {
		t.Fatalf("name = %q; another user's row was changed", e.Name)
	}
}

func TestSettingsReplaceAndValidate(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	in := SettingsBody{GoalKcal: 2200, ProteinG: 150, DayStartHour: 4, Theme: "dark"}
	a, err := f.svc.PutSettings(ctx, uid, in)
	if err != nil {
		t.Fatal(err)
	}
	f.tick()
	in.GoalKcal = 1900
	b, err := f.svc.PutSettings(ctx, uid, in)
	if err != nil || b.CreatedAt != a.CreatedAt || b.ServerSeq <= a.ServerSeq || b.GoalKcal != 1900 {
		t.Fatalf("a=%+v b=%+v err=%v", a, b, err)
	}
	in.GoalKcal = 100
	if _, err := f.svc.PutSettings(ctx, uid, in); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
}
