package food

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"plate/internal/domain"
	"plate/internal/store"
)

const imgURL = "https://images.openfoodfacts.org/images/products/301/762/042/2003/front_de.1.400.jpg"

// rewriteTransport sends every request to the test server while keeping the original Host in the URL the code saw.
type rewriteTransport struct{ target *url.URL }

func (rt rewriteTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.URL.Scheme, r.URL.Host = rt.target.Scheme, rt.target.Host
	return http.DefaultTransport.RoundTrip(r)
}

func jpegBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{200, 10, 10, 255})
	var b bytes.Buffer
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

type imgFx struct {
	*fx
	im    *Images
	calls atomic.Int32
	dir   string
}

func newImgFx(t *testing.T, h http.HandlerFunc, mutate func(*ImagesConfig)) *imgFx {
	t.Helper()
	x := newFx(t)
	f := &imgFx{fx: x, dir: filepath.Join(t.TempDir(), "images")}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.calls.Add(1)
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	target, _ := url.Parse(srv.URL)
	cfg := ImagesConfig{Dir: f.dir, Client: &http.Client{Transport: rewriteTransport{target}, CheckRedirect: sameHostOnly, Timeout: 2 * time.Second}}
	if mutate != nil {
		mutate(&cfg)
	}
	f.im = NewImages(x.db, cfg)
	f.im.now = func() time.Time { return x.now }
	return f
}

func (f *imgFx) register(t *testing.T, u string) string {
	t.Helper()
	var key string
	err := store.InTx(context.Background(), f.db, func(r *store.Repo) error {
		if k := RegisterImage(context.Background(), r, u, stamp(f.now)); k != nil {
			key = *k
		}
		return nil
	})
	if err != nil || key == "" {
		t.Fatalf("register %q: %q %v", u, key, err)
	}
	return key
}

func TestImageFetchedOnceThenServedFromDisk(t *testing.T) {
	body := jpegBytes(t)
	f := newImgFx(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(body)
	}, nil)
	key := f.register(t, imgURL)
	for range 3 {
		img, err := f.im.Get(context.Background(), key)
		if err != nil || img.ContentType != "image/jpeg" {
			t.Fatalf("img = %+v, %v", img, err)
		}
		got, _ := os.ReadFile(img.Path)
		if !bytes.Equal(got, body) {
			t.Fatal("cached bytes differ")
		}
	}
	if f.calls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", f.calls.Load())
	}
}

func TestImageKeyIsOpaqueAndSafe(t *testing.T) {
	f := newImgFx(t, func(http.ResponseWriter, *http.Request) {}, nil)
	for _, bad := range []string{"", "../etc/passwd", "..%2f", "short", strings.Repeat("g", 32), strings.Repeat("a", 33), "https://evil.example/x.jpg"} {
		if _, err := f.im.Get(context.Background(), bad); !errors.Is(err, domain.ErrNotFound) {
			t.Errorf("%q: err = %v", bad, err)
		}
	}
	if _, err := f.im.Get(context.Background(), strings.Repeat("a", 32)); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown key: %v", err)
	}
	if f.calls.Load() != 0 {
		t.Fatal("a bad key must never reach the network")
	}
	if strings.Contains(imageKey(imgURL), "openfoodfacts") {
		t.Fatal("the key must not embed the URL")
	}
}

func TestNonAllowlistedURLsAreNeverRegisteredOrFetched(t *testing.T) {
	f := newImgFx(t, func(http.ResponseWriter, *http.Request) {}, nil)
	for _, u := range []string{
		"", "http://images.openfoodfacts.org/images/a.jpg", "https://evil.example/images/a.jpg",
		"https://images.openfoodfacts.org.evil.example/images/a.jpg", "https://images.openfoodfacts.org@evil.example/images/a.jpg",
		"https://user:pw@images.openfoodfacts.org/images/a.jpg", "https://images.openfoodfacts.org:8443/images/a.jpg",
		"https://images.openfoodfacts.org/secret/a.jpg", "file:///etc/passwd", "http://169.254.169.254/latest",
	} {
		if AllowedImageURL(u) || ImageKeyFor(u) != "" {
			t.Errorf("%q was allowed", u)
		}
		_ = store.InTx(context.Background(), f.db, func(r *store.Repo) error {
			if RegisterImage(context.Background(), r, u, stamp(f.now)) != nil {
				t.Errorf("%q was registered", u)
			}
			return nil
		})
	}
	// even a row written straight into the database with a bad URL is refused at fetch time
	key := strings.Repeat("b", 32)
	if _, err := f.db.Exec(`INSERT INTO image_cache(key, content_type, bytes, fetched_at, last_used_at, source_url) VALUES (?, '', 0, '', '', 'https://evil.example/x.jpg')`, key); err != nil {
		t.Fatal(err)
	}
	if _, err := f.im.Get(context.Background(), key); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
	if f.calls.Load() != 0 {
		t.Fatal("the network was touched")
	}
}

