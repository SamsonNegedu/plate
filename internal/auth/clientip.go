package auth

import (
	"net"
	"net/http"
	"net/netip"
)

// ClientIP is the socket peer address. It never reads forwarded headers: nothing in front of the app is trusted to set them.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	return a.Unmap().String()
}
