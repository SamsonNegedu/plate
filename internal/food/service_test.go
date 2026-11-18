package food

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
	psync "plate/internal/sync"
)

const uid = "0190a1b2-0000-7000-8000-000000000001"

type fakeOFF struct {
	products map[string]OFFProduct
	err      error
	calls    atomic.Int32
	searches atomic.Int32
	hits     []OFFProduct
}

func (f *fakeOFF) Product(_ context.Context, code string) (OFFProduct, error) {
	f.calls.Add(1)
	if f.err != nil {
		return OFFProduct{}, f.err
	}
	if p, ok := f.products[code]; ok {
		return p, nil
	}
	return OFFProduct{}, ErrProductNotFound
}

func (f *fakeOFF) Search(context.Context, string) ([]OFFProduct, error) {
	f.searches.Add(1)
	return f.hits, f.err
}

type fx struct {
	db  *sql.DB
	svc *Service
	off *fakeOFF
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
	if err := r.CreateUser(ctx, domain.User{ID: uid, Email: "a@b.c", PasswordHash: "h", CreatedAt: stamp(now), UpdatedAt: stamp(now)}); err != nil {
		t.Fatal(err)
	}
	off := &fakeOFF{products: map[string]OFFProduct{}}
	x := &fx{db: d, off: off, r: r, now: now}
	x.svc = NewService(d, off, slog.New(slog.NewTextHandler(io.Discard, nil)))
	x.svc.SetClock(func() time.Time { return x.now })
	return x
}

func offProduct(code, name string, kcal float64) OFFProduct {
	p := OFFProduct{Code: code, ProductName: name, Brands: textList{"Marke"}}
	p.Nutriments = map[string]rawJSON{"energy-kcal_100g": rawJSON(jsonOf(kcal)), "proteins_100g": rawJSON("5")}
	p.ImageFrontURL = "https://images.openfoodfacts.org/images/products/400/000/000/0011/front_de.4.400.jpg"
	return p
}

func (x *fx) addCatalog(t *testing.T, barcode, name string, kcal float64) {
	t.Helper()
	img := "https://images.openfoodfacts.org/images/products/301/762/042/2003/front.jpg"
	err := x.r.PutCatalogFood(context.Background(), domain.CatalogFood{
		Barcode: barcode, Name: name, Brand: "Ferrero", Per100: domain.Nutrients{Kcal: kcal}, ImageSourceURL: &img,
		DatasetVersion: "v1", ImportedAt: stamp(now),
	}, stamp(now))
	if err != nil {
		t.Fatal(err)
	}
}

func (x *fx) foodsCount(t *testing.T) int {
	t.Helper()
	var n int
	_ = x.db.QueryRow(`SELECT count(*) FROM foods`).Scan(&n)
	return n
}

func TestCatalogHitMaterializesOneRowAndNeverCallsOFF(t *testing.T) {
	x := newFx(t)
	x.addCatalog(t, "3017620422003", "Nutella", 539)
	ctx := context.Background()

	a, err := x.svc.Barcode(ctx, uid, "3017620422003")
	if err != nil {
		t.Fatal(err)
	}
	b, err := x.svc.Barcode(ctx, uid, "3017620422003")
	if err != nil {
		t.Fatal(err)
	}
	if a.Source != domain.SourceCatalog || a.Per100.Kcal != 539 || a.ID != b.ID || x.foodsCount(t) != 1 {
		t.Fatalf("a=%+v b=%+v foods=%d", a, b, x.foodsCount(t))
	}
	if x.off.calls.Load() != 0 {
		t.Fatal("a catalog hit must not call OFF")
	}
	if a.ImageKey == nil || *a.ImageKey == "" {
		t.Fatal("the catalog image must be registered under a server key")
	}
	var changes int
	_ = x.db.QueryRow(`SELECT count(*) FROM change_log`).Scan(&changes)
	if changes != 0 {
		t.Fatal("cached foods are not synced")
	}
}

