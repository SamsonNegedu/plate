package auth

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"plate/internal/domain"
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

const goodPassword = "correct horse battery"

func newAccount(t *testing.T, d *sql.DB, name string) (string, []string) {
	t.Helper()
	u, codes, err := Register(context.Background(), d, name, goodPassword)
	if err != nil {
		t.Fatal(err)
	}
	return u.ID, codes
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

func TestRegisterCreatesAccountAndEightHashedCodes(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	u, codes, err := Register(ctx, d, "  Sam.Lee ", goodPassword)
	if err != nil {
		t.Fatal(err)
	}
	if u.Username != "sam.lee" || strings.Contains(u.PasswordHash, goodPassword) {
		t.Fatalf("user = %+v", u)
	}
	if len(codes) != RecoveryCodeCount {
		t.Fatalf("codes = %d", len(codes))
	}
	r := store.NewRepo(d)
	if n, _ := r.CountRecoveryCodes(ctx, u.ID); n != RecoveryCodeCount {
		t.Fatalf("stored codes = %d", n)
	}
	var plain int
	_ = d.QueryRow(`SELECT count(*) FROM recovery_codes WHERE CAST(code_hash AS TEXT) LIKE ?`, "%"+strings.ReplaceAll(codes[0], "-", "")+"%").Scan(&plain)
	if plain != 0 {
		t.Fatal("a recovery code is stored in the clear")
	}
}

func TestRegisterRejectsBadInputAndDuplicates(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	newAccount(t, d, "sam")
	if _, _, err := Register(ctx, d, "SAM", goodPassword); !errors.Is(err, domain.ErrConflict) {
		t.Fatalf("duplicate (case-insensitive) = %v", err)
	}
	for _, bad := range []string{"", "ab", "has space", "-leading", strings.Repeat("a", 65), "semi;colon"} {
		if _, _, err := Register(ctx, d, bad, goodPassword); !errors.Is(err, ErrBadUsername) {
			t.Errorf("%q = %v, want ErrBadUsername", bad, err)
		}
	}
	if _, _, err := Register(ctx, d, "other", "password1234"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("weak = %v", err)
	}
	if n, _ := store.NewRepo(d).CountUsers(ctx); n != 1 {
		t.Fatalf("users = %d, a rejected signup must not create one", n)
	}
}

func TestFormerEmailSignInIsAValidUsername(t *testing.T) {
	if got, err := NormalizeUsername("Admin@Example.com"); err != nil || got != "admin@example.com" {
		t.Fatalf("got %q, %v", got, err)
	}
}

func TestRecoveryCodeIsTolerantOfHowItIsTyped(t *testing.T) {
	codes, hashes, err := NewRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	typed := strings.ToLower(strings.ReplaceAll(codes[0], "-", " "))
	if h, ok := HashRecoveryCode(typed); !ok || !bytes.Equal(h, hashes[0]) {
		t.Fatal("lowercase and spaces must hash the same")
	}
	if _, ok := HashRecoveryCode("short"); ok {
		t.Fatal("a short string is not a code")
	}
	if _, ok := HashRecoveryCode("ABCDE-FGHJU"); ok {
		t.Fatal("U is not in the alphabet")
	}
}

func TestResetWithCodeSpendsTheCodeAndSignsOutEveryDevice(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	uid, codes := newAccount(t, d, "sam")
	for _, tok := range []string{"t1", "t2"} {
		b, _ := s.codec.Encode(time.Now().Add(time.Hour), map[string]any{UserKey: uid})
		if err := s.Commit(tok, b, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if err := ResetWithCode(ctx, d, s, "SAM", codes[0], "a brand new passphrase"); err != nil {
		t.Fatal(err)
	}
	u, _ := store.NewRepo(d).UserByID(ctx, uid)
	if ok, _ := VerifyPassword("a brand new passphrase", u.PasswordHash); !ok {
		t.Fatal("new password does not verify")
	}
	if n, _ := s.Count(ctx, uid); n != 0 {
		t.Fatalf("sessions left = %d", n)
	}
	if n, _ := store.NewRepo(d).CountRecoveryCodes(ctx, uid); n != RecoveryCodeCount-1 {
		t.Fatalf("codes left = %d", n)
	}
	if err := ResetWithCode(ctx, d, s, "sam", codes[0], "yet another passphrase"); !errors.Is(err, ErrBadRecovery) {
		t.Fatalf("a spent code worked again: %v", err)
	}
}

func TestResetFailuresAreIndistinguishable(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	_, codes := newAccount(t, d, "sam")
	_, otherCodes := newAccount(t, d, "kim")
	cases := map[string][2]string{
		"unknown user":      {"nobody", codes[0]},
		"wrong code":        {"sam", "AAAAA-AAAAA"},
		"someone else's":    {"sam", otherCodes[0]},
		"malformed":         {"sam", "nope"},
		"malformed account": {"!!", codes[0]},
	}
	for name, c := range cases {
		if err := ResetWithCode(ctx, d, s, c[0], c[1], "a brand new passphrase"); !errors.Is(err, ErrBadRecovery) {
			t.Errorf("%s = %v, want ErrBadRecovery", name, err)
		}
	}
	if err := ResetWithCode(ctx, d, s, "sam", codes[0], "short"); !errors.Is(err, ErrWeakPassword) {
		t.Fatalf("weak new password = %v", err)
	}
}

func TestNewCodesReplaceTheOldOnes(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	uid, old := newAccount(t, d, "sam")
	fresh, err := NewCodes(ctx, d, uid)
	if err != nil || len(fresh) != RecoveryCodeCount {
		t.Fatalf("fresh = %v, %v", fresh, err)
	}
	if err := ResetWithCode(ctx, d, NewSessionStore(d), "sam", old[0], "a brand new passphrase"); !errors.Is(err, ErrBadRecovery) {
		t.Fatalf("an old code survived regeneration: %v", err)
	}
	if err := ResetWithCode(ctx, d, NewSessionStore(d), "sam", fresh[0], "a brand new passphrase"); err != nil {
		t.Fatal(err)
	}
}

func newPoW(t *testing.T, bits int) *PoW {
	t.Helper()
	p, err := NewPoW(bits)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestPoWSolvedChallengeIsAcceptedOnce(t *testing.T) {
	p := newPoW(t, 8)
	c, _ := p.Issue()
	n := Solve(c)
	if err := p.Verify(c, n); err != nil {
		t.Fatal(err)
	}
	if err := p.Verify(c, n); !errors.Is(err, ErrReplayed) {
		t.Fatalf("replay = %v", err)
	}
}

func TestPoWRejectsForgeryWeakWorkAndExpiry(t *testing.T) {
	p := newPoW(t, 12)
	c, _ := p.Issue()

	lowered := c
	lowered.Bits = 0
	if err := p.Verify(lowered, 0); !errors.Is(err, ErrBadChallenge) {
		t.Fatalf("a lowered difficulty = %v", err)
	}
	other := newPoW(t, 12)
	if err := other.Verify(c, Solve(c)); !errors.Is(err, ErrBadChallenge) {
		t.Fatalf("a challenge from another server = %v", err)
	}
	n := Solve(c)
	for bad := n + 1; ; bad++ { // the next counter that does not meet the target
		if leadingZeroBits(workHash(c.Salt, bad)) < c.Bits {
			if err := p.Verify(c, bad); !errors.Is(err, ErrWorkTooLow) {
				t.Fatalf("weak work = %v", err)
			}
			break
		}
	}
	p.now = func() time.Time { return time.Now().Add(ChallengeTTL + time.Minute) }
	if err := p.Verify(c, n); !errors.Is(err, ErrExpired) {
		t.Fatalf("expired = %v", err)
	}
}

func TestPoWDifficultyRisesUnderLoadAndRecovers(t *testing.T) {
	p := newPoW(t, 0)
	now := time.Now()
	p.now = func() time.Time { return now }
	if c, _ := p.Issue(); c.Bits != 0 {
		t.Fatalf("idle bits = %d", c.Bits)
	}
	for range 31 {
		c, _ := p.Issue()
		if err := p.Verify(c, Solve(c)); err != nil {
			t.Fatal(err)
		}
	}
	if c, _ := p.Issue(); c.Bits != 1 {
		t.Fatalf("busy bits = %d, want 1", c.Bits)
	}
	now = now.Add(loadWindow + time.Second)
	if c, _ := p.Issue(); c.Bits != 0 {
		t.Fatalf("recovered bits = %d", c.Bits)
	}
}

func TestPoWRejectsOutOfRangeBase(t *testing.T) {
	if _, err := NewPoW(MaxPoWBits + 1); err == nil {
		t.Fatal("too many bits accepted")
	}
}

func TestSessionStoreHashesTokenAndExpires(t *testing.T) {
	ctx := context.Background()
	d := testDB(t)
	s := NewSessionStore(d)
	uid, _ := newAccount(t, d, "admin")
	b, _ := s.codec.Encode(time.Now().Add(time.Hour), map[string]any{UserKey: uid})

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

func TestClientIPIgnoresForwardedHeaders(t *testing.T) {
	hdr := map[string]string{"CF-Connecting-IP": "203.0.113.9", "X-Forwarded-For": "203.0.113.10", "Cf-Access-Authenticated-User-Email": "me@x.y"}
	if got := ClientIP(req("198.51.100.7:4000", hdr)); got != "198.51.100.7" {
		t.Errorf("forwarded headers must be ignored: %q", got)
	}
	if got := ClientIP(req("[::ffff:198.51.100.7]:4000", nil)); got != "198.51.100.7" {
		t.Errorf("mapped IPv4: %q", got)
	}
	if got := ClientIP(req("garbage", nil)); got != "unknown" {
		t.Errorf("unparsable peer: %q", got)
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
