package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"plate/internal/auth"
	"plate/internal/config"
	"plate/internal/domain"
	"plate/internal/food"
	"plate/internal/store"
)

func TestStartupBootstrapsAndImportsTheCatalog(t *testing.T) {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	db, err := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	seed := filepath.Join(t.TempDir(), "seed.db")
	err = food.WriteSeed(seed, []domain.CatalogFood{{Barcode: "3017620422003", Name: "Nutella", Per100: domain.Nutrients{Kcal: 539}}},
		food.SeedMeta{DatasetVersion: "v1", BuiltAt: "2026-11-13T00:00:00Z", Source: "OFF"})
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		IntegrityCheck: true, AdminEmail: "a@example.com", AdminPassword: "correct horse battery", ImportCatalog: seed,
	}
	if err := startupActions(ctx, cfg, log, db, auth.NewSessionStore(db)); err != nil {
		t.Fatal(err)
	}
	r := store.NewRepo(db)
	if n, _ := r.CountUsers(ctx); n != 1 {
		t.Fatalf("users = %d", n)
	}
	if c, err := r.CatalogByBarcode(ctx, "3017620422003"); err != nil || c.Name != "Nutella" {
		t.Fatalf("catalog = %+v, %v", c, err)
	}
}

func TestStartupFindsTheBundledCatalog(t *testing.T) {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	dataDir := t.TempDir()
	db, _ := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	seed := filepath.Join(dataDir, "off-catalog.db")
	err := food.WriteSeed(seed, []domain.CatalogFood{{Barcode: "3017620422003", Name: "Nutella", Per100: domain.Nutrients{Kcal: 539}}},
		food.SeedMeta{DatasetVersion: "v1", BuiltAt: "2026-11-13T00:00:00Z", Source: "OFF"})
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		IntegrityCheck: true, AdminEmail: "a@example.com", AdminPassword: "correct horse battery", DataDir: dataDir,
	}
	if err := startupActions(ctx, cfg, log, db, auth.NewSessionStore(db)); err != nil {
		t.Fatal(err)
	}
	if c, err := store.NewRepo(db).CatalogByBarcode(ctx, "3017620422003"); err != nil || c.Name != "Nutella" {
		t.Fatalf("catalog = %+v, %v", c, err)
	}
}

func TestStartupSkipsAnExistingCatalog(t *testing.T) {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	db, _ := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	seed := filepath.Join(t.TempDir(), "seed.db")
	err := food.WriteSeed(seed, []domain.CatalogFood{{Barcode: "3017620422003", Name: "Nutella", Per100: domain.Nutrients{Kcal: 539}}},
		food.SeedMeta{DatasetVersion: "v1", BuiltAt: "2026-11-13T00:00:00Z", Source: "OFF"})
	if err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{
		IntegrityCheck: true, AdminEmail: "a@example.com", AdminPassword: "correct horse battery", ImportCatalog: seed,
	}
	if err := startupActions(ctx, cfg, log, db, auth.NewSessionStore(db)); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(seed); err != nil {
		t.Fatal(err)
	}
	if err := startupActions(ctx, cfg, log, db, auth.NewSessionStore(db)); err != nil {
		t.Fatalf("second boot must not touch an existing catalog: %v", err)
	}
	if c, err := store.NewRepo(db).CatalogByBarcode(ctx, "3017620422003"); err != nil || c.Name != "Nutella" {
		t.Fatalf("catalog = %+v, %v", c, err)
	}
}

func TestStartupRefusesABadCatalogWithoutTouchingTheOldOne(t *testing.T) {
	ctx := context.Background()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	db, _ := store.Open(filepath.Join(t.TempDir(), "plate.db"))
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(ctx, db, ""); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{AdminEmail: "a@example.com", AdminPassword: "correct horse battery", ImportCatalog: filepath.Join(t.TempDir(), "missing.db")}
	if err := startupActions(ctx, cfg, log, db, auth.NewSessionStore(db)); err == nil {
		t.Fatal("a missing seed must stop startup, not be ignored")
	}
}
