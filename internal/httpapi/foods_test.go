package httpapi

import (
	"bytes"
	"context"
	"encoding/base64"
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
		{"GET", "/images/catalog/3017620422003", ""}, {"GET", "/about", ""}, {"GET", "/foods/reference/wafct:02_005", ""},
		{"PUT", "/foods/barcode/4337256560191/correction", `{}`}, {"GET", "/foods/barcode/4337256560191/fact", ""},
		{"POST", "/foods/barcode/4337256560191/dispute", ""},
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

func TestReferenceFoodSearchAndSelect(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	n := func(v float64) *float64 { return &v }
	err := store.InTx(context.Background(), e.db, func(r *store.Repo) error {
		return r.ReplaceReference(context.Background(), []domain.ReferenceFood{{
			RefID: "wafct:06_008", Name: "Dikanut, kernel, dried, raw", LocalNames: "ogbono apon", ScientificName: "Irvingia gabonensis",
			Per100: domain.Nutrients{Kcal: 650, Protein: n(7.6), Fat: n(62.6)}, Source: "wafct-2019", DatasetVersion: "wafct-2019",
			ImportedAt: "2026-11-22T00:00:00Z",
		}})
	})
	if err != nil {
		t.Fatal(err)
	}
	rec := e.do("GET", "/api/v1/foods/search?q=ogbono", "", cookie(c))
	var out struct {
		Results []struct {
			ID          *string `json:"id"`
			ReferenceID *string `json:"reference_id"`
			Barcode     *string `json:"barcode"`
			Name        string  `json:"name"`
		} `json:"results"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Results) != 1 || out.Results[0].ReferenceID == nil || *out.Results[0].ReferenceID != "wafct:06_008" ||
		out.Results[0].ID != nil || out.Results[0].Barcode != nil {
		t.Fatalf("search = %d %s", rec.Code, rec.Body)
	}

	rec = e.do("GET", "/api/v1/foods/reference/wafct:06_008", "", cookie(c))
	v := decode[map[string]any](t, rec)
	if rec.Code != 200 || v["name"] != "Dikanut, kernel, dried, raw" || v["kcal"] != float64(650) || v["protein"] != float64(7.6) ||
		v["carbs"] != nil || v["barcode"] != nil || v["source"] != "catalog" || v["id"] == nil {
		t.Fatalf("select = %d %s", rec.Code, rec.Body)
	}
	again := decode[map[string]any](t, e.do("GET", "/api/v1/foods/reference/wafct:06_008", "", cookie(c)))
	if again["id"] != v["id"] {
		t.Fatalf("a second selection made a second food: %v vs %v", again["id"], v["id"])
	}
	if rec := e.do("GET", "/api/v1/foods/reference/wafct:nope", "", cookie(c)); rec.Code != 404 {
		t.Fatalf("unknown id = %d, want 404", rec.Code)
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

func correctionJSON(mods map[string]any) string {
	m := map[string]any{
		"revision_id": newID(), "name": "Räucherlachs", "brand": "REWE Beste Wahl", "kcal": 192, "kj": 801, "protein": 21,
		"carbs": 0, "fat": 12, "satfat": 1.9, "sugar": 0, "fiber": 0, "salt": 2.8, "source": "manual",
	}
	for k, v := range mods {
		m[k] = v
	}
	return jsonBody(m)
}

func TestACorrectionIsSharedAndAFailedOneIsNot(t *testing.T) {
	e := newEnv(t, opts{})
	a := e.login(t)
	rec := e.signup(t, "second", "a long passphrase here")
	if rec.Code != 200 {
		t.Fatalf("signup = %d %s", rec.Code, rec.Body)
	}
	b := sessionCookie(rec)
	const code = "4337256560191"
	p := offProduct(code, "Räucherlachs", "399")
	p.Nutriments["fat_100g"], p.Nutriments["proteins_100g"] = json.RawMessage("25"), json.RawMessage("43.8")
	e.off.products[code] = p

	if rec := e.do("GET", "/api/v1/foods/barcode/"+code, "", cookie(a)); rec.Code != 200 {
		t.Fatalf("setup lookup = %d", rec.Code)
	}
	// A correction that contradicts itself stays private: the other account still sees Open Food Facts.
	bad := e.do("PUT", "/api/v1/foods/barcode/"+code+"/correction", correctionJSON(map[string]any{"kcal": 500, "kj": nil}), cookie(a))
	got := decode[map[string]any](t, bad)
	if bad.Code != 200 || got["status"] != "pending" || len(got["issues"].([]any)) == 0 {
		t.Fatalf("failed check = %d %s", bad.Code, bad.Body)
	}
	if v := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/"+code, "", cookie(b))); v["kcal"] != float64(399) || v["community"] != false {
		t.Fatalf("a pending value leaked to another account: %v", v)
	}

	ok := e.do("PUT", "/api/v1/foods/barcode/"+code+"/correction", correctionJSON(nil), cookie(a))
	if got := decode[map[string]any](t, ok); ok.Code != 200 || got["status"] != "accepted" {
		t.Fatalf("correction = %d %s", ok.Code, ok.Body)
	}
	v := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/"+code, "", cookie(b)))
	if v["kcal"] != float64(192) || v["community"] != true || v["protein"] != float64(21) {
		t.Fatalf("the other account sees %v", v)
	}
	fact := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/"+code+"/fact", "", cookie(b)))
	if f, _ := fact["fact"].(map[string]any); f == nil || f["mine"] != false || f["origin"] != "off_correction" {
		t.Fatalf("fact = %v", fact)
	}
	if strings.Contains(ok.Body.String(), "contributor") || strings.Contains(fact["fact"].(map[string]any)["updated_at"].(string), "contributor") {
		t.Fatal("a contributor id leaked")
	}
	if rec := e.do("POST", "/api/v1/foods/barcode/"+code+"/dispute", "", cookie(a)); rec.Code != 409 {
		t.Fatalf("disputing your own facts = %d", rec.Code)
	}
}

func TestCorrectionValidation(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	for name, body := range map[string]string{
		"not a uuid":    correctionJSON(map[string]any{"revision_id": "nope"}),
		"unknown field": correctionJSON(map[string]any{"user_id": "x"}),
		"bad source":    correctionJSON(map[string]any{"source": "guess"}),
		"junk photo":    correctionJSON(map[string]any{"label_image": "AAAA"}),
	} {
		if rec := e.do("PUT", "/api/v1/foods/barcode/4337256560191/correction", body, cookie(c)); rec.Code != 422 && rec.Code != 400 {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	if rec := e.do("PUT", "/api/v1/foods/barcode/12/correction", correctionJSON(nil), cookie(c)); rec.Code < 400 {
		t.Errorf("a short barcode = %d", rec.Code)
	}
}

func photoB64(t *testing.T) string { return base64.StdEncoding.EncodeToString(jpegBody(t)) }

func TestASharedFrontPhotoIsServedBackAndOnlyWhileItsRevisionIsTheServedOne(t *testing.T) {
	e := newEnv(t, opts{})
	a := e.login(t)
	rec := e.signup(t, "second", "a long passphrase here")
	b := sessionCookie(rec)
	const code = "4337256560191"

	ok := e.do("PUT", "/api/v1/foods/barcode/"+code+"/correction",
		correctionJSON(map[string]any{"front_image": photoB64(t), "label_image": photoB64(t)}), cookie(a))
	first := decode[map[string]any](t, ok)
	if ok.Code != 200 || first["status"] != "accepted" {
		t.Fatalf("correction = %d %s", ok.Code, ok.Body)
	}

	food := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/"+code, "", cookie(b)))
	front, _ := food["image_path"].(string)
	want := "/api/v1/images/fact/" + first["revision_id"].(string) + "/front"
	if front != want {
		t.Fatalf("image_path = %q, want %q", front, want)
	}
	for _, p := range []string{front, strings.TrimSuffix(front, "front") + "nutrition"} {
		got := e.do("GET", p, "", cookie(b))
		if got.Code != 200 || got.Header().Get("Content-Type") != "image/jpeg" ||
			!strings.Contains(got.Header().Get("Cache-Control"), "immutable") || !bytes.Equal(got.Body.Bytes(), jpegBody(t)) {
			t.Fatalf("%s = %d %v", p, got.Code, got.Header())
		}
	}
	if got := e.do("GET", front, ""); got.Code != 401 {
		t.Fatalf("a photo needs a session: %d", got.Code)
	}
	if got := e.do("GET", "/api/v1/images/fact/"+newID()+"/front", "", cookie(b)); got.Code != 404 {
		t.Fatalf("an unknown revision = %d", got.Code)
	}
	if got := e.do("GET", "/api/v1/images/fact/"+newID()+"/side", "", cookie(b)); got.Code != 422 && got.Code != 404 {
		t.Fatalf("an unknown kind = %d", got.Code)
	}

	// A private revision (a check failed) has no public photo.
	private := e.do("PUT", "/api/v1/foods/barcode/"+code+"/correction",
		correctionJSON(map[string]any{"kcal": 500, "kj": nil, "front_image": photoB64(t)}), cookie(b))
	pend := decode[map[string]any](t, private)
	if pend["status"] != "pending" {
		t.Fatalf("setup: %s", private.Body)
	}
	if got := e.do("GET", "/api/v1/images/fact/"+pend["revision_id"].(string)+"/front", "", cookie(a)); got.Code != 404 {
		t.Fatalf("a private revision's photo = %d", got.Code)
	}

	// A newer revision replaces the served one: the old photo URL stops working and the food stops pointing at it.
	if r := e.do("PUT", "/api/v1/foods/barcode/"+code+"/correction", correctionJSON(nil), cookie(b)); r.Code != 200 {
		t.Fatalf("second correction = %d %s", r.Code, r.Body)
	}
	if got := e.do("GET", front, "", cookie(a)); got.Code != 404 {
		t.Fatalf("a replaced revision's photo = %d", got.Code)
	}
	if again := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/"+code, "", cookie(a))); again["image_path"] != nil {
		t.Fatalf("image_path after the photo was replaced = %v", again["image_path"])
	}
}

func TestASharedFrontPhotoNeverReplacesAPictureTheFoodAlreadyHas(t *testing.T) {
	e := newEnv(t, opts{imagesDir: t.TempDir()})
	a := e.login(t)
	rec := e.signup(t, "second", "a long passphrase here")
	b := sessionCookie(rec)
	addCatalog(t, e, "4337256560191", "Räucherlachs", 399)

	before := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4337256560191", "", cookie(a)))
	catalogPath, _ := before["image_path"].(string)
	if !strings.HasPrefix(catalogPath, "/api/v1/images/") || strings.Contains(catalogPath, "/fact/") {
		t.Fatalf("setup: image_path = %q", catalogPath)
	}
	if r := e.do("PUT", "/api/v1/foods/barcode/4337256560191/correction", correctionJSON(map[string]any{"front_image": photoB64(t)}), cookie(a)); r.Code != 200 {
		t.Fatalf("correction = %d %s", r.Code, r.Body)
	}
	for name, c := range map[string]*http.Cookie{"the author": a, "another account that never looked it up": b} {
		got := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4337256560191", "", cookie(c)))
		path, _ := got["image_path"].(string)
		if got["community"] != true || got["kcal"] != float64(192) {
			t.Fatalf("%s: %v", name, got)
		}
		if !strings.HasPrefix(path, "/api/v1/images/") || strings.Contains(path, "/fact/") {
			t.Errorf("%s: the catalog picture was replaced by %q", name, path)
		}
	}
}

// sizedJPEG makes a valid JPEG whose pixels and size differ from another's, so a test can tell which photo came back.
func sizedJPEG(t *testing.T, w, h int, shade uint8) []byte {
	t.Helper()
	img := image.NewGray(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = shade + uint8(i%7)*9
	}
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestFrontAndNutritionPhotosAreNeverMixedUp(t *testing.T) {
	e := newEnv(t, opts{})
	a := e.login(t)
	front := sizedJPEG(t, 40, 60, 20)
	table := sizedJPEG(t, 90, 50, 180)
	if bytes.Equal(front, table) {
		t.Fatal("setup: the two photos must differ")
	}
	enc := base64.StdEncoding.EncodeToString

	// Both photos: the food's picture is the front, and each URL returns its own bytes.
	rec := e.do("PUT", "/api/v1/foods/barcode/4337256560191/correction",
		correctionJSON(map[string]any{"front_image": enc(front), "label_image": enc(table)}), cookie(a))
	both := decode[map[string]any](t, rec)
	rev := both["revision_id"].(string)
	food := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4337256560191", "", cookie(a)))
	if food["image_path"] != "/api/v1/images/fact/"+rev+"/front" {
		t.Fatalf("image_path = %v, want the front photo", food["image_path"])
	}
	if got := e.do("GET", "/api/v1/images/fact/"+rev+"/front", "", cookie(a)); !bytes.Equal(got.Body.Bytes(), front) {
		t.Fatal("/front did not return the front photo")
	}
	if got := e.do("GET", "/api/v1/images/fact/"+rev+"/nutrition", "", cookie(a)); !bytes.Equal(got.Body.Bytes(), table) {
		t.Fatal("/nutrition did not return the nutrition table")
	}

	// Only the nutrition table was shared (the front photo is optional): the food must not show the table as its picture.
	rec = e.do("PUT", "/api/v1/foods/barcode/4337256560208/correction",
		correctionJSON(map[string]any{"label_image": enc(table)}), cookie(a))
	only := decode[map[string]any](t, rec)["revision_id"].(string)
	food = decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4337256560208", "", cookie(a)))
	if food["image_path"] != nil {
		t.Fatalf("image_path = %v, but no front photo was shared", food["image_path"])
	}
	if got := e.do("GET", "/api/v1/images/fact/"+only+"/front", "", cookie(a)); got.Code != 404 {
		t.Fatalf("/front with no front photo = %d, want 404 and not the table", got.Code)
	}
	if got := e.do("GET", "/api/v1/images/fact/"+only+"/nutrition", "", cookie(a)); got.Code != 200 || !bytes.Equal(got.Body.Bytes(), table) {
		t.Fatalf("/nutrition = %d", got.Code)
	}
}

func TestAFoodCarriesItsCategoryRangesSoTheClientCanSpotOutliers(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	repo := store.NewRepo(e.db)
	ctx := context.Background()
	if err := repo.PutCatalogFood(ctx, domain.CatalogFood{
		Barcode: "4337256560191", Name: "Räucherlachs", Per100: domain.Nutrients{Kcal: 190}, Category: "en:smoked-salmons",
		DatasetVersion: "v1", ImportedAt: "2026-11-21T00:00:00Z",
	}, "2026-11-21T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := repo.PutCatalogFood(ctx, domain.CatalogFood{
		Barcode: "4000000000011", Name: "Nudeln", Per100: domain.Nutrients{Kcal: 350},
		DatasetVersion: "v1", ImportedAt: "2026-11-21T00:00:00Z",
	}, "2026-11-21T00:00:00Z"); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReplaceCategoryStats(ctx, []domain.CategoryStats{{
		Category: "en:smoked-salmons", N: 227, Ranges: map[string][3]float64{"kcal": {123, 180, 244}, "salt": {1.4, 2.8, 3.6}},
	}}); err != nil {
		t.Fatal(err)
	}

	got := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4337256560191", "", cookie(c)))
	cat, _ := got["category"].(map[string]any)
	if cat == nil || cat["name"] != "smoked salmons" {
		t.Fatalf("category = %v", got["category"])
	}
	kcal, _ := cat["ranges"].(map[string]any)["kcal"].([]any)
	if len(kcal) != 3 || kcal[2] != float64(244) {
		t.Fatalf("kcal range = %v", kcal)
	}
	plain := decode[map[string]any](t, e.do("GET", "/api/v1/foods/barcode/4000000000011", "", cookie(c)))
	if _, has := plain["category"]; has {
		t.Fatalf("a food with no category must not carry one: %v", plain["category"])
	}
	if strings.Contains(e.do("GET", "/api/v1/foods/recent", "", cookie(c)).Body.String(), "internal") {
		t.Fatal("recent must stay clean")
	}
}
