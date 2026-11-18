package webui

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func serve(h http.Handler, method, target string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
	return rec
}

func TestMissingBuildGivesMessageNotPanic(t *testing.T) {
	rec := serve(handler(fstest.MapFS{}), http.MethodGet, "/")
	if rec.Code != http.StatusServiceUnavailable || !strings.Contains(rec.Body.String(), "make dev-web") {
		t.Fatalf("got %d %q", rec.Code, rec.Body)
	}
}

func TestEmbeddedPlaceholderIsHandled(t *testing.T) {
	rec := serve(Handler(), http.MethodGet, "/anything")
	if rec.Code != http.StatusServiceUnavailable && rec.Code != http.StatusOK {
		t.Fatalf("code = %d", rec.Code)
	}
}

func TestSPAFallbackAndCaching(t *testing.T) {
	root := fstest.MapFS{
		"index.html":    {Data: []byte("<html>app</html>")},
		"assets/a-1.js": {Data: []byte("js")},
		"sw.js":         {Data: []byte("sw")},
	}
	h := handler(root)

	if rec := serve(h, http.MethodGet, "/log/2026-11-13"); rec.Code != 200 || !strings.Contains(rec.Body.String(), "app") {
		t.Fatalf("client route: %d %q", rec.Code, rec.Body)
	}
	if rec := serve(h, http.MethodGet, "/assets/a-1.js"); !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("asset cache = %q", rec.Header().Get("Cache-Control"))
	}
	if rec := serve(h, http.MethodGet, "/sw.js"); rec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("sw cache = %q", rec.Header().Get("Cache-Control"))
	}
	if rec := serve(h, http.MethodGet, "/assets/missing.js"); rec.Code != 404 {
		t.Fatalf("missing asset = %d", rec.Code)
	}
	if rec := serve(h, http.MethodPost, "/"); rec.Code != 405 {
		t.Fatalf("post = %d", rec.Code)
	}
}

func TestManifestHasItsOwnContentType(t *testing.T) {
	root := fstest.MapFS{"index.html": {Data: []byte("x")}, "manifest.webmanifest": {Data: []byte("{}")}}
	rec := serve(handler(root), http.MethodGet, "/manifest.webmanifest")
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "application/manifest+json") {
		t.Fatalf("content type = %q", got)
	}
}
