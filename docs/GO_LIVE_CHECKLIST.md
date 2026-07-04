# Go-Live Checklist

The concrete, ordered checklist a deployer runs before pushing Concord to a
real browser at a real domain. Every claim below traces to code — file:line
citations are given for anything load-bearing. Companion script:
`scripts/verify-prod-env.mjs` (real preflight probes, no fabricated PASS).

---

## 1. Run the preflight

```bash
# From the repo root, with the env vars you intend to deploy set (or a
# server/.env / ./.env file in place — the script loads it the same way
# server.js does):
NODE_ENV=production node scripts/verify-prod-env.mjs

# Machine-readable:
NODE_ENV=production node scripts/verify-prod-env.mjs --json
```

Exit code is `0` only when every **REQUIRED** check passes. `WARN` /
`DORMANT` lines are not failures — they describe optional features that
degrade honestly when unconfigured (see §3). Do not proceed past this step
until exit code is `0`.

---

## 2. Required secrets

| Var | Requirement | Why (code) | Generate |
|---|---|---|---|
| `JWT_SECRET` | Set, ≥32 chars, not a placeholder | `server.js:1803-1805` (validateEnvironment exits in production if short/missing); `server.js:2619-2625` (boot exits if unset in production when JWT auth is in use) | `openssl rand -base64 48` |
| `ADMIN_PASSWORD` | Set, ≥12 chars, not a placeholder | `server.js:1770-1774` (required in production), `:1813-1815` (≥12 chars, exits if not) | `openssl rand -base64 18` |
| `AUTH_MODE` | Must NOT resolve to `public` in production | `server.js:2596-2616` — `AUTH_MODE=public` (or `AUTH_ENABLED=false` with no explicit `AUTH_MODE`) makes the process refuse to start in production (`process.exit(1)`) | Set `AUTH_MODE=hybrid` (accepts JWT cookies/Bearers + API keys) or `AUTH_MODE=jwt` |
| Security deps installed | `helmet`, `express-rate-limit`, `bcryptjs`, `jsonwebtoken` resolvable | `server.js:1778-1792` — any missing security dependency is a fatal error in production | `cd server && npm install` |
| `better-sqlite3` loadable | Native module builds/loads, can open a DB | Falling back to JSON persistence (`server.js:1790-1792`) is only a WARN in code, but is not production-grade storage | `cd server && npm rebuild better-sqlite3` if it fails to load on the target host's node/arch |
| Node version | ≥18 (hard floor); ≥22 recommended | `server/package.json` `engines.node: ">=18.0.0"`; `server.js:36` "Node: v18+ recommended (works on v24+)" | Install via nvm/asdf/system package manager |
| `DB_PATH` directory writable | The directory holding the SQLite file must be writable by the process user | `server.js:4910-4949` opens `DB_PATH` (default `DATA_DIR/concord.db`) at boot | `mkdir -p` the target dir and check ownership/permissions |

---

## 3. Fail-closed / dormant behaviors — read before you assume "it just works"

These are **not** boot blockers, but silently accepting the default has a
real, sometimes security-relevant, effect:

- **`ALLOWED_ORIGINS` unset in production → WebSocket CORS fails CLOSED.**
  `server.js:8174-8193`: with `ALLOWED_ORIGINS` unset, cross-origin browser
  Socket.IO clients are rejected outright (only non-Origin/non-browser
  clients pass). If your frontend and backend are served from different
  origins (e.g. `concord-os.org` calling `api.concord-os.org`), sockets will
  not connect until you set `ALLOWED_ORIGINS=https://concord-os.org` (comma
  list for multiple origins). This is a deliberate hardening — it used to
  infer same-host and silently relax CORS with `credentials: true`, which is
  the unsafe direction to fail.
- **`AUTH_MODE=public` is refused outright in production** (`server.js:2613-2616`)
  — not merely warned about. There is no way to run public/no-auth mode in
  production; this is intentional.
