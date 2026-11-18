package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthcheck(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		want   int
	}{
		{"ready", http.StatusOK, 0},
		{"not ready", http.StatusServiceUnavailable, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(tc.status)
			}))
			defer srv.Close()
			t.Setenv("PLATE_HEALTHCHECK_URL", srv.URL)
			if got := healthcheck(); got != tc.want {
				t.Fatalf("healthcheck() = %d, want %d", got, tc.want)
			}
		})
	}
}
