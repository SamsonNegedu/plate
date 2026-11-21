package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

const now = "2026-11-13T08:00:00Z"

func migrated(t *testing.T) *sql.DB {
	t.Helper()
	d := openTemp(t)
	if err := Migrate(context.Background(), d, ""); err != nil {
		t.Fatal(err)
	}
	return d
}

func mustExec(t *testing.T, d *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := d.Exec(q, args...); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

func wantErr(t *testing.T, d *sql.DB, contains, q string, args ...any) {
	t.Helper()
	_, err := d.Exec(q, args...)
	if err == nil || !strings.Contains(err.Error(), contains) {
		t.Fatalf("%s: err = %v, want %q", q, err, contains)
	}
}

func seedUser(t *testing.T, d *sql.DB) {
	t.Helper()
	mustExec(t, d, `INSERT INTO users(id, username, password_hash, created_at, updated_at) VALUES ('u1','a@b.c','h',?,?)`, now, now)
}

func addFood(t *testing.T, d *sql.DB, id, barcode, name, brand string, kcal any) {
	t.Helper()
	var bc any
	if barcode != "" {
		bc = barcode
	}
	mustExec(t, d, `INSERT INTO foods(id, user_id, barcode, name, brand, kcal_100g, source, search_name, created_at, updated_at)
		VALUES (?, 'u1', ?, ?, ?, ?, 'off', ?, ?, ?)`, id, bc, name, brand, kcal, strings.ToLower(name), now, now)
}

func TestMigrationsUpDownUp(t *testing.T) {
	ctx := context.Background()
	d := migrated(t)
	p, err := provider(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.DownTo(ctx, 0); err != nil {
		t.Fatalf("down: %v", err)
	}
	var left int
	if err := d.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE 'goose_%'`).Scan(&left); err != nil || left != 0 {
		t.Fatalf("objects left after down: %d, %v", left, err)
	}
	if _, err := p.Up(ctx); err != nil {
		t.Fatalf("up again: %v", err)
	}
}

func TestSchemaObjects(t *testing.T) {
	d := migrated(t)
	rows, err := d.Query(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name NOT LIKE 'sqlite_%' AND NOT (type = 'table' AND (name LIKE '%_fts_%' OR name LIKE '%_trgm_%')) AND name != 'goose_db_version' ORDER BY name`)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	var got []string
	for rows.Next() {
		var n string
		_ = rows.Scan(&n)
		got = append(got, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := "catalog_ad catalog_ai catalog_au catalog_foods catalog_fts catalog_meta catalog_trgm catalog_trgm_ad catalog_trgm_ai " +
		"catalog_trgm_au category_stats change_log entries favorites foods foods_ad foods_ai foods_au foods_fts foods_trgm foods_trgm_ad " +
		"foods_trgm_ai foods_trgm_au health_records image_cache meta product_fact_disputes product_fact_revisions product_facts recovery_codes saved_meal_items saved_meals search_cache " +
		"sessions settings sync_ops sync_state users"
	if strings.Join(got, " ") != want {
		t.Fatalf("schema drift:\n got %s\nwant %s", strings.Join(got, " "), want)
	}
}

func TestFoodWithoutKcalIsRejected(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	wantErr(t, d, "NOT NULL", `INSERT INTO foods(id, user_id, name, source, search_name, created_at, updated_at, kcal_100g)
		VALUES ('f1','u1','x','off','x',?,?,NULL)`, now, now)
	wantErr(t, d, "CHECK", `INSERT INTO foods(id, user_id, name, source, search_name, created_at, updated_at, kcal_100g)
		VALUES ('f1','u1','x','off','x',?,?,-1)`, now, now)
}

func TestMissingNutrientStaysNull(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "4000000000011", "Joghurt", "Ehrmann", 61)
	var protein sql.NullFloat64
	if err := d.QueryRow(`SELECT protein_100g FROM foods WHERE id='f1'`).Scan(&protein); err != nil || protein.Valid {
		t.Fatalf("protein = %v, %v; want NULL", protein, err)
	}
}

func TestBarcodeUniqueAmongLiveRows(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "4000000000011", "Joghurt", "", 61)
	wantErr(t, d, "UNIQUE", `INSERT INTO foods(id, user_id, barcode, name, kcal_100g, source, search_name, created_at, updated_at)
		VALUES ('f2','u1','4000000000011','Dup',1,'off','dup',?,?)`, now, now)

	mustExec(t, d, `UPDATE foods SET deleted_at=? WHERE id='f1'`, now)
	addFood(t, d, "f3", "4000000000011", "Joghurt neu", "", 62)
}

func TestNoBarcodeFoodsCoexist(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "", "Apfel", "", 52)
	addFood(t, d, "f2", "", "Birne", "", 57)
}

