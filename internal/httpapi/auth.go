package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/alexedwards/scs/v2"
	"github.com/danielgtaylor/huma/v2"
	"github.com/go-chi/chi/v5"

	"plate/internal/auth"
	"plate/internal/domain"
	"plate/internal/ratelimit"
	"plate/internal/store"
)

// Auth is everything the HTTP layer needs to authenticate a request.
type Auth struct {
	Sessions *scs.SessionManager
	Store    *auth.SessionStore
	Limits   *auth.LoginLimits
	Proxy    auth.Proxy
	// ProxyMode trusts Cf-Access-Authenticated-User-Email from the proxy CIDR instead of a session.
	ProxyMode bool
	// Reads and Sync cap requests per user per minute: 60 for the general API, 120 for /sync.
	Reads *ratelimit.Limiter
	Sync  *ratelimit.Limiter
	// Lookups caps barcode lookups per client IP: 60 a minute.
	Lookups *ratelimit.Limiter
}

// NewAuth builds the production auth wiring from the database.
func NewAuth(sessions *auth.SessionStore, proxy auth.Proxy, proxyMode bool) *Auth {
	return &Auth{
		Sessions:  auth.NewSessionManager(sessions),
		Store:     sessions,
		Limits:    auth.NewLoginLimits(),
		Proxy:     proxy,
		ProxyMode: proxyMode,
		Reads:     ratelimit.NewLimiter(300, time.Minute),
		Sync:      ratelimit.NewLimiter(600, time.Minute),
		Lookups:   ratelimit.NewLimiter(60, time.Minute),
	}
}

func (a *Auth) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		uid := UserID(r.Context())
		if uid == "" {
			next.ServeHTTP(w, r)
			return
		}
		l := a.Reads
		if strings.HasPrefix(strings.TrimPrefix(r.URL.Path, APIPrefix), "/sync/") {
			l = a.Sync
		}
		if ok, wait := l.Allow(uid); !ok {
			w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds())+1))
			writeProblem(w, r, http.StatusTooManyRequests, "rate_limited", "Too many requests. Try again shortly.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type authCtxKey int

const (
	userIDKey authCtxKey = iota + 10
	clientIPKey
)

// UserID returns the authenticated user's id. It is empty on public routes.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(userIDKey).(string)
	return id
}

func clientIP(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey).(string)
	return ip
}

var logSalt = func() []byte {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return b
}()

// hashIP lets logs correlate failures without storing addresses.
func hashIP(ip string) string {
	h := sha256.Sum256(append(append([]byte{}, logSalt...), ip...))
	return hex.EncodeToString(h[:6])
}

func (d Deps) csrf(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			switch auth.CheckMutation(r, d.Config.BaseURL) {
			case auth.CSRFBadOrigin:
				writeProblem(w, r, http.StatusForbidden, "bad_origin", "Cross-origin requests are not allowed.")
				return
			case auth.CSRFNavigation:
				writeProblem(w, r, http.StatusForbidden, "bad_fetch_mode", "Navigations cannot call the API.")
				return
			case auth.CSRFBadContentType:
				writeProblem(w, r, http.StatusUnsupportedMediaType, "unsupported_media_type", "Send application/json.")
				return
			case auth.CSRFOK:
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Auth) clientInfo(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), clientIPKey, a.Proxy.ClientIP(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func isPublic(r *http.Request) bool {
	p := strings.TrimPrefix(r.URL.Path, APIPrefix)
	switch p {
	case "/auth/login", "/auth/logout", "/openapi.json", "/openapi.yaml", "/openapi-3.0.json", "/openapi-3.0.yaml":
		return true
	}
	return strings.HasPrefix(p, "/schemas/")
}

// require rejects unauthenticated requests. scs re-commits a loaded session when an idle timeout is set, so every
// authenticated request slides the idle deadline. Everything under /api/v1 is private unless isPublic says otherwise.
func (a *Auth) require(db interface {
	UserByEmail(context.Context, string) (domain.User, error)
}) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isPublic(r) {
				next.ServeHTTP(w, r)
				return
			}
			uid := a.Sessions.GetString(r.Context(), auth.UserKey)
			if uid == "" && a.ProxyMode {
				if email := a.Proxy.AccessEmail(r); email != "" {
					if u, err := db.UserByEmail(r.Context(), strings.ToLower(email)); err == nil {
						uid = u.ID
					}
				}
			}
			if uid == "" {
				writeProblem(w, r, http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDKey, uid)))
		})
	}
}

type loginInput struct {
	Body struct {
		Email    string `json:"email" minLength:"3" maxLength:"254"`
		Password string `json:"password" minLength:"1" maxLength:"1024"`
	}
}

type UserBody struct {
	ID          string  `json:"id"`
	Email       string  `json:"email"`
	LastLoginAt *string `json:"last_login_at"`
}

type userOutput struct{ Body UserBody }

type meOutput struct {
	Body struct {
		User     UserBody `json:"user"`
		AuthMode string   `json:"auth_mode" enum:"password,proxy"`
	}
}

