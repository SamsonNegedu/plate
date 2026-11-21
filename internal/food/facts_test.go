package food

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"testing"

	"github.com/google/uuid"

	"plate/internal/domain"
)

const salmon = "4337256560191"

// salmonInput is the REWE smoked salmon label: 192 kcal, 12 g fat, 21 g protein per 100 g.
func salmonInput() CorrectionInput {
	id, _ := uuid.NewV7()
	return CorrectionInput{
		FoodInput: FoodInput{
			Name: "Räucherlachs", Brand: "REWE Beste Wahl",
			Per100: domain.Nutrients{Kcal: 192, Protein: fp(21), Carbs: fp(0), Fat: fp(12), SatFat: fp(1.9), Sugar: fp(0), Fiber: fp(0), Salt: fp(2.8)},
		},
		RevisionID: id.String(), Source: "manual", EnergyKJ: fp(801),
	}
}

func (x *fx) addUser(t *testing.T, n int) string {
	t.Helper()
	id := fmt.Sprintf("0190a1b2-0000-7000-8000-%012d", n)
	err := x.r.CreateUser(context.Background(), domain.User{ID: id, Username: fmt.Sprintf("u%d@b.c", n), PasswordHash: "h", CreatedAt: stamp(now), UpdatedAt: stamp(now)})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// wrongSalmon puts OFF's mistake (399 kcal, 25 g fat, 43.8 g protein) in front of user a.
func (x *fx) wrongSalmon(t *testing.T) {
	t.Helper()
	p := offProduct(salmon, "Räucherlachs", 399)
	p.Nutriments["fat_100g"] = rawJSON("25")
	p.Nutriments["proteins_100g"] = rawJSON("43.8")
	x.off.products[salmon] = p
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewGray(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestPlausibilityRules(t *testing.T) {
	good := domain.Nutrients{Kcal: 192, Protein: fp(21), Carbs: fp(0), Fat: fp(12), SatFat: fp(1.9), Sugar: fp(0)}
	cases := []struct {
		name string
		n    domain.Nutrients
		kj   *float64
		want []string
	}{
		{"the salmon label is consistent", good, fp(801), nil},
		{"energy that the macros cannot make", domain.Nutrients{Kcal: 500, Protein: fp(21), Carbs: fp(0), Fat: fp(12)}, nil, []string{IssueEnergyMismatch}},
		{"saturates above fat", domain.Nutrients{Kcal: 192, Protein: fp(21), Carbs: fp(0), Fat: fp(12), SatFat: fp(15)}, nil, []string{IssueSatOverFat}},
		{"sugars above carbohydrate", domain.Nutrients{Kcal: 100, Protein: fp(0), Carbs: fp(5), Fat: fp(8), Sugar: fp(9)}, nil, []string{IssueSugarOverCarbs}},
		{"kJ that disagrees with kcal", good, fp(2000), []string{IssueKJMismatch}},
		{"macros over 100 g", domain.Nutrients{Kcal: 400, Protein: fp(60), Carbs: fp(30), Fat: fp(20)}, nil, []string{IssueOutOfRange, IssueMacrosOver100, IssueEnergyMismatch}},
		{"missing nutrients are skipped, never read as 0", domain.Nutrients{Kcal: 192}, nil, nil},
		{"a lost decimal point (15 g fat for 1.5 g)", domain.Nutrients{Kcal: 60, Protein: fp(2), Carbs: fp(10), Fat: fp(15)}, nil, []string{IssueEnergyMismatch}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := Plausibility(c.n, c.kj)
			if fmt.Sprint(got) != fmt.Sprint(c.want) {
				t.Fatalf("issues = %v, want %v", got, c.want)
			}
		})
	}
}

func TestCorrectionGoesLiveForEveryAccount(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.wrongSalmon(t)
	other := x.addUser(t, 2)

	before, err := x.svc.Barcode(ctx, uid, salmon)
	if err != nil || before.Per100.Kcal != 399 {
		t.Fatalf("setup: %+v %v", before, err)
	}
	res, err := x.svc.Correct(ctx, uid, salmon, salmonInput())
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != domain.FactAccepted || len(res.Issues) != 0 || res.Origin != domain.OriginCorrection {
		t.Fatalf("result = %+v", res)
	}

	mine, err := x.r.FoodByBarcode(ctx, uid, salmon)
	if err != nil || mine.Per100.Kcal != 192 || mine.CommunityRev == nil {
		t.Fatalf("the author's cached row was not rewritten: %+v %v", mine, err)
	}
	if mine.ServerSeq <= before.ServerSeq {
		t.Fatalf("the rewrite must travel through the change log: seq %d then %d", before.ServerSeq, mine.ServerSeq)
	}

	calls := x.off.calls.Load()
	theirs, err := x.svc.Barcode(ctx, other, salmon)
	if err != nil {
		t.Fatal(err)
	}
	if theirs.Per100.Kcal != 192 || theirs.CommunityRev == nil || theirs.UserID != other {
		t.Fatalf("another account got %+v", theirs)
	}
	if x.off.calls.Load() != calls {
		t.Fatal("a community fact must not call Open Food Facts")
	}
}

func TestImplausibleCorrectionStaysPrivate(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.wrongSalmon(t)
	other := x.addUser(t, 2)
	in := salmonInput()
	in.Per100.Kcal = 500
	in.EnergyKJ = nil

	res, err := x.svc.Correct(ctx, uid, salmon, in)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != domain.FactPending || len(res.Issues) != 1 || res.Issues[0] != IssueEnergyMismatch {
		t.Fatalf("result = %+v", res)
	}
	got, err := x.svc.Barcode(ctx, other, salmon)
	if err != nil || got.Per100.Kcal != 399 || got.CommunityRev != nil {
		t.Fatalf("a value that failed the checks leaked: %+v %v", got, err)
	}
	if _, ok, _ := x.svc.Fact(ctx, other, salmon); ok {
		t.Fatal("no fact should be served")
	}
}

func TestNewProductBecomesFindableForOthers(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	other := x.addUser(t, 2)
	if _, err := x.svc.Barcode(ctx, other, salmon); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("setup: want a miss, got %v", err)
	}
	res, err := x.svc.Correct(ctx, uid, salmon, salmonInput())
	if err != nil || res.Origin != domain.OriginNew || res.Status != domain.FactAccepted {
		t.Fatalf("result = %+v %v", res, err)
	}
	got, err := x.svc.Barcode(ctx, other, salmon)
	if err != nil || got.Name != "Räucherlachs" || got.Per100.Kcal != 192 {
		t.Fatalf("rescan: %+v %v (the cached miss must not hide a new fact)", got, err)
	}
}

func TestResubmittingTheSameRevisionIsSafe(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	in := salmonInput()
	first, err := x.svc.Correct(ctx, uid, salmon, in)
	if err != nil {
		t.Fatal(err)
	}
	second, err := x.svc.Correct(ctx, uid, salmon, in)
	if err != nil || second.RevisionID != first.RevisionID || second.Status != first.Status {
		t.Fatalf("retry = %+v %v", second, err)
	}
	revs, err := x.r.RevisionsForBarcode(ctx, salmon)
	if err != nil || len(revs) != 1 {
		t.Fatalf("%d revisions, want 1 (%v)", len(revs), err)
	}
	other := x.addUser(t, 2)
	if _, err := x.svc.Correct(ctx, other, salmon, in); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("another account reusing a revision id: %v", err)
	}
}

