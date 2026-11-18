# Cloudflare Tunnel and Access

If you use Cloudflare Tunnel, it is the only path to the origin for that setup. No inbound ports are open. Access is the outer gate; the app session is the inner gate. The tunnel is run by the operator, not shipped in `compose.yaml`.

## Tunnel

1. Zero Trust, Networks, Tunnels: create a tunnel and put its token in the cloudflared service's environment (not the app's `.env`).
2. Add a public hostname, for example `plate.example.com`, with service `http://plate:8080` when cloudflared shares the compose network, or `http://127.0.0.1:8080` when it runs on the host.
3. Only cloudflared makes outbound connections; `plate` publishes no port.
4. Set `PLATE_BASE_URL=https://plate.example.com`. The app rejects `http://` base URLs except on localhost.

## Trusting the proxy

Set `PLATE_TRUST_PROXY=true` only when requests reach the app through cloudflared, and make `PLATE_PROXY_CIDRS` cover that network (for example `172.16.0.0/12` for the compose network). The app reads `CF-Connecting-IP` and `Cf-Access-Authenticated-User-Email` only when the TCP peer is inside that range. Check with `docker network inspect` and narrow it.

## Access application

1. Zero Trust, Access, Applications: add a self-hosted application for the hostname.
2. Policy: Allow, include the operator's email only.
3. Session duration: 30 days.
4. Keep the app password. Access does not replace the login screen.

When the Access session expires, `/api/*` may return an HTML login page instead of JSON. The client treats a non-JSON response on an API call as "sign in to continue". Record the exact behaviour you observe in `docs/spike-results.md` (Spike E).

## Cache rules

Bypass cache for `/api/*`, `/healthz`, `/readyz`. Immutable build assets under `/assets/*` may be cached at the edge. Never cache HTML.

## HSTS

Enable HSTS at the edge. The app also sends it when `PLATE_BASE_URL` is `https://`.

## Checks

- `curl -I https://plate.example.com/healthz` without an Access session must not return the app.
- The origin host has no listening port reachable from the internet.
- The camera prompt appears on the phone (HTTPS is required).