// useAuth installs session loading and the default-deny gate. It must run before any route is registered.
func (d Deps) useAuth(sub chi.Router) {
	sub.Use(d.Auth.Sessions.LoadAndSave, d.Auth.clientInfo, d.Auth.require(store.NewRepo(d.DB)), d.Auth.rateLimit)
}

func (d Deps) registerAuth(api huma.API) {
	a := d.Auth
	repo := store.NewRepo(d.DB)

	huma.Register(api, huma.Operation{
		OperationID: "login",
		Method:      http.MethodPost,
		Path:        "/auth/login",
		Summary:     "Sign in with email and password",
		Tags:        []string{"auth"},
	}, func(ctx context.Context, in *loginInput) (*userOutput, error) {
		return d.login(ctx, a, repo, in)
	})

	huma.Register(api, huma.Operation{
		OperationID:   "logout",
		Method:        http.MethodPost,
		Path:          "/auth/logout",
		Summary:       "End this session",
		Tags:          []string{"auth"},
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*struct{}, error) {
		if uid := a.Sessions.GetString(ctx, auth.UserKey); uid != "" {
			d.Log.InfoContext(ctx, "logout", slog.String("request_id", RequestID(ctx)))
		}
		if err := a.Sessions.Destroy(ctx); err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not end the session.")
		}
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "logout-all",
		Method:        http.MethodPost,
		Path:          "/auth/logout-all",
		Summary:       "End every session for this user",
		Tags:          []string{"auth"},
		DefaultStatus: http.StatusNoContent,
		Security:      []map[string][]string{{"session": {}}},
	}, func(ctx context.Context, _ *struct{}) (*struct{}, error) {
		n, err := a.Store.RevokeUser(ctx, UserID(ctx))
		if err != nil {
			return nil, Err(http.StatusInternalServerError, "internal", "Could not revoke sessions.")
		}
		_ = a.Sessions.Destroy(ctx)
		d.Log.WarnContext(ctx, "sessions revoked", slog.Int64("count", n), slog.String("request_id", RequestID(ctx)))
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "me",
		Method:      http.MethodGet,
		Path:        "/auth/me",
		Summary:     "The signed-in user",
		Tags:        []string{"auth"},
		Security:    []map[string][]string{{"session": {}}},
	}, func(ctx context.Context, _ *struct{}) (*meOutput, error) {
		u, err := repo.UserByID(ctx, UserID(ctx))
		if err != nil {
			return nil, Err(http.StatusUnauthorized, "unauthorized", "Sign in to continue.")
		}
		out := &meOutput{}
		out.Body.User = UserBody{ID: u.ID, Email: u.Email, LastLoginAt: u.LastLoginAt}
		out.Body.AuthMode = d.Config.AuthMode
		return out, nil
	})
}

var errBadLogin = Err(http.StatusUnauthorized, "invalid_credentials", "Email or password is incorrect.")

func (d Deps) login(ctx context.Context, a *Auth, repo *store.Repo, in *loginInput) (*userOutput, error) {
	ip := clientIP(ctx)
	email := strings.ToLower(strings.TrimSpace(in.Body.Email))

	if ok, wait := a.Limits.Check(ip, email); !ok {
		secs := int(wait.Seconds()) + 1
		d.Log.WarnContext(ctx, "login rate limited", slog.String("ip", hashIP(ip)), slog.String("request_id", RequestID(ctx)))
		h := http.Header{}
		h.Set("Retry-After", strconv.Itoa(secs))
		return nil, huma.ErrorWithHeaders(
			Err(http.StatusTooManyRequests, "rate_limited", "Too many attempts. Try again later."), h)
	}

	user, err := repo.UserByEmail(ctx, email)
	switch {
	case errors.Is(err, domain.ErrNotFound):
		auth.BurnPasswordTime(in.Body.Password)
		return nil, d.loginFailed(ctx, ip)
	case err != nil:
		return nil, Err(http.StatusInternalServerError, "internal", "Could not sign in.")
	}
	ok, err := auth.VerifyPassword(in.Body.Password, user.PasswordHash)
	if err != nil || !ok {
		return nil, d.loginFailed(ctx, ip)
	}

	if err := a.Sessions.RenewToken(ctx); err != nil {
		return nil, Err(http.StatusInternalServerError, "internal", "Could not sign in.")
	}
	a.Sessions.Put(ctx, auth.UserKey, user.ID)
	now := time.Now().UTC().Format(time.RFC3339)
	if err := repo.TouchLastLogin(ctx, user.ID, now); err != nil {
		d.Log.ErrorContext(ctx, "recording last login failed", slog.String("error", err.Error()))
	}
	a.Limits.Succeeded(email)
	d.Log.InfoContext(ctx, "login ok", slog.String("ip", hashIP(ip)), slog.String("request_id", RequestID(ctx)))

	out := &userOutput{}
	out.Body = UserBody{ID: user.ID, Email: user.Email, LastLoginAt: user.LastLoginAt}
	return out, nil
}

func (d Deps) loginFailed(ctx context.Context, ip string) error {
	d.Log.WarnContext(ctx, "login failed", slog.String("ip", hashIP(ip)), slog.String("request_id", RequestID(ctx)))
	return errBadLogin
}
