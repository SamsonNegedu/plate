// Package store opens SQLite, runs migrations and provides the write-transaction helper.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand/v2"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pressly/goose/v3"
	"modernc.org/sqlite"
)

const poolSize = 4

// Open opens the database with the pragmas from ADR-003. It does not migrate.
func Open(path string) (*sql.DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return nil, fmt.Errorf("creating data directory: %w", err)
	}
	q := url.Values{}
	for _, p := range []string{
		"journal_mode(WAL)",
		"busy_timeout(5000)",
		"synchronous(NORMAL)",
		"foreign_keys(ON)",
	} {
		q.Add("_pragma", p)
	}
	d, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}
	d.SetMaxOpenConns(poolSize)
	if err := d.PingContext(context.Background()); err != nil {
		_ = d.Close()
		return nil, fmt.Errorf("pinging database: %w", err)
	}
	return d, nil
}

func provider(d *sql.DB) (*goose.Provider, error) {
	sub, err := fsSub()
	if err != nil {
		return nil, err
	}
	p, err := goose.NewProvider(goose.DialectSQLite3, d, sub)
	if err != nil {
		return nil, fmt.Errorf("creating migration provider: %w", err)
	}
	return p, nil
}

// Migrate snapshots the database when migrations are pending, then applies them.
func Migrate(ctx context.Context, d *sql.DB, snapshotDir string) error {
	p, err := provider(d)
	if err != nil {
		return err
	}
	pending, err := Pending(ctx, d)
	if err != nil {
		return err
	}
	if pending == 0 {
		return nil
	}
	if snapshotDir != "" && hasUserTables(ctx, d) {
		if err := Snapshot(ctx, d, snapshotDir, "pre-migrate"); err != nil {
			return err
		}
	}
	if _, err := p.Up(ctx); err != nil {
		return fmt.Errorf("applying migrations: %w", err)
	}
	return nil
}

// Pending reports how many migrations have not been applied.
func Pending(ctx context.Context, d *sql.DB) (int, error) {
	p, err := provider(d)
	if err != nil {
		return 0, err
	}
	all := p.ListSources()
	statuses, err := p.Status(ctx)
	if err != nil {
		return 0, fmt.Errorf("reading migration status: %w", err)
	}
	applied := 0
	for _, s := range statuses {
		if s.State == goose.StateApplied {
			applied++
		}
	}
	return len(all) - applied, nil
}

func hasUserTables(ctx context.Context, d *sql.DB) bool {
	var n int
	err := d.QueryRowContext(ctx,
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'goose_db_version'`,
	).Scan(&n)
	return err == nil && n > 0
}

// Snapshot writes a consistent copy of the database with VACUUM INTO.
func Snapshot(ctx context.Context, d *sql.DB, dir, label string) error {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return fmt.Errorf("creating snapshot directory: %w", err)
	}
	name := fmt.Sprintf("%s-%s.db", label, time.Now().UTC().Format("20060102T150405Z"))
	dest := filepath.Join(dir, name)
	if _, err := d.ExecContext(ctx, "VACUUM INTO ?", dest); err != nil {
		return fmt.Errorf("snapshotting to %s: %w", dest, err)
	}
	return nil
}

const maxBusyRetries = 3

// WithTx runs fn inside BEGIN IMMEDIATE so writers queue instead of failing on lock upgrade.
// A busy database retries the whole transaction up to three times with jitter.
func WithTx(ctx context.Context, d *sql.DB, fn func(conn *sql.Conn) error) error {
	var err error
	for attempt := range maxBusyRetries + 1 {
		err = runTx(ctx, d, fn)
		if !isBusy(err) || attempt == maxBusyRetries {
			return err
		}
		jitter := rand.IntN(60) // #nosec G404 -- retry jitter, not security
		wait := time.Duration(20+jitter) * time.Millisecond * time.Duration(attempt+1)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
	}
	return err
}

func runTx(ctx context.Context, d *sql.DB, fn func(conn *sql.Conn) error) error {
	conn, err := d.Conn(ctx)
	if err != nil {
		return fmt.Errorf("acquiring connection: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE"); err != nil {
		return fmt.Errorf("beginning transaction: %w", err)
	}
	if err := fn(conn); err != nil {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), "ROLLBACK")
		return err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		_, _ = conn.ExecContext(context.WithoutCancel(ctx), "ROLLBACK")
		return fmt.Errorf("committing: %w", err)
	}
	return nil
}

func isBusy(err error) bool {
	var se *sqlite.Error
	if errors.As(err, &se) {
		code := se.Code() & 0xff
		return code == 5 || code == 6 // SQLITE_BUSY, SQLITE_LOCKED
	}
	return err != nil && strings.Contains(err.Error(), "database is locked")
}
