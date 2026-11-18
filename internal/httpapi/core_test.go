package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func newID() string { return uuid.Must(uuid.NewV7()).String() }

func entryJSON(mods map[string]any) string {
	m := map[string]any{
		"eaten_on": "2026-11-13", "meal": "lunch", "name": "Oats", "amount": 40, "unit": "g", "grams": 40,
		"kcal": 370, "protein": 13, "client_updated_at": "2026-11-13T08:00:00Z",
	}
	for k, v := range mods {
		if v == nil {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	b, _ := json.Marshal(m)
	return string(b)
}

func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decoding %q: %v", rec.Body.String(), err)
	}
	return v
}

type problem struct {
	Code      string `json:"code"`
	RequestID string `json:"request_id"`
	Errors    []struct {
		Message  string `json:"message"`
		Location string `json:"location"`
	} `json:"errors"`
}

func TestEveryCoreRouteRequiresAuth(t *testing.T) {
	e := newEnv(t, opts{})
	id := newID()
	routes := []struct{ method, path, body string }{
		{"GET", "/settings", ""}, {"PUT", "/settings", `{}`}, {"PUT", "/entries/" + id, entryJSON(nil)},
		{"GET", "/entries/" + id, ""}, {"DELETE", "/entries/" + id, ""}, {"GET", "/days/2026-11-13", ""},
		{"GET", "/days?from=2026-11-01&to=2026-11-13", ""}, {"GET", "/export", ""}, {"POST", "/import?mode=replace", `{}`},
	}
	for _, r := range routes {
		rec := e.do(r.method, "/api/v1"+r.path, r.body)
		if rec.Code != 401 {
			t.Errorf("%s %s = %d, want 401", r.method, r.path, rec.Code)
		}
	}
}

func TestPutEntryIsIdempotentAndReturnsServerFields(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	a := e.do("PUT", "/api/v1/entries/"+id, entryJSON(nil), cookie(c))
	b := e.do("PUT", "/api/v1/entries/"+id, entryJSON(nil), cookie(c))
	if a.Code != 200 || b.Code != 200 {
		t.Fatalf("codes %d %d: %s", a.Code, b.Code, b.Body)
	}
	da, db := decode[map[string]any](t, a), decode[map[string]any](t, b)
	if da["created_at"] != db["created_at"] || da["server_seq"] == db["server_seq"] || da["id"] != id {
		t.Fatalf("a=%v b=%v", da, db)
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("rows = %d", n)
	}
	if strings.Contains(a.Body.String(), `"user_id"`) {
		t.Fatal("user_id must not leak into responses")
	}
}

