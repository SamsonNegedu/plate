// Package ratelimit holds the in-memory sliding-window limiter shared by login, the API and the OFF client.
package ratelimit

import (
	"sync"
	"time"
)

// Limiter is an in-memory sliding-window counter. A restart clears it, which is acceptable for one instance.
type Limiter struct {
	mu     sync.Mutex
	now    func() time.Time
	window time.Duration
	max    int
	hits   map[string][]time.Time
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{now: time.Now, window: window, max: max, hits: map[string][]time.Time{}}
}

// Allow records an attempt for key. It returns false and the wait when the key is over its limit.
func (l *Limiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	recent := l.prune(key, now)
	if len(recent) >= l.max {
		return false, recent[0].Add(l.window).Sub(now)
	}
	l.hits[key] = append(recent, now)
	return true, 0
}

// Peek reports whether key is already over its limit without recording an attempt.
func (l *Limiter) Peek(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	recent := l.prune(key, now)
	if len(recent) >= l.max {
		return false, recent[0].Add(l.window).Sub(now)
	}
	return true, 0
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.hits, key)
}

func (l *Limiter) prune(key string, now time.Time) []time.Time {
	cut := now.Add(-l.window)
	hits := l.hits[key]
	i := 0
	for i < len(hits) && !hits[i].After(cut) {
		i++
	}
	hits = hits[i:]
	if len(hits) == 0 {
		delete(l.hits, key)
		return nil
	}
	l.hits[key] = hits
	return hits
}
