package ratelimit

import (
	"testing"
	"time"
)

func TestLimiter(t *testing.T) {
	now := time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)
	l := NewLimiter(3, time.Minute)
	l.now = func() time.Time { return now }
	for range 3 {
		if ok, _ := l.Allow("ip"); !ok {
			t.Fatal("blocked too early")
		}
	}
	ok, wait := l.Allow("ip")
	if ok || wait <= 0 || wait > time.Minute {
		t.Fatalf("ok=%v wait=%v", ok, wait)
	}
	if ok, _ := l.Allow("other"); !ok {
		t.Fatal("buckets must be independent")
	}
	now = now.Add(61 * time.Second)
	if ok, _ := l.Allow("ip"); !ok {
		t.Fatal("window did not slide")
	}
	l.Reset("ip")
	if ok, _ := l.Peek("ip"); !ok {
		t.Fatal("reset did not clear")
	}
}
