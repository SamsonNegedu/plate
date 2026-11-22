package main

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"plate/internal/auth"
	"plate/internal/config"
	"plate/internal/food"
	"plate/internal/store"
	psync "plate/internal/sync"
)

// startupActions run once, before the listener opens. Later phases append their one-shot actions here.
func startupActions(ctx context.Context, cfg config.Config, log *slog.Logger, db *sql.DB, sessions *auth.SessionStore) error {
	if cfg.IntegrityCheck {
		var result string
		if err := db.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&result); err != nil {
			return fmt.Errorf("integrity check: %w", err)
		}
		if result != "ok" {
			return fmt.Errorf("integrity check failed: %s", result)
		}
		log.Info("startup action", slog.String("action", "integrity_check"), slog.String("result", result))
	}
	if n, err := sessions.PruneExpired(ctx); err != nil {
		return err
	} else if n > 0 {
		log.Info("startup action", slog.String("action", "prune_sessions"), slog.Int64("removed", n))
	}
	if seed := catalogSeed(cfg); seed != "" {
		repo := store.NewRepo(db)
		importNow := cfg.CatalogReimport
		if !importNow {
			n, err := repo.CountCatalog(ctx)
			if err != nil {
				return fmt.Errorf("checking catalog: %w", err)
			}
			importNow = n == 0
			if !importNow {
				v, _ := repo.CatalogMeta(ctx, "dataset_version")
				log.Info("catalog already present; skipping import",
					slog.String("action", "import_catalog"), slog.Int64("rows", n), slog.String("version", v))
			}
		}
		if importNow {
			if _, err := food.ImportCatalog(ctx, db, seed, log); err != nil {
				return err
			}
			log.Info("catalog import finished",
				slog.String("action", "import_catalog"), slog.String("seed", seed))
		}
	}
	if cfg.ImportBLSPath != "" {
		name, err := auth.NormalizeUsername(cfg.ImportBLSUser)
		if err != nil {
			return fmt.Errorf("PLATE_IMPORT_BLS_USERNAME: %w", err)
		}
		user, err := store.NewRepo(db).UserByUsername(ctx, name)
		if err != nil {
			return fmt.Errorf("BLS import needs an existing account: %w", err)
		}
		if _, err := food.ImportBLS(ctx, db, user.ID, cfg.ImportBLSPath, log); err != nil {
			return err
		}
		log.Warn("BLS imported; remove PLATE_IMPORT_BLS_PATH and restart", slog.String("action", "import_bls"))
	}
	if err := food.EnsureReference(ctx, db, log); err != nil {
		return err
	}
	if cfg.ReindexFTS {
		if err := store.RebuildFTS(ctx, db); err != nil {
			return err
		}
		log.Info("startup action", slog.String("action", "reindex_fts"))
	}
	return nil
}

// catalogSeed is the configured seed or the bundled one: data/off-catalog.db locally, /seed in the image.
func catalogSeed(cfg config.Config) string {
	if cfg.ImportCatalog != "" {
		return cfg.ImportCatalog
	}
	for _, p := range []string{filepath.Join(cfg.DataDir, "off-catalog.db"), "/seed/off-catalog.db"} {
		if info, err := os.Stat(p); err == nil && info.Mode().IsRegular() {
			return p
		}
	}
	return ""
}

func pruneSessionsHourly(ctx context.Context, sessions *auth.SessionStore, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if n, err := sessions.PruneExpired(ctx); err != nil {
				log.Error("session prune failed", slog.String("error", err.Error()))
			} else if n > 0 {
				log.Info("sessions pruned", slog.Int64("removed", n))
			}
		}
	}
}

func maintenanceJobs(foods *food.Service, sync *psync.Service) []store.Job {
	return append(store.CoreJobs(),
		store.Job{Name: "prune_search_cache", Run: func(ctx context.Context, _ *sql.DB) (int64, error) { return foods.PruneCaches(ctx) }},
		store.Job{Name: "prune_change_log", Run: func(ctx context.Context, _ *sql.DB) (int64, error) { return sync.PruneRetention(ctx) }},
	)
}
