package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"plate/internal/domain"
	"plate/internal/store"
)

// ErrUnsupportedVersion is returned for an export from a newer build than this one understands.
var ErrUnsupportedVersion = errors.New("unsupported backup version")

const (
	// MaxImportBytes caps the import body; the importer reads it fully before writing anything.
	MaxImportBytes = 32 << 20
	maxImportRows  = 500000
)

// Export builds the JSON backup: live entries, tombstone ids, referenced and custom foods, saved meals, favorites.
func (s *Service) Export(ctx context.Context, userID, appVersion string) (ExportDoc, error) {
	schema, err := store.SchemaVersion(ctx, s.db)
	if err != nil {
		return ExportDoc{}, err
	}
	r := store.NewRepo(s.db)
	doc := ExportDoc{
		FormatVersion: FormatVersion, SchemaVersion: schema, ExportedAt: stamp(s.now()), AppVersion: appVersion,
		Entries: []EntryDoc{}, DeletedEntries: []TombstoneDoc{}, Foods: []FoodDoc{}, SavedMeals: []SavedMealDoc{},
		Favorites: []FavoriteDoc{}, HealthRecords: []HealthRecordDoc{},
	}
	doc.Attribution = s.attribution
	if st, err := r.Settings(ctx, userID); err == nil {
		d := SettingsToDoc(st)
		doc.Settings = &d
	} else if !errors.Is(err, domain.ErrNotFound) {
		return ExportDoc{}, err
	}

	entries, err := r.AllEntries(ctx, userID)
	if err != nil {
		return ExportDoc{}, err
	}
	need := map[string]bool{}
	for _, e := range entries {
		if e.DeletedAt != nil {
			doc.DeletedEntries = append(doc.DeletedEntries, TombstoneDoc{ID: e.ID, DeletedAt: *e.DeletedAt})
			continue
		}
		doc.Entries = append(doc.Entries, EntryToDoc(e))
		if e.FoodID != nil {
			need[*e.FoodID] = true
		}
	}

	meals, err := r.AllSavedMeals(ctx, userID)
	if err != nil {
		return ExportDoc{}, err
	}
	for _, m := range meals {
		doc.SavedMeals = append(doc.SavedMeals, MealToDoc(m))
		for _, it := range m.Items {
			if it.FoodID != nil {
				need[*it.FoodID] = true
			}
		}
	}
	favs, err := r.AllFavorites(ctx, userID)
	if err != nil {
		return ExportDoc{}, err
	}
	for _, f := range favs {
		doc.Favorites = append(doc.Favorites, FavoriteToDoc(f))
		need[f.FoodID] = true
	}

	health, err := r.AllHealthRecords(ctx, userID)
	if err != nil {
		return ExportDoc{}, err
	}
	for _, h := range health {
		if h.DeletedAt == nil {
			doc.HealthRecords = append(doc.HealthRecords, HealthToDoc(h))
		}
	}

	custom, err := r.UserFoods(ctx, userID)
	if err != nil {
		return ExportDoc{}, err
	}
	for _, f := range custom {
		need[f.ID] = true
	}
	ids := make([]string, 0, len(need))
	for id := range need {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for start := 0; start < len(ids); start += 500 {
		foods, err := r.FoodsByIDs(ctx, userID, ids[start:min(start+500, len(ids))])
		if err != nil {
			return ExportDoc{}, err
		}
		for _, f := range foods {
			doc.Foods = append(doc.Foods, FoodToDoc(f))
		}
	}
	return doc, nil
}

// ParseBackup decodes and fully validates a backup without touching the database.
func (s *Service) ParseBackup(ctx context.Context, raw []byte) (ExportDoc, error) {
	var head struct {
		FormatVersion int   `json:"format_version"`
		SchemaVersion int64 `json:"schema_version"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return ExportDoc{}, bad("document", "is not valid JSON")
	}
	if head.FormatVersion < 1 {
		return ExportDoc{}, bad("format_version", "is missing or below 1")
	}
	if head.FormatVersion > FormatVersion {
		return ExportDoc{}, fmt.Errorf("format_version %d is newer than %d: %w", head.FormatVersion, FormatVersion, ErrUnsupportedVersion)
	}
	current, err := store.SchemaVersion(ctx, s.db)
	if err != nil {
		return ExportDoc{}, err
	}
	if head.SchemaVersion < 1 || head.SchemaVersion > current {
		return ExportDoc{}, fmt.Errorf("schema_version %d is not supported by schema %d: %w", head.SchemaVersion, current, ErrUnsupportedVersion)
	}

	var doc ExportDoc
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return ExportDoc{}, bad("document", err.Error())
	}
	return doc, s.validateBackup(doc)
}

func bad(field, msg string) error {
	return &domain.ValidationError{Fields: []domain.FieldError{{Field: field, Message: msg}}}
}

func (s *Service) validateBackup(doc ExportDoc) error {
	if len(doc.Entries)+len(doc.Foods)+len(doc.SavedMeals)+len(doc.Favorites)+len(doc.DeletedEntries)+len(doc.HealthRecords) > maxImportRows {
		return bad("document", "has too many rows")
	}
	var fields []domain.FieldError
	add := func(f, m string) {
		if len(fields) < 20 {
			fields = append(fields, domain.FieldError{Field: f, Message: m})
		}
	}
	foodIDs := map[string]bool{}
	for i, f := range doc.Foods {
		fd := DocToFood(f, "")
		if !fd.Source.Valid() || fd.Name == "" || f.Kcal < 0 || len(f.ID) != 36 {
			add(fmt.Sprintf("foods[%d]", i), "is not a valid food")
		}
		if foodIDs[f.ID] {
			add(fmt.Sprintf("foods[%d]", i), "duplicate id")
		}
		foodIDs[f.ID] = true
	}
	seen := map[string]bool{}
	for i, d := range doc.Entries {
		e := DocToEntry(d, "")
		if err := domain.ValidateEntry(e, s.now().AddDate(10, 0, 0)); err != nil {
			add(fmt.Sprintf("entries[%d]", i), err.Error())
		}
		if seen[d.ID] {
			add(fmt.Sprintf("entries[%d]", i), "duplicate id")
		}
		seen[d.ID] = true
		if d.FoodID != nil && !foodIDs[*d.FoodID] {
			add(fmt.Sprintf("entries[%d].food_id", i), "refers to a food that is not in the backup")
		}
	}
	for i, m := range doc.SavedMeals {
		if m.Name == "" {
			add(fmt.Sprintf("saved_meals[%d]", i), "needs a name")
		}
		if m.Servings < 0 || m.Servings > domain.MaxServings {
			add(fmt.Sprintf("saved_meals[%d].servings", i), "must be above 0 and at most 1000")
		}
		for j, it := range m.Items {
			if !domain.Unit(it.Unit).Valid() || it.Grams <= 0 || it.Amount <= 0 || it.Kcal < 0 {
				add(fmt.Sprintf("saved_meals[%d].items[%d]", i, j), "is not a valid item")
			}
			if it.FoodID != nil && !foodIDs[*it.FoodID] {
				add(fmt.Sprintf("saved_meals[%d].items[%d].food_id", i, j), "refers to a food that is not in the backup")
			}
		}
	}
	for i, f := range doc.Favorites {
		if !foodIDs[f.FoodID] {
			add(fmt.Sprintf("favorites[%d].food_id", i), "refers to a food that is not in the backup")
		}
	}
	healthSeen := map[string]bool{}
	for i, d := range doc.HealthRecords {
		if err := domain.ValidateHealthRecord(DocToHealth(d, ""), s.now().AddDate(10, 0, 0)); err != nil {
			add(fmt.Sprintf("health_records[%d]", i), err.Error())
		}
		if healthSeen[d.ID] {
			add(fmt.Sprintf("health_records[%d]", i), "duplicate id")
		}
		healthSeen[d.ID] = true
	}
	if doc.Settings != nil {
		if err := domain.ValidateSettings(settingsFromBody(doc.Settings.SettingsBody, "")); err != nil {
			add("settings", err.Error())
		}
	}
	if len(fields) > 0 {
		return &domain.ValidationError{Fields: fields}
	}
	return nil
}

// ImportResult counts what a restore wrote.
type ImportResult struct {
	Entries       int
	Foods         int
	SavedMeals    int
	Favorites     int
	HealthRecords int
	Removed       int
}

// Restore replaces the user's data with the backup in one transaction. Rows the backup does not contain are
// tombstoned, not deleted, so other devices learn about the removal through the normal change stream.
// The caller must have validated doc with ParseBackup and taken a pre-import snapshot.
func (s *Service) Restore(ctx context.Context, userID string, doc ExportDoc) (ImportResult, error) {
	var res ImportResult
	now := s.now()
	err := store.InTx(ctx, s.db, func(r *store.Repo) error {
		res = ImportResult{}
		if doc.Settings != nil {
			in := settingsFromBody(doc.Settings.SettingsBody, userID)
			if _, err := ApplySettings(ctx, r, userID, in, now); err != nil {
				return err
			}
		}
		foodIDs, err := restoreFoods(ctx, r, userID, doc.Foods, now, &res)
		if err != nil {
			return err
		}
		if err := restoreEntries(ctx, r, userID, doc, foodIDs, now, &res); err != nil {
			return err
		}
		if err := restoreMeals(ctx, r, userID, doc.SavedMeals, foodIDs, now, &res); err != nil {
			return err
		}
		if err := restoreFavorites(ctx, r, userID, doc.Favorites, foodIDs, now, &res); err != nil {
			return err
		}
		return restoreHealth(ctx, r, userID, doc.HealthRecords, now, &res)
	})
	return res, err
}
