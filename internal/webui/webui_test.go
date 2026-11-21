package webui

import (
	"bytes"
	"compress/gzip"
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

func gz(t *testing.T, s string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := gzip.NewWriter(&b)
	if _, err := w.Write([]byte(s)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestLabelReaderFilesAreStoredGzippedAndServedUnderTheirPlainNames(t *testing.T) {
	root := fstest.MapFS{
		"index.html":                         {Data: []byte("app")},
		"ocr/det.onnx.gz":                    {Data: gz(t, "model bytes")},
		"ocr/ort-wasm-simd-threaded.wasm.gz": {Data: gz(t, "wasm bytes")},
		"ocr/ort-wasm-simd-threaded.mjs.gz":  {Data: gz(t, "export default 1")},
	}
	h := handler(root)

	req := httptest.NewRequest(http.MethodGet, "/ocr/det.onnx", nil)
	req.Header.Set("Accept-Encoding", "gzip, br")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("gzip client: %d %v", rec.Code, rec.Header())
	}
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	var got bytes.Buffer
	if _, err := got.ReadFrom(zr); err != nil || got.String() != "model bytes" {
		t.Fatalf("body = %q (%v)", got.String(), err)
	}

	plain := serve(h, http.MethodGet, "/ocr/det.onnx")
	if plain.Code != 200 || plain.Header().Get("Content-Encoding") != "" || plain.Body.String() != "model bytes" {
		t.Fatalf("a client without gzip must get the decompressed file: %d %q %v", plain.Code, plain.Body, plain.Header())
	}
	if ct := serve(h, http.MethodGet, "/ocr/ort-wasm-simd-threaded.wasm").Header().Get("Content-Type"); ct != "application/wasm" {
		t.Fatalf("wasm type = %q", ct)
	}
	if ct := serve(h, http.MethodGet, "/ocr/ort-wasm-simd-threaded.mjs").Header().Get("Content-Type"); !strings.Contains(ct, "javascript") {
		t.Fatalf("mjs type = %q (a module script must be served as JavaScript)", ct)
	}
	if rec := serve(h, http.MethodGet, "/ocr/missing.onnx"); rec.Code != 404 {
		t.Fatalf("an unknown reader file = %d", rec.Code)
	}
}
