package food

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func fastClient(url string) *OFF {
	return NewOFF(OFFConfig{
		BaseURL: url, SearchURL: url, UserAgent: "Plate-test/1.0", RetryWait: time.Millisecond,
		RequestsPerMin: 10000, BreakerAfter: 5, BreakerOpenFor: time.Minute,
	})
}

func serve(t *testing.T, h http.HandlerFunc) (*OFF, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	return fastClient(srv.URL), &calls
}

func TestProductSuccessSendsUserAgentAndFields(t *testing.T) {
	fixture, _ := os.ReadFile("testdata/product_nutella.json")
	var ua, path, fields string
	c, _ := serve(t, func(w http.ResponseWriter, r *http.Request) {
		ua, path, fields = r.Header.Get("User-Agent"), r.URL.Path, r.URL.Query().Get("fields")
		if r.URL.RawQuery == "" || strings.Contains(r.Header.Get("Cookie"), "session") {
			t.Error("unexpected request shape")
		}
		_, _ = w.Write(fixture)
	})
	p, err := c.Product(context.Background(), "3017620422003")
	if err != nil || p.Code != "3017620422003" {
		t.Fatalf("p = %+v, %v", p, err)
	}
	if ua != "Plate-test/1.0" || path != "/api/v2/product/3017620422003.json" || !strings.Contains(fields, "nutriments") {
		t.Fatalf("ua=%q path=%q fields=%q", ua, path, fields)
	}
}

func TestProduct404IsNotFoundAndNotRetried(t *testing.T) {
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"code":"1","status":0,"status_verbose":"product not found"}`))
	})
	if _, err := c.Product(context.Background(), "4000000000000"); !errors.Is(err, ErrProductNotFound) {
		t.Fatalf("err = %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, a 404 must not be retried", calls.Load())
	}
}

func TestProductStatusZeroWith200IsNotFound(t *testing.T) {
	c, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"status":0}`)) })
	if _, err := c.Product(context.Background(), "4000000000000"); !errors.Is(err, ErrProductNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestFiveHundredRetriesOnceThenSucceeds(t *testing.T) {
	var n atomic.Int32
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		if n.Add(1) == 1 {
			w.WriteHeader(503)
			return
		}
		_, _ = w.Write([]byte(`{"status":1,"product":{"code":"4000000000011","product_name":"X"}}`))
	})
	if _, err := c.Product(context.Background(), "4000000000011"); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("calls = %d", calls.Load())
	}
}

func TestFiveHundredTwiceIsUpstreamError(t *testing.T) {
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(502) })
	_, err := c.Product(context.Background(), "4000000000011")
	if !errors.Is(err, ErrUpstream) || calls.Load() != 2 {
		t.Fatalf("err = %v calls = %d", err, calls.Load())
	}
}

func TestRateLimited429IsUpstreamWithRetryAfterAndNoRetry(t *testing.T) {
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "42")
		w.WriteHeader(429)
	})
	_, err := c.Product(context.Background(), "4000000000011")
	var ue *UpstreamError
	if !errors.As(err, &ue) || ue.RetryAfter != 42*time.Second || calls.Load() != 1 {
		t.Fatalf("err = %v calls = %d", err, calls.Load())
	}
}

func TestTimeoutIsUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-time.After(2 * time.Second):
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(srv.Close)
	c := NewOFF(OFFConfig{BaseURL: srv.URL, SearchURL: srv.URL, UserAgent: "t", Timeout: 50 * time.Millisecond, RetryWait: time.Millisecond, RequestsPerMin: 1000})
	if _, err := c.Product(context.Background(), "4000000000011"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v", err)
	}
}

func TestMalformedAndOversizedBodies(t *testing.T) {
	c, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{not json`)) })
	if _, err := c.Product(context.Background(), "4000000000011"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("malformed: %v", err)
	}
	big, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":1,"product":{"product_name":"` + strings.Repeat("a", 3<<20) + `"}}`))
	})
	if _, err := big.Product(context.Background(), "4000000000011"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("oversized: %v", err)
	}
}

func TestRedirectToAnotherHostIsRefused(t *testing.T) {
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Error("the redirect target must never be contacted")
		_, _ = w.Write([]byte(`{}`))
	}))
	t.Cleanup(evil.Close)
	c, _ := serve(t, func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, evil.URL, http.StatusFound) })
	if _, err := c.Product(context.Background(), "4000000000011"); !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v", err)
	}
}

