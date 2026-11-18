package config

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestDefaults(t *testing.T) {
	c, err := Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" || c.DBPath != "data/plate.db" || !c.SyncEnabled || !c.IntegrityCheck || c.MaintenanceHr != 3 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestValidation(t *testing.T) {
	cases := map[string]struct {
		env  map[string]string
		want string
	}{
		"http base off localhost": {map[string]string{"PLATE_BASE_URL": "http://plate.example.com"}, "https except on localhost"},
		"bad bool":                {map[string]string{"PLATE_SYNC_ENABLED": "maybe"}, "not a boolean"},
		"bad hour":                {map[string]string{"PLATE_MAINTENANCE_HOUR": "25"}, "want 0-23"},
		"reset needs password":    {map[string]string{"PLATE_ADMIN_RESET_PASSWORD": "true"}, "needs PLATE_ADMIN_PASSWORD"},
		"short password":          {map[string]string{"PLATE_ADMIN_PASSWORD": "short"}, "at least 12"},
		"bad log level":           {map[string]string{"PLATE_LOG_LEVEL": "loud"}, "PLATE_LOG_LEVEL"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := Load(env(tc.env))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}
