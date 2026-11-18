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
		"trust proxy needs cidrs": {map[string]string{"PLATE_TRUST_PROXY": "true"}, "PLATE_PROXY_CIDRS: required"},
		"bad cidr":                {map[string]string{"PLATE_PROXY_CIDRS": "nope"}, "not a CIDR"},
		"bad bool":                {map[string]string{"PLATE_SYNC_ENABLED": "maybe"}, "not a boolean"},
		"bad hour":                {map[string]string{"PLATE_MAINTENANCE_HOUR": "25"}, "want 0-23"},
		"proxy auth needs trust":  {map[string]string{"PLATE_AUTH_MODE": "proxy", "PLATE_PROXY_CIDRS": "10.0.0.0/8"}, "requires PLATE_TRUST_PROXY"},
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

func TestProxyConfig(t *testing.T) {
	c, err := Load(env(map[string]string{
		"PLATE_TRUST_PROXY": "true",
		"PLATE_PROXY_CIDRS": "172.18.0.0/16, 10.0.0.0/8",
		"PLATE_BASE_URL":    "https://plate.example.com",
	}))
	if err != nil || len(c.ProxyCIDRs) != 2 {
		t.Fatalf("got %v, %+v", err, c.ProxyCIDRs)
	}
}
