package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store/sqlc"
)

// Repo maps generated rows to domain types. Handlers use Repo and never see sqlc types.
type Repo struct {
	q *sqlc.Queries
}

func NewRepo(db sqlc.DBTX) *Repo { return &Repo{q: sqlc.New(db)} }

// InTx runs fn with a Repo bound to a BEGIN IMMEDIATE transaction.
func InTx(ctx context.Context, d *sql.DB, fn func(*Repo) error) error {
	return WithTx(ctx, d, func(conn *sql.Conn) error { return fn(NewRepo(conn)) })
}

func notFound(err error, what string) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%s: %w", what, domain.ErrNotFound)
	}
	return fmt.Errorf("%s: %w", what, err)
}

func (r *Repo) CountUsers(ctx context.Context) (int64, error) {
	n, err := r.q.CountUsers(ctx)
	if err != nil {
		return 0, fmt.Errorf("counting users: %w", err)
	}
	return n, nil
}

func (r *Repo) CreateUser(ctx context.Context, u domain.User) error {
	err := r.q.InsertUser(ctx, sqlc.InsertUserParams{
		ID: u.ID, Email: u.Email, PasswordHash: u.PasswordHash, CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt,
	})
	if err != nil {
		return fmt.Errorf("inserting user: %w", err)
	}
	return nil
}

func (r *Repo) FirstUser(ctx context.Context) (domain.User, error) {
	u, err := r.q.GetFirstUser(ctx)
	if err != nil {
		return domain.User{}, notFound(err, "user")
	}
	return toUser(u), nil
}

func (r *Repo) UserByEmail(ctx context.Context, email string) (domain.User, error) {
	u, err := r.q.GetUserByEmail(ctx, email)
	if err != nil {
		return domain.User{}, notFound(err, "user")
	}
	return toUser(u), nil
}