func TestImageSizeTypeAndContentRules(t *testing.T) {
	cases := map[string]func(http.ResponseWriter, *http.Request){
		"too large": func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write(append(jpegBytes(t), make([]byte, 3000)...))
		},
		"html as jpeg": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write([]byte("<html><script>alert(1)</script></html>"))
		},
		"svg": func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "image/svg+xml")
			_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
		},
		"truncated jpeg": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(jpegBytes(t)[:12]) },
		"404":            func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(404) },
		"empty":          func(http.ResponseWriter, *http.Request) {},
	}
	for name, h := range cases {
		f := newImgFx(t, h, func(c *ImagesConfig) { c.MaxBytes = 2000 })
		key := f.register(t, imgURL)
		if _, err := f.im.Get(context.Background(), key); !errors.Is(err, ErrBadImage) {
			t.Errorf("%s: err = %v", name, err)
		}
		if m, _ := filepath.Glob(filepath.Join(f.dir, "*")); len(m) != 0 {
			t.Errorf("%s: a rejected image was cached: %v", name, m)
		}
	}
}

func TestImageRedirectToAnotherHostIsRefused(t *testing.T) {
	f := newImgFx(t, func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "https://evil.example/x.jpg", http.StatusFound)
	}, nil)
	key := f.register(t, imgURL)
	if _, err := f.im.Get(context.Background(), key); err == nil {
		t.Fatal("a redirect off-host must fail")
	}
}

func TestImageCacheEvictsLeastRecentlyUsed(t *testing.T) {
	body := jpegBytes(t)
	f := newImgFx(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) },
		func(c *ImagesConfig) { c.CacheBytes = int64(len(body))*2 + 10 })
	urls := []string{
		"https://images.openfoodfacts.org/images/products/1/a.jpg",
		"https://images.openfoodfacts.org/images/products/1/b.jpg",
		"https://images.openfoodfacts.org/images/products/1/c.jpg",
	}
	var keys []string
	for _, u := range urls {
		k := f.register(t, u)
		keys = append(keys, k)
		f.now = f.now.Add(time.Minute)
		if _, err := f.im.Get(context.Background(), k); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(filepath.Join(f.dir, keys[0])); !os.IsNotExist(err) {
		t.Fatal("the least recently used file should be evicted")
	}
	for _, k := range keys[1:] {
		if _, err := os.Stat(filepath.Join(f.dir, k)); err != nil {
			t.Fatalf("recent file %s was evicted", k)
		}
	}
	before := f.calls.Load()
	if _, err := f.im.Get(context.Background(), keys[0]); err != nil || f.calls.Load() != before+1 {
		t.Fatalf("an evicted image must be fetched again on demand: %v", err)
	}
}

func TestCatalogImageResolvesByBarcode(t *testing.T) {
	body := jpegBytes(t)
	f := newImgFx(t, func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write(body) }, nil)
	f.addCatalog(t, "3017620422003", "Nutella", 539)
	img, err := f.im.ForCatalog(context.Background(), "3017620422003")
	if err != nil || img.ContentType != "image/jpeg" {
		t.Fatalf("img = %+v, %v", img, err)
	}
	if _, err := f.im.ForCatalog(context.Background(), "4000000000099"); !errors.Is(err, domain.ErrNotFound) {
		t.Fatalf("unknown barcode: %v", err)
	}
}
