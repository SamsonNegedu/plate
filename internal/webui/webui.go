// Package webui serves the embedded single-page app.
package webui

import (
	"compress/gzip"
	"embed"
	"errors"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

//go:embed all:dist
var dist embed.FS

func init() {
	// Not every system's mime table knows the manifest type.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

const missingMessage = "The web app is not built. Run `make dev-web` for the Vite dev server or `make build` for the embedded app.\n"

// Handler serves files from the embedded build, falling back to index.html for client routes.
func Handler() http.Handler {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return missing()
	}
	return handler(sub)
}

func handler(root fs.FS) http.Handler {
	if _, err := fs.Stat(root, "index.html"); err != nil {
		return missing()
	}
	files := http.FileServerFS(root)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if strings.HasPrefix(name, "ocr/") && serveGzipped(w, r, root, name) {
			return
		}
		info, err := fs.Stat(root, name)
		switch {
		case err != nil || info.IsDir():
			if path.Ext(name) != "" {
				http.NotFound(w, r)
				return
			}
			serveIndex(w, r, root)
		case strings.HasPrefix(name, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			files.ServeHTTP(w, r)
		default:
			w.Header().Set("Cache-Control", "no-cache")
			files.ServeHTTP(w, r)
		}
	})
}

func serveIndex(w http.ResponseWriter, r *http.Request, root fs.FS) {
	b, err := fs.ReadFile(root, "index.html")
	if err != nil {
		http.Error(w, "index.html unreadable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(b)
}

func missing() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = w.Write([]byte(missingMessage))
	})
}

// serveGzipped sends a build-time gzipped file (the label reader's models and runtime) under its plain name. A client
// that accepts gzip gets the bytes as stored; any other gets them decompressed. It reports whether it answered.
func serveGzipped(w http.ResponseWriter, r *http.Request, root fs.FS, name string) bool {
	f, err := root.Open(name + ".gz")
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()
	ctype := mime.TypeByExtension(path.Ext(name))
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ctype)
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Vary", "Accept-Encoding")
	var src io.Reader = f
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
	} else {
		zr, err := gzip.NewReader(f)
		if err != nil {
			http.Error(w, "reader unreadable", http.StatusInternalServerError)
			return true
		}
		defer func() { _ = zr.Close() }()
		src = zr
	}
	if r.Method == http.MethodHead {
		return true
	}
	if _, err := io.Copy(w, src); err != nil && !errors.Is(err, io.EOF) {
		return true // the client went away; nothing useful to add
	}
	return true
}
