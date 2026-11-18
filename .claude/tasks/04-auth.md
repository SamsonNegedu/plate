# Phase 3 — Auth and security

Status: done
Depends on: 2
Blocks: 4

## Goal

One user can log in from a phone, stay logged in, and be the only person who can read or write the log. Every state-changing route is protected against CSRF and abuse.

## Bootstrap

On startup:

1. Count users.
2. If zero and `PLATE_ADMIN_EMAIL` and `PLATE_ADMIN_PASSWORD` are set, create the user with Argon2id. Log the email and "admin created"; never log the password.
3. If zero and the env vars are missing, refuse to start with a message that names both variables.
4. If one or more users exist, ignore the bootstrap env vars and log a warning if they are set.

There is no public signup. The first user is created from the deploy environment, not from an unauthenticated endpoint.

## Password reset without a CLI

1. Set `PLATE_ADMIN_PASSWORD` to the new password and `PLATE_ADMIN_RESET_PASSWORD=true`.
2. Restart the service.
3. The server updates the hash, revokes every session, and logs one line: "admin password reset; sessions revoked".
4. Remove both variables and restart again.
5. Verify: the old password fails, the new one works, and every device is signed out.

The reset is refused if the user does not exist, the password is shorter than 12 characters, or `PLATE_ADMIN_RESET_PASSWORD` is set without `PLATE_ADMIN_PASSWORD`. It never creates a user.

## Sessions

- `scs/v2` with a custom SQLite store implementing its `Store` interface. The store hashes the token with SHA-256 before persisting.
- Cookie: `__Host-plate_session`, `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, persistent for 30 days.
- Lifetime 30 days; idle timeout 14 days; session ID rotates on login.
- Logout deletes the row and clears the cookie.
- "Log out all devices" deletes every session for the user; exposed in Settings.
- Expired sessions are pruned on startup and hourly.

## Password handling

- Argon2id via `alexedwards/argon2id` with OWASP-aligned parameters. Store the encoded hash, never the password.
- Login compares against a dummy hash when the email is unknown, so timing does not reveal account existence.
- Minimum 12 characters at bootstrap; reject the known-compromised top list at setup.
- No password reset email in v1. A forgotten password is reset at startup: see below.

## Login rate limiting

- Per IP: 5 attempts per minute, burst 10.
- Per account: 10 attempts per 15 minutes.
- A successful login clears the account bucket.
- Return `429` with `Retry-After`. The response body never says whether the email or password was wrong.
- Rate limiter state is in memory. A restart clears it; acceptable for a single instance.

## CSRF and origin checks

- `SameSite=Lax` blocks most cross-site POSTs.
- Mutating requests must have `Content-Type: application/json` and a same-origin `Origin` or `Sec-Fetch-Site: same-origin`.
- Reject requests with `Sec-Fetch-Mode: navigate` on API mutation routes.
- No CSRF token is needed for the same-origin JSON SPA, but the origin check is mandatory.

## Security headers

Set in middleware. Cloudflare also enforces HSTS at the edge:

- `Content-Security-Policy` as defined in `00-architecture.md`.
- `Strict-Transport-Security` only when the request is HTTPS.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: no-referrer`.
- `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.
- `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` where they do not break the PWA.

## Cloudflare Access and proxy mode

Cloudflare Access is the outer gate, not a replacement for the app session:

- When Access expires, `/api/*` may return an HTML login page or a redirect instead of JSON. The client detects a non-JSON response, keeps local data, pauses sync, and shows "Sign in to continue" linking to the public hostname.
- The app's own 401 remains a separate state: "Session expired, sign in with your password."


## Audit and logging

- Log login success, login failure (hashed IP, no password), logout, session revocation, and bootstrap.
- Do not log session tokens, cookies, or passwords.
- Add a `last_login_at` column to `users` for the Settings screen.

## Tests

- Bootstrap creates exactly one user; a second start does not duplicate it.
- Correct password logs in; wrong password returns 401 and does not reveal which field failed.
- Session survives a server restart.
- Session cookie has all required flags.
- Logout invalidates the session server-side.
- Expired session returns 401.
- Rate limit returns 429 after the configured attempts.
- Mutation with a foreign Origin returns 403.
- An Access-expired response (HTML or redirect) is detected by the client as re-authentication, not as a JSON error.
- Password reset updates the hash, revokes all sessions, and refuses an invalid or missing password.
- Security headers are present on HTML and API responses.

## Deliverables

- [x] `internal/auth` package with password, sessions, middleware, rate limiting.
- [x] `sessions` store adapter for `scs`.
- [x] Bootstrap logic and reset command.
- [x] Origin/CSRF middleware and security headers.
- [x] Auth tests.
- [x] Settings endpoint hooks for logout-all and last login (UI in Phase 9).

## Verification

- `go test ./internal/auth/...` passes.
- `curl` login sets a `__Host-` cookie with the expected flags.
- Replaying a mutation with `Origin: https://evil.example` returns 403.
- Restarting the server keeps the session valid.
- A wrong password six times in a minute returns 429.

## Out of scope

Passkeys, TOTP, email verification, password reset email, multi-user roles, and OAuth providers.

## Note

Verified: `make verify`-level lint and all Go tests pass (auth unit tests plus 20 HTTP-level tests: cookie flags, wrong password versus unknown email, restart survival, logout and logout-all, expiry, session rotation, rate limit with `Retry-After`, spoofed-header resistance, foreign Origin 403, form post 415, proxy mode inside and outside the CIDR, log redaction, default-deny). Also checked by `curl` against the built binary: cookie flags, 403 on `Origin: https://evil.example`, session valid after restart, 429 on the sixth wrong password.

Decisions made while building:

- Every route under `/api/v1` is private unless `isPublic` lists it (login, logout, OpenAPI and schemas). A new route cannot ship unauthenticated by accident, and an unknown route returns 401 before 404 when signed out.
- scs re-commits a loaded session whenever an idle timeout is set, so sliding renewal needs no extra code. The cost is one session write and a refreshed cookie per authenticated request, which is fine for one user. The cookie lasts 14 days idle, capped at 30 days from login.
- The first boot now refuses to start without `PLATE_ADMIN_EMAIL` and `PLATE_ADMIN_PASSWORD` (the plan requires it); the Playwright config passes test credentials.
- `argon2id` uses `alexedwards/argon2id` (named in the stack) at the OWASP minimum (19 MiB, 2 passes, 1 lane). The compromised-password check is a small built-in deny list, not a breach corpus.
- Login responses carry `Cache-Control: no-cache="Set-Cookie"` from scs.

Not done: the client-side "Sign in to continue" handling of an Access-expired HTML response is Phase 7. Cloudflare header behaviour is still Spike E.
