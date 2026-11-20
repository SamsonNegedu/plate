package sync

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

const mealID = "0190a1b2-0000-7000-8000-0000000000a1"

func populate(t *testing.T, f *fx) {
	t.Helper()
	ctx := context.Background()
	custom := domain.Food{
		ID: food1, UserID: uid, Name: "Meine Oats", Brand: "Hof", Barcode: ptr("4000000000011"),
		Per100: domain.Nutrients{Kcal: 370, Protein: fp(13)}, Source: domain.SourceUser,
		SearchName: "meine oats hof", CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
	}
	if err := writeFoodTx(ctx, f, custom); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PutSettings(ctx, uid, SettingsBody{GoalKcal: 2100, ProteinG: 140, FiberG: 30, DayStartHour: 4, Theme: "dark", WeightGoalKg: ptr(78.5), MedName: ptr("Mounjaro"), MedIntervalDays: ptr(int64(7))}); err != nil {
		t.Fatal(err)
	}
	b := body()
	b.FoodID = ptr(food1)
	b.Protein = nil
	if _, err := f.svc.PutEntry(ctx, uid, eid, b); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PutEntry(ctx, uid, eid2, body()); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.DeleteEntry(ctx, uid, eid2); err != nil {
		t.Fatal(err)
	}
	err := store.InTx(ctx, f.db, func(r *store.Repo) error {
		m := domain.SavedMeal{
			ID: mealID, UserID: uid, Name: "Breakfast", Servings: 2, CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
			Items: []domain.SavedMealItem{{
				ID: uuid.Must(uuid.NewV7()).String(), FoodID: ptr(food1), Name: "Oats", Amount: 40, Unit: domain.Gram, Grams: 40,
				Snapshot: domain.Nutrients{Kcal: 370}, Position: 0,
			}},
		}
		if err := writeMeal(ctx, r, m, "upsert", t0); err != nil {
			return err
		}
		for i, h := range []domain.HealthRecord{
			{ID: uuid.Must(uuid.NewV7()).String(), Kind: domain.HealthWeight, Value: 82.4},
			{ID: uuid.Must(uuid.NewV7()).String(), Kind: domain.HealthDose, Value: 2.5, Medication: "Mounjaro", Site: "left thigh"},
		} {
			h.UserID, h.RecordedOn, h.RecordedAt = uid, "2026-11-01", "2026-11-01T08:00:00Z"
			h.CreatedAt, h.UpdatedAt = stamp(t0), stamp(t0)
			if _, err := writeHealth(ctx, r, h, "upsert", t0.Add(time.Duration(i)*time.Second)); err != nil {
				return err
			}
		}
		return writeFavorite(ctx, r, domain.Favorite{UserID: uid, FoodID: food1, CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}, "upsert", t0)
	})
	if err != nil {
		t.Fatal(err)
	}
}

func ptr[T any](v T) *T { return &v }

func writeFoodTx(ctx context.Context, f *fx, food domain.Food) error {
	return store.InTx(ctx, f.db, func(r *store.Repo) error { return writeFood(ctx, r, food, "upsert", t0) })
}

