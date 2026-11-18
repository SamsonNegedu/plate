package sync

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"plate/internal/domain"
	"plate/internal/store"
)

const client1 = "0190a1b2-0000-7000-8000-00000000c101"

func nid() string { return uuid.Must(uuid.NewV7()).String() }

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func entryData(mods map[string]any) json.RawMessage {
	m := map[string]any{
		"eaten_on": "2026-11-13", "meal": "lunch", "name": "Oats", "amount": 40, "unit": "g", "grams": 40, "kcal": 370,
		"protein": 13, "client_updated_at": "2026-11-13T08:00:00Z",
	}
	for k, v := range mods {
		if v == nil {
			delete(m, k)
		} else {
			m[k] = v
		}
	}
	return raw(m)
}

func upsert(entity, id string, data json.RawMessage) Op {
	return Op{OpID: nid(), Entity: entity, Type: "upsert", ID: id, Data: data}
}

func del(entity, id string) Op { return Op{OpID: nid(), Entity: entity, Type: "delete", ID: id} }

func (f *fx) push(t *testing.T, ops ...Op) PushResponse {
	t.Helper()
	resp, err := f.svc.Push(context.Background(), uid, PushRequest{ClientID: client1, Ops: ops})
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	if len(resp.Results) != len(ops) {
		t.Fatalf("results = %d for %d ops", len(resp.Results), len(ops))
	}
	return resp
}

func (f *fx) pull(t *testing.T, since int64, limit int) PullResponse {
	t.Helper()
	resp, err := f.svc.Pull(context.Background(), uid, since, limit)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	return resp
}

func TestPushNewEntryThenPullReturnsItWithAHigherSeq(t *testing.T) {
	f := newFx(t)
	before := f.pull(t, 0, 100)
	id := nid()
	res := f.push(t, upsert(EntityEntry, id, entryData(nil)))
	if res.Results[0].Status != StatusApplied || res.Results[0].ServerSeq == nil || res.Results[0].Conflict {
		t.Fatalf("result = %+v", res.Results[0])
	}
	got := f.pull(t, before.Next, 100)
	if len(got.Changes) != 1 || got.Changes[0].ID != id || got.Changes[0].Entity != EntityEntry || got.Changes[0].Seq != *res.Results[0].ServerSeq {
		t.Fatalf("pull = %+v", got)
	}
	var doc EntryDoc
	if err := json.Unmarshal(got.Changes[0].Data, &doc); err != nil || doc.Name != "Oats" || doc.ServerSeq != got.Changes[0].Seq {
		t.Fatalf("data = %+v, %v; an upsert carries the full row", doc, err)
	}
	if res.Cursor != got.Next {
		t.Fatalf("push cursor %d != pull next %d", res.Cursor, got.Next)
	}
}

func TestReplayingABatchIsADuplicateAndWritesNothing(t *testing.T) {
	f := newFx(t)
	a, b := nid(), nid()
	ops := []Op{upsert(EntityEntry, a, entryData(nil)), upsert(EntityEntry, b, entryData(map[string]any{"name": "Milk"}))}
	first := f.push(t, ops...)
	changes := f.changes(t)
	second := f.push(t, ops...) // the response was lost, the client retries the same batch
	for i, r := range second.Results {
		if r.Status != StatusDuplicate || r.ServerSeq == nil || *r.ServerSeq != *first.Results[i].ServerSeq {
			t.Fatalf("result %d = %+v", i, r)
		}
	}
	if f.changes(t) != changes {
		t.Fatal("a duplicate must not append changes")
	}
	var n int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 2 {
		t.Fatalf("entries = %d", n)
	}
}

