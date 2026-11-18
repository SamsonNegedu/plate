package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
)

func pushBody(ops ...map[string]any) string {
	b, _ := json.Marshal(map[string]any{"client_id": newID(), "ops": ops})
	return string(b)
}

func entryOp(id string, mods map[string]any) map[string]any {
	var data map[string]any
	_ = json.Unmarshal([]byte(entryJSON(mods)), &data)
	return map[string]any{"op_id": newID(), "entity": "entry", "type": "upsert", "id": id, "data": data}
}

func deleteOp(id string) map[string]any {
	return map[string]any{"op_id": newID(), "entity": "entry", "type": "delete", "id": id}
}

func TestSyncRoutesRequireAuth(t *testing.T) {
	e := newEnv(t, opts{})
	for _, r := range []struct{ m, p, b string }{
		{"POST", "/sync/push", pushBody()}, {"GET", "/sync/pull?since=0", ""}, {"GET", "/sync/snapshot", ""}, {"GET", "/sync/meta", ""},
	} {
		if rec := e.do(r.m, "/api/v1"+r.p, r.b); rec.Code != 401 {
			t.Errorf("%s %s = %d", r.m, r.p, rec.Code)
		}
	}
}

func TestPushThenPullThroughHTTP(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	op := entryOp(id, nil)
	body := pushBody(op, entryOp(newID(), map[string]any{"grams": 41}), deleteOp(newID()))
	rec := e.do("POST", "/api/v1/sync/push", body, cookie(c))
	var res struct {
		Results []struct {
			OpID      string `json:"op_id"`
			Status    string `json:"status"`
			ServerSeq *int64 `json:"server_seq"`
			Problem   *struct {
				Code   string `json:"code"`
				Errors []struct {
					Field string `json:"field"`
				} `json:"errors"`
			} `json:"problem"`
		} `json:"results"`
		Cursor int64 `json:"cursor"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != 200 || len(res.Results) != 3 || res.Results[0].Status != "applied" || res.Results[1].Status != "rejected" || res.Results[2].Status != "rejected" {
		t.Fatalf("push = %d %s", rec.Code, rec.Body)
	}
	if p := res.Results[1].Problem; p == nil || p.Code != "validation_failed" || len(p.Errors) == 0 || p.Errors[0].Field != "grams" {
		t.Fatalf("problem = %+v", res.Results[1].Problem)
	}

	// replaying the same batch
	rec = e.do("POST", "/api/v1/sync/push", body, cookie(c))
	if !strings.Contains(rec.Body.String(), `"status":"duplicate"`) {
		t.Fatalf("replay = %s", rec.Body)
	}

	rec = e.do("GET", "/api/v1/sync/pull?since=0&limit=10", "", cookie(c))
	var pull struct {
		Changes []struct {
			Seq    int64  `json:"seq"`
			Entity string `json:"entity"`
			ID     string `json:"id"`
			Op     string `json:"op"`
		} `json:"changes"`
		Next    int64 `json:"next"`
		HasMore bool  `json:"has_more"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &pull)
	if rec.Code != 200 || len(pull.Changes) != 1 || pull.Changes[0].ID != id || pull.Next != res.Cursor || pull.HasMore {
		t.Fatalf("pull = %d %s", rec.Code, rec.Body)
	}

	rec = e.do("GET", "/api/v1/sync/snapshot", "", cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"cursor":`+fmt.Sprint(res.Cursor)) || !strings.Contains(rec.Body.String(), id) {
		t.Fatalf("snapshot = %d %s", rec.Code, rec.Body)
	}
	rec = e.do("GET", "/api/v1/sync/meta", "", cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":true`) || !strings.Contains(rec.Body.String(), `"head":`+fmt.Sprint(res.Cursor)) {
		t.Fatalf("meta = %d %s", rec.Code, rec.Body)
	}
}