func TestOFFSuccessIsCachedAndServedLocallyNext(t *testing.T) {
	x := newFx(t)
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 61)
	ctx := context.Background()
	a, err := x.svc.Barcode(ctx, uid, "4000000000011")
	if err != nil {
		t.Fatal(err)
	}
	if a.Source != domain.SourceOFF || a.SourceCheckedAt == nil || a.ID == "" || a.ImageKey == nil {
		t.Fatalf("food = %+v", a)
	}
	if b, err := x.svc.Barcode(ctx, uid, "4000000000011"); err != nil || b.ID != a.ID {
		t.Fatalf("second lookup: %+v %v", b, err)
	}
	if x.off.calls.Load() != 1 {
		t.Fatalf("OFF calls = %d, want 1", x.off.calls.Load())
	}
}

func TestMissIsNegativeCachedForADay(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	for range 3 {
		if _, err := x.svc.Barcode(ctx, uid, "4000000000000"); !errors.Is(err, domain.ErrNotFound) {
			t.Fatalf("err = %v", err)
		}
	}
	if x.off.calls.Load() != 1 {
		t.Fatalf("OFF calls = %d; the negative cache must stop repeat lookups", x.off.calls.Load())
	}
	x.now = x.now.Add(25 * time.Hour)
	_, _ = x.svc.Barcode(ctx, uid, "4000000000000")
	if x.off.calls.Load() != 2 {
		t.Fatal("the negative cache must expire after 24 hours")
	}
}

func TestProductWithoutKcalIsNotLoggableAndNotStored(t *testing.T) {
	x := newFx(t)
	p := OFFProduct{Code: "4000000000011", ProductName: "Mystery", Nutriments: map[string]rawJSON{"proteins_100g": rawJSON("3")},
		ImageFrontURL: "https://images.openfoodfacts.org/images/products/400/000/000/0011/front.jpg"}
	x.off.products["4000000000011"] = p
	_, err := x.svc.Barcode(context.Background(), uid, "4000000000011")
	nl, ok := IsNotLoggable(err)
	if !ok || nl.Reason != ReasonNoNutrition || nl.Name != "Mystery" || !errors.Is(err, domain.ErrNotLoggable) {
		t.Fatalf("err = %v", err)
	}
	if x.foodsCount(t) != 0 {
		t.Fatal("a product without kcal must never be stored as a food")
	}
}

func TestUpstreamFailureIsNotCachedAsAMiss(t *testing.T) {
	x := newFx(t)
	x.off.err = &UpstreamError{Reason: "down", RetryAfter: time.Minute}
	if _, err := x.svc.Barcode(context.Background(), uid, "4000000000011"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v", err)
	}
	x.off.err = nil
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 61)
	if _, err := x.svc.Barcode(context.Background(), uid, "4000000000011"); err != nil {
		t.Fatalf("an outage must not poison later lookups: %v", err)
	}
}

func TestInvalidBarcodeNeverReachesAnySource(t *testing.T) {
	x := newFx(t)
	if _, err := x.svc.Barcode(context.Background(), uid, "12ab"); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("err = %v", err)
	}
	if x.off.calls.Load() != 0 {
		t.Fatal("OFF was called")
	}
}

func TestTwelveDigitCodeTriesTheThirteenDigitForm(t *testing.T) {
	x := newFx(t)
	x.off.products["0012345678905"] = offProduct("0012345678905", "UPC product", 100)
	f, err := x.svc.Barcode(context.Background(), uid, "012345678905")
	if err != nil || f.Barcode == nil || *f.Barcode != "0012345678905" {
		t.Fatalf("f = %+v, %v", f, err)
	}
}

func TestUserCorrectionBeatsCatalogAndOFF(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.addCatalog(t, "3017620422003", "Nutella", 539)
	x.off.products["3017620422003"] = offProduct("3017620422003", "Nutella OFF", 999)

	cat, err := x.svc.Barcode(ctx, uid, "3017620422003")
	if err != nil {
		t.Fatal(err)
	}
	bc := "3017620422003"
	fixed, err := x.svc.SaveCustom(ctx, uid, cat.ID, FoodInput{
		Barcode: &bc, Name: "Nutella (meins)", Brand: "Ferrero", Per100: domain.Nutrients{Kcal: 540},
	})
	if err != nil {
		t.Fatal(err)
	}
	if fixed.ID != cat.ID || fixed.Source != domain.SourceUser || fixed.SourceID == nil || *fixed.SourceID != bc {
		t.Fatalf("a correction updates the row in place and keeps source_id: %+v", fixed)
	}
	got, err := x.svc.Barcode(ctx, uid, bc)
	if err != nil || got.Per100.Kcal != 540 || got.Name != "Nutella (meins)" {
		t.Fatalf("lookup after correction = %+v, %v", got, err)
	}
	if x.off.calls.Load() != 0 {
		t.Fatal("OFF must not be consulted once a row exists")
	}
	var seqs int
	_ = x.db.QueryRow(`SELECT count(*) FROM change_log WHERE entity = 'food'`).Scan(&seqs)
	if seqs != 1 {
		t.Fatalf("food changes = %d; a user correction must sync", seqs)
	}
}