func TestOlderBaseSeqIsAppliedAndReportedAsAConflict(t *testing.T) {
	f := newFx(t)
	id := nid()
	first := f.push(t, upsert(EntityEntry, id, entryData(nil)))
	f.push(t, upsert(EntityEntry, id, entryData(map[string]any{"name": "Edited elsewhere"})))
	base := *first.Results[0].ServerSeq
	op := upsert(EntityEntry, id, entryData(map[string]any{"name": "Edited here"}))
	op.BaseSeq = &base
	res := f.push(t, op).Results[0]
	if res.Status != StatusApplied || !res.Conflict {
		t.Fatalf("result = %+v", res)
	}
	e, _ := f.r.Entry(context.Background(), uid, id)
	if e.Name != "Edited here" {
		t.Fatalf("name = %q; the write must not be blocked", e.Name)
	}
	fresh := *res.ServerSeq
	op2 := upsert(EntityEntry, id, entryData(map[string]any{"name": "Again"}))
	op2.BaseSeq = &fresh
	if r := f.push(t, op2).Results[0]; r.Conflict {
		t.Fatalf("an up-to-date base_seq is not a conflict: %+v", r)
	}
	if r := f.push(t, upsert(EntityEntry, id, entryData(map[string]any{"name": "No base"}))).Results[0]; r.Conflict {
		t.Fatalf("no base_seq means no conflict report: %+v", r)
	}
}

func TestUpdateAfterDeleteIsTombstonedAndStaysDeleted(t *testing.T) {
	f := newFx(t)
	id := nid()
	f.push(t, upsert(EntityEntry, id, entryData(nil)), del(EntityEntry, id))
	n := f.changes(t)
	res := f.push(t, upsert(EntityEntry, id, entryData(map[string]any{"name": "Zombie"}))).Results[0]
	if res.Status != StatusTombstoned || len(res.Tombstone) == 0 {
		t.Fatalf("result = %+v", res)
	}
	var tomb EntryDoc
	_ = json.Unmarshal(res.Tombstone, &tomb)
	if tomb.DeletedAt == nil || tomb.Name != "Oats" {
		t.Fatalf("tombstone = %+v", tomb)
	}
	if f.changes(t) != n {
		t.Fatal("a tombstoned op must not append a change")
	}
	if e, _ := f.r.Entry(context.Background(), uid, id); e.DeletedAt == nil {
		t.Fatal("the entry was resurrected")
	}
}

func TestDeleteTwiceIsANoOp(t *testing.T) {
	f := newFx(t)
	id := nid()
	f.push(t, upsert(EntityEntry, id, entryData(nil)))
	r1 := f.push(t, del(EntityEntry, id)).Results[0]
	n := f.changes(t)
	r2 := f.push(t, del(EntityEntry, id)).Results[0]
	if r1.Status != StatusApplied || r2.Status != StatusApplied || f.changes(t) != n {
		t.Fatalf("r1=%+v r2=%+v changes %d->%d", r1, r2, n, f.changes(t))
	}
	if r := f.push(t, del(EntityEntry, nid())).Results[0]; r.Status != StatusRejected || r.Problem.Code != "not_found" {
		t.Fatalf("deleting an unknown entry: %+v", r)
	}
}

func TestOneInvalidOpDoesNotBlockTheRestOrLeaveTraces(t *testing.T) {
	f := newFx(t)
	good1, good2, bad, badFood := nid(), nid(), nid(), nid()
	missingFood := nid()
	res := f.push(t,
		upsert(EntityEntry, good1, entryData(nil)),
		upsert(EntityEntry, bad, entryData(map[string]any{"grams": 41})),
		upsert(EntityEntry, badFood, entryData(map[string]any{"food_id": missingFood})),
		upsert(EntityEntry, good2, entryData(map[string]any{"name": "Milk"})),
		Op{OpID: "not-a-uuid", Entity: EntityEntry, Type: "upsert", ID: nid(), Data: entryData(nil)},
		Op{OpID: nid(), Entity: "unicorn", Type: "upsert", ID: nid()},
		upsert(EntityEntry, nid(), json.RawMessage(`{"surprise": true}`)),
	)
	want := []string{StatusApplied, StatusRejected, StatusRejected, StatusApplied, StatusRejected, StatusRejected, StatusRejected}
	for i, r := range res.Results {
		if r.Status != want[i] {
			t.Errorf("op %d = %+v, want %s", i, r, want[i])
		}
	}
	if p := res.Results[1].Problem; p == nil || p.Code != "validation_failed" || len(p.Errors) == 0 || p.Errors[0].Field != "grams" {
		t.Fatalf("problem = %+v", res.Results[1].Problem)
	}
	var n int
	_ = f.db.QueryRow(`SELECT count(*) FROM entries`).Scan(&n)
	if n != 2 || f.changes(t) != 2 {
		t.Fatalf("entries = %d changes = %d; rejected ops must leave no partial writes", n, f.changes(t))
	}
	_ = f.db.QueryRow(`SELECT count(*) FROM sync_ops`).Scan(&n)
	if n != 2 {
		t.Fatalf("sync_ops = %d; only applied ops are recorded", n)
	}
}

