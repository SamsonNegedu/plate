package httpapi

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"
	"time"

	"github.com/danielgtaylor/huma/v2"

	"plate/internal/domain"
	"plate/internal/store"
	psync "plate/internal/sync"
)

const appVersion = "1.0.0"

var sessionSecurity = []map[string][]string{{"session": {}}}

// toAPIError maps domain errors to problems. Internals are logged, never returned.
func (d Deps) toAPIError(ctx context.Context, err error) error {
	var ve *domain.ValidationError
	switch {
	case errors.As(err, &ve):
		p := Err(http.StatusUnprocessableEntity, "validation_failed", "Some fields are invalid.")
		p.RequestID = RequestID(ctx)
		for _, f := range ve.Fields {
			p.Errors = append(p.Errors, Detail{Message: f.Message, Location: f.Field})
		}
		return p
	case errors.Is(err, psync.ErrBatchTooLarge):
		return Err(http.StatusUnprocessableEntity, "batch_too_large", "A push holds at most 100 ops.")
	case errors.Is(err, psync.ErrUnsupportedVersion):
		return Err(http.StatusUnprocessableEntity, "unsupported_version", "This backup was made by a newer version of Plate.")
	case errors.Is(err, domain.ErrTombstoned):
		return Err(http.StatusConflict, "tombstoned", "This entry was deleted. Create a new entry instead.")
	case errors.Is(err, domain.ErrConflict):
		return Err(http.StatusConflict, "conflict", "That ID is already in use.")
	case errors.Is(err, domain.ErrNotFound):
		return Err(http.StatusNotFound, "not_found", "Not found.")
	case errors.Is(err, domain.ErrInvalid):
		return Err(http.StatusUnprocessableEntity, "validation_failed", "The request is invalid.")
	}
	d.Log.ErrorContext(ctx, "request failed", slog.String("error", err.Error()), slog.String("request_id", RequestID(ctx)))
	return Err(http.StatusInternalServerError, "internal", "Something went wrong.")
}

// SettingsView is settings plus read-time fields.
type SettingsView struct {
	psync.SettingsBody
	UpdatedAt   string  `json:"updated_at"`
	ServerSeq   int64   `json:"server_seq"`
	LastLoginAt *string `json:"last_login_at" nullable:"true"`
	ServerDate  string  `json:"server_date" doc:"The server's current UTC date. The client never uses it to assign eaten_on."`
}

type settingsOut struct{ Body SettingsView }
type settingsIn struct{ Body psync.SettingsBody }

type entryPathIn struct {
	ID string `path:"id" format:"uuid"`
}

type entryPutIn struct {
	ID   string `path:"id" format:"uuid" doc:"Client-generated UUIDv7. This is the only create path."`
	Body psync.EntryBody
}

type entryOut struct{ Body psync.EntryDoc }

type GoalBody struct {
	Kcal     int64 `json:"kcal"`
	ProteinG int64 `json:"protein_g"`
	CarbsG   int64 `json:"carbs_g"`
	FatG     int64 `json:"fat_g"`
}

type TotalsBody struct {
	Kcal    float64  `json:"kcal" doc:"Rounded to a whole number after summing unrounded entries."`
	Protein *float64 `json:"protein" nullable:"true"`
	Carbs   *float64 `json:"carbs" nullable:"true"`
	Fat     *float64 `json:"fat" nullable:"true"`
	Count   int      `json:"count"`
}

type DayBody struct {
	Date    string           `json:"date"`
	Entries []psync.EntryDoc `json:"entries"`
	Totals  TotalsBody       `json:"totals"`
	Missing []string         `json:"missing" doc:"Macros that at least one entry did not report."`
	Goal    GoalBody         `json:"goal"`
}

type dayIn struct {
	Date string `path:"date" pattern:"^\\d{4}-\\d{2}-\\d{2}$"`
}

type dayOut struct{ Body DayBody }

type DaySummary struct {
	Date    string   `json:"date"`
	Kcal    float64  `json:"kcal"`
	Protein *float64 `json:"protein" nullable:"true"`
	Carbs   *float64 `json:"carbs" nullable:"true"`
	Fat     *float64 `json:"fat" nullable:"true"`
	Count   int      `json:"count"`
	Missing []string `json:"missing"`
}

type rangeIn struct {
	From string `query:"from" pattern:"^\\d{4}-\\d{2}-\\d{2}$"`
	To   string `query:"to" pattern:"^\\d{4}-\\d{2}-\\d{2}$"`
}

type rangeOut struct {
	Body struct {
		From string       `json:"from"`
		To   string       `json:"to"`
		Days []DaySummary `json:"days" doc:"Every date in the range, including days with no entries."`
		Goal GoalBody     `json:"goal"`
	}
}