func TestOFFFetchNeverOverwritesAUserRow(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	bc := "4000000000011"
	mine, err := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000aa", FoodInput{
		Barcode: &bc, Name: "Mein Joghurt", Per100: domain.Nutrients{Kcal: 70},
	})
	if err != nil {
		t.Fatal(err)
	}
	x.off.products[bc] = offProduct(bc, "Joghurt OFF", 61)
	x.now = x.now.Add(200 * 24 * time.Hour)
	got, err := x.svc.Barcode(ctx, uid, bc)
	x.svc.Wait()
	if err != nil || got.ID != mine.ID || got.Per100.Kcal != 70 {
		t.Fatalf("got %+v, %v", got, err)
	}
	if x.off.calls.Load() != 0 {
		t.Fatal("a user row must never be revalidated")
	}
}

func TestSaveCustomReusesTheRowThatOwnsTheBarcode(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 61)
	cached, _ := x.svc.Barcode(ctx, uid, "4000000000011")

	bc := "4000000000011"
	got, err := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000bb", FoodInput{
		Barcode: &bc, Name: "Joghurt korrigiert", Per100: domain.Nutrients{Kcal: 65},
	})
	if err != nil || got.ID != cached.ID {
		t.Fatalf("got %+v, %v; want the existing row %s", got, err, cached.ID)
	}
	if x.foodsCount(t) != 1 {
		t.Fatalf("foods = %d; a barcode must not be duplicated", x.foodsCount(t))
	}
}

func TestSaveCustomValidation(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	bad := map[string]struct {
		id string
		in FoodInput
	}{
		"empty name":      {"0190a1b2-0000-7000-8000-0000000000cc", FoodInput{Name: "  ", Per100: domain.Nutrients{Kcal: 1}}},
		"not a uuid":      {"nope", FoodInput{Name: "X", Per100: domain.Nutrients{Kcal: 1}}},
		"short barcode":   {"0190a1b2-0000-7000-8000-0000000000cc", FoodInput{Name: "X", Barcode: sp("123"), Per100: domain.Nutrients{Kcal: 1}}},
		"absurd kcal":     {"0190a1b2-0000-7000-8000-0000000000cc", FoodInput{Name: "X", Per100: domain.Nutrients{Kcal: 5000}}},
		"macro over 100g": {"0190a1b2-0000-7000-8000-0000000000cc", FoodInput{Name: "X", Per100: domain.Nutrients{Kcal: 100, Fat: fp(120)}}},
		"bad serving":     {"0190a1b2-0000-7000-8000-0000000000cc", FoodInput{Name: "X", ServingGrams: fp(-1), Per100: domain.Nutrients{Kcal: 1}}},
	}
	for name, c := range bad {
		if _, err := x.svc.SaveCustom(ctx, uid, c.id, c.in); !errors.Is(err, domain.ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if x.foodsCount(t) != 0 {
		t.Fatal("invalid foods were stored")
	}
	water, err := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000dd", FoodInput{Name: "Wasser", Per100: domain.Nutrients{Kcal: 0}})
	if err != nil || water.Per100.Kcal != 0 || water.Barcode != nil {
		t.Fatalf("a 0 kcal food without a barcode is valid: %+v %v", water, err)
	}
}

func TestSaveCustomBarcodeConflict(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	bc := "4000000000011"
	a, _ := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000e1", FoodInput{Name: "A", Barcode: &bc, Per100: domain.Nutrients{Kcal: 1}})
	b, _ := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000e2", FoodInput{Name: "B", Per100: domain.Nutrients{Kcal: 1}})
	_, err := x.svc.SaveCustom(ctx, uid, b.ID, FoodInput{Name: "B", Barcode: &bc, Per100: domain.Nutrients{Kcal: 1}})
	if !errors.Is(err, domain.ErrConflict) || a.ID == b.ID {
		t.Fatalf("err = %v", err)
	}
}

func TestStaleRowIsRevalidatedOnceWhenRecentlyLogged(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 61)
	f, _ := x.svc.Barcode(ctx, uid, "4000000000011")
	x.off.calls.Store(0)

	// log it, then let 100 days pass: the row is stale and was used recently
	x.now = x.now.Add(100 * 24 * time.Hour)
	svc := psync.NewService(x.db)
	svc.SetClock(func() time.Time { return x.now })
	_, err := svc.PutEntry(ctx, uid, "0190a1b2-0000-7000-8000-0000000000e1", psync.EntryBody{
		EatenOn: x.now.Format("2006-01-02"), Meal: "lunch", FoodID: &f.ID, Name: "Joghurt", Amount: 100, Unit: "g", Grams: 100,
		Kcal: 61, ClientUpdatedAt: stamp(x.now),
	})
	if err != nil {
		t.Fatal(err)
	}
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 70) // upstream corrected it

	for range 3 {
		if _, err := x.svc.Barcode(ctx, uid, "4000000000011"); err != nil {
			t.Fatal(err)
		}
		x.svc.Wait()
	}
	if x.off.calls.Load() != 1 {
		t.Fatalf("revalidation calls = %d, want exactly 1 per day", x.off.calls.Load())
	}
	got, _ := x.r.Food(ctx, uid, f.ID)
	if got.Per100.Kcal != 70 || got.SourceCheckedAt == nil || *got.SourceCheckedAt != stamp(x.now) {
		t.Fatalf("row after revalidation = %+v", got.Per100)
	}
	entry, _ := x.r.Entry(ctx, uid, "0190a1b2-0000-7000-8000-0000000000e1")
	if entry.Snapshot.Kcal != 61 {
		t.Fatalf("entry snapshot = %v; history must not follow a refresh", entry.Snapshot.Kcal)
	}

	x.now = x.now.Add(25 * time.Hour)
	// fresh now (checked a day ago), so no further call
	_, _ = x.svc.Barcode(ctx, uid, "4000000000011")
	x.svc.Wait()
	if x.off.calls.Load() != 1 {
		t.Fatal("a freshly checked row must not be revalidated")
	}
}