func TestRejectedOpMayBeResentAfterItIsFixed(t *testing.T) {
	f := newFx(t)
	id, opID := nid(), nid()
	bad := Op{OpID: opID, Entity: EntityEntry, Type: "upsert", ID: id, Data: entryData(map[string]any{"grams": 99})}
	if f.push(t, bad).Results[0].Status != StatusRejected {
		t.Fatal("expected a rejection")
	}
	bad.Data = entryData(nil)
	if r := f.push(t, bad).Results[0]; r.Status != StatusApplied {
		t.Fatalf("the corrected op with the same id should apply: %+v", r)
	}
}

func TestPullPagingAndCursor(t *testing.T) {
	f := newFx(t)
	var ops []Op
	for range 25 {
		ops = append(ops, upsert(EntityEntry, nid(), entryData(nil)))
	}
	f.push(t, ops...)
	var seen []int64
	cursor := int64(0)
	for pages := 0; ; pages++ {
		page := f.pull(t, cursor, 10)
		for _, c := range page.Changes {
			seen = append(seen, c.Seq)
		}
		if page.Next < cursor {
			t.Fatal("the cursor went backwards")
		}
		cursor = page.Next
		if !page.HasMore {
			break
		}
		if len(page.Changes) != 10 || pages > 5 {
			t.Fatalf("page %d has %d changes", pages, len(page.Changes))
		}
	}
	if len(seen) != 25 || !sort.SliceIsSorted(seen, func(i, j int) bool { return seen[i] < seen[j] }) {
		t.Fatalf("seen = %v", seen)
	}
	empty := f.pull(t, cursor, 10)
	if len(empty.Changes) != 0 || empty.Next != cursor || empty.HasMore {
		t.Fatalf("an empty page keeps the cursor: %+v", empty)
	}
	if capped := f.pull(t, 0, 99999); len(capped.Changes) != 25 {
		t.Fatalf("limit is capped at 500, got %d", len(capped.Changes))
	}
}

func TestPullDeleteCarriesOnlyDeletedAt(t *testing.T) {
	f := newFx(t)
	id := nid()
	f.push(t, upsert(EntityEntry, id, entryData(nil)), del(EntityEntry, id))
	page := f.pull(t, 0, 10)
	last := page.Changes[len(page.Changes)-1]
	var m map[string]any
	_ = json.Unmarshal(last.Data, &m)
	if last.Op != "delete" || len(m) != 1 || m["deleted_at"] == nil {
		t.Fatalf("delete change = %+v data %v", last, m)
	}
}

func TestSinceBelowMinSeqRequiresASnapshot(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	for range 5 {
		f.push(t, upsert(EntityEntry, nid(), entryData(nil)))
	}
	f.now = f.now.Add(200 * 24 * time.Hour)
	n, err := f.svc.PruneRetention(ctx)
	if err != nil || n == 0 {
		t.Fatalf("pruned %d, %v", n, err)
	}
	st, _ := f.r.SyncState(ctx, uid)
	if st.MinSeq == 0 || st.HeadSeq < st.MinSeq {
		t.Fatalf("state = %+v", st)
	}
	var re *ResyncError
	if _, err := f.svc.Pull(ctx, uid, st.MinSeq-1, 10); !errors.As(err, &re) || re.MinSeq != st.MinSeq {
		t.Fatalf("err = %v", err)
	}
	if _, err := f.svc.Pull(ctx, uid, st.MinSeq, 10); err != nil {
		t.Fatalf("a client at min_seq holds everything and needs no snapshot: %v", err)
	}
	snap, err := f.svc.Snapshot(ctx, uid)
	if err != nil || len(snap.Entries) != 5 || snap.Cursor < st.MinSeq {
		t.Fatalf("snapshot = %+v, %v; live rows survive pruning of the stream", snap, err)
	}
	if _, err := f.svc.Pull(ctx, uid, snap.Cursor, 10); err != nil {
		t.Fatalf("continuing from the snapshot cursor: %v", err)
	}
}

