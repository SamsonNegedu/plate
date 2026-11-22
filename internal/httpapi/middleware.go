package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"
)

// style-src allows one hash: Radix's scroll lock (react-remove-scroll-bar) injects a fixed <style> element when a sheet opens.
// Without it the page behind a sheet scrolls. The hash is of that exact text; the end-to-end suite fails on any CSP violation,
// so a Radix upgrade that changes the text is caught.
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-nzTgYzXYDNe6BAHiiI7NNlfK8n/auuOAhh2t92YvuXo='; img-src 'self' data:; " +
	"connect-src 'self'; font-src 'self'; worker-src 'self' blob:; manifest-src 'self'; " +
	"base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

func requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := uuid.NewString()
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

type statusWriter struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (w *statusWriter) WriteHeader(code int) {
	if w.wrote {
		return // a second call is a no-op; forwarding it only logs "superfluous WriteHeader"
	}
	w.status, w.wrote = code, true
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Write(b []byte) (int, error) {
	if !w.wrote {
		w.status, w.wrote = http.StatusOK, true
	}
	return w.ResponseWriter.Write(b)
}

func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// isProbe is a health check the container runtime or a monitor calls every few seconds.
func isProbe(path string) bool { return path == "/healthz" || path == "/readyz" }

// accessLog logs method, path, status and duration. It never logs query strings, bodies or headers. A health check that
// succeeds is logged at debug level only: it runs every 30 seconds and would otherwise be most of the log; a failing
// one still shows at info.
func accessLog(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(sw, r)
			level := slog.LevelInfo
			if isProbe(r.URL.Path) && sw.status < http.StatusBadRequest {
				level = slog.LevelDebug
			}
			log.LogAttrs(r.Context(), level, "request",
				slog.String("request_id", RequestID(r.Context())),
				slog.String("method", r.Method),
				slog.String("path", r.URL.Path),
				slog.Int("status", sw.status),
				slog.Duration("duration", time.Since(start)),
			)
		})
	}
}

func recoverer(log *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				rec := recover()
				if rec == nil || rec == any(http.ErrAbortHandler) {
					return
				}
				log.ErrorContext(r.Context(), "panic", slog.Any("panic", rec), slog.String("stack", string(debug.Stack())))
				writeProblem(w, r, http.StatusInternalServerError, "internal", "Something went wrong.")
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, detail string) {
	p := Err(status, code, detail)
	p.RequestID = RequestID(r.Context())
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(p)
}

func securityHeaders(hsts bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			h.Set("Content-Security-Policy", csp)
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			if hsts {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			next.ServeHTTP(w, r)
		})
	}
}

const (
	maxBodyBytes   = 1 << 20
	maxImportBytes = 32 << 20
)

func bodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") && r.Body != nil {
			limit := int64(maxBodyBytes)
			if r.URL.Path == APIPrefix+"/import" {
				limit = maxImportBytes
			}
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}

// noStoreAPI keeps authenticated JSON out of every shared cache.
func noStoreAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}