func TestBreakerOpensAfterFiveFailuresAndRecovers(t *testing.T) {
	var healthy atomic.Bool
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		if healthy.Load() {
			_, _ = w.Write([]byte(`{"status":1,"product":{"code":"4000000000011","product_name":"X"}}`))
			return
		}
		w.WriteHeader(500)
	})
	clock := time.Now()
	c.breaker.now = func() time.Time { return clock }

	for range 5 {
		_, _ = c.Product(context.Background(), "4000000000011")
	}
	opened := calls.Load()
	_, err := c.Product(context.Background(), "4000000000011")
	var ue *UpstreamError
	if !errors.As(err, &ue) || ue.Reason != "circuit open" || ue.RetryAfter <= 0 || calls.Load() != opened {
		t.Fatalf("while open: err=%v calls %d->%d", err, opened, calls.Load())
	}

	clock = clock.Add(61 * time.Second)
	healthy.Store(true)
	if _, err := c.Product(context.Background(), "4000000000011"); err != nil {
		t.Fatalf("trial request: %v", err)
	}
	if _, err := c.Product(context.Background(), "4000000000011"); err != nil {
		t.Fatalf("closed again: %v", err)
	}
}

func TestBreakerReopensWhenTheTrialFails(t *testing.T) {
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) })
	clock := time.Now()
	c.breaker.now = func() time.Time { return clock }
	for range 5 {
		_, _ = c.Product(context.Background(), "4000000000011")
	}
	clock = clock.Add(61 * time.Second)
	before := calls.Load()
	_, _ = c.Product(context.Background(), "4000000000011") // the trial
	if calls.Load() == before {
		t.Fatal("the trial request was not sent")
	}
	after := calls.Load()
	_, _ = c.Product(context.Background(), "4000000000011")
	if calls.Load() != after {
		t.Fatal("a failed trial must reopen the breaker")
	}
}

func TestA404DoesNotCountAsAFailure(t *testing.T) {
	c, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) })
	for range 20 {
		_, _ = c.Product(context.Background(), "4000000000000")
	}
	if c.breaker.blockedFor() != 0 {
		t.Fatal("misses must not open the breaker")
	}
}

func TestGlobalRateLimitStopsUpstreamCalls(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) }))
	t.Cleanup(srv.Close)
	c := NewOFF(OFFConfig{BaseURL: srv.URL, SearchURL: srv.URL, UserAgent: "t", RequestsPerMin: 3})
	var limited int
	for range 6 {
		if _, err := c.Product(context.Background(), "4000000000000"); errors.Is(err, ErrUpstream) {
			limited++
		}
	}
	if limited != 3 {
		t.Fatalf("limited = %d, want 3", limited)
	}
}

func TestSearchGermanyFirstThenUnfilteredWhenThin(t *testing.T) {
	var filters []string
	c, _ := serve(t, func(w http.ResponseWriter, r *http.Request) {
		filters = append(filters, r.URL.Query().Get("countries_tags_en"))
		if r.URL.Query().Get("countries_tags_en") != "" {
			_, _ = w.Write([]byte(`{"hits":[{"code":"1","product_name":"A"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"hits":[{"code":"1","product_name":"A"},{"code":"2","product_name":"B"}]}`))
	})
	hits, err := c.Search(context.Background(), "joghurt")
	if err != nil || len(hits) != 2 {
		t.Fatalf("hits = %+v, %v", hits, err)
	}
	if len(filters) != 2 || filters[0] != "Germany" || filters[1] != "" {
		t.Fatalf("filters = %v", filters)
	}
}

func TestSearchEnoughGermanHitsSkipsTheRetry(t *testing.T) {
	c, calls := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"hits":[{"code":"1"},{"code":"2"},{"code":"3"},{"code":"4"},{"code":"5"}]}`))
	})
	if hits, err := c.Search(context.Background(), "joghurt"); err != nil || len(hits) != 5 || calls.Load() != 1 {
		t.Fatalf("hits=%d err=%v calls=%d", len(hits), err, calls.Load())
	}
}

func TestSearchParsesTheRealSearchResponse(t *testing.T) {
	fixture, _ := os.ReadFile("testdata/search_joghurt.json")
	c, _ := serve(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(fixture) })
	hits, err := c.search(context.Background(), "joghurt", true)
	if err != nil || len(hits) == 0 {
		t.Fatalf("hits = %d, %v", len(hits), err)
	}
	n, err := Normalize(hits[0], now)
	if err != nil || n.Food.Brand == "" || n.Food.Per100.Kcal <= 0 {
		t.Fatalf("a real search hit must normalize (brands arrive as an array): %+v %v", n.Food, err)
	}
}
