package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/url"

	"plate/internal/auth"
	"plate/internal/config"
	"plate/internal/food"
)

// SpecJSON renders the OpenAPI document without a database or network. The output is stable so a drift test can diff it.
func SpecJSON() ([]byte, error) {
	base, err := url.Parse("http://localhost:8080")
	if err != nil {
		return nil, fmt.Errorf("parsing base url: %w", err)
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	_, api := New(Deps{
		Config: config.Config{BaseURL: base, AuthMode: "password"},
		Log:    log,
		Auth:   NewAuth(auth.NewSessionStore(nil), auth.Proxy{}, false),
		Food:   food.NewService(nil, nil, log),
		Images: food.NewImages(nil, food.ImagesConfig{}),
	})
	raw, err := json.Marshal(api.OpenAPI())
	if err != nil {
		return nil, fmt.Errorf("encoding openapi: %w", err)
	}
	var out bytes.Buffer
	if err := json.Indent(&out, raw, "", "  "); err != nil {
		return nil, fmt.Errorf("indenting openapi: %w", err)
	}
	out.WriteByte('\n')
	return out.Bytes(), nil
}