func TestRetentionIsPerUser(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	other := nid()
	if err := f.r.CreateUser(ctx, domain.User{ID: other, Email: "o@b.c", PasswordHash: "h", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}); err != nil {
		t.Fatal(err)
	}
	f.push(t, upsert(EntityEntry, nid(), entryData(nil)))
	f.now = f.now.Add(200 * 24 * time.Hour)
	if _, err := f.svc.Push(ctx, other, PushRequest{ClientID: client1, Ops: []Op{upsert(EntityEntry, nid(), entryData(map[string]any{"eaten_on": f.now.Format("2006-01-02")}))}}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.PruneRetention(ctx); err != nil {
		t.Fatal(err)
	}
	a, _ := f.r.SyncState(ctx, uid)
	b, _ := f.r.SyncState(ctx, other)
	if a.MinSeq == 0 {
		t.Fatalf("user one's old changes should be pruned: %+v", a)
	}
	if b.MinSeq != 0 {
		t.Fatalf("user two's min_seq moved to %d because of user one's pruning", b.MinSeq)
	}
	if _, err := f.svc.Pull(ctx, uid, 0, 10); err == nil {
		t.Fatal("user one at cursor 0 must resync")
	}
	if _, err := f.svc.Pull(ctx, other, 0, 10); err != nil {
		t.Fatalf("user two is unaffected: %v", err)
	}
}

func TestSnapshotThenContinueWithPull(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	a, b := nid(), nid()
	f.push(t, upsert(EntityEntry, a, entryData(nil)), upsert(EntityEntry, b, entryData(map[string]any{"name": "Milk"})), del(EntityEntry, b))
	snap, err := f.svc.Snapshot(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Entries) != 1 || snap.Entries[0].ID != a {
		t.Fatalf("snapshot must hold live rows only: %+v", snap.Entries)
	}
	c := nid()
	f.push(t, upsert(EntityEntry, c, entryData(nil)))
	page := f.pull(t, snap.Cursor, 10)
	if len(page.Changes) != 1 || page.Changes[0].ID != c {
		t.Fatalf("pull after the snapshot cursor = %+v", page.Changes)
	}
}

func TestUsersNeverSeeEachOthersRows(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	other := nid()
	if err := f.r.CreateUser(ctx, domain.User{ID: other, Email: "o@b.c", PasswordHash: "h", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}); err != nil {
		t.Fatal(err)
	}
	mine := nid()
	f.push(t, upsert(EntityEntry, mine, entryData(nil)))
	pg, err := f.svc.Pull(ctx, other, 0, 100)
	if err != nil || len(pg.Changes) != 0 {
		t.Fatalf("another user pulled %d changes, %v", len(pg.Changes), err)
	}
	sn, _ := f.svc.Snapshot(ctx, other)
	if len(sn.Entries) != 0 {
		t.Fatalf("another user's snapshot leaked %d entries", len(sn.Entries))
	}
	res, err := f.svc.Push(ctx, other, PushRequest{ClientID: client1, Ops: []Op{upsert(EntityEntry, mine, entryData(map[string]any{"name": "Hijack"}))}})
	if err != nil || res.Results[0].Status != StatusRejected {
		t.Fatalf("pushing over someone else's row: %+v %v", res, err)
	}
	if e, _ := f.r.Entry(ctx, uid, mine); e.Name != "Oats" {
		t.Fatalf("name = %q", e.Name)
	}
	if dup, err := f.svc.Push(ctx, other, PushRequest{ClientID: client1, Ops: []Op{{OpID: f.firstOpID(t), Entity: EntityEntry, Type: "upsert", ID: nid(), Data: entryData(nil)}}}); err != nil || dup.Results[0].Status == StatusDuplicate {
		t.Fatalf("another account's op id must never be reported as a duplicate: %+v %v", dup, err)
	}
}

func (f *fx) firstOpID(t *testing.T) string {
	t.Helper()
	var id string
	if err := f.db.QueryRow(`SELECT op_id FROM sync_ops LIMIT 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestSettingsAndSavedMealsRoundTripWithNestedItems(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	res := f.push(t, upsert(EntitySettings, uid, raw(map[string]any{"goal_kcal": 2300, "protein_g": 150, "carbs_g": 0, "fat_g": 70, "day_start_hour": 4, "theme": "dark"})))
	if res.Results[0].Status != StatusApplied {
		t.Fatalf("settings = %+v", res.Results[0])
	}
	if r := f.push(t, upsert(EntitySettings, nid(), raw(map[string]any{"goal_kcal": 2000, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "day_start_hour": 0, "theme": "auto"}))).Results[0]; r.Status != StatusRejected {
		t.Fatalf("settings must use the user id: %+v", r)
	}
	if r := f.push(t, del(EntitySettings, uid)).Results[0]; r.Status != StatusRejected {
		t.Fatalf("settings cannot be deleted: %+v", r)
	}
	if r := f.push(t, upsert(EntitySettings, uid, raw(map[string]any{"goal_kcal": 100, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "day_start_hour": 0, "theme": "auto"}))).Results[0]; r.Status != StatusRejected {
		t.Fatalf("an invalid goal: %+v", r)
	}

	meal := nid()
	item := func(name string, pos int) map[string]any {
		return map[string]any{"id": nid(), "food_id": nil, "name": name, "brand": "", "amount": 40, "unit": "g", "grams": 40, "kcal": 370, "position": pos}
	}
	f.push(t, upsert(EntitySavedMeal, meal, raw(map[string]any{"name": "Breakfast", "items": []any{item("Oats", 0), item("Milk", 1), item("Honey", 2)}})))
	m, err := f.r.SavedMeal(ctx, uid, meal)
	if err != nil || len(m.Items) != 3 || m.Items[1].Name != "Milk" {
		t.Fatalf("meal = %+v, %v", m, err)
	}
	f.push(t, upsert(EntitySavedMeal, meal, raw(map[string]any{"name": "Light breakfast", "items": []any{item("Oats", 0)}})))
	m, _ = f.r.SavedMeal(ctx, uid, meal)
	if m.Name != "Light breakfast" || len(m.Items) != 1 {
		t.Fatalf("items are replaced atomically: %+v", m)
	}
	var change PullChange
	for _, c := range f.pull(t, 0, 100).Changes {
		if c.Entity == EntitySavedMeal {
			change = c
		}
	}
	var doc SavedMealDoc
	if err := json.Unmarshal(change.Data, &doc); err != nil || len(doc.Items) != 1 || doc.Name != "Light breakfast" {
		t.Fatalf("the change payload nests items: %+v %v", doc, err)
	}
	if r := f.push(t, upsert(EntitySavedMeal, nid(), raw(map[string]any{"name": "", "items": []any{}}))).Results[0]; r.Status != StatusRejected {
		t.Fatalf("a nameless meal: %+v", r)
	}
	if r := f.push(t, del(EntitySavedMeal, meal)).Results[0]; r.Status != StatusApplied {
		t.Fatalf("delete meal: %+v", r)
	}
	if r := f.push(t, upsert(EntitySavedMeal, meal, raw(map[string]any{"name": "Back", "items": []any{}}))).Results[0]; r.Status != StatusTombstoned {
		t.Fatalf("a deleted meal is not resurrected: %+v", r)
	}
}

func TestFoodCorrectionsSyncAndServerManagedFoodsAreProtected(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	id := nid()
	body := map[string]any{"name": "Meine Oats", "brand": "Hof", "kcal": 370, "protein": 13, "barcode": "4000000000011"}
	if r := f.push(t, upsert(EntityFood, id, raw(body))).Results[0]; r.Status != StatusApplied {
		t.Fatalf("custom food: %+v", r)
	}
	if fd, _ := f.r.Food(ctx, uid, id); fd.Source != domain.SourceUser || fd.Per100.Kcal != 370 || fd.SearchName != "meine oats hof" {
		t.Fatalf("food = %+v", fd)
	}
	// a client cannot claim a different source
	withSource := map[string]any{"name": "Fake OFF", "kcal": 100, "source": "off"}
	if r := f.push(t, upsert(EntityFood, nid(), raw(withSource))).Results[0]; r.Status != StatusRejected {
		t.Fatalf("source must not be pushable: %+v", r)
	}
	// a barcode already owned by another live food
	if r := f.push(t, upsert(EntityFood, nid(), raw(map[string]any{"name": "Dup", "kcal": 1, "barcode": "4000000000011"}))).Results[0]; r.Status != StatusRejected || r.Problem.Code != "barcode_taken" {
		t.Fatalf("barcode clash: %+v", r)
	}
	// implausible nutrition
	if r := f.push(t, upsert(EntityFood, nid(), raw(map[string]any{"name": "Fat", "kcal": 100, "fat": 150}))).Results[0]; r.Status != StatusRejected {
		t.Fatalf("implausible: %+v", r)
	}

	// correcting a server-cached row by id turns it into a user food; deleting one is refused
	cached := domain.Food{
		ID: nid(), UserID: uid, Barcode: ptr("3017620422003"), Name: "Nutella", Per100: domain.Nutrients{Kcal: 539}, Source: domain.SourceOFF,
		SearchName: "nutella", CreatedAt: stamp(t0), UpdatedAt: stamp(t0),
	}
	if err := f.r.PutFood(ctx, cached); err != nil {
		t.Fatal(err)
	}
	if r := f.push(t, del(EntityFood, cached.ID)).Results[0]; r.Status != StatusRejected || r.Problem.Code != "forbidden" {
		t.Fatalf("deleting a cached food: %+v", r)
	}
	fix := map[string]any{"name": "Nutella (meins)", "kcal": 540, "barcode": "3017620422003"}
	if r := f.push(t, upsert(EntityFood, cached.ID, raw(fix))).Results[0]; r.Status != StatusApplied {
		t.Fatalf("correction: %+v", r)
	}
	if fd, _ := f.r.Food(ctx, uid, cached.ID); fd.Source != domain.SourceUser || fd.Per100.Kcal != 540 {
		t.Fatalf("food = %+v", fd)
	}
	if r := f.push(t, del(EntityFood, id)).Results[0]; r.Status != StatusApplied {
		t.Fatalf("delete own food: %+v", r)
	}
	if r := f.push(t, upsert(EntityFood, id, raw(body))).Results[0]; r.Status != StatusTombstoned {
		t.Fatalf("a deleted food stays deleted: %+v", r)
	}
	snap, _ := f.svc.Snapshot(ctx, uid)
	for _, fd := range snap.Foods {
		if fd.Source != "user" {
			t.Fatalf("the snapshot carried a server-managed food: %+v", fd)
		}
	}
}

func TestFavoritesSync(t *testing.T) {
	f := newFx(t)
	food := nid()
	if err := f.r.PutFood(context.Background(), domain.Food{ID: food, UserID: uid, Name: "Oats", Per100: domain.Nutrients{Kcal: 370}, Source: domain.SourceUser, SearchName: "oats", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}); err != nil {
		t.Fatal(err)
	}
	if r := f.push(t, upsert(EntityFavorite, food, nil)).Results[0]; r.Status != StatusApplied {
		t.Fatalf("add: %+v", r)
	}
	if r := f.push(t, del(EntityFavorite, food)).Results[0]; r.Status != StatusApplied {
		t.Fatalf("remove: %+v", r)
	}
	if r := f.push(t, upsert(EntityFavorite, food, nil)).Results[0]; r.Status != StatusApplied {
		t.Fatalf("re-add: %+v", r)
	}
	if r := f.push(t, upsert(EntityFavorite, nid(), nil)).Results[0]; r.Status != StatusRejected {
		t.Fatalf("unknown food: %+v", r)
	}
	snap, _ := f.svc.Snapshot(context.Background(), uid)
	if len(snap.Favorites) != 1 || snap.Favorites[0].FoodID != food {
		t.Fatalf("favorites = %+v", snap.Favorites)
	}
}

func TestBatchAndPayloadLimits(t *testing.T) {
	f := newFx(t)
	ctx := context.Background()
	var ops []Op
	for range MaxBatchOps + 1 {
		ops = append(ops, upsert(EntityEntry, nid(), entryData(nil)))
	}
	if _, err := f.svc.Push(ctx, uid, PushRequest{ClientID: client1, Ops: ops}); !errors.Is(err, ErrBatchTooLarge) {
		t.Fatalf("err = %v", err)
	}
	if f.changes(t) != 0 {
		t.Fatal("an oversized batch must write nothing")
	}
	if _, err := f.svc.Push(ctx, uid, PushRequest{ClientID: "nope", Ops: nil}); !errors.Is(err, domain.ErrInvalid) {
		t.Fatalf("bad client id: %v", err)
	}
	big := entryData(map[string]any{"note": strings.Repeat("a", MaxOpDataBytes)})
	if r := f.push(t, upsert(EntityEntry, nid(), big)).Results[0]; r.Status != StatusRejected || r.Problem.Code != "payload_too_large" {
		t.Fatalf("big op: %+v", r)
	}
	hundred := ops[:MaxBatchOps]
	if res := f.push(t, hundred...); len(res.Results) != MaxBatchOps {
		t.Fatalf("a full batch must apply: %d", len(res.Results))
	}
}

func TestPushOfAHundredOpsIsFast(t *testing.T) {
	f := newFx(t)
	var durs []time.Duration
	for range 12 {
		var ops []Op
		for range 100 {
			ops = append(ops, upsert(EntityEntry, nid(), entryData(nil)))
		}
		start := time.Now()
		f.push(t, ops...)
		durs = append(durs, time.Since(start))
	}
	sort.Slice(durs, func(i, j int) bool { return durs[i] < durs[j] })
	if p95 := durs[len(durs)*95/100]; p95 > 300*time.Millisecond {
		t.Fatalf("p95 = %s for 100 ops; the budget is 300 ms", p95)
	}
}

func TestPushRecordsOnlyAppliedOps(t *testing.T) {
	f := newFx(t)
	id := nid()
	f.push(t, upsert(EntityEntry, id, entryData(nil)), del(EntityEntry, id))
	tomb := upsert(EntityEntry, id, entryData(nil))
	f.push(t, tomb)
	var n int
	_ = f.db.QueryRow(`SELECT count(*) FROM sync_ops WHERE op_id = ?`, tomb.OpID).Scan(&n)
	if n != 0 {
		t.Fatal("a tombstoned op is not recorded as applied")
	}
}

// ---- randomized two-client convergence ----

type simRow struct {
	Name    string
	Amount  float64
	Deleted bool
}

type sim struct {
	rows   map[string]simRow
	cursor int64
	outbox []Op
}

func newSim() *sim { return &sim{rows: map[string]simRow{}} }

func (c *sim) create(rng *rand.Rand) {
	id := nid()
	row := simRow{Name: fmt.Sprintf("food-%d", rng.Intn(1000)), Amount: float64(10 + rng.Intn(500))}
	c.rows[id] = row
	c.outbox = append(c.outbox, upsert(EntityEntry, id, simData(row)))
}

func simData(r simRow) json.RawMessage {
	return entryData(map[string]any{"name": r.Name, "amount": r.Amount, "grams": r.Amount})
}

func (c *sim) live() []string {
	var ids []string
	for id, r := range c.rows {
		if !r.Deleted {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func (c *sim) edit(rng *rand.Rand) {
	ids := c.live()
	if len(ids) == 0 {
		return
	}
	id := ids[rng.Intn(len(ids))]
	row := c.rows[id]
	row.Name = fmt.Sprintf("edit-%d", rng.Intn(1000))
	row.Amount = float64(10 + rng.Intn(500))
	c.rows[id] = row
	c.outbox = append(c.outbox, upsert(EntityEntry, id, simData(row)))
}

func (c *sim) remove(rng *rand.Rand) {
	ids := c.live()
	if len(ids) == 0 {
		return
	}
	id := ids[rng.Intn(len(ids))]
	row := c.rows[id]
	row.Deleted = true
	c.rows[id] = row
	c.outbox = append(c.outbox, del(EntityEntry, id))
}

// sync drains the outbox in batches (sometimes replaying a batch as if the response was lost), then pulls everything.
func (c *sim) sync(t *testing.T, f *fx, rng *rand.Rand) {
	t.Helper()
	ctx := context.Background()
	for len(c.outbox) > 0 {
		n := min(len(c.outbox), 1+rng.Intn(MaxBatchOps))
		batch := c.outbox[:n]
		resp, err := f.svc.Push(ctx, uid, PushRequest{ClientID: client1, Ops: batch})
		if err != nil {
			t.Fatal(err)
		}
		if rng.Intn(4) == 0 { // a lost response: the client sends the same batch again
			again, err := f.svc.Push(ctx, uid, PushRequest{ClientID: client1, Ops: batch})
			if err != nil {
				t.Fatal(err)
			}
			for i, r := range again.Results {
				if resp.Results[i].Status == StatusApplied && r.Status != StatusDuplicate {
					t.Fatalf("a replayed op must be a duplicate, got %+v", r)
				}
			}
		}
		c.outbox = c.outbox[n:]
	}
	for {
		page, err := f.svc.Pull(ctx, uid, c.cursor, 1+rng.Intn(60))
		if err != nil {
			t.Fatal(err)
		}
		for _, ch := range page.Changes {
			if ch.Seq <= c.cursor {
				continue
			}
			switch ch.Op {
			case "upsert":
				var d EntryDoc
				if err := json.Unmarshal(ch.Data, &d); err != nil {
					t.Fatal(err)
				}
				c.rows[ch.ID] = simRow{Name: d.Name, Amount: d.Amount}
			case "delete":
				row := c.rows[ch.ID]
				row.Deleted = true
				c.rows[ch.ID] = row
			}
		}
		c.cursor = page.Next
		if !page.HasMore {
			return
		}
	}
}

func TestTwoClientsConvergeUnderRandomOfflineSequences(t *testing.T) {
	f := newFx(t)
	rng := rand.New(rand.NewSource(20261113))
	clients := []*sim{newSim(), newSim()}
	for i := 0; i < 1000; i++ {
		c := clients[rng.Intn(2)]
		switch r := rng.Intn(10); {
		case r < 3:
			c.create(rng)
		case r < 6:
			c.edit(rng)
		case r < 7:
			c.remove(rng)
		default:
			c.sync(t, f, rng)
		}
	}
	for range 2 { // quiesce: everyone pushes and pulls until nothing changes
		for _, c := range clients {
			c.sync(t, f, rng)
		}
	}

	server, err := f.svc.Snapshot(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	var serverIDs []string
	for _, e := range server.Entries {
		serverIDs = append(serverIDs, e.ID)
	}
	sort.Strings(serverIDs)
	for i, c := range clients {
		live := c.live()
		if strings.Join(live, ",") != strings.Join(serverIDs, ",") {
			t.Fatalf("client %d live set (%d rows) differs from the server (%d rows)", i, len(live), len(serverIDs))
		}
		for _, e := range server.Entries {
			if r := c.rows[e.ID]; r.Name != e.Name || r.Amount != e.Amount {
				t.Fatalf("client %d row %s = %+v, server has %s/%v", i, e.ID, r, e.Name, e.Amount)
			}
		}
	}
	if len(serverIDs) == 0 {
		t.Fatal("the run produced no live rows; the test proves nothing")
	}
	t.Logf("converged on %d live entries after 1000 random operations", len(serverIDs))
}

var _ = store.Pending
