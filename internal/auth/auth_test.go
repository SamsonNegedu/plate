package auth

import (
	"context"
	"database/sql"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"plate/internal/config"
	"plate/internal/ratelimit"
	"plate/internal/store"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := store.Migrate(context.Background(), d, ""); err != nil {
		t.Fatal(err)
	}
	return d
}

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

const goodPassword = "correct horse battery"

func adminCfg(email, pw string) config.Config {
	return config.Config{AdminEmail: email, AdminPassword: pw}
}

func TestPasswordHashAndVerify(t *testing.T) {
	h, err := HashPassword(goodPassword)
	if err != nil || !strings.HasPrefix(h, "$argon2id$") {
		t.Fatalf("hash = %q, %v", h, err)
	}
	if ok, _ := VerifyPassword(goodPassword, h); !ok {
		t.Fatal("correct password rejected")
	}
	if ok, _ := VerifyPassword("wrong password!!", h); ok {
		t.Fatal("wrong password accepted")
	}
}

func TestCheckPassword(t *testing.T) {
	for _, bad := range []string{"short", "elevenchars", "password1234", "PASSWORD1234"} {
		if err := CheckPassword(bad); err == nil {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if err := CheckPassword(goodPassword); err != nil {
		t.Error(err)
	}
}

func TestBootstrapCreatesExactlyOneUser(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	cfg := adminCfg("Admin@Example.com", goodPassword)

	if err := Bootstrap(ctx, cfg, d, s, quiet()); err != nil {
		t.Fatal(err)
	}
	if err := Bootstrap(ctx, cfg, d, s, quiet()); err != nil {
		t.Fatalf("second start: %v", err)
	}
	r := store.NewRepo(d)
	if n, _ := r.CountUsers(ctx); n != 1 {
		t.Fatalf("users = %d", n)
	}
	u, err := r.UserByEmail(ctx, "admin@example.com")
	if err != nil || strings.Contains(u.PasswordHash, goodPassword) {
		t.Fatalf("user = %+v, %v", u, err)
	}
}

func TestBootstrapRefusesToStartWithoutEnv(t *testing.T) {
	err := Bootstrap(context.Background(), adminCfg("", ""), testDB(t), nil, quiet())
	if err == nil || !strings.Contains(err.Error(), "PLATE_ADMIN_EMAIL") || !strings.Contains(err.Error(), "PLATE_ADMIN_PASSWORD") {
		t.Fatalf("err = %v, want both variable names", err)
	}
}

func TestBootstrapRejectsWeakInput(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	if err := Bootstrap(ctx, adminCfg("admin@example.com", "password1234"), d, nil, quiet()); err == nil {
		t.Fatal("common password accepted")
	}
	if err := Bootstrap(ctx, adminCfg("not-an-email", goodPassword), d, nil, quiet()); err == nil {
		t.Fatal("bad email accepted")
	}
	if n, _ := store.NewRepo(d).CountUsers(ctx); n != 0 {
		t.Fatal("a rejected bootstrap must not create a user")
	}
}

func TestResetUpdatesHashAndRevokesEverySession(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	if err := Bootstrap(ctx, adminCfg("admin@example.com", goodPassword), d, s, quiet()); err != nil {
		t.Fatal(err)
	}
	r := store.NewRepo(d)
	u, _ := r.FirstUser(ctx)
	old := u.PasswordHash
	sess := NewSessionManager(s)
	for _, tok := range []string{"t1", "t2"} {
		b, _ := s.codec.Encode(time.Now().Add(time.Hour), map[string]any{UserKey: u.ID})
		if err := s.Commit(tok, b, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	_ = sess

	reset := adminCfg("", "a brand new passphrase")
	reset.ResetPassword = true
	if err := Bootstrap(ctx, reset, d, s, quiet()); err != nil {
		t.Fatal(err)
	}
	u, _ = r.FirstUser(ctx)
	if u.PasswordHash == old {
		t.Fatal("hash unchanged")
	}
	if ok, _ := VerifyPassword("a brand new passphrase", u.PasswordHash); !ok {
		t.Fatal("new password does not verify")
	}
	if ok, _ := VerifyPassword(goodPassword, u.PasswordHash); ok {
		t.Fatal("old password still verifies")
	}
	if n, _ := s.Count(ctx, u.ID); n != 0 {
		t.Fatalf("sessions left = %d", n)
	}
}

func TestResetRefusals(t *testing.T) {
	ctx := context.Background()
	reset := adminCfg("", "a brand new passphrase")
	reset.ResetPassword = true

	empty := testDB(t)
	if err := Bootstrap(ctx, reset, empty, NewSessionStore(empty), quiet()); err == nil {
		t.Fatal("reset with no user must fail, never create one")
	}
	if n, _ := store.NewRepo(empty).CountUsers(ctx); n != 0 {
		t.Fatal("reset created a user")
	}

	d := testDB(t)
	s := NewSessionStore(d)
	if err := Bootstrap(ctx, adminCfg("admin@example.com", goodPassword), d, s, quiet()); err != nil {
		t.Fatal(err)
	}
	short := adminCfg("", "short")
	short.ResetPassword = true
	if err := Bootstrap(ctx, short, d, s, quiet()); err == nil {
		t.Fatal("short reset password accepted")
	}
}

func TestSessionStoreHashesTokenAndExpires(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	if err := Bootstrap(ctx, adminCfg("admin@example.com", goodPassword), d, s, quiet()); err != nil {
		t.Fatal(err)
	}
	u, _ := store.NewRepo(d).FirstUser(ctx)
	b, _ := s.codec.Encode(time.Now().Add(time.Hour), map[string]any{UserKey: u.ID})

	if err := s.Commit("secret-token", b, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	var raw int
	_ = d.QueryRow(`SELECT count(*) FROM sessions WHERE CAST(token_hash AS TEXT) LIKE '%secret-token%'`).Scan(&raw)
	if raw != 0 {
		t.Fatal("the raw token is stored")
	}
	if _, found, _ := s.Find("secret-token"); !found {
		t.Fatal("session not found")
	}

	if err := s.Commit("old-token", b, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.Find("old-token"); found {
		t.Fatal("expired session returned")
	}
	if n, _ := s.PruneExpired(ctx); n != 1 {
		t.Fatalf("pruned = %d, want 1", n)
	}
	if err := s.Delete("secret-token"); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.Find("secret-token"); found {
		t.Fatal("deleted session still found")
	}
}

func TestSessionWithoutUserIsNotPersisted(t *testing.T) {
	d := testDB(t)
	s := NewSessionStore(d)
	b, _ := s.codec.Encode(time.Now().Add(time.Hour), map[string]any{"other": "x"})
	if err := s.Commit("anon", b, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, found, _ := s.Find("anon"); found {
		t.Fatal("anonymous session persisted")
	}
}

func TestSessionManagerCookieFlags(t *testing.T) {
	m := NewSessionManager(NewSessionStore(testDB(t)))
	if m.Cookie.Name != "__Host-plate_session" || !m.Cookie.Secure || !m.Cookie.HttpOnly ||
		m.Cookie.SameSite != http.SameSiteLaxMode || m.Cookie.Path != "/" || m.Cookie.Domain != "" || !m.Cookie.Persist {
		t.Fatalf("cookie = %+v", m.Cookie)
	}
	if m.Lifetime != 30*24*time.Hour || m.IdleTimeout != 14*24*time.Hour {
		t.Fatalf("lifetime %v idle %v", m.Lifetime, m.IdleTimeout)
	}
}

func TestLoginLimitsAccountBucketClearsOnSuccess(t *testing.T) {
	ll := NewLoginLimits()
	ll.IP = ratelimit.NewLimiter(1000, time.Minute)
	ll.Global = ratelimit.NewLimiter(1000, time.Minute)
	for range 10 {
		if ok, _ := ll.Check("1.1.1.1", "a@b.c"); !ok {
			t.Fatal("blocked before 10")
		}
	}
	if ok, _ := ll.Check("1.1.1.1", "a@b.c"); ok {
		t.Fatal("the 11th attempt in 15 minutes must be blocked")
	}
	ll.Succeeded("a@b.c")
	if ok, _ := ll.Check("1.1.1.1", "a@b.c"); !ok {
		t.Fatal("success must clear the account bucket")
	}
}

func req(remote string, hdr map[string]string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.RemoteAddr = remote
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	return r
}

func TestClientIPTrustsCloudflareOnlyFromCIDR(t *testing.T) {
	p := Proxy{Trust: true, CIDRs: []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16")}}
	hdr := map[string]string{"CF-Connecting-IP": "203.0.113.9", "Cf-Access-Authenticated-User-Email": "me@x.y"}

	if got := p.ClientIP(req("172.18.0.5:4000", hdr)); got != "203.0.113.9" {
		t.Errorf("trusted peer: %q", got)
	}
	if got := p.ClientIP(req("198.51.100.7:4000", hdr)); got != "198.51.100.7" {
		t.Errorf("untrusted peer must be ignored: %q", got)
	}
	if got := p.AccessEmail(req("198.51.100.7:4000", hdr)); got != "" {
		t.Errorf("identity header from outside the CIDR must be ignored: %q", got)
	}
	if got := p.AccessEmail(req("172.18.0.5:4000", hdr)); got != "me@x.y" {
		t.Errorf("identity header from the proxy: %q", got)
	}
	if got := (Proxy{}).ClientIP(req("172.18.0.5:4000", hdr)); got != "172.18.0.5" {
		t.Errorf("trust off: %q", got)
	}
	if got := p.ClientIP(req("172.18.0.5:4000", map[string]string{"CF-Connecting-IP": "garbage"})); got != "172.18.0.5" {
		t.Errorf("garbage header: %q", got)
	}
}

func TestCheckMutation(t *testing.T) {
	base, _ := url.Parse("https://plate.example.com")
	mk := func(method string, hdr map[string]string, body string) *http.Request {
		r := httptest.NewRequest(method, "/api/v1/entries/x", strings.NewReader(body))
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		return r
	}
	json := map[string]string{"Content-Type": "application/json"}
	with := func(extra map[string]string) map[string]string {
		m := map[string]string{"Content-Type": "application/json"}
		for k, v := range extra {
			m[k] = v
		}
		return m
	}
	cases := []struct {
		name string
		r    *http.Request
		want CSRFVerdict
	}{
		{"GET is never checked", mk("GET", map[string]string{"Origin": "https://evil.example"}, ""), CSRFOK},
		{"curl with no browser headers", mk("PUT", json, "{}"), CSRFOK},
		{"same origin header", mk("PUT", with(map[string]string{"Origin": "https://plate.example.com"}), "{}"), CSRFOK},
		{"fetch metadata same-origin", mk("PUT", with(map[string]string{"Sec-Fetch-Site": "same-origin", "Origin": "http://localhost:5173"}), "{}"), CSRFOK},
		{"foreign origin", mk("PUT", with(map[string]string{"Origin": "https://evil.example"}), "{}"), CSRFBadOrigin},
		{"cross-site fetch metadata", mk("PUT", with(map[string]string{"Sec-Fetch-Site": "cross-site"}), "{}"), CSRFBadOrigin},
		{"same-site is not same-origin", mk("PUT", with(map[string]string{"Sec-Fetch-Site": "same-site"}), "{}"), CSRFBadOrigin},
		{"navigation", mk("POST", with(map[string]string{"Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "same-origin"}), "{}"), CSRFNavigation},
		{"form post", mk("POST", map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, "a=b"), CSRFBadContentType},
		{"text/plain body", mk("POST", map[string]string{"Content-Type": "text/plain"}, "{}"), CSRFBadContentType},
		{"json with charset", mk("POST", map[string]string{"Content-Type": "application/json; charset=utf-8"}, "{}"), CSRFOK},
		{"bodyless delete needs no content type", mk("DELETE", nil, ""), CSRFOK},
	}
	for _, c := range cases {
		if got := CheckMutation(c.r, base); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
