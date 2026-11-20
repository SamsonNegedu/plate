# Plate

Offline-first PWA for logging calories by barcode. React 19 + TypeScript + Vite client, Go + SQLite server, one static binary that serves the API and the built SPA.

Documentation: [`docs/`](docs/README.md) (architecture, data model, sync, accounts, security, client, API, configuration, runbook). Plan and progress: `.claude/tasks/README.md`. Locked decisions: `.claude/tasks/00-architecture.md`. Visual direction: `mockups.html`.

## Run it

Needs Go 1.27, Node 24, pnpm 10.

```
cp .env.example .env
make dev          # Go on :8080, Vite on :5173
make build        # bin/plate with the SPA embedded
make verify       # lint, tests, build, generated-file checks
```

Open http://localhost:5173 in development and create an account on the sign-in screen (the proof of work takes about a second). `make build` produces one binary:

```
PLATE_DATA_DIR=./data ./bin/plate
```

## Deploy

```
cp .env.example .env     # set PLATE_BASE_URL (https); people sign up in the app
docker compose up -d     # pulls ghcr.io/samsonnegedu/plate:latest
# or build from this checkout:
# docker compose -f compose.yaml -f compose.build.yaml up -d --build
```

Every green push to `main` publishes `latest` after the full CI (including a smoke test of the image; `make docker-smoke` runs the same check locally). Tag `vX.Y.Z` to also publish a pinnable version for rollbacks. Upgrade, rollback and backups are in `docs/runbook.md`.

## Notes

- The camera needs HTTPS except on localhost.
- Food data comes from Open Food Facts (ODbL). See the in-app attribution page.
