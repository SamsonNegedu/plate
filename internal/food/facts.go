package food

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // registers the decoder image.DecodeConfig uses to check a photo
	_ "image/png"  // registers the decoder image.DecodeConfig uses to check a photo
	"log/slog"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
	psync "plate/internal/sync"
)

const (
	maxLabelImageBytes  = 400 * 1024 // both photos in base64 must fit the 1 MB JSON body limit
	maxFrontImageBytes  = 250 * 1024
	maxRevisionsPerDay  = 50
	maxRevisionsTotal   = 500
	disputesToRevert    = 2
	sourceManual        = "manual"
	sourceOCR           = "ocr"
	staleCheckedAt      = "1970-01-01T00:00:00Z"
	contributorHashSalt = "plate-contributor:"
)

// CorrectionInput is a person's version of a product's facts (ADR-020).
type CorrectionInput struct {
	FoodInput
	// RevisionID is chosen by the client, so a retried submission is the same submission.
	RevisionID      string
	Source          string
	AppVersion      string
	Lang            string
	Countries       string
	IngredientsText string
	EnergyKJ        *float64
	LabelImage      []byte
	FrontImage      []byte
}

// CorrectionResult says what became of a submission. Issues lists the plausibility checks it failed; a revision with
// issues is stored but never goes live.
type CorrectionResult struct {
	RevisionID string
	Status     domain.FactStatus
	Origin     domain.FactOrigin
	Issues     []string
}

// contributorID is an opaque, stable id for an account. It identifies no one outside this database.
func contributorID(userID string) string {
	h := sha256.Sum256([]byte(contributorHashSalt + userID))
	return hex.EncodeToString(h[:16])
}

func checkImage(b []byte, field string, limit int) error {
	if len(b) == 0 {
		return nil
	}
	if len(b) > limit {
		return &domain.ValidationError{Fields: []domain.FieldError{{Field: field, Message: fmt.Sprintf("must be %d KB or smaller", limit/1024)}}}
	}
	if _, _, err := image.DecodeConfig(bytes.NewReader(b)); err != nil {
		return &domain.ValidationError{Fields: []domain.FieldError{{Field: field, Message: "must be a JPEG or PNG image"}}}
	}
	return nil
}

// Correct stores a revision of a product's facts. It goes live for every account at once when its numbers pass the
// plausibility checks. A revision that fails them stays pending, visible only to its author through their own food.
// Protection is the checks, per-account caps, the append-only history and Dispute, not a second opinion up front: with
// open signup, no administrator and few accounts, a quorum would rarely form and two throwaway accounts would pass it.
func (s *Service) Correct(ctx context.Context, userID, rawBarcode string, in CorrectionInput) (CorrectionResult, error) {
	code, _, err := NormalizeBarcode(rawBarcode)
	if err != nil {
		return CorrectionResult{}, err
	}
	revID, err := uuid.Parse(in.RevisionID)
	if err != nil {
		return CorrectionResult{}, &domain.ValidationError{Fields: []domain.FieldError{{Field: "revision_id", Message: "must be a UUID"}}}
	}
	in.Barcode = &code
	raw := in.Per100 // validateFoodInput drops a saturates or sugars value above its parent; the checks must see it first
	n, err := validateFoodInput(revID.String(), &in.FoodInput)
	if err != nil {
		return CorrectionResult{}, err
	}
	in.Per100 = n
	if err := checkImage(in.LabelImage, "label_image", maxLabelImageBytes); err != nil {
		return CorrectionResult{}, err
	}
	if err := checkImage(in.FrontImage, "front_image", maxFrontImageBytes); err != nil {
		return CorrectionResult{}, err
	}
	source := in.Source
	if source != sourceOCR {
		source = sourceManual
	}
	contributor := contributorID(userID)
	issues := Plausibility(raw, in.EnergyKJ)

	var res CorrectionResult
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		now := s.now()
		if prev, err := r.FactRevision(ctx, revID.String()); err == nil {
			if prev.Contributor != contributor {
				return fmt.Errorf("revision %s: %w", prev.ID, domain.ErrConflict)
			}
			res = CorrectionResult{RevisionID: prev.ID, Status: prev.Status, Origin: prev.Origin, Issues: Plausibility(prev.Per100, prev.EnergyKJ)}
			return nil // the same submission, retried
		} else if !errors.Is(err, domain.ErrNotFound) {
			return err
		}
		day, total, err := r.ContributorRevisionCounts(ctx, contributor, stamp(now.Add(-24*time.Hour)))
		if err != nil {
			return err
		}
		if day >= maxRevisionsPerDay || total >= maxRevisionsTotal {
			return fmt.Errorf("correction limit: %w", domain.ErrLimitReached)
		}
		origin, err := s.originFor(ctx, r, userID, code)
		if err != nil {
			return err
		}
		live := len(issues) == 0
		rev := domain.FactRevision{
			ID: revID.String(), Barcode: code, Contributor: contributor, Source: source, Origin: origin,
			Status: domain.FactPending, AppVersion: truncate(in.AppVersion, 40), Lang: orDefault(in.Lang, "de"),
			Countries: orDefault(in.Countries, "en:germany"), Name: in.Name, Brand: in.Brand, Quantity: in.Quantity,
			ServingSize: in.ServingSize, ServingGrams: in.ServingGrams,
			IngredientsText: truncate(in.IngredientsText, maxLongText), Per100: in.Per100, EnergyKJ: in.EnergyKJ,
			LabelImage: in.LabelImage, FrontImage: in.FrontImage, SubmittedAt: stamp(now),
		}
		if live {
			rev.Status = domain.FactAccepted
			at := stamp(now)
			rev.AcceptedAt = &at
		}
		if err := r.InsertFactRevision(ctx, rev); err != nil {
			return err
		}
		if live {
			if err := s.serve(ctx, r, rev, now); err != nil {
				return err
			}
		}
		res = CorrectionResult{RevisionID: rev.ID, Status: rev.Status, Origin: origin, Issues: issues}
		return nil
	})
	return res, err
}

