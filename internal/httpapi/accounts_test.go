package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"plate/internal/auth"
)

type challenge struct {
	Salt      string `json:"salt"`
	Bits      int    `json:"bits"`
	ExpiresAt int64  `json:"expires_at"`
	Signature string `json:"signature"`
}

type signedUp struct {
	User struct {
		ID       string `json:"id"`
		Username string `json:"username"`
	} `json:"user"`
	RecoveryCodes []string `json:"recovery_codes"`
}

func (e *env) challenge(t *testing.T) challenge {
	t.Helper()
	rec := e.do("GET", "/api/v1/auth/challenge", "")
	if rec.Code != 200 {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body)
	}
	return decode[challenge](t, rec)
}

func signupBody(c challenge, counter uint64, username, password string) string {
	b, _ := json.Marshal(map[string]any{
		"username": username, "password": password, "counter": counter,
		"challenge": map[string]any{"salt": c.Salt, "bits": c.Bits, "expires_at": c.ExpiresAt, "signature": c.Signature},
	})
	return string(b)
}

// signup solves a fresh challenge and creates the account.
func (e *env) signup(t *testing.T, username, password string, opts ...reqOpt) *httptest.ResponseRecorder {
	t.Helper()
	c := e.challenge(t)
	n := auth.Solve(auth.Challenge{Salt: c.Salt, Bits: c.Bits, ExpiresAt: c.ExpiresAt, Signature: c.Signature})
	return e.do("POST", "/api/v1/auth/signup", signupBody(c, n, username, password), opts...)
}

