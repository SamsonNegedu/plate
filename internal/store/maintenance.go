package store

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"time"
)

// Job is one daily maintenance step. It must be idempotent and honor ctx.
type Job struct {
	Name string
	Run  func(ctx context.Context, d *sql.DB) (affected int64, err error)
}

// CoreJobs are the steps that need no schema: query planner stats and WAL truncation.
func CoreJobs() []Job {
	return []Job{
		{Name: "pragma_optimize", Run: execPragma("PRAGMA optimize")},
		{Name: "wal_checkpoint", Run: execPragma("PRAGMA wal_checkpoint(TRUNCATE)")},
	}
}

func execPragma(stmt string) func(context.Context, *sql.DB) (int64, error) {
	return func(ctx context.Context, d *sql.DB) (int64, error) {
		rows, err := d.QueryContext(ctx, stmt)
		if err != nil {
			return 0, fmt.Errorf("%s: %w", stmt, err)
		}
		defer func() { _ = rows.Close() }()
		for rows.Next() {
		}
		return 0, rows.Err()
	}
}

// RunJobs runs every job once and logs one line each. A failing job does not stop the others.
func RunJobs(ctx context.Context, d *sql.DB, log *slog.Logger, jobs []Job) {
	for _, j := range jobs {
		if ctx.Err() != nil {
			return
		}
		start := time.Now()
		n, err := j.Run(ctx, d)
		if err != nil {
			log.ErrorContext(ctx, "maintenance job failed", slog.String("job", j.Name), slog.String("error", err.Error()))
			continue
		}
		log.InfoContext(ctx, "maintenance job done",
			slog.String("job", j.Name), slog.Int64("affected", n), slog.Duration("took", time.Since(start)))
	}
}

// NextRun returns the next occurrence of hour:00 in loc strictly after now.
func NextRun(now time.Time, hour int, loc *time.Location) time.Time {
	n := now.In(loc)
	t := time.Date(n.Year(), n.Month(), n.Day(), hour, 0, 0, 0, loc)
	if !t.After(n) {
		t = t.AddDate(0, 0, 1)
	}
	return t
}

// Schedule runs jobs daily at the given local hour until ctx ends.
func Schedule(ctx context.Context, d *sql.DB, log *slog.Logger, hour int, jobs func() []Job) {
	for {
		wait := time.Until(NextRun(time.Now(), hour, time.Local))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
			RunJobs(ctx, d, log, jobs())
		}
	}
}

// RebuildFTS recreates both search indexes from their content tables.
func RebuildFTS(ctx context.Context, d *sql.DB) error {
	stmts := map[string]string{
		"foods_fts":     "INSERT INTO foods_fts(foods_fts) VALUES('rebuild')",
		"catalog_fts":   "INSERT INTO catalog_fts(catalog_fts) VALUES('rebuild')",
		"foods_trgm":    "INSERT INTO foods_trgm(foods_trgm) VALUES('rebuild')",
		"catalog_trgm":  "INSERT INTO catalog_trgm(catalog_trgm) VALUES('rebuild')",
		"reference_fts": "INSERT INTO reference_fts(reference_fts) VALUES('rebuild')",
	}
	for name, stmt := range stmts {
		if _, err := d.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("rebuilding %s: %w", name, err)
		}
	}
	return nil
}
