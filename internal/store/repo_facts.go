package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store/sqlc"
)

func toRevision(r sqlc.ProductFactRevision) domain.FactRevision {
	return domain.FactRevision{
		ID: r.ID, Barcode: r.Barcode, Contributor: r.Contributor, Source: r.Source, Origin: domain.FactOrigin(r.Origin),
		Status: domain.FactStatus(r.Status), AppVersion: r.AppVersion, Lang: r.Lang, Countries: r.Countries,
		Name: r.ProductName, Brand: r.Brands, Quantity: r.Quantity, ServingSize: r.ServingSize,
		ServingGrams: r.ServingGrams, IngredientsText: r.IngredientsText,
		Per100: domain.Nutrients{
			Kcal: r.EnergyKcal100g, Protein: r.Proteins100g, Carbs: r.Carbohydrates100g, Fat: r.Fat100g,
			Sugar: r.Sugars100g, SatFat: r.SaturatedFat100g, Fiber: r.Fiber100g, Salt: r.Salt100g,
		},
		EnergyKJ: r.EnergyKj100g, LabelImage: r.LabelImage, FrontImage: r.FrontImage, SubmittedAt: r.SubmittedAt,
		AcceptedAt: r.AcceptedAt, PushedAt: r.PushedAt,
	}
}

func toRevisions(rows []sqlc.ProductFactRevision) []domain.FactRevision {
	out := make([]domain.FactRevision, len(rows))
	for i, r := range rows {
		out[i] = toRevision(r)
	}
	return out
}

// InsertFactRevision stores a submitted revision.
func (r *Repo) InsertFactRevision(ctx context.Context, v domain.FactRevision) error {
	err := r.q.InsertFactRevision(ctx, sqlc.InsertFactRevisionParams{
		ID: v.ID, Barcode: v.Barcode, Contributor: v.Contributor, Source: v.Source, Origin: string(v.Origin),
		Status: string(v.Status), AppVersion: v.AppVersion, Lang: v.Lang, Countries: v.Countries,
		ProductName: v.Name, Brands: v.Brand, Quantity: v.Quantity, ServingSize: v.ServingSize,
		ServingGrams: v.ServingGrams, IngredientsText: v.IngredientsText, EnergyKcal100g: v.Per100.Kcal,
		EnergyKj100g: v.EnergyKJ, Fat100g: v.Per100.Fat, SaturatedFat100g: v.Per100.SatFat,
		Carbohydrates100g: v.Per100.Carbs, Sugars100g: v.Per100.Sugar, Fiber100g: v.Per100.Fiber,
		Proteins100g: v.Per100.Protein, Salt100g: v.Per100.Salt, LabelImage: v.LabelImage, FrontImage: v.FrontImage,
		SubmittedAt: v.SubmittedAt, AcceptedAt: v.AcceptedAt,
	})
	if err != nil {
		return fmt.Errorf("saving fact revision: %w", err)
	}
	return nil
}

func (r *Repo) FactRevision(ctx context.Context, id string) (domain.FactRevision, error) {
	row, err := r.q.GetFactRevision(ctx, id)
	if err != nil {
		return domain.FactRevision{}, notFound(err, "fact revision")
	}
	return toRevision(row), nil
}

// AcceptedFact returns the revision currently served for a barcode, or ErrNotFound.
func (r *Repo) AcceptedFact(ctx context.Context, barcode string) (domain.FactRevision, error) {
	row, err := r.q.GetAcceptedFact(ctx, barcode)
	if err != nil {
		return domain.FactRevision{}, notFound(err, "product fact")
	}
	return toRevision(row), nil
}

// AcceptedFacts returns the served revision for each of the barcodes that has one.
func (r *Repo) AcceptedFacts(ctx context.Context, barcodes []string) ([]domain.FactRevision, error) {
	if len(barcodes) == 0 {
		return []domain.FactRevision{}, nil
	}
	rows, err := r.q.ListAcceptedFacts(ctx, barcodes)
	if err != nil {
		return nil, fmt.Errorf("listing product facts: %w", err)
	}
	return toRevisions(rows), nil
}

// ServeFact makes a revision the one served for its barcode and retires the previous one.
func (r *Repo) ServeFact(ctx context.Context, v domain.FactRevision, now string) error {
	if err := r.q.SupersedeAcceptedRevisions(ctx, sqlc.SupersedeAcceptedRevisionsParams{Barcode: v.Barcode, ID: v.ID}); err != nil {
		return fmt.Errorf("retiring previous revision: %w", err)
	}
	if err := r.q.SetFactRevisionStatus(ctx, sqlc.SetFactRevisionStatusParams{Status: string(domain.FactAccepted), AcceptedAt: &now, ID: v.ID}); err != nil {
		return fmt.Errorf("accepting revision: %w", err)
	}
	if err := r.q.UpsertProductFact(ctx, sqlc.UpsertProductFactParams{Barcode: v.Barcode, RevisionID: v.ID, UpdatedAt: now}); err != nil {
		return fmt.Errorf("serving fact: %w", err)
	}
	return nil
}

