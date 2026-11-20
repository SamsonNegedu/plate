package store

import (
	"context"
	"errors"
	"testing"

	"plate/internal/domain"
)

func fp(v float64) *float64 { return &v }
func sp(v string) *string   { return &v }

func repoWithUser(t *testing.T) (*Repo, context.Context) {
	t.Helper()
	d := migrated(t)
	r := NewRepo(d)
	ctx := context.Background()
	if err := r.CreateUser(ctx, domain.User{ID: "u1", Username: "a@b.c", PasswordHash: "h", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	return r, ctx
}

func TestUserRoundTripAndNotFound(t *testing.T) {
	r, ctx := repoWithUser(t)
	u, err := r.UserByUsername(ctx, "a@b.c")
	if err != nil || u.ID != "u1" {
		t.Fatalf("got %+v, %v", u, err)
	}
	if _, err := r.UserByUsername(ctx, "nobody@x.y"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if err := r.SetPassword(ctx, "ghost", "h2", now); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
	if n, _ := r.CountUsers(ctx); n != 1 {
		t.Fatalf("users = %d", n)
	}
}

func TestFoodRoundTripKeepsNullNutrients(t *testing.T) {
	r, ctx := repoWithUser(t)
	f := domain.Food{
		ID: "f1", UserID: "u1", Barcode: sp("4000000000011"), Name: "Joghurt", Brand: "Ehrmann",
		Per100: domain.Nutrients{Kcal: 61, Protein: fp(3.5)}, Source: domain.SourceOFF,
		SearchName: domain.SearchName("Joghurt"), CreatedAt: now, UpdatedAt: now,
	}
	if err := r.PutFood(ctx, f); err != nil {
		t.Fatal(err)
	}
	got, err := r.FoodByBarcode(ctx, "u1", "4000000000011")
	if err != nil {
		t.Fatal(err)
	}
	if got.Per100.Kcal != 61 || got.Per100.Protein == nil || *got.Per100.Protein != 3.5 {
		t.Fatalf("nutrients = %+v", got.Per100)
	}
	if got.Per100.Carbs != nil || got.Per100.Fat != nil || got.ServingGrams != nil {
		t.Fatal("missing values must come back nil, not zero")
	}

	f.Name = "Joghurt mild"
	if err := r.PutFood(ctx, f); err != nil {
		t.Fatal(err)
	}
	if got, _ = r.Food(ctx, "u1", "f1"); got.Name != "Joghurt mild" {
		t.Fatalf("name = %q", got.Name)
	}
	if _, err := r.Food(ctx, "other-user", "f1"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("a food is never visible to another user: %v", err)
	}
}

func TestEntryRoundTripAndDayQuery(t *testing.T) {
	r, ctx := repoWithUser(t)
	mk := func(id, day string, deleted *string) domain.Entry {
		return domain.Entry{
			ID: id, UserID: "u1", EatenOn: day, Meal: domain.Lunch, Name: "Oats", Amount: 40, Unit: domain.Gram, Grams: 40,
			Snapshot: domain.Nutrients{Kcal: 370}, CreatedAt: now, UpdatedAt: now, ClientUpdatedAt: now, DeletedAt: deleted,
		}
	}
	for _, e := range []domain.Entry{mk("e1", "2026-11-13", nil), mk("e2", "2026-11-13", sp(now)), mk("e3", "2026-11-14", nil)} {
		if err := r.PutEntry(ctx, e); err != nil {
			t.Fatal(err)
		}
	}
	day, err := r.EntriesForDay(ctx, "u1", "2026-11-13")
	if err != nil || len(day) != 1 || day[0].ID != "e1" {
		t.Fatalf("day = %+v, %v (tombstones must be hidden)", day, err)
	}
	rng, err := r.EntriesInRange(ctx, "u1", "2026-11-13", "2026-11-14")
	if err != nil || len(rng) != 2 {
		t.Fatalf("range = %d, %v", len(rng), err)
	}
	empty, _ := r.EntriesForDay(ctx, "u1", "2000-01-01")
	if empty == nil {
		t.Fatal("an empty day must be an empty slice, not nil")
	}
}

func TestInTxRollsBackWholeUnit(t *testing.T) {
	d := migrated(t)
	ctx := context.Background()
	boom := errors.New("boom")
	err := InTx(ctx, d, func(r *Repo) error {
		if err := r.CreateUser(ctx, domain.User{ID: "u9", Username: "x@y.z", PasswordHash: "h", CreatedAt: now, UpdatedAt: now}); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if n, _ := NewRepo(d).CountUsers(ctx); n != 0 {
		t.Fatalf("users = %d after rollback", n)
	}
}

func TestSettingsUpsert(t *testing.T) {
	r, ctx := repoWithUser(t)
	s := domain.Settings{UserID: "u1", GoalKcal: 2200, ProteinG: 150, DayStartHour: 4, Theme: "auto", CreatedAt: now, UpdatedAt: now}
	if err := r.PutSettings(ctx, s); err != nil {
		t.Fatal(err)
	}
	s.GoalKcal = 1900
	if err := r.PutSettings(ctx, s); err != nil {
		t.Fatal(err)
	}
	got, err := r.Settings(ctx, "u1")
	if err != nil || got.GoalKcal != 1900 || got.DayStartHour != 4 {
		t.Fatalf("got %+v, %v", got, err)
	}
	s.DayStartHour = 24
	if err := r.PutSettings(ctx, s); err == nil {
		t.Fatal("day_start_hour 24 must be rejected by the schema")
	}
}
