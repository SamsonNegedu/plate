package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store/sqlc"
)

// ReplaceReference swaps the whole reference table for rows. Call it inside a transaction.
func (r *Repo) ReplaceReference(ctx context.Context, rows []domain.ReferenceFood) error {
	if err := r.q.DeleteAllReferenceFoods(ctx); err != nil {
		return fmt.Errorf("clearing reference foods: %w", err)
	}
	for _, f := range rows {
		estimated := int64(0)
		if f.Estimated {
			estimated = 1
		}
		err := r.q.InsertReferenceFood(ctx, sqlc.InsertReferenceFoodParams{
			RefID: f.RefID, Name: f.Name, LocalNames: f.LocalNames, ScientificName: f.ScientificName, Category: f.Category,
			Kcal100g: f.Per100.Kcal, Protein100g: f.Per100.Protein, Carbs100g: f.Per100.Carbs, Fat100g: f.Per100.Fat,
			Sugar100g: f.Per100.Sugar, Satfat100g: f.Per100.SatFat, Fiber100g: f.Per100.Fiber, Salt100g: f.Per100.Salt,
			Estimated: estimated, Source: f.Source, DatasetVersion: f.DatasetVersion, ImportedAt: f.ImportedAt,
		})
		if err != nil {
			return fmt.Errorf("inserting reference food %s: %w", f.RefID, err)
		}
	}
	return nil
}

func (r *Repo) SearchReference(ctx context.Context, match string, limit int) ([]domain.ReferenceFood, error) {
	rows, err := r.q.SearchReference(ctx, sqlc.SearchReferenceParams{Match: &match, MaxRows: int64(limit)})
	if err != nil {
		return nil, fmt.Errorf("searching reference foods: %w", err)
	}
	out := make([]domain.ReferenceFood, len(rows))
	for i, row := range rows {
		out[i] = toReferenceFood(row)
	}
	return out, nil
}

func (r *Repo) ReferenceByID(ctx context.Context, refID string) (domain.ReferenceFood, error) {
	row, err := r.q.GetReferenceFood(ctx, refID)
	if err != nil {
		return domain.ReferenceFood{}, notFound(err, "reference food")
	}
	return toReferenceFood(row), nil
}

func (r *Repo) CountReference(ctx context.Context) (int64, error) {
	n, err := r.q.CountReferenceFoods(ctx)
	if err != nil {
		return 0, fmt.Errorf("counting reference foods: %w", err)
	}
	return n, nil
}

// ReferenceVersion is the dataset version of the loaded reference foods, or "" when the table is empty.
func (r *Repo) ReferenceVersion(ctx context.Context) (string, error) {
	v, err := r.q.GetReferenceVersion(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reading reference version: %w", err)
	}
	return v, nil
}

func toReferenceFood(f sqlc.ReferenceFood) domain.ReferenceFood {
	return domain.ReferenceFood{
		RefID: f.RefID, Name: f.Name, LocalNames: f.LocalNames, ScientificName: f.ScientificName, Category: f.Category,
		Per100: domain.Nutrients{
			Kcal: f.Kcal100g, Protein: f.Protein100g, Carbs: f.Carbs100g, Fat: f.Fat100g,
			Sugar: f.Sugar100g, SatFat: f.Satfat100g, Fiber: f.Fiber100g, Salt: f.Salt100g,
		},
		Estimated: f.Estimated == 1, Source: f.Source, DatasetVersion: f.DatasetVersion, ImportedAt: f.ImportedAt,
	}
}
