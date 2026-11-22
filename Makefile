export CGO_ENABLED := 0

# `cp .env.example .env` then `make dev`; env vars are not read by the Go binary itself.
ifneq (,$(wildcard ./.env))
include .env
export
endif

GO_RUN := go run
SQLC := $(GO_RUN) github.com/sqlc-dev/sqlc/cmd/sqlc
GOOSE := $(GO_RUN) github.com/pressly/goose/v3/cmd/goose
LINT := $(GO_RUN) github.com/golangci/golangci-lint/v2/cmd/golangci-lint
VULN := $(GO_RUN) golang.org/x/vuln/cmd/govulncheck

DATA_DIR ?= ./data
DB_PATH ?= $(DATA_DIR)/plate.db
GOOSE_ENV := GOOSE_DRIVER=sqlite3 GOOSE_DBSTRING=$(DB_PATH) GOOSE_MIGRATION_DIR=db/migrations

.PHONY: wafct usda off-export dev dev-api dev-web build build-web test test-go test-web test-e2e e2eseed lint fmt generate sqlc-diff \
	docker-smoke coverage coverage-live catalog lint-go audit-go migrate-up migrate-down migrate-status backup verify audit

dev:
	@trap 'kill 0' INT TERM EXIT; $(MAKE) dev-api & $(MAKE) dev-web & wait

dev-api:
	PLATE_DATA_DIR=$(DATA_DIR) go run ./cmd/plate

# Vite proxies to the API, which only listens after migrations and the first-boot catalog import.
dev-web:
	@echo "waiting for the API on :8080..."
	@for i in $$(seq 1 120); do curl -fs -o /dev/null http://127.0.0.1:8080/healthz && break; sleep 1; done; \
	curl -fs -o /dev/null http://127.0.0.1:8080/healthz || { echo "API not healthy after 120 s"; exit 1; }
	pnpm --dir web dev

docker-smoke:
	docker build -t plate:smoke .
	scripts/docker-smoke.sh plate:smoke

build-web:
	pnpm --dir web install --frozen-lockfile
	pnpm --dir web build

build: build-web
	go build -trimpath -ldflags="-s -w" -o bin/plate ./cmd/plate
	@touch internal/webui/dist/.gitkeep

test: test-go test-web

test-go:
	go test ./...

test-web:
	pnpm --dir web test

# The two projects run at the same time, each on its own port with its own server, seed and user, so the per-user rate
# limit is not shared. The seeder is built once (go caches it) instead of `go run` compiling it in every server start.
test-e2e: e2eseed
	@set -e; \
	E2E_PORT=18081 pnpm --dir web exec playwright test --project=mobile-400 & m=$$!; \
	E2E_PORT=18082 pnpm --dir web exec playwright test --project=desktop & d=$$!; \
	rc=0; wait $$m || rc=1; wait $$d || rc=1; exit $$rc

e2eseed:
	go build -o bin/e2eseed ./tools/e2eseed

lint-go:
	$(LINT) run ./...

lint: lint-go
	pnpm --dir web lint
	pnpm --dir web typecheck

fmt:
	gofmt -w cmd internal db
	pnpm --dir web fmt

generate:
	@if [ -f sqlc.yaml ]; then $(SQLC) generate; fi
	@if [ -d cmd/genopenapi ]; then go run ./cmd/genopenapi > internal/httpapi/openapi.json && go run ./cmd/genopenapi -markdown > docs/api.md && pnpm --dir web gen:api; fi

sqlc-diff:
	@if [ -f sqlc.yaml ]; then $(SQLC) diff; else echo "sqlc.yaml not present yet, skipping"; fi

coverage:
	PLATE_COVERAGE_SEED=$(abspath $(wildcard data/off-catalog.db)) PLATE_COVERAGE_REPORT=coverage/report.md go test ./internal/food -run Coverage -v -count=1

coverage-live:
	go run ./tools/corpus -dump $(DUMP) -seed $(or $(SEED),data/off-catalog.db) -record

off-export:
	go run ./tools/offexport -db $(DB_PATH) -out $(or $(OUT),off-export)

catalog:
	go run ./tools/catalog -dump $(DUMP) -out $(or $(OUT),data/off-catalog.db) -n $(or $(N),100000) -min-scans $(or $(MIN_SCANS),2) $(if $(VERSION),-version $(VERSION))

wafct:
	go run ./tools/wafct -in $(XLSX) $(if $(OUT),-out $(OUT))

usda:
	go run ./tools/usda -in $(ZIP) $(if $(OUT),-out $(OUT))

migrate-up:
	$(GOOSE_ENV) $(GOOSE) up

migrate-down:
	$(GOOSE_ENV) $(GOOSE) down

migrate-status:
	$(GOOSE_ENV) $(GOOSE) status

backup:
	@mkdir -p $(DATA_DIR)/snapshots
	sqlite3 $(DB_PATH) "VACUUM INTO '$(DATA_DIR)/snapshots/manual-$$(date -u +%Y%m%dT%H%M%SZ).db'"

audit-go:
	$(VULN) ./...

audit: audit-go
	pnpm --dir web audit --prod

# Generated files must match what is committed. Without a git repository the diff check is skipped.
verify: lint test build sqlc-diff
	@$(MAKE) generate >/dev/null
	@if git rev-parse --git-dir >/dev/null 2>&1; then \
		git diff --quiet -- db internal web/src/api docs/api.md || (echo "generated files are stale"; exit 1); \
	fi
