package httpapi

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"

	"plate/internal/auth"
	"plate/internal/config"
	"plate/internal/food"
	"plate/internal/store"
)

const (
	testUsername = "sam"
	testPassword = "correct horse battery"
)

type fakeOFF struct {
	products map[string]food.OFFProduct
	err      error
	hits     []food.OFFProduct
	calls    atomic.Int32
}

func (f *fakeOFF) Product(_ context.Context, code string) (food.OFFProduct, error) {
	f.calls.Add(1)
	if f.err != nil {
		return food.OFFProduct{}, f.err
	}
	if p, ok := f.products[code]; ok {
		return p, nil
	}
	return food.OFFProduct{}, food.ErrProductNotFound
}

func (f *fakeOFF) Search(context.Context, string) ([]food.OFFProduct, error) { return f.hits, f.err }

type env struct {
	auth  *Auth
	off   *fakeOFF
	h     http.Handler
	db    *sql.DB
	store *auth.SessionStore
	logs  *bytes.Buffer
}

type opts struct {
	register func(huma.API, chi.Router)
	dataDir  string
	syncOff  bool
	// signupOff turns open signup off, as PLATE_SIGNUP_ENABLED=false does.
	signupOff bool
	// imageClient replaces the image proxy's HTTP client so tests never reach the internet.
	imageClient *http.Client
	imagesDir   string
}

func (o opts) imageDir() string {
	if o.imagesDir != "" {
		return o.imagesDir
	}
	return os.TempDir()
}

func newEnv(t *testing.T, o opts) *env {
	t.Helper()
	d, err := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := store.Migrate(t.Context(), d, ""); err != nil {
		t.Fatal(err)
	}
	ss := auth.NewSessionStore(d)
	if _, _, err := auth.Register(t.Context(), d, testUsername, testPassword); err != nil {
		t.Fatal(err)
	}
	return build(t, d, ss, o)
}

func build(t *testing.T, d *sql.DB, ss *auth.SessionStore, o opts) *env {
	t.Helper()
	logs := &bytes.Buffer{}
	base, _ := url.Parse("https://plate.example.com")
	log := slog.New(slog.NewJSONHandler(logs, nil))
	off := &fakeOFF{products: map[string]food.OFFProduct{}}
	images := food.NewImages(d, food.ImagesConfig{Dir: filepath.Join(o.imageDir(), "images"), Client: o.imageClient})
	pow, err := auth.NewPoW(4)
	if err != nil {
		t.Fatal(err)
	}
	a := NewAuth(ss, pow)
	h, _ := New(Deps{
		Config:   config.Config{BaseURL: base, DataDir: o.dataDir, SyncEnabled: !o.syncOff, SignupEnabled: !o.signupOff},
		Log:      log,
		DB:       d,
		Auth:     a,
		Food:     food.NewService(d, off, log),
		Images:   images,
		Web:      http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "spa") }),
		Register: o.register,
	})
	return &env{h: h, db: d, store: ss, logs: logs, off: off, auth: a}
}

type reqOpt func(*http.Request)

func header(k, v string) reqOpt { return func(r *http.Request) { r.Header.Set(k, v) } }
func cookie(c *http.Cookie) reqOpt {
	return func(r *http.Request) {
		if c != nil {
			r.AddCookie(c)
		}
	}
}
func remote(addr string) reqOpt { return func(r *http.Request) { r.RemoteAddr = addr } }

func (e *env) do(method, target, body string, opts ...reqOpt) *httptest.ResponseRecorder {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, target, rd)
	if body != "" {
		r.Header.Set("Content-Type", "application/json")
	}
	for _, o := range opts {
		o(r)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, r)
	return rec
}

func loginBody(username, pw string) string {
	b, _ := json.Marshal(map[string]string{"username": username, "password": pw})
	return string(b)
}

func sessionCookie(rec *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rec.Result().Cookies() {
		if c.Name == auth.CookieName {
			return c
		}
	}
	return nil
}

func (e *env) login(t *testing.T, opts ...reqOpt) *http.Cookie {
	t.Helper()
	rec := e.do("POST", "/api/v1/auth/login", loginBody(testUsername, testPassword), opts...)
	c := sessionCookie(rec)
	if rec.Code != 200 || c == nil {
		t.Fatalf("login = %d %s", rec.Code, rec.Body)
	}
	return c
}

func TestHealthAndReady(t *testing.T) {
	e := newEnv(t, opts{})
	for _, p := range []string{"/healthz", "/readyz"} {
		if rec := e.do("GET", p, ""); rec.Code != 200 {
			t.Errorf("%s = %d %s", p, rec.Code, rec.Body)
		}
	}
}

