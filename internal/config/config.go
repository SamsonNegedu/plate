// Package config parses and validates environment configuration.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type Config struct {
	Addr            string
	DataDir         string
	DBPath          string
	BaseURL         *url.URL
	TrustProxy      bool
	ProxyCIDRs      []netip.Prefix
	AdminEmail      string
	AdminPassword   string
	LogLevel        slog.Level
	AuthMode        string
	ResetPassword   bool
	SyncEnabled     bool
	ReindexFTS      bool
	ImportBLSPath   string
	ImportCatalog   string
	CatalogVersion  string
	CatalogReimport bool
	IntegrityCheck  bool
	MaintenanceHr   int
	OFFBaseURL      string
	OFFSearchURL    string
	OFFUserAgent    string
	ImageMaxBytes   int64
	ImageCacheMB    int64
}

// Load reads configuration from the given lookup function so tests need no real environment.
func Load(env func(string) string) (Config, error) {
	var errs []error
	str := func(key, def string) string {
		if v := strings.TrimSpace(env(key)); v != "" {
			return v
		}
		return def
	}
	boolean := func(key string, def bool) bool {
		v := strings.TrimSpace(env(key))
		if v == "" {
			return def
		}
		b, err := strconv.ParseBool(v)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %q is not a boolean", key, v))
			return def
		}
		return b
	}
	integer := func(key string, def int64) int64 {
		v := strings.TrimSpace(env(key))
		if v == "" {
			return def
		}
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			errs = append(errs, fmt.Errorf("%s: %q is not a non-negative integer", key, v))
			return def
		}
		return n
	}

	c := Config{
		Addr:            str("PLATE_ADDR", ":8080"),
		DataDir:         str("PLATE_DATA_DIR", "./data"),
		TrustProxy:      boolean("PLATE_TRUST_PROXY", false),
		AdminEmail:      str("PLATE_ADMIN_EMAIL", ""),
		AdminPassword:   env("PLATE_ADMIN_PASSWORD"),
		AuthMode:        str("PLATE_AUTH_MODE", "password"),
		ResetPassword:   boolean("PLATE_ADMIN_RESET_PASSWORD", false),
		SyncEnabled:     boolean("PLATE_SYNC_ENABLED", true),
		ReindexFTS:      boolean("PLATE_REINDEX_FTS", false),
		ImportBLSPath:   str("PLATE_IMPORT_BLS_PATH", ""),
		ImportCatalog:   str("PLATE_IMPORT_CATALOG_PATH", ""),
		CatalogVersion:  str("PLATE_CATALOG_DATASET_VERSION", ""),
		CatalogReimport: boolean("PLATE_CATALOG_REIMPORT", false),
		IntegrityCheck:  boolean("PLATE_INTEGRITY_CHECK", true),
		MaintenanceHr:   int(integer("PLATE_MAINTENANCE_HOUR", 3)),
		OFFBaseURL:      str("PLATE_OFF_BASE_URL", "https://world.openfoodfacts.org"),
		OFFSearchURL:    str("PLATE_OFF_SEARCH_URL", "https://search.openfoodfacts.org"),
		OFFUserAgent:    str("PLATE_OFF_USER_AGENT", "Plate/1.0 (self-hosted)"),
		ImageMaxBytes:   integer("PLATE_IMAGE_MAX_BYTES", 2_000_000),
		ImageCacheMB:    integer("PLATE_IMAGE_CACHE_MB", 256),
	}
	c.DBPath = str("PLATE_DB_PATH", filepath.Join(c.DataDir, "plate.db"))

	switch strings.ToLower(str("PLATE_LOG_LEVEL", "info")) {
	case "debug":
		c.LogLevel = slog.LevelDebug
	case "info":
		c.LogLevel = slog.LevelInfo
	case "warn":
		c.LogLevel = slog.LevelWarn
	case "error":
		c.LogLevel = slog.LevelError
	default:
		errs = append(errs, errors.New("PLATE_LOG_LEVEL: want debug, info, warn or error"))
	}

	base, err := url.Parse(str("PLATE_BASE_URL", "http://localhost:8080"))
	switch {
	case err != nil || base.Host == "":
		errs = append(errs, errors.New("PLATE_BASE_URL: not a valid absolute URL"))
	case base.Scheme != "https" && base.Hostname() != "localhost" && base.Hostname() != "127.0.0.1":
		errs = append(errs, errors.New("PLATE_BASE_URL: must be https except on localhost"))
	default:
		c.BaseURL = base
	}

	if c.AuthMode != "password" && c.AuthMode != "proxy" {
		errs = append(errs, errors.New("PLATE_AUTH_MODE: want password or proxy"))
	}
	if c.MaintenanceHr < 0 || c.MaintenanceHr > 23 {
		errs = append(errs, errors.New("PLATE_MAINTENANCE_HOUR: want 0-23"))
	}

	for _, raw := range strings.Split(env("PLATE_PROXY_CIDRS"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		p, err := netip.ParsePrefix(raw)
		if err != nil {
			errs = append(errs, fmt.Errorf("PLATE_PROXY_CIDRS: %q is not a CIDR", raw))
			continue
		}
		c.ProxyCIDRs = append(c.ProxyCIDRs, p)
	}
	if (c.TrustProxy || c.AuthMode == "proxy") && len(c.ProxyCIDRs) == 0 {
		errs = append(errs, errors.New("PLATE_PROXY_CIDRS: required when proxy trust or proxy auth is on"))
	}
	if c.AuthMode == "proxy" && !c.TrustProxy {
		errs = append(errs, errors.New("PLATE_AUTH_MODE=proxy requires PLATE_TRUST_PROXY=true"))
	}
	if c.ResetPassword && c.AdminPassword == "" {
		errs = append(errs, errors.New("PLATE_ADMIN_RESET_PASSWORD needs PLATE_ADMIN_PASSWORD"))
	}
	if c.AdminPassword != "" && len(c.AdminPassword) < 12 {
		errs = append(errs, errors.New("PLATE_ADMIN_PASSWORD: use at least 12 characters"))
	}

	return c, errors.Join(errs...)
}

// FromOS loads configuration from the process environment.
func FromOS() (Config, error) {
	return Load(os.Getenv)
}