func TestEntryConstraints(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	ins := `INSERT INTO entries(id, user_id, eaten_on, meal, name, amount, unit, grams, kcal_100g, created_at, updated_at, client_updated_at)
		VALUES (?, 'u1', ?, ?, 'x', ?, ?, ?, 100, ?, ?, ?)`
	mustExec(t, d, ins, "e1", "2026-11-13", "lunch", 100, "g", 100, now, now, now)
	wantErr(t, d, "CHECK", ins, "e2", "2026-11-13", "lunch", 0, "g", 100, now, now, now)
	wantErr(t, d, "CHECK", ins, "e3", "2026-11-13", "lunch", 100, "g", 0, now, now, now)
	wantErr(t, d, "CHECK", ins, "e4", "2026-11-13", "brunch", 100, "g", 100, now, now, now)
	wantErr(t, d, "CHECK", ins, "e5", "2026-11-13", "lunch", 100, "cup", 100, now, now, now)
	wantErr(t, d, "CHECK", ins, "e6", "13.11.2026", "lunch", 100, "g", 100, now, now, now)
}

func TestEntrySnapshotSurvivesFoodChange(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "4000000000011", "Nutella", "Ferrero", 539)
	mustExec(t, d, `INSERT INTO entries(id, user_id, eaten_on, meal, food_id, name, amount, unit, grams, kcal_100g, created_at, updated_at, client_updated_at)
		VALUES ('e1','u1','2026-11-13','snack','f1','Nutella',15,'g',15,539,?,?,?)`, now, now, now)
	mustExec(t, d, `UPDATE foods SET kcal_100g = 400 WHERE id='f1'`)
	var kcal float64
	if err := d.QueryRow(`SELECT kcal_100g FROM entries WHERE id='e1'`).Scan(&kcal); err != nil || kcal != 539 {
		t.Fatalf("entry kcal = %v, %v; the snapshot must not follow the food", kcal, err)
	}
	mustExec(t, d, `DELETE FROM foods WHERE id='f1'`)
	var fid sql.NullString
	if err := d.QueryRow(`SELECT food_id FROM entries WHERE id='e1'`).Scan(&fid); err != nil || fid.Valid {
		t.Fatalf("food_id = %v, %v; want NULL after the food is gone", fid, err)
	}
}

func TestCascades(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	mustExec(t, d, `INSERT INTO saved_meals(id, user_id, name, created_at, updated_at) VALUES ('m1','u1','Breakfast',?,?)`, now, now)
	mustExec(t, d, `INSERT INTO saved_meal_items(id, saved_meal_id, name, amount, unit, grams, kcal_100g, position) VALUES ('i1','m1','Oats',40,'g',40,370,0)`)
	mustExec(t, d, `DELETE FROM saved_meals WHERE id='m1'`)
	var n int
	_ = d.QueryRow(`SELECT count(*) FROM saved_meal_items`).Scan(&n)
	if n != 0 {
		t.Fatalf("items left: %d", n)
	}

	addFood(t, d, "f1", "", "Apfel", "", 52)
	mustExec(t, d, `INSERT INTO settings(user_id, goal_kcal, created_at, updated_at) VALUES ('u1', 2000, ?, ?)`, now, now)
	mustExec(t, d, `DELETE FROM users WHERE id='u1'`)
	for _, tbl := range []string{"foods", "settings"} {
		_ = d.QueryRow(`SELECT count(*) FROM ` + tbl).Scan(&n)
		if n != 0 {
			t.Fatalf("%s rows left after user delete: %d", tbl, n)
		}
	}
}

func TestChangeLogSeqIsMonotonic(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	var last int64
	for i := range 20 {
		res, err := d.Exec(`INSERT INTO change_log(user_id, entity, entity_id, op, payload, created_at) VALUES ('u1','entry',?, 'upsert','{}',?)`, i, now)
		if err != nil {
			t.Fatal(err)
		}
		seq, _ := res.LastInsertId()
		if seq != last+1 {
			t.Fatalf("seq %d after %d: a single user's stream must have no gaps", seq, last)
		}
		last = seq
	}
	wantErr(t, d, "CHECK", `INSERT INTO change_log(user_id, entity, entity_id, op, payload, created_at) VALUES ('u1','entry','x','upsert','not json',?)`, now)
}

