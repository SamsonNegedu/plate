package auth

import (
	"net/http"
	"net/url"
	"strings"
)

type CSRFVerdict int

const (
	CSRFOK CSRFVerdict = iota
	CSRFBadOrigin
	CSRFBadContentType
	CSRFNavigation
)

// CheckMutation applies the same-origin rules to a state-changing request.
// A request with neither Origin nor Sec-Fetch-Site is not from a browser page, so it passes.
func CheckMutation(r *http.Request, base *url.URL) CSRFVerdict {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return CSRFOK
	}
	if r.Header.Get("Sec-Fetch-Mode") == "navigate" {
		return CSRFNavigation
	}
	site := r.Header.Get("Sec-Fetch-Site")
	if site != "" && site != "same-origin" {
		return CSRFBadOrigin
	}
	if origin := r.Header.Get("Origin"); origin != "" && site != "same-origin" && !sameOrigin(origin, base) {
		return CSRFBadOrigin
	}
	if hasBody(r) && !isJSON(r.Header.Get("Content-Type")) {
		return CSRFBadContentType
	}
	return CSRFOK
}

func hasBody(r *http.Request) bool {
	return r.ContentLength != 0 || len(r.TransferEncoding) > 0
}

func isJSON(ct string) bool {
	ct, _, _ = strings.Cut(ct, ";")
	return strings.EqualFold(strings.TrimSpace(ct), "application/json")
}

func sameOrigin(origin string, base *url.URL) bool {
	u, err := url.Parse(origin)
	if err != nil || base == nil {
		return false
	}
	return strings.EqualFold(u.Scheme, base.Scheme) && strings.EqualFold(u.Host, base.Host)
}