func (r *Repo) SetPassword(ctx context.Context, id, hash, now string) error {
	n, err := r.q.UpdateUserPassword(ctx, sqlc.UpdateUserPasswordParams{PasswordHash: hash, UpdatedAt: now, ID: id})
	if err != nil {
		return fmt.Errorf("updating password: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("user %s: %w", id, domain.ErrNotFound)
	}
	return nil
}

func (r *Repo) UserByID(ctx context.Context, id string) (domain.User, error) {
	u, err := r.q.GetUserByID(ctx, id)
	if err != nil {
		return domain.User{}, notFound(err, "user")
	}
	return toUser(u), nil
}

func (r *Repo) TouchLastLogin(ctx context.Context, id, now string) error {
	if err := r.q.TouchLastLogin(ctx, sqlc.TouchLastLoginParams{LastLoginAt: &now, ID: id}); err != nil {
		return fmt.Errorf("recording login: %w", err)
	}
	return nil
}

func toUser(u sqlc.User) domain.User {
	return domain.User{
		ID: u.ID, Email: u.Email, PasswordHash: u.PasswordHash,
		CreatedAt: u.CreatedAt, UpdatedAt: u.UpdatedAt, LastLoginAt: u.LastLoginAt,
	}
}

func (r *Repo) Settings(ctx context.Context, userID string) (domain.Settings, error) {
	s, err := r.q.GetSettings(ctx, userID)
	if err != nil {
		return domain.Settings{}, notFound(err, "settings")
	}
	return domain.Settings{
		UserID: s.UserID, GoalKcal: s.GoalKcal, ProteinG: s.ProteinG, CarbsG: s.CarbsG, FatG: s.FatG,
		DayStartHour: s.DayStartHour, Theme: s.Theme, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, ServerSeq: s.ServerSeq,
	}, nil
}

func (r *Repo) PutSettings(ctx context.Context, s domain.Settings) error {
	err := r.q.UpsertSettings(ctx, sqlc.UpsertSettingsParams{
		UserID: s.UserID, GoalKcal: s.GoalKcal, ProteinG: s.ProteinG, CarbsG: s.CarbsG, FatG: s.FatG,
		DayStartHour: s.DayStartHour, Theme: s.Theme, CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, ServerSeq: s.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving settings: %w", err)
	}
	return nil
}

func (r *Repo) Food(ctx context.Context, userID, id string) (domain.Food, error) {
	f, err := r.q.GetFood(ctx, sqlc.GetFoodParams{ID: id, UserID: userID})
	if err != nil {
		return domain.Food{}, notFound(err, "food")
	}
	return toFood(f), nil
}

func (r *Repo) FoodByBarcode(ctx context.Context, userID, barcode string) (domain.Food, error) {
	f, err := r.q.GetLiveFoodByBarcode(ctx, sqlc.GetLiveFoodByBarcodeParams{UserID: userID, Barcode: &barcode})
	if err != nil {
		return domain.Food{}, notFound(err, "food by barcode")
	}
	return toFood(f), nil
}

func (r *Repo) PutFood(ctx context.Context, f domain.Food) error {
	n, err := r.q.UpsertFood(ctx, sqlc.UpsertFoodParams{
		ID: f.ID, UserID: f.UserID, Barcode: f.Barcode, Name: f.Name, Brand: f.Brand, Quantity: f.Quantity,
		ServingSize: f.ServingSize, ServingGrams: f.ServingGrams, Kcal100g: f.Per100.Kcal,
		Protein100g: f.Per100.Protein, Carbs100g: f.Per100.Carbs, Fat100g: f.Per100.Fat,
		Sugar100g: f.Per100.Sugar, Satfat100g: f.Per100.SatFat, Fiber100g: f.Per100.Fiber, Salt100g: f.Per100.Salt,
		Nutriscore: f.Nutriscore, Source: string(f.Source), SourceID: f.SourceID,
		SourceUpdatedAt: f.SourceUpdatedAt, SourceCheckedAt: f.SourceCheckedAt, ImageKey: f.ImageKey,
		Ingredients: f.Ingredients, Allergens: f.Allergens, SearchName: f.SearchName,
		CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt, DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving food: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("food %s belongs to another user: %w", f.ID, domain.ErrConflict)
	}
	return nil
}

func toFood(f sqlc.Food) domain.Food {
	return domain.Food{
		ID: f.ID, UserID: f.UserID, Barcode: f.Barcode, Name: f.Name, Brand: f.Brand, Quantity: f.Quantity,
		ServingSize: f.ServingSize, ServingGrams: f.ServingGrams,
		Per100: domain.Nutrients{
			Kcal: f.Kcal100g, Protein: f.Protein100g, Carbs: f.Carbs100g, Fat: f.Fat100g,
			Sugar: f.Sugar100g, SatFat: f.Satfat100g, Fiber: f.Fiber100g, Salt: f.Salt100g,
		},
		Nutriscore: f.Nutriscore, Source: domain.Source(f.Source), SourceID: f.SourceID,
		SourceUpdatedAt: f.SourceUpdatedAt, SourceCheckedAt: f.SourceCheckedAt, ImageKey: f.ImageKey,
		Ingredients: f.Ingredients, Allergens: f.Allergens, SearchName: f.SearchName,
		CreatedAt: f.CreatedAt, UpdatedAt: f.UpdatedAt, DeletedAt: f.DeletedAt, ServerSeq: f.ServerSeq,
	}
}

func (r *Repo) Entry(ctx context.Context, userID, id string) (domain.Entry, error) {
	e, err := r.q.GetEntry(ctx, sqlc.GetEntryParams{ID: id, UserID: userID})
	if err != nil {
		return domain.Entry{}, notFound(err, "entry")
	}
	return toEntry(e), nil
}

func (r *Repo) PutEntry(ctx context.Context, e domain.Entry) error {
	n, err := r.q.UpsertEntry(ctx, sqlc.UpsertEntryParams{
		ID: e.ID, UserID: e.UserID, EatenOn: e.EatenOn, Meal: string(e.Meal), FoodID: e.FoodID,
		Name: e.Name, Brand: e.Brand, Barcode: e.Barcode, Amount: e.Amount, Unit: string(e.Unit), Grams: e.Grams,
		Kcal100g: e.Snapshot.Kcal, Protein100g: e.Snapshot.Protein, Carbs100g: e.Snapshot.Carbs,
		Fat100g: e.Snapshot.Fat, Sugar100g: e.Snapshot.Sugar, Satfat100g: e.Snapshot.SatFat,
		Fiber100g: e.Snapshot.Fiber, Salt100g: e.Snapshot.Salt, Note: e.Note,
		CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, ClientUpdatedAt: e.ClientUpdatedAt,
		DeletedAt: e.DeletedAt, ServerSeq: e.ServerSeq,
	})
	if err != nil {
		return fmt.Errorf("saving entry: %w", err)
	}
	if n == 0 {
		return fmt.Errorf("entry %s belongs to another user: %w", e.ID, domain.ErrConflict)
	}
	return nil
}

func (r *Repo) EntriesForDay(ctx context.Context, userID, day string) ([]domain.Entry, error) {
	rows, err := r.q.ListEntriesForDay(ctx, sqlc.ListEntriesForDayParams{UserID: userID, EatenOn: day})
	if err != nil {
		return nil, fmt.Errorf("listing entries for %s: %w", day, err)
	}
	return toEntries(rows), nil
}

func (r *Repo) EntriesInRange(ctx context.Context, userID, from, to string) ([]domain.Entry, error) {
	rows, err := r.q.ListEntriesInRange(ctx, sqlc.ListEntriesInRangeParams{UserID: userID, FromDay: from, ToDay: to})
	if err != nil {
		return nil, fmt.Errorf("listing entries %s..%s: %w", from, to, err)
	}
	return toEntries(rows), nil
}

func toEntries(rows []sqlc.Entry) []domain.Entry {
	out := make([]domain.Entry, 0, len(rows))
	for _, e := range rows {
		out = append(out, toEntry(e))
	}
	return out
}

func toEntry(e sqlc.Entry) domain.Entry {
	return domain.Entry{
		ID: e.ID, UserID: e.UserID, EatenOn: e.EatenOn, Meal: domain.Meal(e.Meal), FoodID: e.FoodID,
		Name: e.Name, Brand: e.Brand, Barcode: e.Barcode, Amount: e.Amount, Unit: domain.Unit(e.Unit), Grams: e.Grams,
		Snapshot: domain.Nutrients{
			Kcal: e.Kcal100g, Protein: e.Protein100g, Carbs: e.Carbs100g, Fat: e.Fat100g,
			Sugar: e.Sugar100g, SatFat: e.Satfat100g, Fiber: e.Fiber100g, Salt: e.Salt100g,
		},
		Note: e.Note, CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, ClientUpdatedAt: e.ClientUpdatedAt,
		DeletedAt: e.DeletedAt, ServerSeq: e.ServerSeq,
	}
}
