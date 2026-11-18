# Plate

Single-user, offline-first PWA for logging calories by barcode. React 19 + TypeScript + Vite client, Go + SQLite server, one static binary that serves the API and the built SPA.

Plan and progress: `.claude/tasks/README.md`. Locked decisions: `.claude/tasks/00-architecture.md`. Visual direction: `mockups.html`.

## Run it

Needs Go 1.27, Node 24, pnpm 10.

```
cp .env.example .env
make dev          # Go on :8080, Vite on :5173
make build        # bin/plate with the SPA embedded
make verify       # lint, tests, build, generated-file checks
```

Open http://localhost:5173 in development. `make build` produces one binary:

```
PLATE_DATA_DIR=./data ./bin/plate
```

## Deploy

```
cp .env.example .env     # set PLATE_BASE_URL (https) and the first-boot admin
docker compose up -d     # pulls ghcr.io/samsonnegedu/plate; add --build to build from source
```

Tag `vX.Y.Z` to publish a release image; CI smoke-tests it first (`make docker-smoke` runs the same check locally). Upgrade, rollback and backups are in `docs/runbook.md`.

## Notes

- The camera needs HTTPS except on localhost. If you front the app with Cloudflare Tunnel, see `docs/cloudflare.md`.
- Food data comes from Open Food Facts (ODbL). See the in-app attribution page.