func TestSecurityHeadersOnHTMLAndAPI(t *testing.T) {
	e := newEnv(t, opts{})
	for _, path := range []string{"/", "/api/v1/auth/me"} {
		rec := e.do("GET", path, "")
		for k, want := range map[string]string{
			"X-Content-Type-Options":    "nosniff",
			"Permissions-Policy":        "camera=(self)",
			"Strict-Transport-Security": "max-age=",
			"Content-Security-Policy":   "frame-ancestors 'none'",
			"Referrer-Policy":           "no-referrer",
		} {
			if !strings.Contains(rec.Header().Get(k), want) {
				t.Errorf("%s %s = %q, want %q", path, k, rec.Header().Get(k), want)
			}
		}
	}
}

// The label camera previews its photo from a blob: URL; without this the image silently fails to load.
func TestCSPAllowsBlobImages(t *testing.T) {
	e := newEnv(t, opts{})
	got := e.do("GET", "/", "").Header().Get("Content-Security-Policy")
	if !strings.Contains(got, "img-src 'self' data: blob:") {
		t.Errorf("CSP = %q, want img-src to allow blob:", got)
	}
}

func TestEveryAPIRouteIsPrivateByDefault(t *testing.T) {
	e := newEnv(t, opts{register: func(api huma.API, _ chi.Router) {
		huma.Get(api, "/secret", func(context.Context, *struct{}) (*struct{}, error) { return nil, nil })
	}})
	for _, p := range []string{"/api/v1/secret", "/api/v1/nope", "/api/v1/auth/me", "/api/v1/auth/logout-all"} {
		method := "GET"
		if strings.HasSuffix(p, "logout-all") {
			method = "POST"
		}
		rec := e.do(method, p, "")
		if rec.Code != 401 || !strings.Contains(rec.Body.String(), `"code":"unauthorized"`) {
			t.Errorf("%s = %d %s", p, rec.Code, rec.Body)
		}
	}
	c := e.login(t)
	if rec := e.do("GET", "/api/v1/secret", "", cookie(c)); rec.Code != 204 && rec.Code != 200 {
		t.Errorf("authenticated = %d", rec.Code)
	}
	if rec := e.do("GET", "/api/v1/nope", "", cookie(c)); rec.Code != 404 || !strings.Contains(rec.Header().Get("Content-Type"), "problem+json") {
		t.Errorf("unknown route when signed in = %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
}

func TestLoginSetsHardenedCookieAndRecordsLastLogin(t *testing.T) {
	e := newEnv(t, opts{})
	rec := e.do("POST", "/api/v1/auth/login", loginBody("  SAM ", testPassword))
	c := sessionCookie(rec)
	if rec.Code != 200 || c == nil {
		t.Fatalf("login = %d %s", rec.Code, rec.Body)
	}
	if c.Name != "__Host-plate_session" || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode ||
		c.Path != "/" || c.Domain != "" || c.MaxAge < 13*24*3600 || c.MaxAge > 14*24*3600+60 {
		t.Fatalf("cookie = %+v", c)
	}
	me := e.do("GET", "/api/v1/auth/me", "", cookie(c))
	var body struct {
		User struct {
			Username    string  `json:"username"`
			LastLoginAt *string `json:"last_login_at"`
		} `json:"user"`
	}
	_ = json.Unmarshal(me.Body.Bytes(), &body)
	if me.Code != 200 || body.User.Username != testUsername || body.User.LastLoginAt == nil {
		t.Fatalf("me = %d %s", me.Code, me.Body)
	}
	if strings.Contains(me.Body.String(), "argon2") {
		t.Fatal("the response must never carry password material")
	}
}

func TestWrongPasswordAndUnknownUsernameLookAlike(t *testing.T) {
	e := newEnv(t, opts{})
	a := e.do("POST", "/api/v1/auth/login", loginBody(testUsername, "wrong wrong wrong"))
	b := e.do("POST", "/api/v1/auth/login", loginBody("nobody@example.com", "wrong wrong wrong"))
	if a.Code != 401 || b.Code != 401 {
		t.Fatalf("codes = %d, %d", a.Code, b.Code)
	}
	strip := func(s string) string {
		var m map[string]any
		_ = json.Unmarshal([]byte(s), &m)
		delete(m, "request_id")
		out, _ := json.Marshal(m)
		return string(out)
	}
	if strip(a.Body.String()) != strip(b.Body.String()) {
		t.Fatalf("responses differ:\n%s\n%s", a.Body, b.Body)
	}
	if sessionCookie(a) != nil || sessionCookie(b) != nil {
		t.Fatal("a failed login must not set a session cookie")
	}
}

func TestSessionSurvivesRestart(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	restarted := build(t, e.db, auth.NewSessionStore(e.db), opts{})
	if rec := restarted.do("GET", "/api/v1/auth/me", "", cookie(c)); rec.Code != 200 {
		t.Fatalf("after restart = %d %s", rec.Code, rec.Body)
	}
}

func TestLogoutInvalidatesServerSide(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	if rec := e.do("POST", "/api/v1/auth/logout", "", cookie(c)); rec.Code != 204 {
		t.Fatalf("logout = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(c)); rec.Code != 401 {
		t.Fatalf("replaying the old cookie = %d, want 401", rec.Code)
	}
	var n int
	_ = e.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&n)
	if n != 0 {
		t.Fatalf("session rows left = %d", n)
	}
}

func TestEveryAuthenticatedRequestSlidesTheIdleDeadline(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	if _, err := e.db.Exec(`UPDATE sessions SET expiry = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day')`); err != nil {
		t.Fatal(err)
	}
	rec := e.do("GET", "/api/v1/auth/me", "", cookie(c))
	renewed := sessionCookie(rec)
	if rec.Code != 200 || renewed == nil || renewed.MaxAge < 13*24*3600 {
		t.Fatalf("session was not renewed: %d %+v", rec.Code, renewed)
	}
	var days float64
	if err := e.db.QueryRow(`SELECT julianday(expiry) - julianday('now') FROM sessions`).Scan(&days); err != nil || days < 13 {
		t.Fatalf("stored expiry is %.1f days away, %v", days, err)
	}
}

func TestExpiredSessionIs401(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	if _, err := e.db.Exec(`UPDATE sessions SET expiry = '2000-01-01T00:00:00Z'`); err != nil {
		t.Fatal(err)
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(c)); rec.Code != 401 {
		t.Fatalf("expired = %d", rec.Code)
	}
}

func TestLoginRotatesSessionAndIgnoresPlantedCookie(t *testing.T) {
	e := newEnv(t, opts{})
	planted := &http.Cookie{Name: auth.CookieName, Value: "attacker-chosen-token"}
	rec := e.do("POST", "/api/v1/auth/login", loginBody(testUsername, testPassword), cookie(planted))
	c := sessionCookie(rec)
	if c == nil || c.Value == "attacker-chosen-token" {
		t.Fatalf("login must issue a fresh token, got %+v", c)
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(planted)); rec.Code != 401 {
		t.Fatalf("planted cookie works: %d", rec.Code)
	}
	if again := e.login(t); again.Value == c.Value {
		t.Fatal("two logins share a token")
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t, opts{})
	var last *httptest.ResponseRecorder
	for range 11 {
		last = e.do("POST", "/api/v1/auth/login", loginBody(testUsername, "wrong wrong wrong"), remote("198.51.100.7:1234"))
	}
	if last.Code != 429 || last.Header().Get("Retry-After") == "" {
		t.Fatalf("11th attempt on one account = %d, Retry-After %q", last.Code, last.Header().Get("Retry-After"))
	}
	if strings.Contains(strings.ToLower(last.Body.String()), "username") && strings.Contains(strings.ToLower(last.Body.String()), "wrong") {
		t.Fatal("the 429 must not say which field was wrong")
	}
	other := e.do("POST", "/api/v1/auth/login", loginBody("kim", "wrong wrong wrong"), remote("203.0.113.1:1234"))
	if other.Code != 401 {
		t.Fatalf("another account from another IP is not limited: %d", other.Code)
	}
}

func TestForgedForwardedIPDoesNotBypassTheLimit(t *testing.T) {
	e := newEnv(t, opts{})
	var last *httptest.ResponseRecorder
	for i := range 31 {
		n := strconv.Itoa(i)
		last = e.do("POST", "/api/v1/auth/login", loginBody("nobody"+n, "wrong wrong wrong"),
			remote("198.51.100.7:1234"), header("CF-Connecting-IP", "10.9.9."+n), header("X-Forwarded-For", "1.2.3."+n))
	}
	if last.Code != 429 {
		t.Fatalf("31st attempt with rotating spoofed headers = %d, want 429", last.Code)
	}
}

func TestMutationWithForeignOriginIs403(t *testing.T) {
	e := newEnv(t, opts{})
	rec := e.do("POST", "/api/v1/auth/login", loginBody(testUsername, testPassword), header("Origin", "https://evil.example"))
	if rec.Code != 403 || !strings.Contains(rec.Body.String(), "bad_origin") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	form := httptest.NewRequest("POST", "/api/v1/auth/login", strings.NewReader("email=a&password=b"))
	form.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, form)
	if w.Code != 415 {
		t.Fatalf("form post = %d", w.Code)
	}
}

func TestLogoutAllRevokesEveryDevice(t *testing.T) {
	e := newEnv(t, opts{})
	phone, laptop := e.login(t), e.login(t)
	if rec := e.do("POST", "/api/v1/auth/logout-all", "", cookie(phone)); rec.Code != 204 {
		t.Fatalf("logout-all = %d %s", rec.Code, rec.Body)
	}
	for name, c := range map[string]*http.Cookie{"phone": phone, "laptop": laptop} {
		if rec := e.do("GET", "/api/v1/auth/me", "", cookie(c)); rec.Code != 401 {
			t.Errorf("%s still signed in: %d", name, rec.Code)
		}
	}
}

func TestAccessHeaderNeverAuthenticates(t *testing.T) {
	e := newEnv(t, opts{})
	rec := e.do("GET", "/api/v1/auth/me", "", header("Cf-Access-Authenticated-User-Email", testUsername), remote("172.18.0.5:1"))
	if rec.Code != 401 {
		t.Fatalf("an identity header authenticated the request: %d", rec.Code)
	}
}

func TestLogsNeverContainSecrets(t *testing.T) {
	e := newEnv(t, opts{})
	c := e.login(t)
	e.do("GET", "/api/v1/auth/me?token=hunter2", "", cookie(c))
	e.do("POST", "/api/v1/auth/login", loginBody(testUsername, "my-secret-wrong-pw"))
	out := e.logs.String()
	for _, secret := range []string{testPassword, "my-secret-wrong-pw", c.Value, "hunter2", "198.51.100", "192.0.2.1"} {
		if strings.Contains(out, secret) {
			t.Errorf("logs contain %q", secret)
		}
	}
	if !strings.Contains(out, "login ok") || !strings.Contains(out, "login failed") {
		t.Error("expected audit lines for success and failure")
	}
}

func TestPanicBecomesProblem(t *testing.T) {
	e := newEnv(t, opts{register: func(_ huma.API, r chi.Router) {
		r.Get("/boom", func(http.ResponseWriter, *http.Request) { panic("kaboom") })
	}})
	c := e.login(t)
	rec := e.do("GET", "/api/v1/boom", "", cookie(c))
	if rec.Code != 500 || !strings.Contains(rec.Body.String(), `"code":"internal"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "kaboom") {
		t.Fatal("panic value leaked to the client")
	}
	if !strings.Contains(e.logs.String(), "kaboom") {
		t.Fatal("panic was not logged")
	}
}

func TestBodyLimit(t *testing.T) {
	type in struct {
		Body struct {
			X string `json:"x"`
		}
	}
	e := newEnv(t, opts{register: func(api huma.API, _ chi.Router) {
		huma.Post(api, "/echo", func(_ context.Context, _ *in) (*struct{}, error) { return nil, nil })
	}})
	c := e.login(t)
	big := `{"x":"` + strings.Repeat("a", 2<<20) + `"}`
	if rec := e.do("POST", "/api/v1/echo", big, cookie(c)); rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("code = %d %s", rec.Code, rec.Body)
	}
}

func TestOpenAPIIsServedAndDeclaresTheSessionScheme(t *testing.T) {
	e := newEnv(t, opts{})
	rec := e.do("GET", "/api/v1/openapi.json", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"openapi":"3.1`) || !strings.Contains(rec.Body.String(), "__Host-plate_session") {
		t.Fatalf("got %d %.200s", rec.Code, rec.Body)
	}
}

func TestSPAFallbackServesNonAPIPaths(t *testing.T) {
	e := newEnv(t, opts{})
	if rec := e.do("GET", "/log/2026-11-13", ""); rec.Body.String() != "spa" {
		t.Fatalf("body = %q", rec.Body)
	}
}

func TestHealthChecksAreQuietUnlessTheyFail(t *testing.T) {
	var logs bytes.Buffer
	log := slog.New(slog.NewJSONHandler(&logs, nil))
	status := http.StatusOK
	h := accessLog(log)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(status) }))
	call := func(path string) {
		h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}

	call("/readyz")
	call("/healthz")
	if logs.Len() != 0 {
		t.Fatalf("a healthy probe was logged at info: %s", logs.String())
	}
	call("/api/v1/auth/me")
	if !strings.Contains(logs.String(), "/api/v1/auth/me") {
		t.Fatal("an ordinary request must still be logged")
	}
	logs.Reset()
	status = http.StatusServiceUnavailable
	call("/readyz")
	if !strings.Contains(logs.String(), `"status":503`) {
		t.Fatalf("a failing probe must be logged: %s", logs.String())
	}
}