func orDefault(v, d string) string {
	if v == "" {
		return d
	}
	return truncate(v, 60)
}

// originFor says whether anything loggable already exists for the barcode.
func (s *Service) originFor(ctx context.Context, r *store.Repo, userID, code string) (domain.FactOrigin, error) {
	if _, err := r.AcceptedFact(ctx, code); err == nil {
		return domain.OriginCorrection, nil
	} else if !errors.Is(err, domain.ErrNotFound) {
		return "", err
	}
	cats, err := r.CatalogByBarcodes(ctx, []string{code})
	if err != nil {
		return "", err
	}
	if len(cats) > 0 {
		return domain.OriginCorrection, nil
	}
	foods, err := r.FoodsByBarcodes(ctx, userID, []string{code})
	if err != nil {
		return "", err
	}
	for _, f := range foods {
		if f.Source == domain.SourceOFF || f.Source == domain.SourceCatalog {
			return domain.OriginCorrection, nil
		}
	}
	return domain.OriginNew, nil
}

// serve makes a revision the one every account sees and rewrites each account's server-managed row for the barcode
// through the change log, so devices pull the fix. Entries already logged keep their snapshots.
func (s *Service) serve(ctx context.Context, r *store.Repo, rev domain.FactRevision, now time.Time) error {
	if err := r.ServeFact(ctx, rev, stamp(now)); err != nil {
		return err
	}
	if err := r.ClearBarcodeMiss(ctx, rev.Barcode); err != nil {
		return err
	}
	foods, err := r.ServerManagedFoods(ctx, rev.Barcode)
	if err != nil {
		return err
	}
	for _, f := range foods {
		applyRevision(&f, rev, now)
		if _, err := psync.ApplyFood(ctx, r, f, now); err != nil {
			return err
		}
	}
	return nil
}

func applyRevision(f *domain.Food, rev domain.FactRevision, now time.Time) {
	f.Per100 = rev.Per100
	if rev.ServingGrams != nil {
		f.ServingGrams = rev.ServingGrams
	}
	if rev.ServingSize != "" {
		f.ServingSize = rev.ServingSize
	}
	if rev.Quantity != "" && f.Quantity == "" {
		f.Quantity = rev.Quantity
	}
	checked := stamp(now)
	f.SourceCheckedAt = &checked
	f.CommunityRev = &rev.ID
}

// Dispute records that the caller thinks the served facts for a barcode are wrong. Two accounts other than the
// contributor return the product to its previous revision (or to what Open Food Facts and the catalog say).
func (s *Service) Dispute(ctx context.Context, userID, rawBarcode string) (reverted bool, err error) {
	code, _, err := NormalizeBarcode(rawBarcode)
	if err != nil {
		return false, err
	}
	contributor := contributorID(userID)
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		now := s.now()
		cur, err := r.AcceptedFact(ctx, code)
		if err != nil {
			return err
		}
		if cur.Contributor == contributor {
			return fmt.Errorf("you submitted these facts: %w", domain.ErrConflict)
		}
		n, err := r.AddDispute(ctx, code, cur.ID, contributor, stamp(now))
		if err != nil {
			return err
		}
		if n < disputesToRevert {
			return nil
		}
		reverted = true
		return s.revert(ctx, r, cur, now)
	})
	return reverted, err
}

