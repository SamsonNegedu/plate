# Accounts

Plate is a multi-account app. Anyone who can reach the server can create an account, and nobody administers the others: there is no admin role, no invite, no email, and no operator step to add, approve, reset or remove a person. Code: `internal/auth` (`accounts.go`, `pow.go`, `recovery.go`, `username.go`), `internal/httpapi/accounts.go`, `internal/sync/limits.go`, `web/src/features/auth`. The decision is ADR-016 in [`.claude/tasks/00-architecture.md`](../.claude/tasks/00-architecture.md).

## What an account is

A username (3 to 64 characters: lowercase letters, numbers and `. _ - @ +`, starting with a letter or number; stored lowercase) and a password of 12 or more characters. Every row a person owns carries their `user_id`, every query is scoped by it, and each account has its own goals, foods, entries, saved meals, favorites and sync stream. Accounts cannot see, change or sync each other's rows; `TestAccountsNeverSeeEachOthersData` and the sync isolation tests hold that line.

There is no email address. Nothing is verified, so there is no personal data to leak and no mail to send.

## Signup

1. `GET /auth/challenge` returns a signed proof-of-work challenge.
2. The browser searches for a counter whose `SHA-256(salt + ":" + counter)` starts with the required number of zero bits. The default is 17 bits: roughly 0.2 to 1 second on a laptop, measured.
3. `POST /auth/signup` sends the username, password, challenge and counter. The server checks the proof first (cheap), then hashes the password (expensive), creates the account and eight recovery codes in one transaction, and signs the browser in.

The challenge is stateless: the server signs `salt:bits:expiry` with a random HMAC key, so a client cannot lower the difficulty or forge a challenge. A challenge lives five minutes and is accepted once. The key and the used-challenge set live in memory, so a restart invalidates open challenges and the page simply asks for a new one.

Difficulty adapts without anyone touching it. When more than 30 accounts were created in the last ten minutes the server asks for 1 extra bit, and for 2 extra above 120 (about 19 bits, a few seconds on a laptop). It falls back on its own. The bumps stay small on purpose: each bit doubles the work, and a real person on a phone pays it too. A global cap of 200 signups an hour is a final backstop. `PLATE_SIGNUP_POW_BITS` sets the base (0 to 28), and `PLATE_SIGNUP_ENABLED=false` closes signup while existing accounts keep working.

This raises the cost of mass signup; it does not stop a determined attacker with real compute. The per-account storage caps below limit what a bulk account can do.

## Recovery codes

With no email and no admin, the only way back into an account is a recovery code. Signup shows eight codes once (`ABCDE-FGHJK`, 50 bits each, Crockford base32 so they are hard to mistype). Only a SHA-256 of each is stored. The sign-up screen makes the person confirm they saved them before it continues.

- `POST /auth/reset` takes the username, one code and a new password. A good code is spent, the password changes, and every session for the account ends.
- An unknown username, a wrong code and a spent code all return the same `401 invalid_recovery` after the same work, so the endpoint cannot be used to find accounts.
- Resets are limited per account and per address like sign-in attempts.
- Settings, Account shows how many codes are left and can make eight new ones (`POST /auth/recovery-codes`, needs the password). New codes retire every old one. The screen asks for this when two or fewer remain.

The codes exist only on the sign-up screen. Reloading or closing the tab before ticking "I have saved these codes" asks the browser to confirm (`beforeunload`). The server records the confirmation (`users.codes_acknowledged_at`, set by `POST /auth/recovery-codes/ack`, cleared whenever new codes are made). If someone leaves anyway, `/auth/me` reports `recovery_codes_saved: false` and Today shows a banner that leads to Settings, where new codes can be made.

A person who loses both their password and every code cannot recover the account. That is the price of having no administrator.

## Deleting an account

Settings, Account, "Delete account" asks for the password and calls `POST /auth/delete-account`. The server deletes the user row; foreign keys remove sessions, recovery codes, settings, foods, entries, saved meals (recipes), favorites, health records, the change log and applied ops with it. The browser clears its local data and returns to sign-in. This is an account-level erasure the person asked for, not a sync delete, so it is the one place rows are removed rather than tombstoned. Accounts that go quiet are kept; nothing expires them.

## Limits per account

| What | Limit | Where |
|---|---|---|
| Live entries | 50,000 | `internal/sync/limits.go` |
| Custom foods | 5,000 | `internal/sync/limits.go` |
| Health records (weights, measurements, doses, ratings) | 100,000 | `internal/sync/limits.go` |
| Barcode lookups | 60 a minute per user | `internal/httpapi/foods.go` |
| General API / sync | 300 / 600 a minute per user | `internal/httpapi/auth.go` |

A write over a cap is rejected with `limit_reached`; existing rows stay editable and deleting frees room. Barcode lookups are limited per user, not per address, because behind a proxy every person shares one address. The server-wide Open Food Facts rate cap (30 a minute) still protects the upstream for everyone.

## Several accounts on one device

The browser holds one local database. When a different account signs in on a device, the client clears the local tables first, so the new account never sees or syncs the previous account's rows. Rows that were already synced come back on the next pull. Rows still waiting in the outbox when someone else signs in are lost, so sync before you hand a device to another person. The same account signing back in keeps everything.

## BLS foods

`PLATE_IMPORT_BLS_PATH` imports generic foods into one account, named by `PLATE_IMPORT_BLS_USERNAME`. Other accounts do not get them. Making BLS shared reference data, like the catalog, is future work.