func TestPutEntryValidation(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	cases := map[string]struct {
		id    string
		body  string
		field string
	}{
		"grams mismatch for g": {newID(), entryJSON(map[string]any{"grams": 41}), "grams"},
		"non-UUID id":          {"not-a-uuid", entryJSON(nil), ""},
		"bad meal":             {newID(), entryJSON(map[string]any{"meal": "brunch"}), ""},
		"impossible date":      {newID(), entryJSON(map[string]any{"eaten_on": "2026-02-30"}), "eaten_on"},
		"far future":           {newID(), entryJSON(map[string]any{"eaten_on": "2099-01-01"}), "eaten_on"},
		"negative kcal":        {newID(), entryJSON(map[string]any{"kcal": -1}), ""},
		"unknown field":        {newID(), entryJSON(map[string]any{"surprise": 1}), ""},
		"missing kcal":         {newID(), entryJSON(map[string]any{"kcal": nil}), ""},
		"note too long":        {newID(), entryJSON(map[string]any{"note": strings.Repeat("a", 501)}), ""},
		"unknown food":         {newID(), entryJSON(map[string]any{"food_id": newID()}), "food_id"},
	}
	for name, tc := range cases {
		rec := e.do("PUT", "/api/v1/entries/"+tc.id, tc.body, cookie(c))
		if rec.Code != 422 {
			t.Errorf("%s: code = %d %s", name, rec.Code, rec.Body)
			continue
		}
		p := decode[problem](t, rec)
		if p.Code != "validation_failed" || p.RequestID == "" || len(p.Errors) == 0 {
			t.Errorf("%s: problem = %+v", name, p)
		}
		if tc.field != "" {
			found := false
			for _, er := range p.Errors {
				if er.Location == tc.field {
					found = true
				}
			}
			if !found {
				t.Errorf("%s: no error located at %q: %+v", name, tc.field, p.Errors)
			}
		}
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 0 {
		t.Fatalf("rows = %d after only invalid requests", n)
	}
}

func TestDeleteTombstonesAndTombstonedEntryIs409(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	e.do("PUT", "/api/v1/entries/"+id, entryJSON(nil), cookie(c))
	for i := range 2 {
		if rec := e.do("DELETE", "/api/v1/entries/"+id, "", cookie(c)); rec.Code != 204 {
			t.Fatalf("delete #%d = %d %s", i+1, rec.Code, rec.Body)
		}
	}
	rec := e.do("PUT", "/api/v1/entries/"+id, entryJSON(nil), cookie(c))
	if rec.Code != 409 || decode[problem](t, rec).Code != "tombstoned" {
		t.Fatalf("update after delete = %d %s", rec.Code, rec.Body)
	}
	got := e.do("GET", "/api/v1/entries/"+id, "", cookie(c))
	if got.Code != 200 || !strings.Contains(got.Body.String(), `"deleted_at":"2`) {
		t.Fatalf("GET tombstone = %d %s", got.Code, got.Body)
	}
	if rec := e.do("DELETE", "/api/v1/entries/"+newID(), "", cookie(c)); rec.Code != 404 {
		t.Fatalf("unknown id delete = %d", rec.Code)
	}
	day := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	if !strings.Contains(day.Body.String(), `"count":0`) {
		t.Fatalf("a tombstoned entry must not appear in the day: %s", day.Body)
	}
}

func TestDayTotalsMatchHandCalculation(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	put := func(mods map[string]any) {
		if rec := e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(mods), cookie(c)); rec.Code != 200 {
			t.Fatalf("put %v = %d %s", mods, rec.Code, rec.Body)
		}
	}
	// 40 g oats at 370 kcal/100 g = 148 kcal, 5.2 g protein
	put(map[string]any{"carbs": 60, "fat": 7})
	// 250 ml of a drink at 42 kcal/100 ml = 105 kcal; no macros reported
	put(map[string]any{"name": "Drink", "amount": 250, "unit": "ml", "grams": 250, "kcal": 42, "protein": nil, "meal": "snack"})
	// a 0 kcal entry still counts
	put(map[string]any{"name": "Water", "amount": 300, "unit": "ml", "grams": 300, "kcal": 0, "protein": 0, "carbs": 0, "fat": 0})
	// a different day must not leak in
	put(map[string]any{"eaten_on": "2026-11-12"})

	rec := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	var day struct {
		Totals struct {
			Kcal    float64  `json:"kcal"`
			Protein *float64 `json:"protein"`
			Carbs   *float64 `json:"carbs"`
			Fat     *float64 `json:"fat"`
			Count   int      `json:"count"`
		} `json:"totals"`
		Missing []string `json:"missing"`
		Entries []any    `json:"entries"`
		Goal    struct {
			Kcal int `json:"kcal"`
		} `json:"goal"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &day)
	if day.Totals.Kcal != 253 || day.Totals.Count != 3 || len(day.Entries) != 3 {
		t.Fatalf("totals = %+v", day.Totals)
	}
	if day.Totals.Protein == nil || *day.Totals.Protein != 5.2 {
		t.Fatalf("protein = %v, want 5.2", day.Totals.Protein)
	}
	if day.Totals.Carbs == nil || *day.Totals.Carbs != 24 || day.Totals.Fat == nil || *day.Totals.Fat != 2.8 {
		t.Fatalf("carbs %v fat %v", day.Totals.Carbs, day.Totals.Fat)
	}
	if len(day.Missing) != 3 || day.Goal.Kcal != 2000 {
		t.Fatalf("missing = %v goal = %+v", day.Missing, day.Goal)
	}
}

func TestMissingMacrosAreNullNotZero(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(map[string]any{"protein": nil}), cookie(c))
	rec := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	if !strings.Contains(rec.Body.String(), `"protein":null`) || !strings.Contains(rec.Body.String(), `"missing":["protein","carbs","fat"]`) {
		t.Fatalf("body = %s", rec.Body)
	}
	empty := e.do("GET", "/api/v1/days/2020-01-01", "", cookie(c))
	if !strings.Contains(empty.Body.String(), `"entries":[]`) || !strings.Contains(empty.Body.String(), `"kcal":0`) {
		t.Fatalf("an empty day = %s", empty.Body)
	}
}

func TestDayRange(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(map[string]any{"eaten_on": "2026-11-11"}), cookie(c))
	rec := e.do("GET", "/api/v1/days?from=2026-11-10&to=2026-11-13", "", cookie(c))
	var out struct {
		Days []struct {
			Date  string  `json:"date"`
			Kcal  float64 `json:"kcal"`
			Count int     `json:"count"`
		} `json:"days"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Days) != 4 || out.Days[0].Date != "2026-11-10" || out.Days[1].Count != 1 || out.Days[2].Count != 0 {
		t.Fatalf("range = %d %+v", rec.Code, out)
	}

	bad := map[string]string{
		"reversed":        "from=2026-11-13&to=2026-11-10",
		"too long":        "from=2025-01-01&to=2026-11-13",
		"impossible date": "from=2026-02-30&to=2026-03-02",
		"missing to":      "from=2026-11-01",
	}
	for name, q := range bad {
		if rec := e.do("GET", "/api/v1/days?"+q, "", cookie(c)); rec.Code != 422 {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	over := e.do("GET", "/api/v1/days?from=2025-11-12&to=2026-11-13", "", cookie(c))
	if over.Code != 422 {
		t.Fatalf("367 days = %d", over.Code)
	}
	limit := e.do("GET", "/api/v1/days?from=2025-11-13&to=2026-11-13", "", cookie(c))
	if limit.Code != 200 {
		t.Fatalf("366 days = %d %s", limit.Code, limit.Body)
	}
}

func TestDayRangeAcrossDSTHasNoDuplicateOrMissingDate(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	for _, span := range [][2]string{{"2026-03-27", "2026-03-30"}, {"2026-10-24", "2026-10-27"}} {
		rec := e.do("GET", fmt.Sprintf("/api/v1/days?from=%s&to=%s", span[0], span[1]), "", cookie(c))
		var out struct {
			Days []struct {
				Date string `json:"date"`
			} `json:"days"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &out)
		if len(out.Days) != 4 {
			t.Fatalf("%v: %d days (%s)", span, len(out.Days), rec.Body)
		}
		seen := map[string]bool{}
		for _, d := range out.Days {
			if seen[d.Date] {
				t.Fatalf("duplicate %s", d.Date)
			}
			seen[d.Date] = true
		}
	}
}

func TestSettings(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	def := e.do("GET", "/api/v1/settings", "", cookie(c))
	var s map[string]any
	_ = json.Unmarshal(def.Body.Bytes(), &s)
	if def.Code != 200 || s["goal_kcal"] != float64(2000) || s["theme"] != "auto" || s["server_date"] == "" || s["last_login_at"] == nil {
		t.Fatalf("defaults = %d %s", def.Code, def.Body)
	}
	put := e.do("PUT", "/api/v1/settings", `{"goal_kcal":2300,"protein_g":150,"carbs_g":0,"fat_g":70,"day_start_hour":4,"theme":"dark"}`, cookie(c))
	if put.Code != 200 || !strings.Contains(put.Body.String(), `"goal_kcal":2300`) || !strings.Contains(put.Body.String(), `"day_start_hour":4`) {
		t.Fatalf("put = %d %s", put.Code, put.Body)
	}
	for name, body := range map[string]string{
		"goal low": `{"goal_kcal":499,"protein_g":0,"carbs_g":0,"fat_g":0,"day_start_hour":0,"theme":"auto"}`,
		"macro":    `{"goal_kcal":2000,"protein_g":501,"carbs_g":0,"fat_g":0,"day_start_hour":0,"theme":"auto"}`,
		"hour":     `{"goal_kcal":2000,"protein_g":0,"carbs_g":0,"fat_g":0,"day_start_hour":24,"theme":"auto"}`,
		"theme":    `{"goal_kcal":2000,"protein_g":0,"carbs_g":0,"fat_g":0,"day_start_hour":0,"theme":"blue"}`,
		"unknown":  `{"goal_kcal":2000,"protein_g":0,"carbs_g":0,"fat_g":0,"day_start_hour":0,"theme":"auto","x":1}`,
	} {
		if rec := e.do("PUT", "/api/v1/settings", body, cookie(c)); rec.Code != 422 {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	day := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	if !strings.Contains(day.Body.String(), `"goal":{"kcal":2300,"protein_g":150,"carbs_g":0,"fat_g":70}`) {
		t.Fatalf("goal at read time = %s", day.Body)
	}
}

func TestExportThenImportViaHTTP(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("PUT", "/api/v1/settings", `{"goal_kcal":2300,"protein_g":0,"carbs_g":0,"fat_g":0,"day_start_hour":0,"theme":"auto"}`, cookie(c))
	keep, gone := newID(), newID()
	e.do("PUT", "/api/v1/entries/"+keep, entryJSON(nil), cookie(c))
	exp := e.do("GET", "/api/v1/export", "", cookie(c))
	if exp.Code != 200 || !strings.Contains(exp.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("export = %d %v", exp.Code, exp.Header())
	}
	e.do("PUT", "/api/v1/entries/"+gone, entryJSON(map[string]any{"name": "Cake"}), cookie(c))

	if rec := e.do("POST", "/api/v1/import", exp.Body.String(), cookie(c)); rec.Code != 422 {
		t.Fatalf("import without mode=replace = %d", rec.Code)
	}
	rec := e.do("POST", "/api/v1/import?mode=replace", exp.Body.String(), cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"removed":1`) {
		t.Fatalf("import = %d %s", rec.Code, rec.Body)
	}
	day := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	if !strings.Contains(day.Body.String(), `"count":1`) || strings.Contains(day.Body.String(), "Cake") {
		t.Fatalf("day after restore = %s", day.Body)
	}
}

func TestImportRejectsBadDocumentsWithoutWriting(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(nil), cookie(c))
	for name, tc := range map[string]struct {
		body string
		code int
	}{
		"newer format": {`{"format_version":9,"schema_version":1}`, 422},
		"not json":     {`{nope`, 400},
		"empty":        {`{}`, 422},
	} {
		if rec := e.do("POST", "/api/v1/import?mode=replace", tc.body, cookie(c)); rec.Code != tc.code {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries WHERE deleted_at IS NULL`).Scan(&n)
	if n != 1 {
		t.Fatal("data changed by a rejected import")
	}
}

func TestImportWritesAPreImportSnapshot(t *testing.T) {
	dir := t.TempDir()
	e := newEnv(t, opts{dataDir: dir})
	c := e.login(t)
	exp := e.do("GET", "/api/v1/export", "", cookie(c))
	if rec := e.do("POST", "/api/v1/import?mode=replace", exp.Body.String(), cookie(c)); rec.Code != 200 {
		t.Fatalf("import = %d %s", rec.Code, rec.Body)
	}
	m, _ := filepath.Glob(filepath.Join(dir, "snapshots", "pre-import-*.db"))
	if len(m) != 1 {
		t.Fatalf("snapshots = %v", m)
	}
	if st, err := os.Stat(m[0]); err != nil || st.Size() == 0 {
		t.Fatalf("snapshot unusable: %v", err)
	}
}

func TestErrorsNeverLeakInternals(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	_ = e.db.Close() // every query now fails
	rec := e.do("GET", "/api/v1/days/2026-11-13", "", cookie(c))
	body := strings.ToLower(rec.Body.String())
	for _, leak := range []string{"sql", "select ", "sqlite", "goroutine", ".go:", "/users/", "database is closed"} {
		if strings.Contains(body, leak) {
			t.Errorf("response leaks %q: %s", leak, rec.Body)
		}
	}
}

func TestAPIRateLimitPerUser(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	var last *httptest.ResponseRecorder
	for range 301 {
		last = e.do("GET", "/api/v1/settings", "", cookie(c))
	}
	if last.Code != http.StatusTooManyRequests || last.Header().Get("Retry-After") == "" {
		t.Fatalf("301st request = %d", last.Code)
	}
}

func TestOpenAPIMatchesTheCommittedSpec(t *testing.T) {
	want, err := os.ReadFile("openapi.json")
	if err != nil {
		t.Fatalf("run `make generate`: %v", err)
	}
	got, err := SpecJSON()
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(want) {
		t.Fatal("internal/httpapi/openapi.json is stale; run `make generate`")
	}
	for _, op := range []string{"put-entry", "delete-entry", "get-day", "list-days", "put-settings", "export", "import", "login"} {
		if !strings.Contains(string(got), `"operationId": "`+op+`"`) {
			t.Errorf("spec lacks operation %s", op)
		}
	}
}

func TestServerStoresEatenOnVerbatim(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	// a late-night entry the client dated to the previous day; the server must not re-derive it from the clock.
	rec := e.do("PUT", "/api/v1/entries/"+id, entryJSON(map[string]any{"eaten_on": "2026-01-02"}), cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"eaten_on":"2026-01-02"`) {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	rec = e.do("PUT", "/api/v1/entries/"+id, entryJSON(map[string]any{"eaten_on": "2026-01-02", "name": "Edited"}), cookie(c))
	if !strings.Contains(rec.Body.String(), `"eaten_on":"2026-01-02"`) {
		t.Fatalf("an edit moved the date: %s", rec.Body)
	}
}
