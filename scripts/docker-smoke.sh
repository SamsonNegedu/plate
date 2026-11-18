#!/usr/bin/env bash
# Boots the production image the way compose runs it and checks the paths a deploy depends on.
set -euo pipefail

IMAGE=${1:-plate:smoke}
NAME=plate-smoke-$$
PORT=${PORT:-18080}
PASSWORD='smoke-test-passphrase-1'
JAR=$(mktemp)
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$NAME-data" >/dev/null 2>&1 || true
  rm -f "$JAR"
}
trap cleanup EXIT

start() {
  docker run -d --name "$NAME" -p "$PORT:8080" --read-only --cap-drop ALL \
    --security-opt no-new-privileges:true -v "$NAME-data:/data" \
    -e PLATE_BASE_URL="http://127.0.0.1:$PORT" \
    -e PLATE_ADMIN_EMAIL=smoke@example.com -e PLATE_ADMIN_PASSWORD="$PASSWORD" \
    "$IMAGE" >/dev/null
}

wait_ready() {
  for _ in $(seq 1 90); do
    curl -fs "http://127.0.0.1:$PORT/readyz" >/dev/null && return 0
    sleep 1
  done
  echo "FAIL: /readyz never turned green"; docker logs "$NAME" | tail -20; exit 1
}

check() { echo "ok: $1"; }
fail() { echo "FAIL: $1"; docker logs "$NAME" | tail -20; exit 1; }

start; wait_ready; check "boots and /readyz is green"
docker exec "$NAME" /plate -healthcheck || fail "container healthcheck"; check "container healthcheck"

code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/v1/settings")
[ "$code" = 401 ] || fail "unauthenticated API returned $code, want 401"; check "API requires a session"

curl -fs -c "$JAR" -H 'Content-Type: application/json' \
  -d "{\"email\":\"smoke@example.com\",\"password\":\"$PASSWORD\"}" \
  "http://127.0.0.1:$PORT/api/v1/auth/login" >/dev/null || fail "login"; check "login"

curl -fs -b "$JAR" "http://127.0.0.1:$PORT/api/v1/foods/search?q=nutella" | grep -q '"source":"catalog"' \
  || fail "catalog search"; check "catalog seed answers search"

curl -fs "http://127.0.0.1:$PORT/" | grep -q '<div id="root"' || fail "SPA not served"; check "SPA is served"

curl -fs -b "$JAR" -X PUT -H 'Content-Type: application/json' \
  "http://127.0.0.1:$PORT/api/v1/entries/0192a000-0000-7000-8000-000000000001" \
  -d '{"eaten_on":"2026-11-18","meal":"lunch","name":"Smoke oats","amount":100,"unit":"g","grams":100,"kcal":380,"client_updated_at":"2026-11-18T21:00:00Z"}' \
  >/dev/null || fail "write an entry"; check "entry written"

docker restart "$NAME" >/dev/null; wait_ready
curl -fs -b "$JAR" "http://127.0.0.1:$PORT/api/v1/days/2026-11-18" | grep -q 'Smoke oats' \
  || fail "entry lost across a restart"; check "entry survives a restart"

if docker logs "$NAME" 2>&1 | grep -qiE '"level":"(ERROR|PANIC)"|panic:'; then fail "errors in the log"; fi
check "no errors in the log"
echo "docker smoke passed"