func TestOFFNeverOverwritesAServedFact(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.wrongSalmon(t)
	other := x.addUser(t, 2)
	if _, err := x.svc.Correct(ctx, uid, salmon, salmonInput()); err != nil {
		t.Fatal(err)
	}
	got, err := x.svc.saveFromOFF(ctx, other, x.off.products[salmon])
	if err != nil {
		t.Fatal(err)
	}
	if got.Per100.Kcal != 192 || got.CommunityRev == nil {
		t.Fatalf("an OFF save replaced the community fact: %+v", got)
	}
}

func TestTwoDisputesRevertToThePreviousRevision(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	b, c, d := x.addUser(t, 2), x.addUser(t, 3), x.addUser(t, 4)
	if _, err := x.svc.Correct(ctx, uid, salmon, salmonInput()); err != nil {
		t.Fatal(err)
	}
	bad := salmonInput()
	bad.Per100 = domain.Nutrients{Kcal: 100, Protein: fp(10), Carbs: fp(15), Fat: fp(0)}
	bad.EnergyKJ = nil
	if res, err := x.svc.Correct(ctx, b, salmon, bad); err != nil || res.Status != domain.FactAccepted {
		t.Fatalf("a plausible wrong value is accepted: %+v %v", res, err)
	}
	if _, err := x.svc.Dispute(ctx, b, salmon); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("disputing your own submission: %v", err)
	}
	if reverted, err := x.svc.Dispute(ctx, c, salmon); err != nil || reverted {
		t.Fatalf("first dispute: %v %v", reverted, err)
	}
	if reverted, err := x.svc.Dispute(ctx, c, salmon); err != nil || reverted {
		t.Fatalf("the same account disputing twice counts once: %v %v", reverted, err)
	}
	if reverted, err := x.svc.Dispute(ctx, d, salmon); err != nil || !reverted {
		t.Fatalf("second account: %v %v", reverted, err)
	}
	got, err := x.svc.Barcode(ctx, c, salmon)
	if err != nil || got.Per100.Kcal != 192 {
		t.Fatalf("after the revert: %+v %v", got, err)
	}
}

