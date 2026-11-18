package food

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"plate/internal/ratelimit"
)

var (
	// ErrProductNotFound means Open Food Facts has no such barcode.
	ErrProductNotFound = errors.New("product not found upstream")
	// ErrUpstream means Open Food Facts could not answer. It is never a statement about the product.
	ErrUpstream = errors.New("upstream unavailable")
)

// UpstreamError carries how long the caller should wait before trying again.
type UpstreamError struct {
	Reason     string
	RetryAfter time.Duration
	Err        error
}

func (e *UpstreamError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("open food facts: %s: %v", e.Reason, e.Err)
	}
	return "open food facts: " + e.Reason
}

func (e *UpstreamError) Unwrap() error { return ErrUpstream }

// Fetcher is the part of the OFF client the rest of the app depends on, so tests can fake it.
type Fetcher interface {
	Product(ctx context.Context, code string) (OFFProduct, error)
	Search(ctx context.Context, query string) ([]OFFProduct, error)
}

// OFFConfig configures the client. Zero values take the defaults from the Phase 5 plan.
type OFFConfig struct {
	BaseURL        string
	SearchURL      string
	UserAgent      string
	Timeout        time.Duration
	Concurrency    int
	RequestsPerMin int
	MaxBodyBytes   int64
	BreakerAfter   int
	BreakerOpenFor time.Duration
	RetryWait      time.Duration
}

const productFields = "code,product_name,product_name_de,generic_name,brands,quantity,serving_size,serving_quantity," +
	"nutriments,nutriscore_grade,image_front_url,image_url,ingredients_text,allergens,last_modified_t,countries_tags"

const searchFields = "code,product_name,product_name_de,generic_name,brands,quantity,serving_size,serving_quantity," +
	"nutriments,nutriscore_grade,image_front_url,image_url,last_modified_t,countries_tags"

const (
	searchPageSize = 24
	thinResults    = 5
)

// OFF is the Open Food Facts client: bounded concurrency, a global request rate, one retry, and a circuit breaker.
// Only a product code or a search string is ever sent upstream; no user identifier leaves the server.
type OFF struct {
	cfg     OFFConfig
	http    *http.Client
	sem     chan struct{}
	limiter *ratelimit.Limiter
	breaker *breaker
}

func NewOFF(cfg OFFConfig) *OFF {
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	if cfg.Concurrency <= 0 {
		cfg.Concurrency = 5
	}
	if cfg.RequestsPerMin <= 0 {
		cfg.RequestsPerMin = 30
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = 2 << 20
	}
	if cfg.BreakerAfter <= 0 {
		cfg.BreakerAfter = 5
	}
	if cfg.BreakerOpenFor <= 0 {
		cfg.BreakerOpenFor = time.Minute
	}
	if cfg.RetryWait <= 0 {
		cfg.RetryWait = 250 * time.Millisecond
	}
	return &OFF{
		cfg:     cfg,
		http:    &http.Client{Timeout: cfg.Timeout, CheckRedirect: sameHostOnly},
		sem:     make(chan struct{}, cfg.Concurrency),
		limiter: ratelimit.NewLimiter(cfg.RequestsPerMin, time.Minute),
		breaker: newBreaker(cfg.BreakerAfter, cfg.BreakerOpenFor),
	}
}

// sameHostOnly refuses any redirect that leaves the original host.
func sameHostOnly(req *http.Request, via []*http.Request) error {
	if len(via) >= 3 {
		return errors.New("too many redirects")
	}
	if req.URL.Host != via[0].URL.Host {
		return fmt.Errorf("redirect to another host (%s) refused", req.URL.Host)
	}
	return nil
}

// Product fetches one product. A missing product returns ErrProductNotFound.
func (c *OFF) Product(ctx context.Context, code string) (OFFProduct, error) {
	u := fmt.Sprintf("%s/api/v2/product/%s.json?fields=%s", strings.TrimRight(c.cfg.BaseURL, "/"), url.PathEscape(code), url.QueryEscape(productFields))
	body, status, err := c.get(ctx, u)
	if err != nil {
		return OFFProduct{}, err
	}
	if status == http.StatusNotFound {
		return OFFProduct{}, ErrProductNotFound
	}
	var env struct {
		Status  int        `json:"status"`
		Product OFFProduct `json:"product"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		c.breaker.failure()
		return OFFProduct{}, &UpstreamError{Reason: "malformed response", Err: err}
	}
	if env.Status != 1 {
		return OFFProduct{}, ErrProductNotFound
	}
	if env.Product.Code == "" {
		env.Product.Code = code
	}
	return env.Product, nil
}

// Search queries the OFF search API for Germany first and retries without the filter when the result is thin.
func (c *OFF) Search(ctx context.Context, query string) ([]OFFProduct, error) {
	hits, err := c.search(ctx, query, true)
	if err != nil {
		return nil, err
	}
	if len(hits) >= thinResults {
		return hits, nil
	}
	more, err := c.search(ctx, query, false)
	if err != nil {
		return hits, nil //nolint:nilerr // the filtered hits are still useful when the retry fails
	}
	seen := map[string]bool{}
	for _, h := range hits {
		seen[h.Code] = true
	}
	for _, h := range more {
		if !seen[h.Code] {
			hits = append(hits, h)
		}
	}
	return hits, nil
}

func (c *OFF) search(ctx context.Context, query string, germany bool) ([]OFFProduct, error) {
	q := url.Values{}
	q.Set("q", query)
	q.Set("page_size", fmt.Sprint(searchPageSize))
	q.Set("fields", searchFields)
	if germany {
		q.Set("countries_tags_en", "Germany")
	}
	body, status, err := c.get(ctx, strings.TrimRight(c.cfg.SearchURL, "/")+"/search?"+q.Encode())
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	var env struct {
		Hits []OFFProduct `json:"hits"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		c.breaker.failure()
		return nil, &UpstreamError{Reason: "malformed response", Err: err}
	}
	return env.Hits, nil
}