type exportOut struct {
	ContentDisposition string `header:"Content-Disposition"`
	Body               psync.ExportDoc
}

type importIn struct {
	Mode    string `query:"mode" enum:"replace" required:"true" doc:"Replace is destructive: rows missing from the backup are tombstoned."`
	RawBody []byte
}

type importOut struct {
	Body struct {
		Entries    int `json:"entries"`
		Foods      int `json:"foods"`
		SavedMeals int `json:"saved_meals"`
		Favorites  int `json:"favorites"`
		Removed    int `json:"removed"`
	}
}

const maxRangeDays = 366

func (d Deps) registerCore(api huma.API, sv *psync.Service) {
	repo := store.NewRepo(d.DB)

	settingsView := func(ctx context.Context, userID string) (SettingsView, error) {
		s, err := repo.Settings(ctx, userID)
		if errors.Is(err, domain.ErrNotFound) {
			s = psync.DefaultSettings(userID)
		} else if err != nil {
			return SettingsView{}, err
		}
		doc := psync.SettingsToDoc(s)
		v := SettingsView{SettingsBody: doc.SettingsBody, UpdatedAt: doc.UpdatedAt, ServerSeq: doc.ServerSeq, ServerDate: sv.Now().UTC().Format("2006-01-02")}
		if u, err := repo.UserByID(ctx, userID); err == nil {
			v.LastLoginAt = u.LastLoginAt
		}
		return v, nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "get-settings", Method: http.MethodGet, Path: "/settings", Tags: []string{"settings"},
		Summary: "Goals, display settings, last login and the server date", Security: sessionSecurity,
	}, func(ctx context.Context, _ *struct{}) (*settingsOut, error) {
		v, err := settingsView(ctx, UserID(ctx))
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &settingsOut{Body: v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "put-settings", Method: http.MethodPut, Path: "/settings", Tags: []string{"settings"},
		Summary: "Replace settings", Security: sessionSecurity,
	}, func(ctx context.Context, in *settingsIn) (*settingsOut, error) {
		if _, err := sv.PutSettings(ctx, UserID(ctx), in.Body); err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		v, err := settingsView(ctx, UserID(ctx))
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &settingsOut{Body: v}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "put-entry", Method: http.MethodPut, Path: "/entries/{id}", Tags: []string{"entries"},
		Summary: "Create or update an entry (idempotent by client ID)", Security: sessionSecurity,
		Errors: []int{http.StatusConflict, http.StatusUnprocessableEntity},
	}, func(ctx context.Context, in *entryPutIn) (*entryOut, error) {
		doc, err := sv.PutEntry(ctx, UserID(ctx), in.ID, in.Body)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &entryOut{Body: doc}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-entry", Method: http.MethodDelete, Path: "/entries/{id}", Tags: []string{"entries"},
		Summary: "Tombstone an entry (idempotent)", Security: sessionSecurity, DefaultStatus: http.StatusNoContent,
		Errors: []int{http.StatusNotFound},
	}, func(ctx context.Context, in *entryPathIn) (*struct{}, error) {
		if err := sv.DeleteEntry(ctx, UserID(ctx), in.ID); err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-entry", Method: http.MethodGet, Path: "/entries/{id}", Tags: []string{"entries"},
		Summary: "One entry, including a tombstone", Security: sessionSecurity, Errors: []int{http.StatusNotFound},
	}, func(ctx context.Context, in *entryPathIn) (*entryOut, error) {
		e, err := repo.Entry(ctx, UserID(ctx), in.ID)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		return &entryOut{Body: psync.EntryToDoc(e)}, nil
	})

	goalFor := func(ctx context.Context, userID string) (GoalBody, error) {
		s, err := repo.Settings(ctx, userID)
		if errors.Is(err, domain.ErrNotFound) {
			s = psync.DefaultSettings(userID)
		} else if err != nil {
			return GoalBody{}, err
		}
		return GoalBody{Kcal: s.GoalKcal, ProteinG: s.ProteinG, CarbsG: s.CarbsG, FatG: s.FatG}, nil
	}

	huma.Register(api, huma.Operation{
		OperationID: "get-day", Method: http.MethodGet, Path: "/days/{date}", Tags: []string{"days"},
		Summary: "Entries and totals for one local date", Security: sessionSecurity,
		Errors: []int{http.StatusUnprocessableEntity},
	}, func(ctx context.Context, in *dayIn) (*dayOut, error) {
		if _, err := domain.ParseDay(in.Date); err != nil {
			return nil, d.toAPIError(ctx, &domain.ValidationError{Fields: []domain.FieldError{{Field: "date", Message: "must be a real date"}}})
		}
		entries, err := repo.EntriesForDay(ctx, UserID(ctx), in.Date)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		goal, err := goalFor(ctx, UserID(ctx))
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		t := domain.SumEntries(entries)
		docs := make([]psync.EntryDoc, 0, len(entries))
		for _, e := range entries {
			docs = append(docs, psync.EntryToDoc(e))
		}
		return &dayOut{Body: DayBody{
			Date: in.Date, Entries: docs, Missing: t.Missing, Goal: goal,
			Totals: TotalsBody{Kcal: t.Kcal, Protein: t.Protein, Carbs: t.Carbs, Fat: t.Fat, Count: t.Count},
		}}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-days", Method: http.MethodGet, Path: "/days", Tags: []string{"days"},
		Summary: "Per-day totals for a date range (at most 366 days)", Security: sessionSecurity,
		Errors: []int{http.StatusUnprocessableEntity},
	}, func(ctx context.Context, in *rangeIn) (*rangeOut, error) {
		from, err1 := domain.ParseDay(in.From)
		to, err2 := domain.ParseDay(in.To)
		var fields []domain.FieldError
		if err1 != nil {
			fields = append(fields, domain.FieldError{Field: "from", Message: "must be a real date"})
		}
		if err2 != nil {
			fields = append(fields, domain.FieldError{Field: "to", Message: "must be a real date"})
		}
		if len(fields) == 0 {
			switch {
			case to.Before(from):
				fields = append(fields, domain.FieldError{Field: "to", Message: "must not be before from"})
			case int(to.Sub(from).Hours()/24)+1 > maxRangeDays:
				fields = append(fields, domain.FieldError{Field: "to", Message: fmt.Sprintf("range is limited to %d days", maxRangeDays)})
			}
		}
		if len(fields) > 0 {
			return nil, d.toAPIError(ctx, &domain.ValidationError{Fields: fields})
		}
		entries, err := repo.EntriesInRange(ctx, UserID(ctx), in.From, in.To)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		goal, err := goalFor(ctx, UserID(ctx))
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		byDay := map[string][]domain.Entry{}
		for _, e := range entries {
			byDay[e.EatenOn] = append(byDay[e.EatenOn], e)
		}
		out := &rangeOut{}
		out.Body.From, out.Body.To, out.Body.Goal = in.From, in.To, goal
		out.Body.Days = []DaySummary{}
		for day := from; !day.After(to); day = day.AddDate(0, 0, 1) {
			key := day.Format("2006-01-02")
			t := domain.SumEntries(byDay[key])
			out.Body.Days = append(out.Body.Days, DaySummary{
				Date: key, Kcal: t.Kcal, Protein: t.Protein, Carbs: t.Carbs, Fat: t.Fat, Count: t.Count, Missing: t.Missing,
			})
		}
		return out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "export", Method: http.MethodGet, Path: "/export", Tags: []string{"backup"},
		Summary: "Full JSON backup", Security: sessionSecurity,
	}, func(ctx context.Context, _ *struct{}) (*exportOut, error) {
		doc, err := sv.Export(ctx, UserID(ctx), appVersion)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		name := "plate-export-" + time.Now().UTC().Format("2006-01-02") + ".json"
		return &exportOut{ContentDisposition: `attachment; filename="` + name + `"`, Body: doc}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "import", Method: http.MethodPost, Path: "/import", Tags: []string{"backup"},
		Summary:      "Restore a backup, replacing current data",
		Description:  "The whole document is validated before anything is written. A snapshot of the database is taken first. Rows the backup lacks are tombstoned.",
		Security:     sessionSecurity,
		MaxBodyBytes: psync.MaxImportBytes,
		RequestBody: &huma.RequestBody{Required: true, Content: map[string]*huma.MediaType{
			"application/json": {Schema: &huma.Schema{Type: "object", Description: "An export document."}},
		}},
		Errors: []int{http.StatusUnprocessableEntity},
	}, func(ctx context.Context, in *importIn) (*importOut, error) {
		userID := UserID(ctx)
		doc, err := sv.ParseBackup(ctx, in.RawBody)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		if err := store.Snapshot(ctx, d.DB, filepath.Join(d.Config.DataDir, "snapshots"), "pre-import"); err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		res, err := sv.Restore(ctx, userID, doc)
		if err != nil {
			return nil, d.toAPIError(ctx, err)
		}
		d.Log.WarnContext(ctx, "backup restored", slog.Int("entries", res.Entries), slog.Int("removed", res.Removed),
			slog.String("request_id", RequestID(ctx)))
		out := &importOut{}
		out.Body.Entries, out.Body.Foods, out.Body.SavedMeals = res.Entries, res.Foods, res.SavedMeals
		out.Body.Favorites, out.Body.Removed = res.Favorites, res.Removed
		return out, nil
	})
}
