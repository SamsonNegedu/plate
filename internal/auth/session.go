package auth

import (
	"net/http"
	"time"

	"github.com/alexedwards/scs/v2"
)

const (
	CookieName  = "__Host-plate_session"
	Lifetime    = 30 * 24 * time.Hour
	IdleTimeout = 14 * 24 * time.Hour
	UserKey     = userKey
)

// NewSessionManager configures scs with the cookie flags from ADR-009.
func NewSessionManager(store scs.Store) *scs.SessionManager {
	m := scs.New()
	m.Store = store
	m.Lifetime = Lifetime
	m.IdleTimeout = IdleTimeout
	m.Cookie.Name = CookieName
	m.Cookie.Path = "/"
	m.Cookie.HttpOnly = true
	m.Cookie.Secure = true
	m.Cookie.SameSite = http.SameSiteLaxMode
	m.Cookie.Persist = true
	return m
}