func TestPushValidatesTheEnvelope(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	var many []map[string]any
	for range 101 {
		many = append(many, entryOp(newID(), nil))
	}
	for name, body := range map[string]string{
		"101 ops":            pushBody(many...),
		"no client id":       `{"ops":[]}`,
		"client id not uuid": `{"client_id":"x","ops":[]}`,
		"unknown field":      `{"client_id":"` + newID() + `","ops":[],"extra":1}`,
		"bad entity":         pushBody(map[string]any{"op_id": newID(), "entity": "nope", "type": "upsert", "id": newID()}),
		"bad type":           pushBody(map[string]any{"op_id": newID(), "entity": "entry", "type": "merge", "id": newID()}),
	} {
		if rec := e.do("POST", "/api/v1/sync/push", body, cookie(c)); rec.Code != 422 {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 0 {
		t.Fatal("an invalid envelope wrote rows")
	}
	if rec := e.do("POST", "/api/v1/sync/push", pushBody(), cookie(c)); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"results":[]`) {
		t.Fatalf("an empty batch is fine: %d %s", rec.Code, rec.Body)
	}
}

func TestPullParametersAreValidated(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	for _, q := range []string{"since=-1", "limit=0", "limit=501", "since=abc"} {
		if rec := e.do("GET", "/api/v1/sync/pull?"+q, "", cookie(c)); rec.Code != 422 && rec.Code != 400 {
			t.Errorf("%s = %d", q, rec.Code)
		}
	}
	if rec := e.do("GET", "/api/v1/sync/pull", "", cookie(c)); rec.Code != 200 {
		t.Fatalf("defaults = %d %s", rec.Code, rec.Body)
	}
}

func TestResyncRequiredCarriesMinSeq(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("POST", "/api/v1/sync/push", pushBody(entryOp(newID(), nil), entryOp(newID(), nil)), cookie(c))
	var uid string
	_ = e.db.QueryRow(`SELECT id FROM users`).Scan(&uid)
	if _, err := e.db.Exec(`UPDATE sync_state SET min_seq = 2 WHERE user_id = ?`, uid); err != nil {
		t.Fatal(err)
	}
	rec := e.do("GET", "/api/v1/sync/pull?since=0", "", cookie(c))
	p := decode[map[string]any](t, rec)
	if rec.Code != 409 || p["code"] != "resync_required" || p["min_seq"] != float64(2) || p["request_id"] == "" {
		t.Fatalf("pull = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/sync/pull?since=2", "", cookie(c)); rec.Code != 200 {
		t.Fatalf("at min_seq = %d", rec.Code)
	}
}

func TestKillSwitchReturns503ButMetaAnswersAndNothingIsLost(t *testing.T) {
	e := newEnv(t, opts{syncOff: true})
	c := e.login(t)
	id := newID()
	// entries still save through the normal API: logging is never blocked by the switch
	if rec := e.do("PUT", "/api/v1/entries/"+id, entryJSON(nil), cookie(c)); rec.Code != 200 {
		t.Fatalf("direct entry write = %d", rec.Code)
	}
	for _, r := range []struct{ m, p, b string }{
		{"POST", "/sync/push", pushBody(entryOp(newID(), nil))}, {"GET", "/sync/pull", ""}, {"GET", "/sync/snapshot", ""},
	} {
		rec := e.do(r.m, "/api/v1"+r.p, r.b, cookie(c))
		p := decode[map[string]any](t, rec)
		if rec.Code != 503 || p["code"] != "sync_disabled" || rec.Header().Get("Retry-After") == "" {
			t.Errorf("%s %s = %d %s", r.m, r.p, rec.Code, rec.Body)
		}
	}
	rec := e.do("GET", "/api/v1/sync/meta", "", cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"enabled":false`) {
		t.Fatalf("meta must tell a kill switch from a network failure: %d %s", rec.Code, rec.Body)
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 1 {
		t.Fatalf("entries = %d; the switch must never delete data", n)
	}
}

func TestSyncHasItsOwnRateLimit(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	var last *httptest.ResponseRecorder
	for i := range 601 {
		last = e.do("GET", "/api/v1/sync/meta", "", cookie(c))
		if i < 600 && last.Code == 429 {
			t.Fatalf("limited at %d", i)
		}
	}
	if last.Code != 429 || last.Header().Get("Retry-After") == "" {
		t.Fatalf("601st = %d", last.Code)
	}
	if rec := e.do("GET", "/api/v1/settings", "", cookie(c)); rec.Code == 429 {
		t.Fatal("the sync limit must not eat the general API budget")
	}
}