- **Frontend needs `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL`, OR a
  same-origin proxy.** `concord-frontend/lib/api/client.ts:30` and
  `lib/realtime/socket.ts:10` both fall back to `''` (relative/same-origin)
  when unset. That fallback only resolves to something real because
  `concord-frontend/next.config.js` rewrites `/api/*`, `/socket.io/*`,
  `/health`, `/ready` to `BACKEND_URL` (default `http://127.0.0.1:5050`).
  Two valid deploy shapes:
  1. Set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_SOCKET_URL` at **Next.js build
     time** (they're baked into the client bundle — changing them requires a
     rebuild, not just a redeploy).
  2. Leave them unset and run frontend+backend behind the same reverse proxy
     with `BACKEND_URL` pointing at the backend — the rewrite makes it
     same-origin from the browser's perspective.
- **The `[FATAL] JWT_SECRET` log line is real, not a false alarm.** It only
  fires when `NODE_ENV=production` AND JWT-based auth is in effect AND
  `JWT_SECRET` is unset (`server.js:2619-2625`) — the process calls
  `process.exit(1)` immediately after. A separate, non-fatal dev-mode path
  (`!process.env.JWT_SECRET`, any `NODE_ENV`) logs a `[WARN]` and generates a
  random secret that won't survive a restart (sessions drop).

### Optional (dormant when unset — honest degradation, not a defect)

| Var(s) | Effect when unset |
|---|---|
| `SESSION_SECRET` (≥32 chars if set) | Cookie-session signing uses a generated value; sessions don't survive a restart. `server.js:1809-1811` rejects a too-short value the same way as `JWT_SECRET`. |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Error tracking off. `concord-frontend/next.config.js` explicitly skips `withSentryConfig` unless `NEXT_PUBLIC_SENTRY_DSN` **and** `SENTRY_ORG` are both set (avoids a CSP/redirect script-load error otherwise). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (+ `CONCORD_CONNECTOR_TOKEN_KEY`) | Gmail/Calendar/Sheets connectors and Google sign-in return an honest `no_token`/not-configured response — no fabricated connection. See `docs/CONNECTORS_GO_LIVE.md`. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing/checkout/payout routes dormant. **Do not** leave the `.env.example` placeholders (`sk_REPLACE_ME_NOT_A_REAL_KEY`, `whsec_REPLACE_ME_NOT_A_REAL_SECRET`) in place — either set real live keys or leave the vars unset entirely; the preflight FAILs on a detected placeholder. |
| `DB_PATH` | Defaults to `DATA_DIR/concord.db`; `DATA_DIR` defaults to `/workspace/concord-data` (RunPod-style volume) if `/workspace` exists, else `./data`. |
| `PORT` | Defaults to `5050`. |
| `MAX_OLD_SPACE_SIZE` | Defaults to `32768` (32GB). Must be kept in sync with the `--max-old-space-size` flag the node process is actually started with (`server/lib/memory-pressure.js:21` reads only the env var — it cannot see the launch flag, so a mismatch silently under- or over-estimates pressure). |

---

## 4. Human-only external steps (cannot be scripted)

- **Google OAuth client** (Gmail/Calendar connectors + Google sign-in):
  create the client at the
  [Google Cloud console](https://console.cloud.google.com/apis/credentials),
  enable the Calendar + Gmail APIs, register the redirect URI
  `https://YOUR_DOMAIN/api/oauth/google/authorize/callback`. Testing mode
  works immediately for up to 100 allowlisted test users; a **public** launch
  requires OAuth consent-screen verification, and Gmail's restricted scope
  additionally requires an annual **CASA** assessment (few hundred–few
  thousand USD/year). Full steps: `docs/CONNECTORS_GO_LIVE.md`.
- **Stripe live keys**: create live-mode API keys + webhook endpoint in the
  Stripe dashboard, register the webhook URL, and set `STRIPE_SECRET_KEY` /
  `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` / `STRIPE_PRICE_TEAMS` to the
  real values (not the `.env.example` `REPLACE_ME` placeholders).
- **DNS / tunnel to `concord-os.org`**: point the domain (or a Cloudflare
  Tunnel / reverse proxy, per `next.config.js`'s `BACKEND_URL` rewrite
  comment) at the frontend; the frontend in turn proxies `/api/*` and
  `/socket.io/*` to the backend.
- **Sentry project** (optional): create a project, set `SENTRY_DSN` +
  `NEXT_PUBLIC_SENTRY_DSN` + `SENTRY_ORG` (+ `SENTRY_PROJECT`) for the
  frontend build to actually wrap itself with `withSentryConfig`.
- **Autoloop / main-branch CI wiring** (optional, if you're picking up the
  self-maintaining depth/detector sweeps): confirm `.github/workflows/*.yml`
  point at the branch you intend as `main` and that any required secrets
  (e.g. `CONCORD_RATE_LIMIT_BYPASS` for CI, GH tokens) are set in repo
  settings, not just locally.

---

## 5. Post-deploy smoke test

Run these against the live URL immediately after deploy.

```bash
BASE=https://concord-os.org

# 1. Liveness — always 200 if the process is up (does NOT check DB/deps)
curl -s "$BASE/health" | python3 -m json.tool

# 2. Readiness — 503 if state/macros/DB aren't actually initialized
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/ready"

# 3. Register + login round-trip.
#    IMPORTANT: the bot guard (server.js:7629-7654) 403s any /api/ request
#    with no User-Agent or a UA matching /bot|crawler|spider|scraper|
#    python-requests|curl\/|wget|.../i — curl's DEFAULT UA is "curl/<ver>"
#    and WILL be rejected. Pass a browser-like -A explicitly.
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"

curl -s -A "$UA" -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "smoketest_'"$(date +%s)"'",
    "email": "smoketest+'"$(date +%s)"'@example.com",
    "password": "a-real-password-12chars",
    "dateOfBirth": "1990-01-01"
  }' | python3 -m json.tool
#   ^ dateOfBirth is REQUIRED (server.js:6688-6695, zod schema) and gates
#     an 18+ age check — an under-18 DOB is rejected by the route.

curl -s -A "$UA" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{ "username": "smoketest_<same-suffix>", "password": "a-real-password-12chars" }' \
  | python3 -m json.tool
#   Expect a JWT/session token in the response.
```

If step 3 returns `{"ok":false,"error":"bot_access_denied", ...}`, the
`-A "$UA"` flag was dropped somewhere in your pipeline — that response is the
bot guard doing its job, not a server bug.

---

## 6. Rollback

- **Docker Compose deploys**: `docker-compose down && docker-compose up -d`
  (or `docker-compose restart <service>` for a lighter-weight bounce) after
  reverting the image tag / compose file to the last known-good version.
- **Database**: SQLite is a single file at `DB_PATH` (default
  `DATA_DIR/concord.db`). Before any migration-bearing deploy, copy it aside:
  `cp "$DB_PATH" "$DB_PATH.bak.$(date +%s)"`. To roll back, stop the server,
  restore the `.bak` file over `DB_PATH`, and restart — migrations are
  append-only (see CLAUDE.md "Migrations are append-only" invariant) so an
  older DB file is safe to restart against an older code revision.
- **Backups**: `server/data/backups/` (or `DATA_DIR/backups/`) holds
  server-generated backups (`createBackup`/`restoreBackup`/`listBackups`,
  exported from `server.js`) — check there before assuming you need the raw
  file copy above.