func jsonBody(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestSignupCreatesAnAccountSignsInAndShowsCodesOnce(t *testing.T) {
	e := newEnv(t, opts{})
	rec := e.signup(t, "Kim", "a long passphrase here")
	if rec.Code != 200 {
		t.Fatalf("signup = %d %s", rec.Code, rec.Body)
	}
	got := decode[signedUp](t, rec)
	if got.User.Username != "kim" || len(got.RecoveryCodes) != auth.RecoveryCodeCount {
		t.Fatalf("signup = %+v", got)
	}
	c := sessionCookie(rec)
	if c == nil || !c.HttpOnly || !c.Secure {
		t.Fatalf("signup must start a hardened session: %+v", c)
	}
	me := e.do("GET", "/api/v1/auth/me", "", cookie(c))
	var body struct {
		User      struct{ Username string } `json:"user"`
		Remaining int                       `json:"recovery_codes_remaining"`
	}
	if err := json.Unmarshal(me.Body.Bytes(), &body); err != nil || body.User.Username != "kim" || body.Remaining != auth.RecoveryCodeCount {
		t.Fatalf("me = %d %s", me.Code, me.Body)
	}
	if strings.Contains(me.Body.String(), got.RecoveryCodes[0]) {
		t.Fatal("/auth/me must never return a code")
	}
	if rec := e.do("POST", "/api/v1/auth/login", loginBody("kim", "a long passphrase here")); rec.Code != 200 {
		t.Fatalf("login after signup = %d", rec.Code)
	}
}

func TestSignupNeedsAFreshSolvedChallenge(t *testing.T) {
	e := newEnv(t, opts{})
	var c challenge
	var n uint64
	for n == 0 { // counter 0 fails the target unless the solver lands on it first
		c = e.challenge(t)
		n = auth.Solve(auth.Challenge{Salt: c.Salt, Bits: c.Bits, ExpiresAt: c.ExpiresAt, Signature: c.Signature})
	}
	bad := uint64(0)
	if rec := e.do("POST", "/api/v1/auth/signup", signupBody(c, bad, "kim", "a long passphrase here")); rec.Code != 422 || !strings.Contains(rec.Body.String(), "challenge_invalid") {
		t.Fatalf("unsolved = %d %s", rec.Code, rec.Body)
	}

	if rec := e.do("POST", "/api/v1/auth/signup", signupBody(c, n, "kim", "a long passphrase here")); rec.Code != 200 {
		t.Fatalf("solved = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("POST", "/api/v1/auth/signup", signupBody(c, n, "lee", "a long passphrase here")); rec.Code != 422 {
		t.Fatalf("a replayed solution = %d, want 422", rec.Code)
	}
	lowered := c
	lowered.Bits = 0
	if rec := e.do("POST", "/api/v1/auth/signup", signupBody(lowered, 0, "lee", "a long passphrase here")); rec.Code != 422 {
		t.Fatalf("a forged easier challenge = %d, want 422", rec.Code)
	}
}

func TestSignupRejectsTakenWeakAndMalformed(t *testing.T) {
	e := newEnv(t, opts{})
	for name, tc := range map[string]struct {
		user, pw, code string
		status         int
	}{
		"taken":          {"SAM", "a long passphrase here", "username_taken", 409},
		"weak":           {"kim", "password1234", "weak_password", 422},
		"short":          {"kim", "tiny", "weak_password", 422},
		"bad characters": {"k i m", "a long passphrase here", "invalid_username", 422},
	} {
		rec := e.signup(t, tc.user, tc.pw)
		if rec.Code != tc.status || !strings.Contains(rec.Body.String(), tc.code) {
			t.Errorf("%s = %d %s", name, rec.Code, rec.Body)
		}
	}
	if n := countUsers(t, e); n != 1 {
		t.Fatalf("users = %d, rejected signups must not create accounts", n)
	}
}

func TestSignupCanBeTurnedOff(t *testing.T) {
	e := newEnv(t, opts{signupOff: true})
	if rec := e.do("GET", "/api/v1/auth/challenge", ""); rec.Code != 403 || !strings.Contains(rec.Body.String(), "signup_disabled") {
		t.Fatalf("challenge = %d %s", rec.Code, rec.Body)
	}
	if rec := e.signupWithoutChallenge("kim"); rec.Code != 403 {
		t.Fatalf("signup = %d", rec.Code)
	}
}

func (e *env) signupWithoutChallenge(username string) *httptest.ResponseRecorder {
	c, _ := e.auth.PoW.Issue()
	n := auth.Solve(c)
	return e.do("POST", "/api/v1/auth/signup", signupBody(challenge{Salt: c.Salt, Bits: c.Bits, ExpiresAt: c.ExpiresAt, Signature: c.Signature}, n, username, "a long passphrase here"))
}

func countUsers(t *testing.T, e *env) int {
	t.Helper()
	var n int
	if err := e.db.QueryRow(`SELECT count(*) FROM users`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRecoveryCodeResetsThePasswordOnceAndEndsEverySession(t *testing.T) {
	e := newEnv(t, opts{})
	su := decode[signedUp](t, e.signup(t, "kim", "a long passphrase here"))
	old := e.do("POST", "/api/v1/auth/login", loginBody("kim", "a long passphrase here"))
	oldCookie := sessionCookie(old)

	reset := func(code, pw string) *httptest.ResponseRecorder {
		return e.do("POST", "/api/v1/auth/reset", jsonBody(map[string]string{"username": "KIM", "recovery_code": code, "new_password": pw}))
	}
	if rec := reset(su.RecoveryCodes[0], "brand new passphrase"); rec.Code != 204 {
		t.Fatalf("reset = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(oldCookie)); rec.Code != 401 {
		t.Fatalf("an old session survived a reset: %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/login", loginBody("kim", "a long passphrase here")); rec.Code != 401 {
		t.Fatalf("the old password still works: %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/login", loginBody("kim", "brand new passphrase")); rec.Code != 200 {
		t.Fatalf("the new password does not work: %d", rec.Code)
	}
	if rec := reset(su.RecoveryCodes[0], "yet another passphrase"); rec.Code != 401 || !strings.Contains(rec.Body.String(), "invalid_recovery") {
		t.Fatalf("a spent code = %d %s", rec.Code, rec.Body)
	}
	unknown := e.do("POST", "/api/v1/auth/reset", jsonBody(map[string]string{"username": "nobody", "recovery_code": su.RecoveryCodes[1], "new_password": "yet another passphrase"}))
	wrong := reset("AAAAA-AAAAA", "yet another passphrase")
	if unknown.Code != wrong.Code || unknown.Body.String() == "" || strings.Contains(unknown.Body.String(), "nobody") {
		t.Fatalf("unknown user %d %s vs wrong code %d %s", unknown.Code, unknown.Body, wrong.Code, wrong.Body)
	}
}

func TestResetIsRateLimitedPerAccount(t *testing.T) {
	e := newEnv(t, opts{})
	var last *httptest.ResponseRecorder
	for range 11 {
		last = e.do("POST", "/api/v1/auth/reset", jsonBody(map[string]string{"username": "sam", "recovery_code": "AAAAA-AAAAA", "new_password": "yet another passphrase"}))
	}
	if last.Code != 429 {
		t.Fatalf("11th guess = %d, want 429", last.Code)
	}
}

func TestRegeneratingCodesNeedsThePasswordAndRetiresTheOldOnes(t *testing.T) {
	e := newEnv(t, opts{})
	su := decode[signedUp](t, e.signup(t, "kim", "a long passphrase here"))
	c := sessionCookie(e.do("POST", "/api/v1/auth/login", loginBody("kim", "a long passphrase here")))

	if rec := e.do("POST", "/api/v1/auth/recovery-codes", jsonBody(map[string]string{"password": "wrong wrong wrong"}), cookie(c)); rec.Code != 401 {
		t.Fatalf("wrong password = %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/recovery-codes", jsonBody(map[string]string{"password": "a long passphrase here"})); rec.Code != 401 {
		t.Fatalf("signed out = %d", rec.Code)
	}
	rec := e.do("POST", "/api/v1/auth/recovery-codes", jsonBody(map[string]string{"password": "a long passphrase here"}), cookie(c))
	fresh := decode[struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}](t, rec)
	if rec.Code != 200 || len(fresh.RecoveryCodes) != auth.RecoveryCodeCount || fresh.RecoveryCodes[0] == su.RecoveryCodes[0] {
		t.Fatalf("regenerate = %d %s", rec.Code, rec.Body)
	}
	old := e.do("POST", "/api/v1/auth/reset", jsonBody(map[string]string{"username": "kim", "recovery_code": su.RecoveryCodes[0], "new_password": "yet another passphrase"}))
	if old.Code != 401 {
		t.Fatalf("an old code worked after regeneration: %d", old.Code)
	}
}

func TestAccountsNeverSeeEachOthersData(t *testing.T) {
	e := newEnv(t, opts{})
	sam := e.login(t)
	kim := sessionCookie(e.signup(t, "kim", "a long passphrase here"))

	id := newID()
	if rec := e.do("PUT", "/api/v1/entries/"+id, entryJSON(map[string]any{"name": "Sam's secret oats"}), cookie(sam)); rec.Code != 200 {
		t.Fatalf("put = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/entries/"+id, "", cookie(kim)); rec.Code != 404 {
		t.Fatalf("kim read sam's entry: %d", rec.Code)
	}
	if rec := e.do("PUT", "/api/v1/entries/"+id, entryJSON(map[string]any{"name": "Hijack"}), cookie(kim)); rec.Code == 200 {
		t.Fatalf("kim overwrote sam's entry: %d", rec.Code)
	}
	if rec := e.do("DELETE", "/api/v1/entries/"+id, "", cookie(kim)); rec.Code == 204 {
		if got := e.do("GET", "/api/v1/entries/"+id, "", cookie(sam)); got.Code != 200 {
			t.Fatal("kim's delete removed sam's entry")
		}
	}
	for _, path := range []string{"/export", "/days?from=2026-11-01&to=2026-11-30", "/sync/snapshot"} {
		rec := e.do("GET", "/api/v1"+path, "", cookie(kim))
		if strings.Contains(rec.Body.String(), "Sam's secret oats") {
			t.Fatalf("%s leaked sam's entry to kim", path)
		}
	}
	if rec := e.do("GET", "/api/v1/entries/"+id, "", cookie(sam)); !strings.Contains(rec.Body.String(), "Sam's secret oats") || strings.Contains(rec.Body.String(), "Hijack") {
		t.Fatalf("sam's entry changed: %s", rec.Body)
	}
}

func TestDeletingAnAccountRemovesOnlyThatAccount(t *testing.T) {
	e := newEnv(t, opts{})
	sam := e.login(t)
	kim := sessionCookie(e.signup(t, "kim", "a long passphrase here"))
	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(nil), cookie(sam))
	e.do("PUT", "/api/v1/entries/"+newID(), entryJSON(nil), cookie(kim))

	if rec := e.do("POST", "/api/v1/auth/delete-account", jsonBody(map[string]string{"password": "not the password"}), cookie(kim)); rec.Code != 401 {
		t.Fatalf("wrong password = %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/delete-account", jsonBody(map[string]string{"password": "a long passphrase here"}), cookie(kim)); rec.Code != 204 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(kim)); rec.Code != 401 {
		t.Fatalf("a deleted account still has a session: %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/login", loginBody("kim", "a long passphrase here")); rec.Code != 401 {
		t.Fatalf("a deleted account can sign in: %d", rec.Code)
	}
	for _, tbl := range []string{"entries", "sync_ops", "change_log", "sessions", "recovery_codes"} {
		var n int
		_ = e.db.QueryRow(`SELECT count(*) FROM ` + tbl + ` WHERE user_id = (SELECT id FROM users WHERE username = 'kim')`).Scan(&n)
		if n != 0 {
			t.Errorf("%s still holds %d rows for the deleted account", tbl, n)
		}
	}
	if rec := e.do("GET", "/api/v1/auth/me", "", cookie(sam)); rec.Code != 200 {
		t.Fatalf("sam lost the session: %d", rec.Code)
	}
	var entries int
	_ = e.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&entries)
	if entries != 1 {
		t.Fatalf("entries left = %d, want sam's one", entries)
	}
	if rec := e.signup(t, "kim", "another long passphrase"); rec.Code != 200 {
		t.Fatalf("the name is free again: %d %s", rec.Code, rec.Body)
	}
}

func TestBarcodeLookupLimitIsPerUserNotPerAddress(t *testing.T) {
	e := newEnv(t, opts{})
	sam := e.login(t)
	kim := sessionCookie(e.signup(t, "kim", "a long passphrase here", remote("10.0.0.1:1")))
	for range 60 {
		e.do("GET", "/api/v1/foods/barcode/4000000000011", "", cookie(sam), remote("10.0.0.1:1"))
	}
	if rec := e.do("GET", "/api/v1/foods/barcode/4000000000011", "", cookie(sam), remote("10.0.0.1:1")); rec.Code != 429 {
		t.Fatalf("sam's 61st lookup = %d, want 429", rec.Code)
	}
	if rec := e.do("GET", "/api/v1/foods/barcode/4000000000011", "", cookie(kim), remote("10.0.0.1:1")); rec.Code == 429 {
		t.Fatal("kim shares sam's lookup budget because they share a proxy address")
	}
}

func (e *env) codesSaved(t *testing.T, c *http.Cookie) bool {
	t.Helper()
	rec := e.do("GET", "/api/v1/auth/me", "", cookie(c))
	return decode[struct {
		Saved bool `json:"recovery_codes_saved"`
	}](t, rec).Saved
}

func TestCodesCountAsUnsavedUntilTheySayTheySavedThem(t *testing.T) {
	e := newEnv(t, opts{})
	c := sessionCookie(e.signup(t, "kim", "a long passphrase here"))
	if e.codesSaved(t, c) {
		t.Fatal("a fresh signup must start with the codes unconfirmed")
	}
	if rec := e.do("POST", "/api/v1/auth/recovery-codes/ack", ""); rec.Code != 401 {
		t.Fatalf("ack while signed out = %d", rec.Code)
	}
	if rec := e.do("POST", "/api/v1/auth/recovery-codes/ack", "", cookie(c)); rec.Code != 204 {
		t.Fatalf("ack = %d %s", rec.Code, rec.Body)
	}
	if !e.codesSaved(t, c) {
		t.Fatal("ack did not stick")
	}
	e.do("POST", "/api/v1/auth/recovery-codes", jsonBody(map[string]string{"password": "a long passphrase here"}), cookie(c))
	if e.codesSaved(t, c) {
		t.Fatal("new codes must need a new confirmation")
	}
}

func TestOneAccountsAckDoesNotConfirmAnothers(t *testing.T) {
	e := newEnv(t, opts{})
	sam := e.login(t)
	kim := sessionCookie(e.signup(t, "kim", "a long passphrase here"))
	e.do("POST", "/api/v1/auth/recovery-codes/ack", "", cookie(kim))
	if e.codesSaved(t, sam) {
		t.Fatal("sam's codes were marked saved by kim")
	}
}