// SetRevisionStatus changes a revision's status without touching what is served.
func (r *Repo) SetRevisionStatus(ctx context.Context, id string, status domain.FactStatus, acceptedAt *string) error {
	if err := r.q.SetFactRevisionStatus(ctx, sqlc.SetFactRevisionStatusParams{Status: string(status), AcceptedAt: acceptedAt, ID: id}); err != nil {
		return fmt.Errorf("setting revision status: %w", err)
	}
	return nil
}

// UnserveFact removes the served fact for a barcode. Reference data, not a syncable row, so this is a real delete.
func (r *Repo) UnserveFact(ctx context.Context, barcode string) error {
	if err := r.q.DeleteProductFact(ctx, barcode); err != nil {
		return fmt.Errorf("removing product fact: %w", err)
	}
	return nil
}

func (r *Repo) PendingRevisions(ctx context.Context, barcode string) ([]domain.FactRevision, error) {
	rows, err := r.q.ListPendingRevisions(ctx, barcode)
	if err != nil {
		return nil, fmt.Errorf("listing pending revisions: %w", err)
	}
	return toRevisions(rows), nil
}

func (r *Repo) RevisionsForBarcode(ctx context.Context, barcode string) ([]domain.FactRevision, error) {
	rows, err := r.q.ListRevisionsForBarcode(ctx, barcode)
	if err != nil {
		return nil, fmt.Errorf("listing revisions: %w", err)
	}
	return toRevisions(rows), nil
}

// LatestSuperseded is the revision that was served before the current one, or ErrNotFound.
func (r *Repo) LatestSuperseded(ctx context.Context, barcode string) (domain.FactRevision, error) {
	row, err := r.q.LatestSupersededRevision(ctx, barcode)
	if err != nil {
		return domain.FactRevision{}, notFound(err, "previous revision")
	}
	return toRevision(row), nil
}

// AddDispute records that a contributor disputes a revision and returns how many contributors now do.
func (r *Repo) AddDispute(ctx context.Context, barcode, revisionID, contributor, now string) (int64, error) {
	if _, err := r.q.InsertFactDispute(ctx, sqlc.InsertFactDisputeParams{
		Barcode: barcode, RevisionID: revisionID, Contributor: contributor, CreatedAt: now,
	}); err != nil {
		return 0, fmt.Errorf("saving dispute: %w", err)
	}
	n, err := r.q.CountFactDisputes(ctx, revisionID)
	if err != nil {
		return 0, fmt.Errorf("counting disputes: %w", err)
	}
	return n, nil
}

func (r *Repo) ContributorRevisionCounts(ctx context.Context, contributor, since string) (day, total int64, err error) {
	day, err = r.q.CountContributorRevisionsSince(ctx, sqlc.CountContributorRevisionsSinceParams{Contributor: contributor, SubmittedAt: since})
	if err != nil {
		return 0, 0, fmt.Errorf("counting recent revisions: %w", err)
	}
	total, err = r.q.CountContributorRevisions(ctx, contributor)
	if err != nil {
		return 0, 0, fmt.Errorf("counting revisions: %w", err)
	}
	return day, total, nil
}

// ServerManagedFoods lists every account's live OFF or catalog row for a barcode, for the fan-out of an accepted fact.
func (r *Repo) ServerManagedFoods(ctx context.Context, barcode string) ([]domain.Food, error) {
	rows, err := r.q.ListFoodsToRefreshForBarcode(ctx, &barcode)
	if err != nil {
		return nil, fmt.Errorf("listing foods to refresh: %w", err)
	}
	return toFoods(rows), nil
}

func (r *Repo) ClearBarcodeMiss(ctx context.Context, code string) error {
	if err := r.q.DeleteSearchCache(ctx, "barcode:"+code); err != nil {
		return fmt.Errorf("clearing barcode miss: %w", err)
	}
	return nil
}

// FactsForExport lists every served fact, for make off-export.
func (r *Repo) FactsForExport(ctx context.Context) ([]domain.FactRevision, error) {
	rows, err := r.q.ListAcceptedFactsForExport(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing facts for export: %w", err)
	}
	return toRevisions(rows), nil
}

// ServedFactPhoto returns one photo of a revision that is currently served for its barcode. A revision that was replaced,
// reverted or never accepted has no public photo, so it answers ErrNotFound like a missing one.
func (r *Repo) ServedFactPhoto(ctx context.Context, revisionID string, nutrition bool) ([]byte, error) {
	row, err := r.q.GetServedFactPhotos(ctx, revisionID)
	if err != nil {
		return nil, notFound(err, "fact photo")
	}
	b := row.FrontImage
	if nutrition {
		b = row.LabelImage
	}
	if len(b) == 0 {
		return nil, fmt.Errorf("fact photo: %w", domain.ErrNotFound)
	}
	return b, nil
}

// ServedFactHasFrontPhoto says whether the served revision carries a front photo, without loading it.
func (r *Repo) ServedFactHasFrontPhoto(ctx context.Context, revisionID string) (bool, error) {
	row, err := r.q.GetServedFactPhotoSizes(ctx, revisionID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("checking fact photo: %w", err)
	}
	return row.FrontBytes > 0, nil
}