func (s *Service) revert(ctx context.Context, r *store.Repo, cur domain.FactRevision, now time.Time) error {
	if err := r.SetRevisionStatus(ctx, cur.ID, domain.FactReverted, nil); err != nil {
		return err
	}
	prev, err := r.LatestSuperseded(ctx, cur.Barcode)
	if err == nil {
		return s.serve(ctx, r, prev, now)
	}
	if !errors.Is(err, domain.ErrNotFound) {
		return err
	}
	if err := r.UnserveFact(ctx, cur.Barcode); err != nil {
		return err
	}
	cats, err := r.CatalogByBarcodes(ctx, []string{cur.Barcode})
	if err != nil {
		return err
	}
	foods, err := r.ServerManagedFoods(ctx, cur.Barcode)
	if err != nil {
		return err
	}
	for _, f := range foods {
		if f.CommunityRev == nil || *f.CommunityRev != cur.ID {
			continue
		}
		f.CommunityRev = nil
		stale := staleCheckedAt
		f.SourceCheckedAt = &stale // an Open Food Facts row refreshes the next time it is used
		if f.Source == domain.SourceCatalog && len(cats) > 0 {
			f.Per100 = cats[0].Per100
		}
		if _, err := psync.ApplyFood(ctx, r, f, now); err != nil {
			return err
		}
	}
	return nil
}

// FactSummary is what a person may see about a served fact.
type FactSummary struct {
	Status     string
	Origin     domain.FactOrigin
	Source     string
	UpdatedAt  string
	Mine       bool
	Confirmed  bool
	HasPhotos  bool
	RevisionID string
}

// Fact describes the fact served for a barcode, if any.
func (s *Service) Fact(ctx context.Context, userID, rawBarcode string) (FactSummary, bool, error) {
	code, _, err := NormalizeBarcode(rawBarcode)
	if err != nil {
		return FactSummary{}, false, err
	}
	r := store.NewRepo(s.db)
	rev, err := r.AcceptedFact(ctx, code)
	if errors.Is(err, domain.ErrNotFound) {
		return FactSummary{}, false, nil
	}
	if err != nil {
		return FactSummary{}, false, err
	}
	at := rev.SubmittedAt
	if rev.AcceptedAt != nil {
		at = *rev.AcceptedAt
	}
	return FactSummary{
		Status: string(rev.Status), Origin: rev.Origin, Source: rev.Source, UpdatedAt: at,
		Mine: rev.Contributor == contributorID(userID), HasPhotos: len(rev.LabelImage) > 0, RevisionID: rev.ID,
	}, true, nil
}

// fromFacts materializes a served fact into the account's foods, like fromCatalog does for a seed row.
func (s *Service) fromFacts(ctx context.Context, userID string, candidates []string) (domain.Food, bool, error) {
	repo := store.NewRepo(s.db)
	revs, err := repo.AcceptedFacts(ctx, candidates)
	if err != nil || len(revs) == 0 {
		return domain.Food{}, false, err
	}
	rev := revs[0]
	for _, c := range revs[1:] {
		if indexOfStr(candidates, c.Barcode) < indexOfStr(candidates, rev.Barcode) {
			rev = c
		}
	}
	var out domain.Food
	err = store.InTx(ctx, s.db, func(r *store.Repo) error {
		if f, ok, err := s.cachedFood(ctx, r, userID, candidates); err != nil || ok {
			out = f
			return err
		}
		id, err := uuid.NewV7()
		if err != nil {
			return fmt.Errorf("generating food id: %w", err)
		}
		now := s.now()
		bc := rev.Barcode
		stampNow := stamp(now)
		// A picture the catalog already has for this barcode stays; the shared front photo only fills a gap (see the API).
		var imageKey *string
		category := ""
		if cats, err := r.CatalogByBarcodes(ctx, []string{rev.Barcode}); err == nil && len(cats) > 0 {
			category = cats[0].Category
			if cats[0].ImageSourceURL != nil {
				imageKey = RegisterImage(ctx, r, *cats[0].ImageSourceURL, stampNow)
			}
		}
		out = domain.Food{
			ID: id.String(), UserID: userID, Barcode: &bc, Name: rev.Name, Brand: rev.Brand, Quantity: rev.Quantity,
			ServingSize: rev.ServingSize, ServingGrams: rev.ServingGrams, Per100: rev.Per100,
			Source: domain.SourceCatalog, SourceID: &bc, SourceCheckedAt: &stampNow, CommunityRev: &rev.ID, ImageKey: imageKey, Category: category,
			SearchName: domain.SearchName(rev.Name + " " + rev.Brand), CreatedAt: stampNow, UpdatedAt: stampNow,
			Ingredients: rev.IngredientsText,
		}
		out, err = psync.ApplyFood(ctx, r, out, now)
		return err
	})
	if err != nil {
		return domain.Food{}, false, err
	}
	s.log.DebugContext(ctx, "served community fact", slog.String("barcode", rev.Barcode))
	return out, true, nil
}