func TestRevertWithNothingBeforeFallsBackToTheCatalog(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.addCatalog(t, salmon, "Räucherlachs", 399)
	b, c := x.addUser(t, 2), x.addUser(t, 3)
	if _, err := x.svc.Barcode(ctx, b, salmon); err != nil {
		t.Fatal(err)
	}
	if _, err := x.svc.Correct(ctx, uid, salmon, salmonInput()); err != nil {
		t.Fatal(err)
	}
	if got, _ := x.r.FoodByBarcode(ctx, b, salmon); got.Per100.Kcal != 192 {
		t.Fatalf("setup: %+v", got)
	}
	if _, err := x.svc.Dispute(ctx, b, salmon); err != nil {
		t.Fatal(err)
	}
	if reverted, err := x.svc.Dispute(ctx, c, salmon); err != nil || !reverted {
		t.Fatalf("%v %v", reverted, err)
	}
	got, err := x.r.FoodByBarcode(ctx, b, salmon)
	if err != nil || got.Per100.Kcal != 399 || got.CommunityRev != nil {
		t.Fatalf("the catalog row should be restored: %+v %v", got, err)
	}
	if _, ok, _ := x.svc.Fact(ctx, b, salmon); ok {
		t.Fatal("the fact should no longer be served")
	}
}

func TestDailyCap(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	for i := 0; i < maxRevisionsPerDay; i++ {
		in := salmonInput()
		in.Per100.Kcal = 500 // stays private, still counts
		if _, err := x.svc.Correct(ctx, uid, salmon, in); err != nil {
			t.Fatalf("submission %d: %v", i+1, err)
		}
	}
	if _, err := x.svc.Correct(ctx, uid, salmon, salmonInput()); !errors.Is(err, domain.ErrLimitReached) {
		t.Fatalf("the next one: %v", err)
	}
}

func TestPhotosMustBeSmallImages(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	in := salmonInput()
	in.LabelImage = []byte("not an image")
	var ve *domain.ValidationError
	if _, err := x.svc.Correct(ctx, uid, salmon, in); !errors.As(err, &ve) {
		t.Fatalf("junk photo: %v", err)
	}
	in = salmonInput()
	in.LabelImage = append(pngBytes(t), make([]byte, maxLabelImageBytes)...)
	if _, err := x.svc.Correct(ctx, uid, salmon, in); !errors.As(err, &ve) {
		t.Fatalf("oversized photo: %v", err)
	}
	in = salmonInput()
	in.LabelImage = pngBytes(t)
	if res, err := x.svc.Correct(ctx, uid, salmon, in); err != nil || res.Status != domain.FactAccepted {
		t.Fatalf("a real photo: %+v %v", res, err)
	}
}

func TestACorrectionNeverRewritesLoggedEntries(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	x.wrongSalmon(t)
	f, err := x.svc.Barcode(ctx, uid, salmon)
	if err != nil {
		t.Fatal(err)
	}
	var entryKcal float64
	if err := x.db.QueryRowContext(ctx, `SELECT 1`).Scan(new(int)); err != nil {
		t.Fatal(err)
	}
	_, err = x.db.ExecContext(ctx, `INSERT INTO entries (id, user_id, eaten_on, meal, food_id, name, amount, unit, grams,
		kcal_100g, created_at, updated_at, client_updated_at) VALUES ('e1', ?, '2026-11-21', 'lunch', ?, 'Räucherlachs', 100, 'g', 100,
		399, ?, ?, ?)`, uid, f.ID, stamp(now), stamp(now), stamp(now))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := x.svc.Correct(ctx, uid, salmon, salmonInput()); err != nil {
		t.Fatal(err)
	}
	if err := x.db.QueryRowContext(ctx, `SELECT kcal_100g FROM entries WHERE id = 'e1'`).Scan(&entryKcal); err != nil {
		t.Fatal(err)
	}
	if entryKcal != 399 {
		t.Fatalf("a logged entry changed to %v kcal; snapshots are immutable", entryKcal)
	}
}

func TestSaturatesAboveFatIsFlaggedNotSilentlyDropped(t *testing.T) {
	x := newFx(t)
	ctx := context.Background()
	in := salmonInput()
	in.Per100.SatFat = fp(15) // more than the 12 g of fat
	res, err := x.svc.Correct(ctx, uid, salmon, in)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != domain.FactPending || len(res.Issues) != 1 || res.Issues[0] != IssueSatOverFat {
		t.Fatalf("result = %+v", res)
	}
}
