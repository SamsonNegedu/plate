# Security

What the code does today. Code: `internal/auth`, `internal/httpapi/middleware.go`, `internal/food`.

## Model

Any number of accounts, each on its own devices, behind HTTPS that the operator provides (a proxy or tunnel in front of the container). The app's own session is the only authentication gate. The app never reads forwarded identity or address headers (`X-Forwarded-For`, `CF-Connecting-IP`, `Cf-Access-*`), so nothing a proxy or a client sets can change who is signed in or whose address a limit counts.

## Accounts and passwords

- Anyone can create an account ([accounts.md](accounts.md)); there is no admin role. Signup needs a solved proof-of-work challenge, and the server checks it before it spends time hashing the password.
- Passwords are 12 or more characters and not on a short deny list. They are hashed with Argon2id (19 MiB, 2 iterations, 1 lane, the OWASP minimum).
- Signing in with an unknown username does the same hashing work as a wrong password, and the error message is the same, so a sign-in cannot be used to find accounts. Signup does reveal that a username is taken; that is unavoidable when anyone can register.
- A forgotten password is reset with a single-use recovery code (`POST /auth/reset`), which ends every session. Recovery codes, regenerating them and deleting the account all need either the code or the current password.
- There is no operator reset. Nobody, including whoever runs the host, can set or read another person's password; a person who loses their password and every recovery code loses the account.
- Every query is scoped by the signed-in user's id. A row id that belongs to another account is treated as absent.

## Sessions

- Cookie `__Host-plate_session`: `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`. The `__Host-` prefix means it works only over HTTPS (browsers accept it on `localhost` for development).
- The cookie holds a random token; the database stores only its SHA-256, in `sessions`.
- 30 days maximum, 14 days idle, renewed on use. The token is rotated at sign-in.
- Sign-out deletes the row; "Log out all devices" (`POST /auth/logout-all`) deletes every row for the user.
- A 401 never clears local data. The client pauses sync and asks for the password.

## Request checks

- **CSRF.** A state-changing request must be JSON when it has a body, must be same-origin (`Sec-Fetch-Site: same-origin`, or an `Origin` matching `PLATE_BASE_URL`), and must not be a top-level navigation. A request with neither header is not from a browser page and passes. There is no CSRF token; `SameSite=Lax` plus these checks cover the same-origin app.
- **Auth is default-deny.** Everything under `/api/v1` requires a session except sign-in, sign-out, the signup challenge, signup, password reset and the OpenAPI document.
- **Limits.** Sign-in and password reset: 30 a minute per address, 10 per 15 minutes per account, 120 a minute overall; a 429 carries `Retry-After`. Signup: a proof of work whose difficulty rises under load, and 200 an hour overall. Signed-in requests: 300 a minute for the general API and 600 a minute for sync, per user. Barcode lookups: 60 a minute per user. Behind a proxy every request shares the proxy's address, so the per-address limits are sized for all users together and the per-account limits are what stop guessing. Storage caps per account are in [accounts.md](accounts.md).
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

A shared recipe is untrusted too. Import reads it only on the device, rejects anything over 200 KB, and validates every field with the limits the server enforces (calories up to 1,000 per 100 g, nutrients up to 100 g, 1 to 100 ingredients, a known unit) before it can become a recipe. It carries no ids, so it cannot point at another account's rows.

## Health data

Weight, measurements, doses and ratings are as private as the rest of an account's rows: every query is scoped by `user_id`, deleting an account removes them, and they appear only in that person's own backup. Nothing is sent to a third party, and there are no analytics. The app does not give medical advice, and its insights only restate what the person logged.

## Container

Distroless, non-root, read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, no published port. The data volume is the only writable path.

## Supply chain

Lockfiles are committed and versions pinned. CI runs `govulncheck` and `pnpm audit --prod`, plus gosec through golangci-lint. There is no analytics, no tracker, and no runtime CDN, font or script from a third party.