func TestCatalogRowIsLoggableWithoutFoodsRow(t *testing.T) {
	d := migrated(t)
	mustExec(t, d, `INSERT INTO catalog_foods(barcode, name, brand, kcal_100g, dataset_version, imported_at, updated_at)
		VALUES ('3017620422003','Nutella','Ferrero',539,'v1',?,?)`, now, now)
	var kcal float64
	if err := d.QueryRow(`SELECT kcal_100g FROM catalog_foods WHERE barcode='3017620422003'`).Scan(&kcal); err != nil || kcal != 539 {
		t.Fatalf("kcal = %v, %v", kcal, err)
	}
	wantErr(t, d, "CHECK", `INSERT INTO catalog_foods(barcode, name, kcal_100g, dataset_version, imported_at, updated_at) VALUES ('123','x',1,'v1',?,?)`, now, now)
	wantErr(t, d, "NOT NULL", `INSERT INTO catalog_foods(barcode, name, kcal_100g, dataset_version, imported_at, updated_at) VALUES ('3017620422004','x',NULL,'v1',?,?)`, now, now)
}

func TestFTSGermanFixtures(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "4000000000011", "Joghurt", "Ehrmann", 61)
	addFood(t, d, "f2", "4000000000028", "Käse", "Hochland", 350)
	addFood(t, d, "f3", "4000000000035", "Vollkornbrot", "Harry", 210)
	addFood(t, d, "f4", "4000000000042", "Hähnchenbrust", "Wiesenhof", 110)
	addFood(t, d, "f5", "4000000000059", "Fruchtjoghurt", "Müller", 95)
	addFood(t, d, "f6", "4000000000066", "Haferdrink", "Milbona", 45)
	addFood(t, d, "f7", "4000000000073", "Schokolade", "Gut & Günstig", 540)
	addFood(t, d, "f8", "4000000000080", "Salami", "Ja!", 450)

	cases := map[string]string{
		`"joghurt"*`:       "f1",
		`"Joghurt"*`:       "f1",
		`"käse"*`:          "f2",
		`"Kase"*`:          "f2",
		`"Vollkornbrot"*`:  "f3",
		`"vollkorn"*`:      "f3",
		`"Müller"*`:        "f5",
		`"Gut" "Günstig"*`: "f7",
		`"Milbona"*`:       "f6",
		`"Hähnchenbrust"*`: "f4",
		`"ja"*`:            "f8",
	}
	for q, want := range cases {
		var got string
		err := d.QueryRow(`SELECT f.id FROM foods_fts JOIN foods f ON f.rowid = foods_fts.rowid
			WHERE foods_fts MATCH ? ORDER BY bm25(foods_fts, 10, 5, 50) LIMIT 1`, q).Scan(&got)
		if err != nil || got != want {
			t.Errorf("%s -> %q, %v; want %s", q, got, err, want)
		}
	}
}

func TestFTSFollowsUpdateAndDelete(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "", "Apfel", "", 52)
	count := func(q string) int {
		var n int
		_ = d.QueryRow(`SELECT count(*) FROM foods_fts WHERE foods_fts MATCH ?`, q).Scan(&n)
		return n
	}
	mustExec(t, d, `UPDATE foods SET name='Birne' WHERE id='f1'`)
	if count(`"apfel"`) != 0 || count(`"birne"`) != 1 {
		t.Fatal("update not reflected in the index")
	}
	mustExec(t, d, `DELETE FROM foods WHERE id='f1'`)
	if count(`"birne"`) != 0 {
		t.Fatal("delete not reflected in the index")
	}
}

func TestForeignKeysAreEnforced(t *testing.T) {
	d := migrated(t)
	wantErr(t, d, "FOREIGN KEY", `INSERT INTO settings(user_id, goal_kcal, created_at, updated_at) VALUES ('nobody', 2000, ?, ?)`, now, now)
}

