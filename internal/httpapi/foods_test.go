package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
	"plate/internal/food"
	"plate/internal/store"
)

func rawNutr(kv map[string]string) map[string]json.RawMessage {
	m := map[string]json.RawMessage{}
	for k, v := range kv {
		m[k] = json.RawMessage(v)
	}
	return m
}

func offProduct(code, name string, kcal string) food.OFFProduct {
	var p food.OFFProduct
	_ = json.Unmarshal([]byte(`{"code":"`+code+`","product_name":"`+name+`","brands":"Marke","countries_tags":["en:germany"],
		"image_front_url":"https://images.openfoodfacts.org/images/products/400/000/000/0011/front.jpg"}`), &p)
	p.Nutriments = rawNutr(map[string]string{"energy-kcal_100g": kcal, "proteins_100g": "5"})
	return p
}

func addCatalog(t *testing.T, e *env, barcode, name string, kcal float64) {
	t.Helper()
	img := "https://images.openfoodfacts.org/images/products/301/762/042/2003/front.jpg"
	err := store.NewRepo(e.db).PutCatalogFood(context.Background(), domain.CatalogFood{
		Barcode: barcode, Name: name, Brand: "Ferrero", Per100: domain.Nutrients{Kcal: kcal}, ImageSourceURL: &img,
		DatasetVersion: "2026-11", ImportedAt: "2026-11-13T00:00:00Z",
	}, "2026-11-13T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
}

func TestFoodRoutesRequireAuth(t *testing.T) {
	e := newEnv(t, opts{})
	id := newID()
	for _, r := range []struct{ m, p, b string }{
		{"GET", "/foods/barcode/3017620422003", ""}, {"GET", "/foods/search?q=joghurt", ""}, {"GET", "/foods/recent", ""},
		{"PUT", "/foods/" + id, `{}`}, {"GET", "/foods/" + id + "/favorite", ""}, {"PUT", "/foods/" + id + "/favorite", ""},
		{"DELETE", "/foods/" + id + "/favorite", ""}, {"GET", "/images/" + strings.Repeat("a", 32), ""},
		{"GET", "/images/catalog/3017620422003", ""}, {"GET", "/about", ""},
	} {
		if rec := e.do(r.m, "/api/v1"+r.p, r.b); rec.Code != 401 {
			t.Errorf("%s %s = %d, want 401", r.m, r.p, rec.Code)
		}
	}
}

func TestBarcodeLookupFromCatalogThenOFF(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	addCatalog(t, e, "3017620422003", "Nutella", 539)
	e.off.products["4000000000011"] = offProduct("4000000000011", "Joghurt", "61")

	rec := e.do("GET", "/api/v1/foods/barcode/3017620422003", "", cookie(c))
	v := decode[map[string]any](t, rec)
	if rec.Code != 200 || v["source"] != "catalog" || v["kcal"] != float64(539) || v["image_path"] == nil {
		t.Fatalf("catalog hit = %d %s", rec.Code, rec.Body)
	}
	rec = e.do("GET", "/api/v1/foods/barcode/4000-000000-011", "", cookie(c))
	v = decode[map[string]any](t, rec)
	if rec.Code != 200 || v["source"] != "off" || v["name"] != "Joghurt" || v["protein"] != float64(5) || v["carbs"] != nil {
		t.Fatalf("OFF hit = %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "openfoodfacts.org") || strings.Contains(rec.Body.String(), `"user_id"`) {
		t.Fatalf("a source URL or user id leaked: %s", rec.Body)
	}
	if e.off.calls.Load() != 1 {
		t.Fatalf("OFF calls = %d", e.off.calls.Load())
	}
}

func TestBarcodeMissNotLoggableAndUpstreamProblems(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)

	rec := e.do("GET", "/api/v1/foods/barcode/4000000000000", "", cookie(c))
	p := decode[map[string]any](t, rec)
	if rec.Code != 404 || p["code"] != "not_found" || p["can_add_manually"] != true || p["request_id"] == "" {
		t.Fatalf("miss = %d %s", rec.Code, rec.Body)
	}

	var nok food.OFFProduct
	_ = json.Unmarshal([]byte(`{"code":"4000000000028","product_name":"Mystery bar","image_front_url":"https://images.openfoodfacts.org/images/products/400/x.jpg"}`), &nok)
	nok.Nutriments = rawNutr(map[string]string{"proteins_100g": "3"})
	e.off.products["4000000000028"] = nok
	rec = e.do("GET", "/api/v1/foods/barcode/4000000000028", "", cookie(c))
	p = decode[map[string]any](t, rec)
	prod, _ := p["product"].(map[string]any)
	if rec.Code != 422 || p["code"] != "not_loggable" || p["reason"] != "no_nutrition" || prod["name"] != "Mystery bar" || p["can_add_manually"] != true {
		t.Fatalf("not loggable = %d %s", rec.Code, rec.Body)
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM foods`).Scan(&n)
	if n != 0 {
		t.Fatal("a product without kcal was stored as a food")
	}

	e.off.err = &food.UpstreamError{Reason: "down", RetryAfter: 45 * time.Second}
	rec = e.do("GET", "/api/v1/foods/barcode/4000000000035", "", cookie(c))
	p = decode[map[string]any](t, rec)
	if rec.Code != 503 || p["code"] != "upstream_unavailable" || rec.Header().Get("Retry-After") != "46" || p["can_add_manually"] != true {
		t.Fatalf("upstream = %d %s %v", rec.Code, rec.Body, rec.Header())
	}

	rec = e.do("GET", "/api/v1/foods/barcode/12ab", "", cookie(c))
	if rec.Code != 422 || decode[map[string]any](t, rec)["code"] != "validation_failed" {
		t.Fatalf("invalid = %d %s", rec.Code, rec.Body)
	}
}

func TestBarcodeLookupsAreRateLimitedPerIP(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	// 60 lookups per minute per IP, but the per-user API limit is also 60: use two users' worth by
	// resetting the user limiter between calls.
	var last *httptest.ResponseRecorder
	for i := range 61 {
		e.reset()
		last = e.do("GET", "/api/v1/foods/barcode/4000000000000", "", cookie(c), remote("198.51.100.9:1"))
		if i < 60 && last.Code == 429 {
			t.Fatalf("limited at %d", i)
		}
	}
	if last.Code != 429 || last.Header().Get("Retry-After") == "" || decode[map[string]any](t, last)["code"] != "rate_limited" {
		t.Fatalf("61st = %d %s", last.Code, last.Body)
	}
	e.reset()
	if rec := e.do("GET", "/api/v1/foods/barcode/4000000000000", "", cookie(c), remote("203.0.113.5:1")); rec.Code == 429 {
		t.Fatal("another IP must not be limited")
	}
}

func TestSearchEndpoint(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	addCatalog(t, e, "3017620422003", "Nutella", 539)
	addCatalog(t, e, "3017620422010", "Nutella B-ready", 480)

	rec := e.do("GET", "/api/v1/foods/search?q=nutella", "", cookie(c))
	var out struct {
		Query   string `json:"query"`
		Results []struct {
			ID        *string `json:"id"`
			Barcode   string  `json:"barcode"`
			Name      string  `json:"name"`
			Source    string  `json:"source"`
			ImagePath string  `json:"image_path"`
		} `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Results) != 2 || out.Results[0].Name != "Nutella" || out.Results[0].ID != nil || out.Results[0].Source != "catalog" ||
		out.Results[0].ImagePath != "/api/v1/images/catalog/3017620422003" {
		t.Fatalf("search = %d %s", rec.Code, rec.Body)
	}
	for _, q := range []string{"", "n", `ja!`, `"`, `Gut & Günstig`, `a:b`} {
		rec := e.do("GET", "/api/v1/foods/search?q="+url.QueryEscape(q), "", cookie(c))
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"results":[`) {
			t.Errorf("%q = %d %s", q, rec.Code, rec.Body)
		}
	}
}

func foodBody(mods map[string]any) string {
	m := map[string]any{"name": "Haferflocken", "brand": "Hof", "kcal": 370, "protein": 13}
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

func TestCustomFoodAndCorrection(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	rec := e.do("PUT", "/api/v1/foods/"+id, foodBody(map[string]any{"barcode": "4000000000011"}), cookie(c))
	v := decode[map[string]any](t, rec)
	if rec.Code != 200 || v["source"] != "user" || v["id"] != id || v["kcal"] != float64(370) || v["carbs"] != nil {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	rec = e.do("GET", "/api/v1/foods/barcode/4000000000011", "", cookie(c))
	if v := decode[map[string]any](t, rec); v["id"] != id || v["name"] != "Haferflocken" {
		t.Fatalf("lookup after create = %s", rec.Body)
	}
	if e.off.calls.Load() != 0 {
		t.Fatal("OFF must not be called when the user has the barcode")
	}

	// correcting an OFF row by posting a different id with the same barcode edits the existing row
	e.off.products["4000000000028"] = offProduct("4000000000028", "Skyr", "63")
	skyr := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4000000000028", "", cookie(c)))
	rec = e.do("PUT", "/api/v1/foods/"+newID(), foodBody(map[string]any{"barcode": "4000000000028", "name": "Skyr (meins)", "kcal": 70}), cookie(c))
	fixed := decode[map[string]any](t, rec)
	if rec.Code != 200 || fixed["id"] != skyr["id"] || fixed["source"] != "user" || fixed["source_id"] != "4000000000028" || fixed["kcal"] != float64(70) {
		t.Fatalf("correction = %d %s", rec.Code, rec.Body)
	}
	var changes int
	_ = e.db.QueryRow(`SELECT count(*) FROM change_log WHERE entity = 'food'`).Scan(&changes)
	if changes != 2 {
		t.Fatalf("food changes = %d; user foods and corrections sync, cached foods do not", changes)
	}
}

func TestCustomFoodValidation(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	for name, tc := range map[string]struct {
		id, body string
		code     int
	}{
		"missing kcal":     {newID(), foodBody(map[string]any{"kcal": nil}), 422},
		"negative kcal":    {newID(), foodBody(map[string]any{"kcal": -1}), 422},
		"empty name":       {newID(), foodBody(map[string]any{"name": ""}), 422},
		"implausible":      {newID(), foodBody(map[string]any{"kcal": 5000}), 422},
		"macro over 100 g": {newID(), foodBody(map[string]any{"fat": 150}), 422},
		"short barcode":    {newID(), foodBody(map[string]any{"barcode": "123"}), 422},
		"unknown field":    {newID(), foodBody(map[string]any{"surprise": 1}), 422},
		"not a uuid":       {"nope", foodBody(nil), 422},
	} {
		if rec := e.do("PUT", "/api/v1/foods/"+tc.id, tc.body, cookie(c)); rec.Code != tc.code {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	zero := e.do("PUT", "/api/v1/foods/"+newID(), foodBody(map[string]any{"name": "Wasser", "kcal": 0, "protein": nil}), cookie(c))
	if zero.Code != 200 {
		t.Fatalf("a 0 kcal food is valid: %d %s", zero.Code, zero.Body)
	}

	bc := "4000000000011"
	e.do("PUT", "/api/v1/foods/"+newID(), foodBody(map[string]any{"barcode": bc}), cookie(c))
	other := newID()
	e.do("PUT", "/api/v1/foods/"+other, foodBody(map[string]any{"name": "Anders"}), cookie(c))
	rec := e.do("PUT", "/api/v1/foods/"+other, foodBody(map[string]any{"name": "Anders", "barcode": bc}), cookie(c))
	if rec.Code != 409 || decode[map[string]any](t, rec)["code"] != "conflict" {
		t.Fatalf("barcode conflict = %d %s", rec.Code, rec.Body)
	}
}

func TestFavoritesAndRecent(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	id := newID()
	e.do("PUT", "/api/v1/foods/"+id, foodBody(nil), cookie(c))

	state := func(method string) (int, bool) {
		rec := e.do(method, "/api/v1/foods/"+id+"/favorite", "", cookie(c))
		return rec.Code, decode[map[string]any](t, rec)["favorite"] == true
	}
	if code, on := state("GET"); code != 200 || on {
		t.Fatalf("initial = %d %v", code, on)
	}
	for range 2 { // idempotent
		if code, on := state("PUT"); code != 200 || !on {
			t.Fatalf("set = %d %v", code, on)
		}
	}
	if _, on := state("GET"); !on {
		t.Fatal("not a favorite after PUT")
	}
	for range 2 {
		if code, on := state("DELETE"); code != 200 || on {
			t.Fatalf("clear = %d %v", code, on)
		}
	}
	if rec := e.do("PUT", "/api/v1/foods/"+newID()+"/favorite", "", cookie(c)); rec.Code != 404 {
		t.Fatalf("unknown food = %d", rec.Code)
	}

	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(map[string]any{"food_id": id}), cookie(c))
	rec := e.do("GET", "/api/v1/foods/recent", "", cookie(c))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"name":"Haferflocken"`) {
		t.Fatalf("recent = %d %s", rec.Code, rec.Body)
	}
}

func jpegBody(t *testing.T) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := jpeg.Encode(&b, image.NewRGBA(image.Rect(0, 0, 3, 3)), nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type rewrite struct{ target *url.URL }

func (rt rewrite) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.URL.Scheme, r.URL.Host = rt.target.Scheme, rt.target.Host
	return http.DefaultTransport.RoundTrip(r)
}

func TestImageRoutesServeSameOriginCachedImages(t *testing.T) {
	body := jpegBody(t)
	var upstream int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { upstream++; _, _ = w.Write(body) }))
	t.Cleanup(srv.Close)
	target, _ := url.Parse(srv.URL)
	e := newEnv(t, opts{imageClient: &http.Client{Transport: rewrite{target}}, imagesDir: t.TempDir()})
	c := e.login(t)
	addCatalog(t, e, "3017620422003", "Nutella", 539)

	food := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/3017620422003", "", cookie(c)))
	path, _ := food["image_path"].(string)
	if !strings.HasPrefix(path, "/api/v1/images/") || strings.Contains(path, "openfoodfacts") {
		t.Fatalf("image_path = %q", path)
	}
	for range 2 {
		rec := e.do("GET", path, "", cookie(c))
		if rec.Code != 200 || rec.Header().Get("Content-Type") != "image/jpeg" || !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") ||
			!bytes.Equal(rec.Body.Bytes(), body) {
			t.Fatalf("image = %d %v", rec.Code, rec.Header())
		}
	}
	if upstream != 1 {
		t.Fatalf("upstream fetches = %d", upstream)
	}
	if rec := e.do("GET", "/api/v1/images/catalog/3017620422003", "", cookie(c)); rec.Code != 200 {
		t.Fatalf("catalog image = %d", rec.Code)
	}
	for _, p := range []string{"/api/v1/images/" + strings.Repeat("a", 32), "/api/v1/images/catalog/4000000000099"} {
		if rec := e.do("GET", p, "", cookie(c)); rec.Code != 404 {
			t.Errorf("%s = %d", p, rec.Code)
		}
	}
	for _, p := range []string{"/api/v1/images/..%2f..%2fetc%2fpasswd", "/api/v1/images/nothex", "/api/v1/images/catalog/abc"} {
		if rec := e.do("GET", p, "", cookie(c)); rec.Code != 422 && rec.Code != 404 {
			t.Errorf("%s = %d", p, rec.Code)
		}
	}
}

