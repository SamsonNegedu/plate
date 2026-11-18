// Package docscheck keeps docs/ honest: it fails when a document stops matching the code it describes.
package docscheck

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

const root = "../.."

func read(t *testing.T, rel string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(root, rel))
	if err != nil {
		t.Fatalf("reading %s: %v", rel, err)
	}
	return string(b)
}

func findAll(t *testing.T, pattern, text string) []string {
	t.Helper()
	seen := map[string]bool{}
	var out []string
	for _, m := range regexp.MustCompile(pattern).FindAllStringSubmatch(text, -1) {
		name := m[len(m)-1]
		if !seen[name] {
			seen[name] = true
			out = append(out, name)
		}
	}
	return out
}

// Every table created by a migration is described in data-model.md.
func TestEveryTableIsDocumented(t *testing.T) {
	doc := read(t, "docs/data-model.md")
	files, err := filepath.Glob(filepath.Join(root, "db/migrations/*.sql"))
	if err != nil || len(files) == 0 {
		t.Fatalf("no migrations found: %v", err)
	}
	checked := 0
	for _, f := range files {
		sql := read(t, strings.TrimPrefix(f, root+"/"))
		up, _, _ := strings.Cut(sql, "-- +goose Down")
		for _, table := range findAll(t, `(?i)CREATE (?:VIRTUAL )?TABLE (?:IF NOT EXISTS )?([a-z_]+)`, up) {
			checked++
			if !strings.Contains(doc, "`"+table+"`") {
				t.Errorf("table %q (%s) is not described in docs/data-model.md", table, filepath.Base(f))
			}
		}
	}
	if checked < 10 {
		t.Fatalf("only %d tables found in the migrations; the pattern is probably wrong", checked)
	}
}

// Every PLATE_ variable the server reads is described in configuration.md, and nothing described is made up.
func TestEveryEnvVarIsDocumented(t *testing.T) {
	doc := read(t, "docs/configuration.md")
	var code string
	for _, rel := range []string{"internal/config/config.go", "cmd/plate/main.go", "cmd/plate/startup.go"} {
		code += read(t, rel)
	}
	inCode := findAll(t, `"(PLATE_[A-Z_]+)"`, code)
	if len(inCode) < 10 {
		t.Fatalf("only %d PLATE_ variables found in the code; the pattern is probably wrong", len(inCode))
	}
	for _, v := range inCode {
		if !strings.Contains(doc, "`"+v+"`") {
			t.Errorf("%s is read by the server but missing from docs/configuration.md", v)
		}
	}
	known := map[string]bool{"PLATE_COVERAGE_SEED": true, "PLATE_COVERAGE_REPORT": true, "PLATE_TEST_BLS_FILE": true}
	for _, v := range inCode {
		known[v] = true
	}
	for _, v := range findAll(t, "`(PLATE_[A-Z_]+)`", doc) {
		if !known[v] {
			t.Errorf("docs/configuration.md describes %s, which no code reads", v)
		}
	}
}

// Every endpoint in the OpenAPI document appears in api.md. (api.md itself is generated; make verify checks it is fresh.)
func TestEveryEndpointIsDocumented(t *testing.T) {
	var spec struct {
		Paths map[string]json.RawMessage `json:"paths"`
	}
	if err := json.Unmarshal([]byte(read(t, "internal/httpapi/openapi.json")), &spec); err != nil {
		t.Fatalf("parsing the spec: %v", err)
	}
	doc := read(t, "docs/api.md")
	for path := range spec.Paths {
		if !strings.Contains(doc, "`"+path+"`") {
			t.Errorf("endpoint %s is missing from docs/api.md; run make generate", path)
		}
	}
}

// Relative links in docs/ and the README point at files that exist.
func TestLinksResolve(t *testing.T) {
	link := regexp.MustCompile(`\]\(([^)#\s]+)(?:#[^)]*)?\)`)
	files, _ := filepath.Glob(filepath.Join(root, "docs/*.md"))
	files = append(files, filepath.Join(root, "README.md"))
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range link.FindAllStringSubmatch(string(b), -1) {
			target := m[1]
			if strings.Contains(target, "://") || strings.HasPrefix(target, "mailto:") {
				continue
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(f), target)); err != nil {
				t.Errorf("%s links to %s, which does not exist", filepath.Base(f), target)
			}
		}
	}
}