func TestRebuildFTSRestoresADamagedIndex(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	addFood(t, d, "f1", "", "Apfel", "", 52)
	mustExec(t, d, `INSERT INTO foods_fts(foods_fts) VALUES('delete-all')`)
	count := func() int {
		var n int
		_ = d.QueryRow(`SELECT count(*) FROM foods_fts WHERE foods_fts MATCH '"apfel"'`).Scan(&n)
		return n
	}
	if count() != 0 {
		t.Fatal("index should be empty after delete-all")
	}
	if err := RebuildFTS(context.Background(), d); err != nil {
		t.Fatal(err)
	}
	if count() != 1 {
		t.Fatal("rebuild did not restore the row")
	}
}

func TestMigrateSnapshotsAnExistingDatabaseFirst(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	p, err := provider(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 1); err != nil {
		t.Fatal(err)
	}
	snaps := t.TempDir()
	if err := Migrate(ctx, d, snaps); err != nil {
		t.Fatal(err)
	}
	m, _ := filepath.Glob(filepath.Join(snaps, "pre-migrate-*.db"))
	if len(m) != 1 {
		t.Fatalf("snapshots = %v, want exactly one pre-migrate snapshot", m)
	}
}

func TestMigrateSkipsSnapshotOnAFreshDatabase(t *testing.T) {
	d := openTemp(t)
	snaps := t.TempDir()
	if err := Migrate(context.Background(), d, snaps); err != nil {
		t.Fatal(err)
	}
	if m, _ := filepath.Glob(filepath.Join(snaps, "*")); len(m) != 0 {
		t.Fatalf("a fresh database has nothing to protect: %v", m)
	}
}

func TestHealthMigrationKeepsTheChangeLogSequence(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	p, err := provider(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 12); err != nil {
		t.Fatal(err)
	}
	seedUser(t, d)
	for range 3 {
		mustExec(t, d, `INSERT INTO change_log(user_id, entity, entity_id, op, payload, created_at) VALUES ('u1','entry','e1','upsert','{}',?)`, now)
	}
	mustExec(t, d, `DELETE FROM change_log`) // a pruned log: the counter must still not restart
	if _, err := p.UpTo(ctx, 13); err != nil {
		t.Fatal(err)
	}
	mustExec(t, d, `INSERT INTO change_log(user_id, entity, entity_id, op, payload, created_at) VALUES ('u1','health_record','h1','upsert','{}',?)`, now)
	var seq int64
	if err := d.QueryRow(`SELECT max(seq) FROM change_log`).Scan(&seq); err != nil {
		t.Fatal(err)
	}
	if seq != 4 {
		t.Fatalf("next seq = %d, want 4: the sequence restarted", seq)
	}
}

func TestHealthRecordValuesAreChecked(t *testing.T) {
	d := migrated(t)
	seedUser(t, d)
	ins := `INSERT INTO health_records(id, user_id, kind, recorded_on, recorded_at, value, medication, created_at, updated_at)
		VALUES (?, 'u1', ?, '2026-11-13', ?, ?, ?, ?, ?)`
	mustExec(t, d, ins, "w1", "weight", now, 82.4, "", now, now)
	mustExec(t, d, ins, "d1", "dose", now, 2.5, "Mounjaro", now, now)
	wantErr(t, d, "CHECK", ins, "w2", "weight", now, 5, "", now, now)
	wantErr(t, d, "CHECK", ins, "d2", "dose", now, 2.5, "  ", now, now)
	wantErr(t, d, "CHECK", ins, "a1", "appetite", now, 6, "", now, now)
	wantErr(t, d, "CHECK", ins, "x1", "mood", now, 3, "", now, now)
}

func TestMeasurementsMigrationKeepsHealthRecords(t *testing.T) {
	ctx := context.Background()
	d := openTemp(t)
	p, err := provider(d)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.UpTo(ctx, 14); err != nil {
		t.Fatal(err)
	}
	seedUser(t, d)
	ins := `INSERT INTO health_records(id, user_id, kind, recorded_on, recorded_at, value, medication, created_at, updated_at)
		VALUES (?, 'u1', ?, '2026-11-13', ?, ?, ?, ?, ?)`
	mustExec(t, d, ins, "w1", "weight", now, 82.4, "", now, now)
	mustExec(t, d, ins, "d1", "dose", now, 0.25, "Wegovy", now, now)
	if _, err := p.UpTo(ctx, 15); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := d.QueryRow(`SELECT count(*) FROM health_records`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("rows after the rebuild = %d, %v", n, err)
	}
	mustExec(t, d, ins, "h1", "hips", now, 101, "", now, now)
	wantErr(t, d, "CHECK", ins, "h2", "hips", now, 5, "", now, now)
}
