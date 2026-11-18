// Package httpapi wires the chi router, middleware and Huma operations.
package httpapi

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humachi"
	"github.com/go-chi/chi/v5"

	"plate/internal/config"
	"plate/internal/food"
	"plate/internal/store"
	psync "plate/internal/sync"
)

const APIPrefix = "/api/v1"

// Deps are the collaborators handlers need. Later phases add fields.
type Deps struct {
	Config config.Config
	Log    *slog.Logger
	DB     *sql.DB
	// Auth is required: every API route is private unless auth.go says it is public.
	Auth *Auth
	// Food resolves barcodes and searches; Images serves the image proxy. Both are required.
	Food   *food.Service
	Images *food.Images
	// Web serves the SPA for every path the API does not own.
	Web http.Handler
	// Register adds Huma operations. Phases 3 and later hook in here.
	Register func(api huma.API, mux chi.Router)
}

// New builds the full handler tree and returns the Huma API for spec generation.
func New(d Deps) (http.Handler, huma.API) {
	installErrorModel()

	r := chi.NewRouter()
	r.Use(
		requestID,
		recoverer(d.Log),
		accessLog(d.Log),
		securityHeaders(d.Config.BaseURL.Scheme == "https"),
		noStoreAPI,
		d.csrf,
		bodyLimit,
	)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write([]byte("ok"))
	})
	r.Get("/readyz", d.readyz)

	cfg := huma.DefaultConfig("Plate API", "1.0.0")
	cfg.Info.Description = "Single-user calorie log. Errors are RFC 9457 problems with a stable `code`."
	cfg.DocsPath = ""
	cfg.CreateHooks = nil // no $schema field: export documents must re-import unchanged
	cfg.Components.SecuritySchemes = map[string]*huma.SecurityScheme{
		"session": {Type: "apiKey", In: "cookie", Name: "__Host-plate_session"},
	}
	cfg.Servers = []*huma.Server{{URL: APIPrefix}}
	var api huma.API
	apiNotFound := func(w http.ResponseWriter, r *http.Request) {
		writeProblem(w, r, http.StatusNotFound, "not_found", "No such API route.")
	}
	r.Route(APIPrefix, func(sub chi.Router) {
		sub.NotFound(apiNotFound)
		sub.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			writeProblem(w, r, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.")
		})
		d.useAuth(sub)
		api = humachi.New(sub, cfg)
		d.registerAuth(api)
		sv := psync.NewService(d.DB)
		sv.SetAttribution(food.Attributions())
		d.registerCore(api, sv)
		d.registerFoods(api)
		d.registerSync(api, sv)
		if d.Register != nil {
			d.Register(api, sub)
		}
	})

	r.Handle("/api/*", http.HandlerFunc(apiNotFound))
	if d.Web != nil {
		r.NotFound(d.Web.ServeHTTP)
	}
	return r, api
}

func (d Deps) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	w.Header().Set("Cache-Control", "no-store")

	if err := d.DB.PingContext(ctx); err != nil {
		writeProblem(w, r, http.StatusServiceUnavailable, "db_unavailable", "Database is not reachable.")
		return
	}
	pending, err := store.Pending(ctx, d.DB)
	if err != nil || pending > 0 {
		writeProblem(w, r, http.StatusServiceUnavailable, "migrations_pending", "Migrations have not finished.")
		return
	}
	_, _ = w.Write([]byte("ready"))
}
