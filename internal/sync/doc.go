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
	FiberG       int64  `json:"fiber_g" required:"false" minimum:"0" maximum:"200" doc:"Fibre target in grams. 0 or absent means not tracked."`
	DayStartHour int64  `json:"day_start_hour" minimum:"0" maximum:"23"`
	Theme        string `json:"theme" enum:"auto,light,dark"`
	// The weight goal and the medication plan are optional; null means not set.
	WeightGoalKg    *float64 `json:"weight_goal_kg" required:"false" nullable:"true" minimum:"20" maximum:"500"`
	MedName         *string  `json:"med_name" required:"false" nullable:"true" minLength:"1" maxLength:"100" doc:"The medication being tracked."`
	MedIntervalDays *int64   `json:"med_interval_days" required:"false" nullable:"true" minimum:"1" maximum:"90" doc:"Days between doses."`
	MedStartedOn    *string  `json:"med_started_on" required:"false" nullable:"true" pattern:"^\\d{4}-\\d{2}-\\d{2}$"`
	MedSupplyDoses  *int64   `json:"med_supply_doses" required:"false" nullable:"true" minimum:"0" maximum:"1000" doc:"Doses on hand as of med_supply_as_of."`
	MedSupplyAsOf   *string  `json:"med_supply_as_of" required:"false" nullable:"true" format:"date-time"`
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
			GoalKcal: s.GoalKcal, ProteinG: s.ProteinG, CarbsG: s.CarbsG, FatG: s.FatG, FiberG: s.FiberG,
			DayStartHour: s.DayStartHour, Theme: s.Theme, WeightGoalKg: s.WeightGoalKg, MedName: s.MedName,
			MedIntervalDays: s.MedIntervalDays, MedStartedOn: s.MedStartedOn, MedSupplyDoses: s.MedSupplyDoses,
			MedSupplyAsOf: s.MedSupplyAsOf,
		},
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt, ServerSeq: s.ServerSeq,
	}
}

func settingsFromBody(b SettingsBody, userID string) domain.Settings {
	return domain.Settings{
		UserID: userID, GoalKcal: b.GoalKcal, ProteinG: b.ProteinG, CarbsG: b.CarbsG, FatG: b.FatG, FiberG: b.FiberG,
		DayStartHour: b.DayStartHour, Theme: b.Theme, WeightGoalKg: b.WeightGoalKg, MedName: b.MedName,
		MedIntervalDays: b.MedIntervalDays, MedStartedOn: b.MedStartedOn, MedSupplyDoses: b.MedSupplyDoses,
		MedSupplyAsOf: b.MedSupplyAsOf,
	}
}

// DefaultSettings is what a user sees before saving goals. It is not persisted.
func DefaultSettings(userID string) domain.Settings {
	return domain.Settings{UserID: userID, GoalKcal: 2000, Theme: "auto"}
}

// HealthRecordBody is one logged number: a weight in kg, a body measurement in cm, an appetite or nausea rating from 0 to 5, or a dose in mg.
type HealthRecordBody struct {
	Kind       string  `json:"kind" enum:"weight,waist,hips,chest,arm,thigh,neck,appetite,nausea,dose"`
	RecordedOn string  `json:"recorded_on" pattern:"^\\d{4}-\\d{2}-\\d{2}$" doc:"Local calendar date the client assigned."`
	RecordedAt string  `json:"recorded_at" format:"date-time"`
	Value      float64 `json:"value" doc:"kg, cm, a 0 to 5 rating, or mg, by kind."`
	Medication string  `json:"medication" required:"false" maxLength:"100" doc:"Required for a dose, empty otherwise."`
	Site       string  `json:"site" required:"false" maxLength:"60"`
	Note       string  `json:"note" required:"false" maxLength:"500"`
}

// HealthRecordDoc is a health record as stored.
type HealthRecordDoc struct {
	ID string `json:"id" format:"uuid"`
	HealthRecordBody
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
	DeletedAt *string `json:"deleted_at" nullable:"true"`
	ServerSeq int64   `json:"server_seq"`
}

func healthFromBody(b HealthRecordBody, id, userID string) domain.HealthRecord {
	return domain.HealthRecord{
		ID: id, UserID: userID, Kind: domain.HealthKind(b.Kind), RecordedOn: b.RecordedOn, RecordedAt: b.RecordedAt,
		Value: b.Value, Medication: trim(b.Medication), Site: trim(b.Site), Note: b.Note,
	}
}

func HealthToDoc(h domain.HealthRecord) HealthRecordDoc {
	return HealthRecordDoc{
		ID: h.ID,
		HealthRecordBody: HealthRecordBody{
			Kind: string(h.Kind), RecordedOn: h.RecordedOn, RecordedAt: h.RecordedAt, Value: h.Value,
			Medication: h.Medication, Site: h.Site, Note: h.Note,
		},
		CreatedAt: h.CreatedAt, UpdatedAt: h.UpdatedAt, DeletedAt: h.DeletedAt, ServerSeq: h.ServerSeq,
	}
}

func DocToHealth(d HealthRecordDoc, userID string) domain.HealthRecord {
	h := healthFromBody(d.HealthRecordBody, d.ID, userID)
	h.CreatedAt, h.UpdatedAt, h.DeletedAt, h.ServerSeq = d.CreatedAt, d.UpdatedAt, d.DeletedAt, d.ServerSeq
	return h
}
