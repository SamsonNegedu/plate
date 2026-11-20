package sync

import (
	"testing"

	"plate/internal/domain"
)

func TestEntryCapRejectsNewEntriesButStillEditsAndFreesRoomOnDelete(t *testing.T) {
	old := maxEntriesPerUser
	maxEntriesPerUser = 2
	t.Cleanup(func() { maxEntriesPerUser = old })

	f := newFx(t)
	a, b := nid(), nid()
	f.push(t, upsert(EntityEntry, a, entryData(nil)), upsert(EntityEntry, b, entryData(nil)))

	over := f.push(t, upsert(EntityEntry, nid(), entryData(nil))).Results[0]
	if over.Status != StatusRejected || over.Problem.Code != "limit_reached" {
		t.Fatalf("third entry = %+v", over)
	}
	if edit := f.push(t, upsert(EntityEntry, a, entryData(map[string]any{"name": "Edited"}))).Results[0]; edit.Status != StatusApplied {
		t.Fatalf("an existing entry must stay editable at the cap: %+v", edit)
	}
	f.push(t, del(EntityEntry, a))
	if again := f.push(t, upsert(EntityEntry, nid(), entryData(nil))).Results[0]; again.Status != StatusApplied {
		t.Fatalf("a delete must free room: %+v", again)
	}
}

func TestFoodCapRejectsNewCustomFoods(t *testing.T) {
	old := maxFoodsPerUser
	maxFoodsPerUser = 1
	t.Cleanup(func() { maxFoodsPerUser = old })

	f := newFx(t)
	f.push(t, upsert(EntityFood, nid(), raw(map[string]any{"name": "One", "kcal": 100})))
	over := f.push(t, upsert(EntityFood, nid(), raw(map[string]any{"name": "Two", "kcal": 100}))).Results[0]
	if over.Status != StatusRejected || over.Problem.Code != "limit_reached" {
		t.Fatalf("second food = %+v", over)
	}
}

func TestCapsCountEachUserSeparately(t *testing.T) {
	old := maxEntriesPerUser
	maxEntriesPerUser = 1
	t.Cleanup(func() { maxEntriesPerUser = old })

	f := newFx(t)
	f.push(t, upsert(EntityEntry, nid(), entryData(nil)))
	other := nid()
	if err := f.r.CreateUser(t.Context(), userFor(other)); err != nil {
		t.Fatal(err)
	}
	res, err := f.svc.Push(t.Context(), other, PushRequest{ClientID: client1, Ops: []Op{upsert(EntityEntry, nid(), entryData(nil))}})
	if err != nil || res.Results[0].Status != StatusApplied {
		t.Fatalf("another account's first entry = %+v, %v", res, err)
	}
}

func userFor(id string) domain.User {
	return domain.User{ID: id, Username: "u-" + id[len(id)-8:], PasswordHash: "h", CreatedAt: stamp(t0), UpdatedAt: stamp(t0)}
}

func TestCapHoldsInsideOneBatch(t *testing.T) {
	old := maxEntriesPerUser
	maxEntriesPerUser = 2
	t.Cleanup(func() { maxEntriesPerUser = old })

	f := newFx(t)
	res := f.push(t, upsert(EntityEntry, nid(), entryData(nil)), upsert(EntityEntry, nid(), entryData(nil)), upsert(EntityEntry, nid(), entryData(nil))).Results
	if res[0].Status != StatusApplied || res[1].Status != StatusApplied || res[2].Status != StatusRejected {
		t.Fatalf("statuses = %s %s %s", res[0].Status, res[1].Status, res[2].Status)
	}
}
