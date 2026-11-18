# Security

What the code does today. Code: `internal/auth`, `internal/httpapi/middleware.go`, `internal/food`.

## Model

One user, on their own devices, behind HTTPS that the operator provides (a proxy or tunnel in front of the container). The app's own session is the only authentication gate. The app never reads forwarded identity or address headers (`X-Forwarded-For`, `CF-Connecting-IP`, `Cf-Access-*`), so nothing a proxy or a client sets can change who is signed in or whose address a limit counts.

## Passwords and the first user

- The first boot creates the admin from `PLATE_ADMIN_EMAIL` and `PLATE_ADMIN_PASSWORD` (12 or more characters). The password is hashed with Argon2id (19 MiB, 2 iterations, 1 lane, the OWASP minimum) and the environment value is never stored. Once the user exists the variables are ignored; remove them.
- `PLATE_ADMIN_RESET_PASSWORD=true` with a new `PLATE_ADMIN_PASSWORD` resets the password and revokes every session; it never creates a user.
- Signing in with an unknown email does the same hashing work as a wrong password, and the error message is the same, so accounts cannot be enumerated.

## Sessions

- Cookie `__Host-plate_session`: `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`. The `__Host-` prefix means it works only over HTTPS (browsers accept it on `localhost` for development).
- The cookie holds a random token; the database stores only its SHA-256, in `sessions`.
- 30 days maximum, 14 days idle, renewed on use. The token is rotated at sign-in.
- Sign-out deletes the row; "Log out all devices" (`POST /auth/logout-all`) deletes every row for the user.
- A 401 never clears local data. The client pauses sync and asks for the password.

## Request checks

- **CSRF.** A state-changing request must be JSON when it has a body, must be same-origin (`Sec-Fetch-Site: same-origin`, or an `Origin` matching `PLATE_BASE_URL`), and must not be a top-level navigation. A request with neither header is not from a browser page and passes. There is no CSRF token; `SameSite=Lax` plus these checks cover the same-origin app.
- **Auth is default-deny.** Everything under `/api/v1` requires a session except sign-in, sign-out and the OpenAPI document.
- **Limits.** Sign-in: 5 a minute per address, 10 per 15 minutes per account, 60 a minute overall; a 429 carries `Retry-After`. Signed-in requests: 300 a minute for the general API and 600 a minute for sync, per user. Barcode lookups: 60 a minute per address. Behind a proxy every request shares the proxy's address, so the per-address limits are effectively shared and the per-account limit still applies.
- **Bodies.** 1 MB for JSON, 32 MB for a backup import, 100 ops and 256 KB per op for sync. Unknown JSON fields are rejected.
- **SQL.** Parameterized queries only (sqlc). Search text is tokenized and bound, never concatenated.
- **Errors** are RFC 9457 problems with a code and a request id, never a stack trace, SQL, or a filesystem path. Panics become a generic 500.
- **Logs** are structured JSON with request id, method, path, status and duration. They never contain bodies, cookies, passwords or session tokens.

## Headers

Every response carries a strict Content-Security-Policy (`default-src 'self'`, scripts from `'self'` plus `wasm-unsafe-eval` for the scanner, images from `'self'` and `data:`, no frames, no `base`, one hashed inline style), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, and `Cross-Origin-Opener-Policy: same-origin`. `Strict-Transport-Security` is added when `PLATE_BASE_URL` is `https`. API responses are `Cache-Control: no-store`, and the service worker never caches `/api/` calls.

## Outbound calls

The server contacts only the configured Open Food Facts hosts and `images.openfoodfacts.org`. No URL from a client is ever fetched. Redirects to another host are refused; timeouts, a rate cap, a circuit breaker and response size limits apply; image bytes are checked, not trusted.

## Imported data

The catalog seed and backups are treated as untrusted input: the seed is opened read-only and structurally checked, and a backup is validated in full before anything is written (and a snapshot is taken first).

## Container

Distroless, non-root, read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, no published port. The data volume is the only writable path.

## Supply chain

Lockfiles are committed and versions pinned. CI runs `govulncheck` and `pnpm audit --prod`, plus gosec through golangci-lint. There is no analytics, no tracker, and no runtime CDN, font or script from a third party.