func TestUnusedStaleRowIsNotRevalidated(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", 61)
	_, _ = x.svc.Barcode(ctx, uid, "4000000000011")
	x.off.calls.Store(0)
	x.now = x.now.Add(200 * 24 * time.Hour)
	_, _ = x.svc.Barcode(ctx, uid, "4000000000011")
	x.svc.Wait()
	if x.off.calls.Load() != 0 {
		t.Fatal("a food nobody logged recently is not worth an upstream call")
	}
}

func TestFavoritesAreTombstonedAndSynced(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	f, _ := x.svc.SaveCustom(ctx, uid, "0190a1b2-0000-7000-8000-0000000000f1", FoodInput{Name: "Oats", Per100: domain.Nutrients{Kcal: 370}})
	if _, err := x.svc.SetFavorite(ctx, uid, f.ID, true); err != nil {
		t.Fatal(err)
	}
	if on, _ := x.svc.IsFavorite(ctx, uid, f.ID); !on {
		t.Fatal("not a favorite")
	}
	if _, err := x.svc.SetFavorite(ctx, uid, f.ID, true); err != nil { // idempotent
		t.Fatal(err)
	}
	if _, err := x.svc.SetFavorite(ctx, uid, f.ID, false); err != nil {
		t.Fatal(err)
	}
	if on, _ := x.svc.IsFavorite(ctx, uid, f.ID); on {
		t.Fatal("still a favorite")
	}
	var rows, changes int
	_ = x.db.QueryRow(`SELECT count(*) FROM favorites`).Scan(&rows)
	_ = x.db.QueryRow(`SELECT count(*) FROM change_log WHERE entity = 'favorite'`).Scan(&changes)
	if rows != 1 || changes != 2 {
		t.Fatalf("rows=%d changes=%d; removal must be a tombstone, and a repeat must not add changes", rows, changes)
	}
	if _, err := x.svc.SetFavorite(ctx, uid, "0190a1b2-0000-7000-8000-00000000dead", true); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown food: %v", err)
	}
}

func sp(s string) *string   { return &s }
func fp(v float64) *float64 { return &v }
