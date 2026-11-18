---
name: security
description: Use when touching authentication, sessions, cookies, CSRF, security headers, CSP, the OFF/image proxy, import/export, rate limits, proxy auth, or dependencies in Plate.
---

# Security guardrails

## Authentication

- Argon2id only. Never SHA/MD5/bcrypt for passwords.
- Compare against a dummy hash when the email is unknown; do not leak account existence.
- Rate limit per IP and per account. Return 429 with `Retry-After`.
- Session ID rotates on login. Logout deletes the server row.
- No password or session token in logs, URLs, or client storage.

## Password reset flag

- Applies only when `PLATE_ADMIN_PASSWORD` and `PLATE_ADMIN_RESET_PASSWORD=true` are both set.
- Refuses a short password or a missing user, and never creates a user.
- Revokes every session, logs one line, and tells the operator to remove both variables.
- A reset flag left in the environment is a configuration bug; the runbook calls it out.

## Sessions

- Cookie name starts with `__Host-`; `Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`.
- Server-side session rows; the cookie carries an opaque token; the database stores a hash.
- 30-day lifetime, 14-day idle timeout, sliding renewal.
- "Log out all devices" revokes every row for the user.
- A 401 never clears local log data; it only pauses sync and asks for login.

## CSRF

- Mutations require `Content-Type: application/json`.
- Require a same-origin `Origin` or `Sec-Fetch-Site: same-origin`.
- Reject `Sec-Fetch-Mode: navigate` on API mutation routes.
- Never perform a mutation on GET.
- No CSRF token is required for the same-origin SPA, but the origin check is not optional.

## Headers and CSP

Baseline:

```
default-src 'self';
script-src 'self' 'wasm-unsafe-eval';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
font-src 'self';
worker-src 'self' blob:;
frame-ancestors 'none';
base-uri 'none';
form-action 'self';
```

- No `unsafe-inline` for scripts. No `unsafe-eval` beyond `wasm-unsafe-eval` for the scanner.
- HSTS only over HTTPS.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`.

## SSRF and outbound requests

- The only outbound hosts are the configured OFF product/search host and `images.openfoodfacts.org`.
- Never accept a URL from a client and fetch it.
- Do not follow redirects to another host.
- Set connect/read timeouts and response size caps.
- Image responses must have an allowed content type and decode as an image.
- The image cache key is server-generated; it is not a path or URL.

## Input and files

- Body limits: 1 MB JSON, 100 ops per sync batch, 256 KB per op.
- Reject unknown JSON fields.
- Validate dates, UUIDs, enums, amounts, and ranges at the boundary.
- Import files have a hard size limit and are fully validated before any write.
- No zip/tar extraction in v1.
- Parameterized SQL only. FTS input is tokenized, quoted, and bound; never concatenated.
- Escape nothing by hand in React; never use `dangerouslySetInnerHTML`.

## Cloudflare edge and proxy auth

- Cloudflare Tunnel is the only path to the origin. No inbound ports; cloudflared connects out.
- Cloudflare Access is the outer gate, restricted to the operator's email with a 30-day session. The app password remains the inner gate.
- `AUTH_MODE=proxy` is optional. It requires `TRUST_PROXY=true` and a non-empty CIDR allowlist for cloudflared.
- Trust only `Cf-Access-Authenticated-User-Email`, and only when the immediate peer is in the allowlist. Never create a user from the header.
- Use `CF-Connecting-IP` for rate limiting only from the trusted CIDR.
- When Access expires, the API may return an HTML login page or redirect, not JSON. The client must treat that as re-authentication, not a server error.
- Refuse to start if proxy mode is enabled without a CIDR allowlist.

## Imported datasets

- The catalog is built from OFF. Honor ODbL attribution and share-alike for the derived seed.
- Treat the seed file as untrusted: open read-only, validate the schema, cap the size, reject unexpected tables/triggers, and copy rows into the app-owned table.
- Never execute SQL found in the imported file. Never attach it to the writable connection.
- Attribute the dataset in the About screen and export.

## Secrets and logging

- Secrets come from the environment or a `0600` file; never committed.
- Bootstrap credentials are removed after first use.
- Logs never contain passwords, session tokens, cookies, full request bodies, or another user's data.
- Error responses never contain SQL, stack traces, filesystem paths, or upstream bodies.

## Dependencies

- Lockfiles committed; exact versions pinned.
- `govulncheck ./...`, `gosec` via golangci-lint, and `pnpm audit` must be clean for high/critical.
- New dependency requires a written reason and a license check.
- No runtime CDN, no remote fonts, no remote WASM.
- Generate an SBOM at release.

## Review checklist

- [ ] Auth required on every non-public route, including sync and export.
- [ ] Session cookie flags correct.
- [ ] Password reset flag requires both variables, revokes sessions, and never creates a user.
- [ ] Origin/CSRF check on every mutation.
- [ ] CSP unchanged or tightened; no new external origin.
- [ ] No user-controlled URL fetched.
- [ ] Body and batch limits applied.
- [ ] FTS input bound and escaped.
- [ ] Errors are problem details, not internals.
- [ ] No secret or token in logs.
- [ ] New dependency justified and audited.

## Threat cases to keep in mind

- A stolen session cookie used from another country.
- A malicious product name from OFF rendered into the DOM.
- A crafted barcode or search query used to break FTS syntax.
- An open proxy endpoint used to scan the internal network.
- A huge import file used to exhaust memory or disk.
- A misconfigured proxy allowlist that trusts any `X-Forwarded-For` or any source IP.
- A tunnel or Access misconfiguration that exposes the origin because a direct DNS record exists.
- A rate-limit bypass through many IPs; keep the global limit too.
