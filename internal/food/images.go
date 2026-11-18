package food

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"

	"plate/internal/store"
)

const imageHost = "images.openfoodfacts.org"

// AllowedImageURL reports whether rawURL points at the one image host over https, with no credentials or port.
func AllowedImageURL(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	return u.Scheme == "https" && u.Host == imageHost && u.User == nil && strings.HasPrefix(u.Path, "/images/")
}

// imageKey derives the cache key from the URL. The key is opaque: it is not a path and carries no URL.
func imageKey(rawURL string) string {
	h := sha256.Sum256([]byte(rawURL))
	return hex.EncodeToString(h[:16])
}

// RegisterImage records an allowlisted upstream URL and returns its key. Anything else returns nil.
// It only writes the database; the fetch happens later, on the first request for the key.
func RegisterImage(ctx context.Context, r *store.Repo, rawURL, now string) *string {
	if !AllowedImageURL(rawURL) {
		return nil
	}
	key := imageKey(rawURL)
	if err := r.RegisterImage(ctx, key, rawURL, now); err != nil {
		return nil
	}
	return &key
}
