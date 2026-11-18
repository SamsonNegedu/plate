package food

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // decoders used to check that a fetched body really is an image
	_ "image/jpeg" // decoders used to check that a fetched body really is an image
	_ "image/png"  // decoders used to check that a fetched body really is an image
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

var keyRe = regexp.MustCompile(`^[0-9a-f]{32}$`)

// ErrBadImage means the upstream body is not an acceptable image.
var ErrBadImage = errors.New("upstream image rejected")

// Image is a cached file ready to serve.
type Image struct {
	Path        string
	ContentType string
}

// ImagesConfig configures the proxy. Zero values take the plan defaults.
type ImagesConfig struct {
	Dir        string
	MaxBytes   int64
	CacheBytes int64
	Timeout    time.Duration
	// Client is replaced in tests to reach a local server; production uses the default with its host-pinned redirects.
	Client *http.Client
}

// Images fetches product images from the one allowlisted host, validates them and caches them on disk.
// A client only ever holds an opaque key; the upstream URL stays in the database.
type Images struct {
	db   *sql.DB
	cfg  ImagesConfig
	http *http.Client
	now  func() time.Time

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewImages(db *sql.DB, cfg ImagesConfig) *Images {
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = 2_000_000
	}
	if cfg.CacheBytes <= 0 {
		cfg.CacheBytes = 256 << 20
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 10 * time.Second
	}
	c := cfg.Client
	if c == nil {
		c = &http.Client{Timeout: cfg.Timeout, CheckRedirect: sameHostOnly}
	}
	return &Images{db: db, cfg: cfg, http: c, now: time.Now, locks: map[string]*sync.Mutex{}}
}

// Get returns the cached image for key, fetching it on first use.
func (im *Images) Get(ctx context.Context, key string) (Image, error) {
	if !keyRe.MatchString(key) {
		return Image{}, fmt.Errorf("image key: %w", domain.ErrNotFound)
	}
	lock := im.lockFor(key)
	lock.Lock()
	defer lock.Unlock()

	repo := store.NewRepo(im.db)
	rec, err := repo.Image(ctx, key)
	if err != nil {
		return Image{}, err
	}
	path := filepath.Join(im.cfg.Dir, key)
	if rec.Bytes > 0 {
		if _, err := os.Stat(path); err == nil {
			_ = repo.TouchImage(ctx, key, stamp(im.now()))
			return Image{Path: path, ContentType: rec.ContentType}, nil
		}
	}
	if !AllowedImageURL(rec.SourceURL) {
		return Image{}, fmt.Errorf("image source is not allowlisted: %w", domain.ErrNotFound)
	}
	body, ctype, err := im.fetch(ctx, rec.SourceURL)
	if err != nil {
		return Image{}, err
	}
	if err := writeAtomic(path, body); err != nil {
		return Image{}, err
	}
	now := stamp(im.now())
	if err := repo.MarkImageFetched(ctx, key, ctype, int64(len(body)), now); err != nil {
		return Image{}, err
	}
	im.evict(ctx, repo, key)
	return Image{Path: path, ContentType: ctype}, nil
}

// ForCatalog resolves the image of a catalog row by barcode, registering it on first use.
func (im *Images) ForCatalog(ctx context.Context, barcode string) (Image, error) {
	repo := store.NewRepo(im.db)
	c, err := repo.CatalogByBarcode(ctx, barcode)
	if err != nil {
		return Image{}, err
	}
	if c.ImageSourceURL == nil || !AllowedImageURL(*c.ImageSourceURL) {
		return Image{}, fmt.Errorf("catalog row has no image: %w", domain.ErrNotFound)
	}
	key := imageKey(*c.ImageSourceURL)
	if err := repo.RegisterImage(ctx, key, *c.ImageSourceURL, stamp(im.now())); err != nil {
		return Image{}, err
	}
	return im.Get(ctx, key)
}

func (im *Images) lockFor(key string) *sync.Mutex {
	im.mu.Lock()
	defer im.mu.Unlock()
	l, ok := im.locks[key]
	if !ok {
		l = &sync.Mutex{}
		im.locks[key] = l
	}
	return l
}

func (im *Images) fetch(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("building image request: %w", err)
	}
	req.Header.Set("Accept", "image/*")
	resp, err := im.http.Do(req)
	if err != nil {
		return nil, "", &UpstreamError{Reason: "image fetch failed", Err: err}
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("image upstream status %d: %w", resp.StatusCode, ErrBadImage)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, im.cfg.MaxBytes+1))
	if err != nil {
		return nil, "", &UpstreamError{Reason: "image read failed", Err: err}
	}
	if int64(len(body)) > im.cfg.MaxBytes {
		return nil, "", fmt.Errorf("image larger than %d bytes: %w", im.cfg.MaxBytes, ErrBadImage)
	}
	ctype, ok := sniffImage(body)
	if !ok {
		return nil, "", fmt.Errorf("body is not an allowed image type: %w", ErrBadImage)
	}
	return body, ctype, nil
}

// sniffImage trusts the bytes, not the upstream Content-Type header.
func sniffImage(b []byte) (string, bool) {
	ctype := http.DetectContentType(b)
	switch ctype {
	case "image/jpeg", "image/png", "image/gif":
		if _, _, err := image.DecodeConfig(bytes.NewReader(b)); err != nil {
			return "", false
		}
		return ctype, true
	case "image/webp":
		return ctype, len(b) > 12
	}
	return "", false
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return fmt.Errorf("creating image directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return fmt.Errorf("creating temp image: %w", err)
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("writing image: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("closing image: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		return fmt.Errorf("publishing image: %w", err)
	}
	return nil
}

// evict drops least-recently-used files until the cache fits. Rows stay so an image can be fetched again.
func (im *Images) evict(ctx context.Context, repo *store.Repo, keep string) {
	total, err := repo.ImageCacheBytes(ctx)
	if err != nil || total <= im.cfg.CacheBytes {
		return
	}
	for total > im.cfg.CacheBytes {
		batch, err := repo.ImagesLRU(ctx, 50)
		if err != nil || len(batch) == 0 {
			return
		}
		progressed := false
		for _, img := range batch {
			if img.Key == keep {
				continue
			}
			_ = os.Remove(filepath.Join(im.cfg.Dir, img.Key))
			if err := repo.ClearImage(ctx, img.Key); err != nil {
				return
			}
			total -= img.Bytes
			progressed = true
			if total <= im.cfg.CacheBytes {
				return
			}
		}
		if !progressed {
			return
		}
	}
}
