package auth

import (
	"time"

	"plate/internal/ratelimit"
)

// LoginLimits bundles the three login buckets: per IP, per account, and one global bucket against many-IP floods.
type LoginLimits struct {
	IP      *ratelimit.Limiter
	Account *ratelimit.Limiter
	Global  *ratelimit.Limiter
}

func NewLoginLimits() *LoginLimits {
	return &LoginLimits{
		IP:      ratelimit.NewLimiter(5, time.Minute),
		Account: ratelimit.NewLimiter(10, 15*time.Minute),
		Global:  ratelimit.NewLimiter(60, time.Minute),
	}
}

// Check records one login attempt and returns how long to wait when any bucket is full.
func (ll *LoginLimits) Check(ip, account string) (bool, time.Duration) {
	var wait time.Duration
	ok := true
	for _, c := range []struct {
		l   *ratelimit.Limiter
		key string
	}{{ll.Global, "all"}, {ll.IP, ip}, {ll.Account, account}} {
		if allowed, w := c.l.Allow(c.key); !allowed {
			ok = false
			wait = max(wait, w)
		}
	}
	return ok, wait
}

// Succeeded clears the account bucket after a good login.
func (ll *LoginLimits) Succeeded(account string) { ll.Account.Reset(account) }
