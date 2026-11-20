// Command plate serves the API and the embedded web app.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"plate/internal/auth"
	"plate/internal/config"
	"plate/internal/food"
	"plate/internal/httpapi"
	"plate/internal/store"
	psync "plate/internal/sync"
	"plate/internal/webui"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "-healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "plate:", err)
		os.Exit(1)
	}
}

// healthcheck lets the image probe /readyz without a shell or curl.
func healthcheck() int {
	raw := os.Getenv("PLATE_HEALTHCHECK_URL")
	if raw == "" {
		raw = "http://127.0.0.1:8080/readyz"
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return 1
	}
	host := u.Hostname()
	if host != "localhost" {
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			return 1
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// #nosec G704 -- operator-set loopback probe, not a request-derived URL.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return 1
	}
	// #nosec G704 -- operator-set loopback probe, not a request-derived URL.
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 1
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func run() error {
	cfg, err := config.FromOS()
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: cfg.LogLevel}))

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(cfg.DBPath)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	if err := store.Migrate(ctx, db, filepath.Join(cfg.DataDir, "snapshots")); err != nil {
		return err
	}
	sessions := auth.NewSessionStore(db)
	if err := startupActions(ctx, cfg, log, db, sessions); err != nil {
		return err
	}

	off := food.NewOFF(food.OFFConfig{BaseURL: cfg.OFFBaseURL, SearchURL: cfg.OFFSearchURL, UserAgent: cfg.OFFUserAgent})
	foods := food.NewService(db, off, log)
	images := food.NewImages(db, food.ImagesConfig{
		Dir:        filepath.Join(cfg.DataDir, "images"),
		CacheBytes: cfg.ImageCacheMB << 20,
	})
	pow, err := auth.NewPoW(cfg.SignupPoWBits)
	if err != nil {
		return err
	}
	handler, _ := httpapi.New(httpapi.Deps{
		Config: cfg,
		Log:    log,
		DB:     db,
		Auth:   httpapi.NewAuth(sessions, pow),
		Food:   foods,
		Images: images,
		Web:    webui.Handler(),
	})
	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	syncSvc := psync.NewService(db)
	go store.Schedule(ctx, db, log, cfg.MaintenanceHr, func() []store.Job { return maintenanceJobs(foods, syncSvc) })
	go pruneSessionsHourly(ctx, sessions, log)

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", slog.String("addr", cfg.Addr))
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serving: %w", err)
		}
	case <-ctx.Done():
		log.Info("shutting down")
	}
	drain, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(drain); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	foods.Wait()
	return nil
}
