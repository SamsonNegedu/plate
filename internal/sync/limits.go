package sync

import (
	"context"
	"fmt"

	"plate/internal/domain"
	"plate/internal/store"
)

// Per-account ceilings. A few years of heavy logging is about 20,000 entries, so these only stop abuse.
// They are variables only so a test can lower them.
var (
	maxEntriesPerUser = 50_000
	maxFoodsPerUser   = 5_000
	maxHealthPerUser  = 100_000
)

// room remembers the live counts for one push. Counting 50,000 entries takes tens of milliseconds, so a batch of
// 100 creates counts once and then adds what it creates. A create that is later rejected still counts, which can only
// make the check stricter for the rest of that batch.
type room struct {
	entries, foods, health             int64
	haveEntries, haveFoods, haveHealth bool
}

type roomKey struct{}

func withRoom(ctx context.Context) context.Context {
	return context.WithValue(ctx, roomKey{}, &room{})
}

func roomFrom(ctx context.Context) *room {
	if rm, ok := ctx.Value(roomKey{}).(*room); ok {
		return rm
	}
	return &room{}
}

func checkEntryRoom(ctx context.Context, r *store.Repo, userID string) error {
	rm := roomFrom(ctx)
	if !rm.haveEntries {
		n, err := r.CountLiveEntries(ctx, userID)
		if err != nil {
			return err
		}
		rm.entries, rm.haveEntries = n, true
	}
	if rm.entries >= int64(maxEntriesPerUser) {
		return fmt.Errorf("%d entries: %w", rm.entries, domain.ErrLimitReached)
	}
	rm.entries++
	return nil
}

func checkFoodRoom(ctx context.Context, r *store.Repo, userID string) error {
	rm := roomFrom(ctx)
	if !rm.haveFoods {
		n, err := r.CountLiveUserFoods(ctx, userID)
		if err != nil {
			return err
		}
		rm.foods, rm.haveFoods = n, true
	}
	if rm.foods >= int64(maxFoodsPerUser) {
		return fmt.Errorf("%d foods: %w", rm.foods, domain.ErrLimitReached)
	}
	rm.foods++
	return nil
}

func checkHealthRoom(ctx context.Context, r *store.Repo, userID string) error {
	rm := roomFrom(ctx)
	if !rm.haveHealth {
		n, err := r.CountLiveHealthRecords(ctx, userID)
		if err != nil {
			return err
		}
		rm.health, rm.haveHealth = n, true
	}
	if rm.health >= int64(maxHealthPerUser) {
		return fmt.Errorf("%d health records: %w", rm.health, domain.ErrLimitReached)
	}
	rm.health++
	return nil
}
