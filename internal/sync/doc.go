// Package sync holds the wire documents and the apply rules shared by the REST handlers, the sync endpoints
// and export/import. Every syncable write goes through here so server_seq and the change log stay consistent.
package sync

import "plate/internal/domain"

// EntryBody is what a client sends for an entry. Nutrients are per 100 g; null means not reported.
type EntryBody struct {
	EatenOn         string   `json:"eaten_on" pattern:"^\\d{4}-\\d{2}-\\d{2}$" doc:"Local calendar date the client assigned."`
	Meal            string   `json:"meal" enum:"breakfast,lunch,dinner,snack"`
	FoodID          *string  `json:"food_id" required:"false" nullable:"true" format:"uuid"`
	Name            string   `json:"name" minLength:"1" maxLength:"200"`
	Brand           string   `json:"brand" required:"false" maxLength:"200"`
	Barcode         *string  `json:"barcode" required:"false" nullable:"true" pattern:"^\\d{8,14}$"`
	Amount          float64  `json:"amount" exclusiveMinimum:"0"`
	Unit            string   `json:"unit" enum:"g,ml,piece,serving"`
	Grams           float64  `json:"grams" exclusiveMinimum:"0"`
	Kcal            float64  `json:"kcal" minimum:"0" doc:"kcal per 100 g snapshot."`
	Protein         *float64 `json:"protein" required:"false" nullable:"true" minimum:"0"`
	Carbs           *float64 `json:"carbs" required:"false" nullable:"true" minimum:"0"`
	Fat             *float64 `json:"fat" required:"false" nullable:"true" minimum:"0"`
	Sugar           *float64 `json:"sugar" required:"false" nullable:"true" minimum:"0"`
	SatFat          *float64 `json:"satfat" required:"false" nullable:"true" minimum:"0"`
	Fiber           *float64 `json:"fiber" required:"false" nullable:"true" minimum:"0"`
	Salt            *float64 `json:"salt" required:"false" nullable:"true" minimum:"0"`
	Note            string   `json:"note" required:"false" maxLength:"500"`
	ClientUpdatedAt string   `json:"client_updated_at" format:"date-time"`
}

// EntryDoc is an entry as the server stores and returns it.
type EntryDoc struct {
	ID string `json:"id" format:"uuid"`
	EntryBody
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	DeletedAt *string `json:"deleted_at" nullable:"true"`
	ServerSeq int64   `json:"server_seq"`
}

func entryFromBody(b EntryBody, id, userID string) domain.Entry {
	return domain.Entry{
		ID: id, UserID: userID, EatenOn: b.EatenOn, Meal: domain.Meal(b.Meal), FoodID: b.FoodID,
		Name: b.Name, Brand: b.Brand, Barcode: b.Barcode, Amount: b.Amount, Unit: domain.Unit(b.Unit), Grams: b.Grams,
		Snapshot: domain.Nutrients{
			Kcal: b.Kcal, Protein: b.Protein, Carbs: b.Carbs, Fat: b.Fat,
			Sugar: b.Sugar, SatFat: b.SatFat, Fiber: b.Fiber, Salt: b.Salt,
		},
		Note: b.Note, ClientUpdatedAt: b.ClientUpdatedAt,
	}
}

// EntryToDoc converts a stored entry to its wire form.
func EntryToDoc(e domain.Entry) EntryDoc {
	return EntryDoc{
		ID: e.ID,
		EntryBody: EntryBody{
			EatenOn: e.EatenOn, Meal: string(e.Meal), FoodID: e.FoodID, Name: e.Name, Brand: e.Brand, Barcode: e.Barcode,
			Amount: e.Amount, Unit: string(e.Unit), Grams: e.Grams, Kcal: e.Snapshot.Kcal,
			Protein: e.Snapshot.Protein, Carbs: e.Snapshot.Carbs, Fat: e.Snapshot.Fat,
			Sugar: e.Snapshot.Sugar, SatFat: e.Snapshot.SatFat, Fiber: e.Snapshot.Fiber, Salt: e.Snapshot.Salt,
			Note: e.Note, ClientUpdatedAt: e.ClientUpdatedAt,
		},
		CreatedAt: e.CreatedAt, UpdatedAt: e.UpdatedAt, DeletedAt: e.DeletedAt, ServerSeq: e.ServerSeq,
	}
}

// DocToEntry converts a wire document back to a domain entry for the given user.
func DocToEntry(d EntryDoc, userID string) domain.Entry {
	e := entryFromBody(d.EntryBody, d.ID, userID)
	e.CreatedAt, e.UpdatedAt, e.DeletedAt, e.ServerSeq = d.CreatedAt, d.UpdatedAt, d.DeletedAt, d.ServerSeq
	return e
}

// SettingsBody is the editable settings object. A macro target of 0 means "not tracked".
type SettingsBody struct {
	GoalKcal     int64  `json:"goal_kcal" minimum:"500" maximum:"9000"`
	ProteinG     int64  `json:"protein_g" minimum:"0" maximum:"500"`
	CarbsG       int64  `json:"carbs_g" minimum:"0" maximum:"500"`
	FatG         int64  `json:"fat_g" minimum:"0" maximum:"500"`
	DayStartHour int64  `json:"day_start_hour" minimum:"0" maximum:"23"`
	Theme        string `json:"theme" enum:"auto,light,dark"`
}

// SettingsDoc is settings as stored.
type SettingsDoc struct {
	SettingsBody
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	ServerSeq int64  `json:"server_seq"`
}

func SettingsToDoc(s domain.Settings) SettingsDoc {
	return SettingsDoc{
		SettingsBody: SettingsBody{
			GoalKcal: s.GoalKcal, ProteinG: s.ProteinG, CarbsG: s.CarbsG, FatG: s.FatG,
			DayStartHour: s.DayStartHour, Theme: s.Theme,
		},
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, ServerSeq: s.ServerSeq,
	}
}

func settingsFromBody(b SettingsBody, userID string) domain.Settings {
	return domain.Settings{
		UserID: userID, GoalKcal: b.GoalKcal, ProteinG: b.ProteinG, CarbsG: b.CarbsG, FatG: b.FatG,
		DayStartHour: b.DayStartHour, Theme: b.Theme,
	}
}

// DefaultSettings is what a user sees before saving goals. It is not persisted.
func DefaultSettings(userID string) domain.Settings {
	return domain.Settings{UserID: userID, GoalKcal: 2000, Theme: "auto"}
}
