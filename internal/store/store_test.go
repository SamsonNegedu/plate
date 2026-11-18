package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func openTemp(t *testing.T) *sql.DB {
	t.Helper()
	d, err := Open(filepath.Join(t.TempDir(), "plate.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

func TestMigrateAppliesOnce(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	snaps := t.TempDir()
	if err := Migrate(ctx, d, snaps); err != nil {
		t.Fatal(err)
	}
	if n, err := Pending(ctx, d); err != nil || n != 0 {
		t.Fatalf("pending = %d, %v", n, err)
	}
	if err := Migrate(ctx, d, snaps); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
}

func TestConcurrentWritersNeverFail(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	if err := Migrate(ctx, d, ""); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 64)
	for i := range 64 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errs <- WithTx(ctx, d, func(c *sql.Conn) error {
				_, err := c.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES (?, 'x')`, "k"+string(rune('A'+i%26))+string(rune('a'+i/26)))
				return err
			})
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("writer: %v", err)
		}
	}
}

func TestRollbackOnError(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	if err := Migrate(ctx, d, ""); err != nil {
		t.Fatal(err)
	}
	_ = WithTx(ctx, d, func(c *sql.Conn) error {
		_, _ = c.ExecContext(ctx, `INSERT INTO meta(key, value) VALUES ('a', 'b')`)
		return sql.ErrConnDone
	})
	var n int
	if err := d.QueryRowContext(ctx, `SELECT count(*) FROM meta WHERE key = 'a'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("rows = %d, %v", n, err)
	}
}

func TestSnapshot(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	if err := Migrate(ctx, d, ""); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "snap")
	if err := Snapshot(ctx, d, dir, "test"); err != nil {
		t.Fatal(err)
	}
	m, _ := filepath.Glob(filepath.Join(dir, "test-*.db"))
	if len(m) != 1 {
		t.Fatalf("snapshots = %v", m)
	}
}

func TestNextRun(t *testing.T) {
	loc := time.UTC
	before := time.Date(2026, 11, 13, 1, 0, 0, 0, loc)
	after := time.Date(2026, 11, 13, 3, 0, 0, 0, loc)
	if got := NextRun(before, 3, loc); !got.Equal(time.Date(2026, 11, 13, 3, 0, 0, 0, loc)) {
		t.Fatalf("before: %v", got)
	}
	if got := NextRun(after, 3, loc); !got.Equal(time.Date(2026, 11, 14, 3, 0, 0, 0, loc)) {
		t.Fatalf("at the hour must roll to tomorrow: %v", got)
	}
}

func TestCoreJobsRun(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	for _, j := range CoreJobs() {
		if _, err := j.Run(ctx, d); err != nil {
			t.Errorf("%s: %v", j.Name, err)
		}
	}
}
