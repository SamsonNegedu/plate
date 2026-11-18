package auth

import (
	"net"
	"net/http"
	"net/netip"
)

// Proxy decides whether forwarded identity headers are believable.
type Proxy struct {
	Trust bool
	CIDRs []netip.Prefix
}

func peerAddr(r *http.Request) (netip.Addr, bool) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}, false
	}
	return a.Unmap(), true
}

// Trusted reports whether the immediate TCP peer is inside the allowlist.
func (p Proxy) Trusted(r *http.Request) bool {
	if !p.Trust || len(p.CIDRs) == 0 {
		return false
	}
	a, ok := peerAddr(r)
	if !ok {
		return false
	}
	for _, c := range p.CIDRs {
		if c.Contains(a) {
			return true
		}
	}
	return false
}

// ClientIP returns CF-Connecting-IP only from a trusted peer; otherwise the socket address.
func (p Proxy) ClientIP(r *http.Request) string {
	if p.Trusted(r) {
		if v := r.Header.Get("CF-Connecting-IP"); v != "" {
			if a, err := netip.ParseAddr(v); err == nil {
				return a.Unmap().String()
			}
		}
	}
	if a, ok := peerAddr(r); ok {
		return a.String()
	}
	return "unknown"
}

// AccessEmail returns the Cloudflare Access identity, honoured only from a trusted peer.
func (p Proxy) AccessEmail(r *http.Request) string {
	if !p.Trusted(r) {
		return ""
	}
	return r.Header.Get("Cf-Access-Authenticated-User-Email")
}
