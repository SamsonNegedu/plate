// Package config parses and validates environment configuration.
package config

import (
	"errors"
	"fmt"
	"log/slog"
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
	LogLevel        slog.Level
	SignupEnabled   bool
	SignupPoWBits   int
	SyncEnabled     bool
	ReindexFTS      bool
	ImportBLSPath   string
	ImportBLSUser   string
	ImportCatalog   string
	CatalogReimport bool
	IntegrityCheck  bool
	MaintenanceHr   int
	OFFBaseURL      string
	OFFSearchURL    string
	OFFUserAgent    string
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
		SignupEnabled:   boolean("PLATE_SIGNUP_ENABLED", true),
		SignupPoWBits:   int(integer("PLATE_SIGNUP_POW_BITS", 17)),
		SyncEnabled:     boolean("PLATE_SYNC_ENABLED", true),
		ReindexFTS:      boolean("PLATE_REINDEX_FTS", false),
		ImportBLSPath:   str("PLATE_IMPORT_BLS_PATH", ""),
		ImportBLSUser:   str("PLATE_IMPORT_BLS_USERNAME", ""),
		ImportCatalog:   str("PLATE_IMPORT_CATALOG_PATH", ""),
		CatalogReimport: boolean("PLATE_CATALOG_REIMPORT", false),
		IntegrityCheck:  boolean("PLATE_INTEGRITY_CHECK", true),
		MaintenanceHr:   int(integer("PLATE_MAINTENANCE_HOUR", 3)),
		OFFBaseURL:      str("PLATE_OFF_BASE_URL", "https://world.openfoodfacts.org"),
		OFFSearchURL:    str("PLATE_OFF_SEARCH_URL", "https://search.openfoodfacts.org"),
		OFFUserAgent:    str("PLATE_OFF_USER_AGENT", "Plate/1.0 (self-hosted)"),
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

	if c.MaintenanceHr < 0 || c.MaintenanceHr > 23 {
		errs = append(errs, errors.New("PLATE_MAINTENANCE_HOUR: want 0-23"))
	}

	if c.ImportBLSPath != "" && c.ImportBLSUser == "" {
		errs = append(errs, errors.New("PLATE_IMPORT_BLS_PATH needs PLATE_IMPORT_BLS_USERNAME"))
	}
	if c.SignupPoWBits > 28 {
		errs = append(errs, errors.New("PLATE_SIGNUP_POW_BITS: want 0-28"))
	}

	return c, errors.Join(errs...)
}

// FromOS loads configuration from the process environment.
func FromOS() (Config, error) {
	return Load(os.Getenv)
}