func exportJSON(t *testing.T, f *fx) []byte {
	t.Helper()
	doc, err := f.svc.Export(context.Background(), uid, "test")
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestExportContainsLiveRowsAndTombstoneIDs(t *testing.T) {
	f := newFx(t)
	populate(t, f)
	doc, err := f.svc.Export(context.Background(), uid, "test")
	if err != nil {
		t.Fatal(err)
	}
	if doc.FormatVersion != 1 || doc.SchemaVersion < 7 || doc.Settings == nil || doc.Settings.GoalKcal != 2100 {
		t.Fatalf("header/settings wrong: %+v", doc)
	}
	if len(doc.Entries) != 1 || doc.Entries[0].ID != eid {
		t.Fatalf("entries = %+v", doc.Entries)
	}
	if len(doc.DeletedEntries) != 1 || doc.DeletedEntries[0].ID != eid2 {
		t.Fatalf("tombstones = %+v", doc.DeletedEntries)
	}
	if len(doc.Foods) != 1 || len(doc.SavedMeals) != 1 || len(doc.SavedMeals[0].Items) != 1 || len(doc.Favorites) != 1 {
		t.Fatalf("collections wrong: foods=%d meals=%d favs=%d", len(doc.Foods), len(doc.SavedMeals), len(doc.Favorites))
	}
	if doc.Entries[0].Protein != nil {
		t.Fatal("a missing nutrient must export as null, not 0")
	}
}

func TestRoundTripIntoAFreshDatabasePreservesEverything(t *testing.T) {
	ctx := context.Background()
	src := newFx(t)
	populate(t, src)
	raw := exportJSON(t, src)

	dst := newFx(t)
	doc, err := dst.svc.ParseBackup(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	res, err := dst.svc.Restore(ctx, uid, doc)
	if err != nil {
		t.Fatal(err)
	}
	if res.Entries != 1 || res.Foods != 1 || res.SavedMeals != 1 || res.Favorites != 1 {
		t.Fatalf("result = %+v", res)
	}

	got, err := dst.svc.Export(ctx, uid, "test")
	if err != nil {
		t.Fatal(err)
	}
	want, _ := src.svc.Export(ctx, uid, "test")
	if len(got.Entries) != 1 || got.Entries[0].Kcal != want.Entries[0].Kcal || got.Entries[0].Name != want.Entries[0].Name ||
		got.Entries[0].FoodID == nil || *got.Entries[0].FoodID != food1 {
		t.Fatalf("entry differs: %+v vs %+v", got.Entries, want.Entries)
	}
	if got.Settings == nil || got.Settings.GoalKcal != 2100 || got.Settings.DayStartHour != 4 || got.Settings.Theme != "dark" {
		t.Fatalf("settings = %+v", got.Settings)
	}
	if len(got.SavedMeals) != 1 || len(got.SavedMeals[0].Items) != 1 || len(got.Favorites) != 1 || len(got.Foods) != 1 {
		t.Fatalf("collections lost: %+v", got)
	}
	if len(got.HealthRecords) != 2 || got.HealthRecords[1].Medication != "Mounjaro" {
		t.Fatalf("health records lost: %+v", got.HealthRecords)
	}
	if got.Settings.FiberG != 30 {
		t.Fatalf("fibre target lost: %+v", got.Settings)
	}
	if got.Settings.MedName == nil || *got.Settings.MedName != "Mounjaro" || got.Settings.WeightGoalKg == nil || *got.Settings.WeightGoalKg != 78.5 {
		t.Fatalf("medication plan lost: %+v", got.Settings)
	}
	if got.SavedMeals[0].Servings != 2 {
		t.Fatalf("recipe servings = %v, want 2", got.SavedMeals[0].Servings)
	}
	if got.Entries[0].Protein != nil {
		t.Fatal("null nutrient turned into a value")
	}
}

func TestReplaceTombstonesWhatTheBackupLacksAndWritesTheChangeStream(t *testing.T) {
	ctx := context.Background()
	f := newFx(t)
	populate(t, f)
	raw := exportJSON(t, f)

	extra := "0190a1b2-0000-7000-8000-0000000000e9"
	if _, err := f.svc.PutEntry(ctx, uid, extra, body()); err != nil {
		t.Fatal(err)
	}
	headBefore, _ := f.r.SyncState(ctx, uid)

	doc, err := f.svc.ParseBackup(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.svc.Restore(ctx, uid, doc)
	if err != nil {
		t.Fatal(err)
	}
	if res.Removed != 1 {
		t.Fatalf("removed = %d, want 1", res.Removed)
	}
	e, _ := f.r.Entry(ctx, uid, extra)
	if e.DeletedAt == nil {
		t.Fatal("an entry missing from the backup must be tombstoned")
	}
	var rows int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries WHERE id = ?`, extra).Scan(&rows)
	if rows != 1 {
		t.Fatal("restore must never hard-delete")
	}
	live, _ := f.r.EntriesForDay(ctx, uid, "2026-11-13")
	if len(live) != 1 || live[0].ID != eid {
		t.Fatalf("live set = %+v", live)
	}
	headAfter, _ := f.r.SyncState(ctx, uid)
	if headAfter.HeadSeq <= headBefore.HeadSeq {
		t.Fatal("a restore must advance the change stream so other devices converge")
	}
}

func TestRestoreIsAtomic(t *testing.T) {
	ctx := context.Background()
	src := newFx(t)
	populate(t, src)
	raw := exportJSON(t, src)

	dst := newFx(t)
	doc, err := dst.svc.ParseBackup(ctx, raw)
	if err != nil {
		t.Fatal(err)
	}
	doc.Favorites[0].FoodID = "0190a1b2-0000-7000-8000-00000000dead" // unknown food: the last step fails
	if _, err := dst.svc.Restore(ctx, uid, doc); err == nil {
		t.Fatal("expected the restore to fail")
	}
	var n int
	_ = dst.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 0 {
		t.Fatalf("entries = %d after a failed restore; it must roll back whole", n)
	}
}

func TestImportRejectsBeforeWriting(t *testing.T) {
	ctx := context.Background()
	f := newFx(t)
	populate(t, f)
	good := string(exportJSON(t, f))

	cases := map[string]struct {
		mutate  func(string) string
		version bool
	}{
		"newer format":  {func(s string) string { return strings.Replace(s, `"format_version":1`, `"format_version":2`, 1) }, true},
		"newer schema":  {func(s string) string { return strings.Replace(s, `"schema_version":`, `"schema_version":9`, 1) }, true},
		"format 0":      {func(s string) string { return strings.Replace(s, `"format_version":1`, `"format_version":0`, 1) }, false},
		"unknown field": {func(s string) string { return strings.Replace(s, `"entries":`, `"surprise":1,"entries":`, 1) }, false},
		"not json":      {func(string) string { return "{nope" }, false},
		"bad entry":     {func(s string) string { return strings.Replace(s, `"grams":40`, `"grams":-5`, 1) }, false},
		"food not in backup": {func(s string) string {
			return strings.Replace(s, `"food_id":"`+food1+`"`, `"food_id":"0190a1b2-0000-7000-8000-00000000dead"`, 1)
		}, false},
	}
	for name, c := range cases {
		_, err := f.svc.ParseBackup(ctx, []byte(c.mutate(good)))
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if c.version != errors.Is(err, ErrUnsupportedVersion) {
			t.Errorf("%s: err = %v (unsupported-version = %v)", name, err, c.version)
		}
	}
	var n int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries WHERE deleted_at IS NULL`).Scan(&n)
	if n != 1 {
		t.Fatal("a rejected import changed the data")
	}
}

func TestFrozenFormatOneFixtureStillImports(t *testing.T) {
	raw, err := os.ReadFile("testdata/export_v1.json")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	f := newFx(t)
	doc, err := f.svc.ParseBackup(ctx, raw)
	if err != nil {
		t.Fatalf("the frozen v1 fixture no longer parses: %v", err)
	}
	res, err := f.svc.Restore(ctx, uid, doc)
	if err != nil || res.Entries != 2 || res.Foods != 1 {
		t.Fatalf("result = %+v, %v", res, err)
	}
	day, _ := f.r.EntriesForDay(ctx, uid, "2026-11-12")
	if len(day) != 2 || day[0].Snapshot.Kcal != 539 {
		t.Fatalf("day = %+v", day)
	}
}

func TestCachedFoodWithSameBarcodeIsRemappedNotDuplicated(t *testing.T) {
	ctx := context.Background()
	f := newFx(t)
	bc := "3017620422003"
	cached := domain.Food{
		ID: "0190a1b2-0000-7000-8000-0000000000c1", UserID: uid, Barcode: &bc, Name: "Nutella", Per100: domain.Nutrients{Kcal: 539},
		Source: domain.SourceOFF, SearchName: "nutella", CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
	}
	if err := f.r.PutFood(ctx, cached); err != nil {
		t.Fatal(err)
	}
	other := cached
	other.ID = "0190a1b2-0000-7000-8000-0000000000c2"

	doc := ExportDoc{
		FormatVersion: 1, SchemaVersion: 7, Foods: []FoodDoc{FoodToDoc(other)},
		Entries: []EntryDoc{{ID: eid, EntryBody: func() EntryBody { b := body(); b.FoodID = &other.ID; return b }()}},
	}
	if _, err := f.svc.Restore(ctx, uid, doc); err != nil {
		t.Fatal(err)
	}
	e, _ := f.r.Entry(ctx, uid, eid)
	if e.FoodID == nil || *e.FoodID != cached.ID {
		t.Fatalf("food_id = %v, want it remapped to the existing %s", e.FoodID, cached.ID)
	}
}