func TestAboutCarriesAttributionAndCatalogRelease(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	addCatalog(t, e, "3017620422003", "Nutella", 539)
	_ = store.NewRepo(e.db).SetCatalogMeta(context.Background(), "dataset_version", "2026-11-12")
	rec := e.do("GET", "/api/v1/about", "", cookie(c))
	body := rec.Body.String()
	if rec.Code != 200 || !strings.Contains(body, "Open Food Facts") || !strings.Contains(body, "ODbL") || !strings.Contains(body, "Max Rubner") ||
		!strings.Contains(body, "CC BY 4.0") || !strings.Contains(body, `"dataset_version":"2026-11-12"`) || !strings.Contains(body, `"rows":1`) {
		t.Fatalf("about = %d %s", rec.Code, body)
	}
}

func TestExportCarriesAttribution(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	rec := e.do("GET", "/api/v1/export", "", cookie(c))
	if !strings.Contains(rec.Body.String(), "Open Food Facts") || !strings.Contains(rec.Body.String(), "Bundeslebensmittelschl") {
		t.Fatalf("the export lacks attribution: %.300s", rec.Body)
	}
	// and it must re-import unchanged
	if rec := e.do("POST", "/api/v1/import?mode=replace", rec.Body.String(), cookie(c)); rec.Code != 200 {
		t.Fatalf("re-import = %d %s", rec.Code, rec.Body)
	}
}