// get performs one upstream call under the breaker, rate limit and semaphore, with a single retry on 5xx or a network error.
func (c *OFF) get(ctx context.Context, rawURL string) ([]byte, int, error) {
	if wait := c.breaker.blockedFor(); wait > 0 {
		return nil, 0, &UpstreamError{Reason: "circuit open", RetryAfter: wait}
	}
	if ok, wait := c.limiter.Allow("upstream"); !ok {
		return nil, 0, &UpstreamError{Reason: "upstream rate limit reached", RetryAfter: wait}
	}
	select {
	case c.sem <- struct{}{}:
		defer func() { <-c.sem }()
	case <-ctx.Done():
		return nil, 0, fmt.Errorf("waiting for an upstream slot: %w", ctx.Err())
	}

	var lastErr error
	for attempt := range 2 {
		body, status, retry, err := c.once(ctx, rawURL)
		if err == nil {
			c.breaker.success()
			return body, status, nil
		}
		lastErr = err
		if !retry || attempt == 1 {
			break
		}
		select {
		case <-ctx.Done():
			return nil, 0, fmt.Errorf("retrying upstream: %w", ctx.Err())
		case <-time.After(c.cfg.RetryWait):
		}
	}
	c.breaker.failure()
	var ue *UpstreamError
	if errors.As(lastErr, &ue) {
		return nil, 0, ue
	}
	return nil, 0, &UpstreamError{Reason: "request failed", Err: lastErr}
}

// once returns retry=true for errors worth a second attempt.
func (c *OFF) once(ctx context.Context, rawURL string) (body []byte, status int, retry bool, err error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, false, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("User-Agent", c.cfg.UserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, false, ctx.Err()
		}
		return nil, 0, true, err
	}
	defer func() { _ = resp.Body.Close() }()

	switch {
	case resp.StatusCode == http.StatusNotFound:
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		return nil, resp.StatusCode, false, nil
	case resp.StatusCode == http.StatusTooManyRequests:
		return nil, resp.StatusCode, false, &UpstreamError{Reason: "upstream asked us to slow down", RetryAfter: retryAfter(resp)}
	case resp.StatusCode >= 500:
		return nil, resp.StatusCode, true, &UpstreamError{Reason: fmt.Sprintf("upstream error %d", resp.StatusCode)}
	case resp.StatusCode != http.StatusOK:
		return nil, resp.StatusCode, false, &UpstreamError{Reason: fmt.Sprintf("unexpected status %d", resp.StatusCode)}
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, c.cfg.MaxBodyBytes+1))
	if err != nil {
		return nil, 0, true, err
	}
	if int64(len(b)) > c.cfg.MaxBodyBytes {
		return nil, 0, false, &UpstreamError{Reason: "response too large"}
	}
	return b, resp.StatusCode, false, nil
}

func retryAfter(resp *http.Response) time.Duration {
	var secs int
	if _, err := fmt.Sscanf(resp.Header.Get("Retry-After"), "%d", &secs); err == nil && secs > 0 && secs <= 3600 {
		return time.Duration(secs) * time.Second
	}
	return 30 * time.Second
}

// breaker opens after N consecutive failures, stays open for a while, then lets one trial request through.
type breaker struct {
	mu       sync.Mutex
	now      func() time.Time
	after    int
	openFor  time.Duration
	fails    int
	openedAt time.Time
	trial    bool
}

func newBreaker(after int, openFor time.Duration) *breaker {
	return &breaker{now: time.Now, after: after, openFor: openFor}
}

// blockedFor returns how long the breaker stays open, or 0 when a request may proceed.
func (b *breaker) blockedFor() time.Duration {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.openedAt.IsZero() {
		return 0
	}
	if left := b.openFor - b.now().Sub(b.openedAt); left > 0 {
		return left
	}
	if b.trial {
		return time.Second // someone else is already probing
	}
	b.trial = true
	return 0
}

func (b *breaker) success() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fails, b.openedAt, b.trial = 0, time.Time{}, false
}

func (b *breaker) failure() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fails++
	if b.fails >= b.after || b.trial {
		b.openedAt, b.trial = b.now(), false
	}
}
