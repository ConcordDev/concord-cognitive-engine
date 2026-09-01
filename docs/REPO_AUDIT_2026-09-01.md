# Concord Cognitive Engine — Repository Audit

**Date:** 2026-09-01  
**Auditor:** Cursor cloud agent (read-only investigation + this report)  
**Tree audited:** GitHub checkout of `ConcordDev/concord-cognitive-engine` at `26eba9bf6` on `fix/gate-spaced-path` (this is also the source of merged PR #933 on `main` at `bf117b885`).  
**Not in scope:** the operator’s dirty local Mac checkout (`handoff-cherry-pick`) and any separate non-git runtime tree. This report only describes what is in the GitHub repo.

This is an investigation, not a feature build. No production code was changed. Hunches are labeled as such.

---

## 0. How this audit was done

- Walked the tree, package manifests, deploy scripts, auth middleware, and the live GitHub Actions history (`gh run list` / `gh run view`).
- Re-measured the numeric claims that have a one-command reproduction (lens dirs, domains, migrations, heartbeats, `server.js` lines, detector baseline JSON).
- Re-read the 2026-07-31 SEC-1…SEC-5 claim sites in source (not just docs).
- Did **not** run the full `npm test` suite: `server/package-lock.json` is out of sync with `server/package.json`, so `npm ci` fails here and on GitHub CI.
- Did **not** re-run the detector ratchet locally (needs `better-sqlite3` from that failed install). Detector redness on `main` is taken from GitHub scheduled runs, which have been failing for several consecutive days.

---

## 1. What this codebase actually is

Concord is a **single-operator, local-first knowledge OS** with a game world and a creator economy welded onto the same substrate. The marketing line (“verification is the product”) matches the engineering culture more closely than most repos this large: graders, detectors, and doc-claim checks are real CI artifacts, not brochure copy.

### Architecture (verified)

| Ring | What it is | Where it lives |
|---|---|---|
| **Substrate** | Discrete Thought Units (DTUs) — 4-layer knowledge objects, SQLite-backed, auto-consolidated MEGA→HYPER | `server/` + `server/migrations/` + `server/lib/dtu-*.js` |
| **Cognition** | 5-brain router (4 LLM + vision) over Ollama, plus deterministic engines (CAS, FEA, accounting) | `server/lib/brain-config.js`, `server/domains/math.js`, `server/lib/simulation/` |
| **Macro API** | Frontend calls `POST /api/lens/run` → `runMacro(domain, name, input, ctx)` | `server/server.js` (~84.9k lines), `server/domains/*.js` (422 files) |
| **Economy** | Citation → royalty cascade, earned-only withdrawals, marketplace fees as constitutional invariants | `server/economy/` |
| **World** | Concordia 3D sim (Three.js + Godot client), NPC/faction/heartbeat simulation | `concord-frontend/lib/world-lens/`, `world-lens-godot/`, `server/emergent/` |
| **Reach** | Connectors (Gmail/Calendar/Slack/Sheets/GitHub/Notion), MCP, mesh | `server/domains/{gmail,calendar,slack,sheets,github,notion}.js`, `server/lib/mcp-*.js` |
| **Meta** | 51 detectors, cartographer, repair cortex (human-gated), doc-claim gates | `server/lib/detectors/`, `scripts/`, `audit/` |

### How it runs

Three launch paths, **not equivalent**:

1. **Production / RunPod (primary):** `./startup.sh --runpod` → 5 host Ollama processes + `pm2 start ecosystem.config.cjs --env runpod`. Backend is **one forked Node process**, heap **8 GB**, `CONCORD_SHARD_WORLDS=false`. Frontend is `server-proxy.js` (required so `/socket.io` and `/godot-ws` do not die in Next rewrites). Ingress is a Cloudflare tunnel to `concord-os.org`.
2. **Docker Compose:** `docker-compose.yml` — backend + frontend + nginx + Redis + Qdrant + Prometheus/Grafana + **7** Ollama containers, also A40-tuned, also 8 GB heap.
3. **Dev:** `server/package.json` `npm run dev` — 32 GB heap, `--watch`. This is **not** what production runs.

Auth is a documented three-gate stack (`authMiddleware` / `publicReadDomains` / Chicken2 `_safeReadPaths`) plus a production write-auth middleware and CSRF (enforced in production unless exempted).

### Major packages

| Tree | Role | Maturity |
|---|---|---|
| `server/` | Express monolith, macros, SQLite, heartbeats | High — 2,092 test files |
| `concord-frontend/` | Next.js, 266 lens pages, ConKay, Concordia 3D | High — 972 vitest files |
| `concord-mobile/` | React Native / Expo | Medium — own CI, 79 tests |
| `world-lens-godot/` | Godot 4 parallel client | Medium — `godot-client.yml` |
| `concord-shell/` | Tauri desktop | Low–medium |
| `concord-vscode/` + `concord-lsp/` | DX extension + language server | Medium — `dx-extension.yml` |
| `concord-jetbrains/` | IntelliJ plugin | Low — no dedicated CI |
| `sdk/` | `@concord/sdk` client | Low — no tests |
| `content/` | Authored worlds / NPCs / quests | High — census-gated |
| `infra/`, `k8s/`, `monitoring/`, `nginx/` | Deploy / observability | Ops |
| `extension/` | Browser-extension leftover | Low / unused by CI |
| `server/lib/_archived/` | Intentional archive (2026-05-09) | Dead by design |
| `server/dtus.js` | Deprecated 145k-line seed pack | Data, not code (LOC counter excludes it) |

There is **no real monorepo workspace** (root `package.json` is a script bag). Apps are siblings with their own lockfiles.

---

## 2. Workspace health

### Structure

Healthy in the sense that the product is one monolith with named satellites, not a graveyard of half-started apps. The satellites that matter for users are `server`, `concord-frontend`, `concord-mobile`, and `world-lens-godot`. The rest are DX or deploy.

Obvious clutter (not defects):

- Two next-session specs at repo root: `NEXT-SESSION-SPEC.md` and `NEXT_SESSION_SPEC.md` (different sizes, same topic family).
- `extension/` (browser) vs `concord-vscode/` — CI only builds the latter.
- `Meilisearch` is an optional server dependency with **zero imports** under `server/` (verified unused).
- Duplicate webhook implementations (macro `WEBHOOKS` in `server.js` vs `server/emergent/public-api.js`).

### Tests

The test surface is unusually large and layered:

- `server/tests/**/*.test.js` — 2,092 files (unit / integration / invariants).
- `server/tests/depth/` — 264 behavioral domain files.
- `server/tests/behavior/lens-behavior-smoke.behavior.js` — one derived case per live macro.
- `concord-frontend` vitest — 972 files.
- Playwright e2e (core / infra / walk) and a separate server e2e tree.

`server` `npm test` is strict. CI uses `ci-test-tolerant.mjs`, which is **not** a blanket pass: it retries V8 crashes, tolerates ≤8 cancellations when fail=0, and re-runs ≤15 isolated flakes. Real failures that reproduce in isolation still fail the job.

### CI — the important honesty finding

There are 26 workflows. Several are genuinely blocking (lint/typecheck, detector ratchet, security-detector subset, audits, deploy gate, Godot, DX). Several are informational (`continue-on-error`: CodeQL job, E2E jobs, Trivy upload, cartograph drift, Lighthouse).

**Live GitHub status on `main` (verified 2026-09-01 via `gh`):**

| Workflow | Latest on `main` | What it means |
|---|---|---|
| **CI** (`ci.yml`) | **Failed** on the PR #933 merge (`32637278999`, 2026-08-23) | `Lint & Test` died at **Install server dependencies**. `Security Scan` died the same way. Downstream lint/tests/build never ran. |
| **Detectors + Cartography** | **Failed** on schedule for at least 5 consecutive days (2026-08-27…08-31) | The ratchet that CLAUDE.md still describes as green is red in CI. |
| Mobile jobs on that same CI run | Succeeded | Mobile lockfile is fine; server lockfile is the breaker. |

Cause of the CI install failure is reproduced locally:

```
npm ci   # in server/
# EUSAGE Missing: @redis/client@6.2.1 from lock file
# (pg@ optional also absent from lock packages)
```

`server/package.json` lists optional `pg` and `redis`; the lockfile has `redis@6.2.0` but not nested `@redis/client@6.2.1`, and no `pg` package entry. Fresh clones and GitHub `npm ci` cannot install the server. This is a **P0 workspace defect**, not a flaky runner.

### Docs vs reality (sampled)

| Claim | Source | Measured 2026-09-01 | Verdict |
|---|---|---|---|
| 267 lens dirs (266 + `[parent]`) | CLAUDE.md | 267 | **Holds** |
| 422 domain files | CLAUDE.md | 422 | **Holds** |
| ~414 migrations | CLAUDE.md | 414 numbered / 415 total | **Holds** (docs slightly behind) |
| 168 heartbeats | CLAUDE.md / STATE | **170** unique `registerHeartbeat` | **Stale** |
| `server.js` 84,622 lines | CLAUDE.md | **84,902** | **Stale** |
| Detector baseline 71 / 0 crit / 7 high | CLAUDE.md / STATE §4 | `audit/detectors/BASELINE.json` is **223 total, 0 crit, 8 high**, generated 2026-08-02 | **Stale** |
| Client-event contracts “27 dead, RED” | CLAUDE.md | `verify-client-event-contracts.mjs` → 1 allowlisted, 0 new, **PASS** (and `audits.yml` gates it) | **Stale** |
| UX polish 1.000 / 265 lenses | CLAUDE.md | Explore-agent re-run: **0.995 / 266** (1 raw, 1 functional) | **Stale** (close) |
| Honest depth 0.688 | CLAUDE.md | Explore-agent re-run: **0.695** | **Stale** (improved) |
| Lens wiring 263 WIRED | CLAUDE.md | Explore-agent: **264 WIRED / 2 by-design** | **Stale** |
| JWT_SECRET “FATAL but server continues” | older CLAUDE.md text | Production **`process.exit(1)`** at `server/server.js:3380–3384` | **Stale / wrong** |
| Wave 1 ConKay + primitives SHIPPED | `docs/NEXT_ARC_PLAN.md` | 79 files under `concord-frontend/components/conkay/`; plan marked SHIPPED | **Plausible** (not every phase test re-run) |
| ConKay “no `setInterval`/`setTimeout`” | CLAUDE.md | Production hooks use both (`useConkayContextBudget.ts`, `useConKayVoice.ts`) | **Overstated** — the *spirit* (no fake progress) may still hold |

`docs/STATE_OF_CONCORD.md` (header 2026-08-01) already warns it will rot. It has. Treat it as a method, not a snapshot.

`scripts/autoloop/guard.mjs` is a real anti-cheat: it blocks edits to graders, `BASELINE.json`, and money/auth invariants. That discipline is one of the strongest things in the repo.

---

## 3. Security

### Secrets in the repo

**No live secret values found in tracked templates.** `.env.example` and `.env.runpod` leave `JWT_SECRET` / `SESSION_SECRET` / `ADMIN_PASSWORD` empty; Stripe keys are `sk_REPLACE_ME_*` placeholders. `k8s/secrets.yaml` is `CHANGE_ME_*` placeholders. Test fixtures use dummy `csk_test_` / `sk_test_dummy` strings.

`.gitignore` covers `.env`, `.env.local`, `.env.production`, `*.pem`, `*.key`.

**Footgun (verified, not a leak today):** `concord-frontend/.env.production` is **tracked** (`git ls-files`) even though `.gitignore` lists `.env.production`. Current contents are two **empty** `NEXT_PUBLIC_*` keys. If someone later fills that file and commits, gitignore will not save them. Class of leak: tracked env file / future secret commit. No values to redact.

### Auth / authz

The three-gate model plus `productionWriteAuthMiddleware` is real and tested. Production refuses `AUTH_MODE=public`. Missing `JWT_SECRET` / short `SESSION_SECRET` **exit** in production. CSRF is on in production; exemptions are broad (see M2). Helmet + fail-closed CORS in production when `ALLOWED_ORIGINS` is unset. Global + auth + anon rate limiters exist; this branch recently exempted register/login/refresh/vitals from the 30/min anon bucket (a live 503-during-signup bug).

`csk_` API keys are hashed, accepted via header/Bearer, and skip CSRF (by design).

OAuth login redirects only to `FRONTEND_URL`. Connector `?redirect=` goes through `safeRelativeRedirect` (relative, no `//`). **SEC-4 still holds.**

### Dangerous endpoints — claimed-fixed

| ID | Claim | Code | Status |
|---|---|---|---|
| **SEC-1** | `invariant.js` RCE | `new Function(...names, "use strict"; return (${expr});)` with AST-bound parameters; pinned by `server/tests/invariant-expression-injection.test.js` | **Fix holds** |
| **SEC-2** | SSRF on cooking / calendar import | `fetchPublicUrl` in `server/domains/cooking.js` | **Fix holds** |
| **SEC-3** | RBAC privilege escalation | Fixed **only** on the *dead* alias surface (`routes/helpers-extended.js` → `globalThis._assignRole` no-op). Live surface in `server.js` was not aligned. | **Partially stale** — see H1 |
| **SEC-4** | OAuth open redirect | See above | **Fix holds** |
| **SEC-5** | Whiteboard path traversal | `isSafePathSegment` + `isWithinRoot` | **Fix holds** |

`ENABLE_TERMINAL_EXEC` defaults off; `SECURITY.md` documents it as the critical unsafe surface. `CONCORD_MCP_PUBLIC=1` can bypass MCP auth; some tools still refuse the public bypass.

### Supply chain

Lockfiles exist for server, frontend, mobile, sdk, vscode. Server overrides pin `protobufjs`, `sharp`, `adm-zip`. Platinum-security runs Semgrep, Gitleaks, npm-audit. CodeQL is **non-blocking** (`continue-on-error: true`). Trivy scan upload is continue-on-error.

The broken server lockfile means **the supply-chain job on main cannot even install**, so npm-audit on server has not run since the #933 merge.

---

## 4. Reliability / ops

### Deploy story

Production is **one box, one Node process, one SQLite file, one GPU**. That is an explicit design (A40, 9 vCPU, 50 GB RAM, 5 Ollama processes, `LLM_CONCURRENCY: 5`). Horizontal scale is not the current path; `CONCORD_SHARD_WORLDS` is off because it previously made the site sluggish on this box.

Durability (post 2026-08-24 migration, verified in `startup.sh` + `scripts/preflight-production.sh`): live DB on **ephemeral local disk**, WAL + `journal_size_limit`, 15-minute WAL-safe backups to `CONCORD_BACKUP_DIR` on the volume, bootstrap-restore if the local DB is missing, async backup on graceful shutdown.

**Template drift:** `.env.runpod` lines 40–47 still say the DB **must** live on the network volume (`DB_PATH=/workspace/concord/db/concord.db`). `docs/OPERATOR.md` still tells operators `MAX_OLD_SPACE_SIZE=32768` and `DB_PATH=/workspace/concord.db`. Following the templates literally undoes the local-disk migration or sizes the watchdog against the wrong heap.

`startup.sh` exports `NODE_OPTIONS=--max-old-space-size=32768` before pm2 starts with 8192. Pre-pm2 subprocesses see the wrong ceiling.

### Connections / sessions

- socket.io on :5050, proxied by `server-proxy.js`; Cloudflare routes `/socket.io/*` and `/godot-ws` **directly** to the backend.
- JWT httpOnly cookies + refresh-token family; bcrypt hashing is **async** on this branch (`470fe08bd`) after sync hashing shed the event loop during signup.
- `ConnectionStatus.tsx` now trusts the socket, with `/health` as secondary.
- Load shedder (`server/lib/request-admission.js`) sheds at 300 ms event-loop lag; auth routes are PROTECTED. `/health` is always 200 (liveness); `/ready` is the admission probe. Easy to miswire a load balancer onto `/health`.

### Single points of failure (verified)

| SPOF | Mitigation in tree |
|---|---|
| One SQLite file | 15-min backups, shutdown backup, integrity-checked restore |
| One Node process | pm2 restart, 6 GB RSS kill, memory-pressure watchdog |
| One GPU / 5 brains | Deterministic fallbacks; `/health` does not fail when a brain is down |
| Governor heartbeat (15 s) | Skip-on-overrun counter; timer now cleared on shutdown (`54e6e77f1`) |
| Sync heartbeat handlers | `Promise.race` timeout **does not preempt** CPU-bound work (documented in `heartbeat-registry.js`) |

Bare-metal pm2 does **not** start Prometheus/Grafana (those are compose services). `/metrics` exists; the alert rules in `monitoring/prometheus/alerts.yml` only fire if someone actually scrapes them.

### Residual reliability risks

- In-flight governor tick can still overlap shutdown (commented at `server.js:3056–3058`); pm2 `kill_timeout` is 15 s.
- Boot-order TDZ: `const app = express()` ~34229, `LENS_ACTIONS` ~44403. New top-level references before those lines throw. Historical dead-mount of `/mcp` and `/api/chat-agent/stream` was this class.
- Long sync ticks (consolidation documented at ~109 s in `ecosystem.config.cjs`) can 503 the front door. Timeout is cooperative, not preemptive.

---

## 5. Highest-risk findings (ranked)

Severity is impact × verified-ness × whether it is live on the default production path. “Latent” means the hole is in a shipped route but the backing store is ephemeral or unused by any UI we found.

### P0 — breaks the verification story itself

**P0-1. Server lockfile cannot `npm ci` — main CI is dark.**  
Evidence: local `cd server && npm ci` → missing `@redis/client@6.2.1` (and `pg`); GitHub run `32637278999` failed at “Install server dependencies” / “Install dependencies for audit”. Every server lint, typecheck, test, frontend build, and npm-audit job on that merge was skipped.  
Impact: the repo’s own “don’t trust, check” machinery has not been able to check `main` since 2026-08-23.  
Fix: regenerate `server/package-lock.json` (`npm install` in `server/`) and land it; confirm `npm ci` on a clean tree.

**P0-2. Detector ratchet red on `main` for a week.**  
Evidence: scheduled `detectors-cartography.yml` failed 2026-08-27 through 2026-08-31. CLAUDE.md still says a 2026-08-01 re-run was green against a 71-finding baseline; the committed baseline is already 223 findings (2026-08-02).  
Hunch (from a parallel tree walk, not re-run here): new fingerprints include schema-drift (critical via maintenance-gates) and `server/lib/cpu-self-pin.js` `execSync` (command-injection detector). The `execSync` calls interpolate `taskset -cp ${spec} ${process.pid}` where `spec` comes from `/proc` parsing — **not user input**. Likely a detector true-positive on *style* (shell string) and a false-positive on *exploitability*. Schema-drift needs a real re-run after P0-1.  
Impact: either there is a real new high/critical, or the baseline/fingerprint has drifted and the gate is crying wolf. Either way the gate is not currently providing a trustworthy signal.

### High

**H1. Live RBAC routes are weaker than the “SEC-3 fixed” claim.**  
Evidence:

- Real handlers: `server/emergent/rbac.js`. `assignRole` checks `manage_roles` when `assignedBy` is set. **`revokeRole` never checks the caller** (lines 171–187) — `revokedBy` is only logged. Owner role cannot be revoked; everything else can.
- Live HTTP: `server/server.js:61958–62013`.
  - `POST /api/rbac/org` — **no `requireAuth()`**; `ownerId` is `req.body.ownerId || req.user?.id` (client-spoofable owner).
  - `DELETE /api/rbac/role` — `requireAuth()` only, then `revokeRole(...)`.
  - `POST /api/rbac/org-lens`, `POST /api/rbac/check-permission` — no `requireAuth()`.
  - All listed **GET**s (`org`, `members`, `permissions`, **`audit-export`**, `metrics`) — no `requireAuth()`.
- `/api/rbac` is on Gate 1 `publicReadPaths` (`server.js:7571`) and Chicken2 `_safeReadPaths` (`:14030`), so anonymous GET is intended.
- The 2026-07-27 admin gate lives on **aliases** `POST /api/rbac/assign|revoke` in `routes/helpers-extended.js`, which call `globalThis._assignRole` — **those helpers do not exist**. Tests (`rbac-roles-authz.test.js`) pin the alias file, not the live `server.js` block.
- Frontend generated client in `concord-frontend/lib/api/client.ts:2111–2128` calls the live routes. **No `rbac*.tsx` lens** was found. `_serializeState()` does **not** persist `STATE._rbac` (Maps would not survive JSON anyway).

Calibration: this is a **real shipped authz hole** on a surface the product advertised as fixed. It is **latent** if nobody creates orgs in the running process (in-memory only, lost on restart, no dedicated UI). It becomes live privilege-stripping / audit-log read the moment any client uses `api.rbac.*`. Production write-auth blocks *anonymous* POST/DELETE, not authenticated abuse.

**H2. Anonymous webhook listing returns every destination URL.**  
Evidence: `GET /api/webhooks` → `webhook.list` (`server.js:52429–52431`, routed at `:52640`). Handler maps **all** `WEBHOOKS` entries and returns `url` (secret omitted — good). `/api/webhooks` is on `publicReadPaths`. Parallel STATE-backed `getWebhook` (`server/emergent/public-api.js:93–98`) is exposed at `GET /api/webhooks/:id` with no `requireAuth()`; secret redacted to `"***"`, URL still returned. `POST /api/webhooks/:id/deactivate` has no `requireAuth()` (anon blocked in production by write-auth only).  
Store is a module-level `BoundedMap` (ephemeral unless something else persists it). Same latency profile as H1: dangerous if used, quiet if unused.

### Medium

**M1. CSRF exemptions cover the entire `/api/lens` and `/api/chat` prefixes.**  
Evidence: `server.js:7217`. Cookie-session browsers can POST macros/chat without a CSRF token. Mitigations: SameSite cookies; production write-auth still requires *some* credential for most writes; `_lensActionForbiddenForAnon` blocks `userId === "anon"` on lens actions in production. Residual: authenticated CSRF into `/api/lens/run` and chat.

**M2. `_isAuthenticatedUser` treats `userId: "anon"` as truthy.**  
Evidence: `server.js:14115–14118` and the comment at `:7993–8000` (the lens-action gate was added *because* of this). Chicken2 / `canRunMacro` still see anon as authenticated. Production has a second gate; `AUTH_MODE=public` or a missed path does not.

**M3. Fallback crypto peppers if env is missing.**  
Evidence: `server/lib/mcp-oauth.js:25` (`dev-mcp-oauth-secret-change-me`), `server/lib/byo-crypto.js:26` (`concord-default-byo-pepper-not-for-prod`). `connector-tokens.js:112–117` stores OAuth tokens **plaintext** if no `CONCORD_CONNECTOR_TOKEN_KEY` / `JWT_SECRET` / `SESSION_SECRET`. Production boot requires JWT/SESSION, so the connector path is protected on a correctly-configured prod box. Dev/misconfig is the risk.

**M4. `.env.runpod` turns `CONCORD_AUTOFIX_LOOP=true`.**  
Evidence: `.env.runpod:354`. The handler (`server.js:83339–83397`) writes a `pending_review` row and does **not** auto-merge — human review is still required. Risk is “Forge generates patches on a schedule,” not unsupervised prod code rewrite. The template comment oversells “autonomous fix.”

**M5. Operator-doc / env-template contradictions can lose data or mis-size the box.**  
Evidence: `.env.runpod:40–47` (DB on volume) vs `startup.sh:326–342` (ephemeral DB + volume backups); `docs/OPERATOR.md:52` (32 GB heap) vs `ecosystem.config.cjs:88–89` (8 GB); compose 7 Ollama vs bare-metal 5. Following docs on a reclaim-prone pod puts the live DB on a network volume (the slowness/503 class this branch just escaped) or on disk the docs no longer treat as durable.

**M6. CodeQL and several E2E/security-scan steps are non-blocking.**  
Compensating checks exist (platinum-codeql-drift test, security-detectors-gate). Still a hole if those compensating tests are skipped because `npm ci` already failed (see P0-1).

**M7. Broad Gate-1 prefixes still look sensitive.**  
`/api/webhooks`, `/api/notifications`, `/api/obsidian`, `/api/notion`, `/api/compliance`, `/api/analytics` are on `publicReadPaths`. Some were narrowed after earlier audits (comments at the array). H2 shows at least one prefix that should not be public. **Hunch:** other list endpoints under those prefixes deserve the same handler-level read. Not re-audited end-to-end.

### Low / info

**L1.** `concord-frontend/.env.production` tracked with empty values — un-track it.  
**L2.** `cpu-self-pin.js` should use `execFile` (no shell) even though inputs are not attacker-controlled — stops the detector from paging.  
**L3.** Duplicate session-spec filenames; unused `extension/`; unused Meilisearch optional dep.  
**L4.** Bare-metal observability gap (no Prometheus unless compose is also run).  
**I1.** Strong `.gitignore` + secret-leak detector + gitleaks in platinum-security.  
**I2.** Economy conservation, earned-only withdrawals, and combat anti-cheat have pinned tests and were not re-litigated here.

---

## 6. What looks solid

These are the load-bearing strengths, verified by reading the code (not by trusting the README badges):

1. **Verification-as-product is real.** Detectors, graders, three-gate consistency tests, schema-drift CI, doc-claim reproduction, autoloop guard. The culture is unusually hostile to fake success and goalpost-moving. The current redness is the system working — and then being left red.
2. **SEC-1, SEC-2, SEC-4, SEC-5 still hold** in the files CLAUDE.md cites. SSRF is centralized on `fetchPublicUrl`. Invariant expressions no longer splice attacker strings into `Function`.
3. **Production auth fail-closed** for missing JWT/SESSION, `AUTH_MODE=public`, and unauthenticated writes (except a short, commented allowlist).
4. **Money path has been burned before and hardened.** `CREDIT_ROW_PREDICATE`, earned-only 48 h withdrawals, royalty-cap tests. Those invariants are guard-protected.
5. **Recent reliability work on this branch is concrete and correctly targeted:** async bcrypt, governor-timer shutdown, async backup, local-disk SQLite, rate-limit exemptions for register/login/vitals, Web Vitals `Blob` beacon, CPU self-pin away from Ollama. These read as responses to live `concord-os.org` incidents, not speculative hygiene.
6. **Deterministic engines exist** (CAS, FEA, craft-resolve, royalty math) and the depth-test harness is built to call them instead of guessing. That is rare and matches the product thesis.
7. **Honest failure is the default on connectors.** Six marquee connectors are code-complete on `connectorFetch`; live use is an OAuth-client ops gate, not a stub dressed as success.
8. **Frontend rebuild invariants** (zero demo data, zero generic-scaffold, designed lenses) have mechanical graders. Even if the 1.000 polish claim is a few weeks stale, the *apparatus* is still there.
9. **Godot client is a real second client**, not a folder of placeholders — auth’d `/godot-ws`, shared combat validation, export pipeline.

---

## 7. What to do next

Ordered for a single operator. Do not start a feature wave until P0 is green; the repo’s own method says verification is the product.

1. **Regenerate and commit `server/package-lock.json`.** Prove `cd server && npm ci` on a clean tree. Re-run GitHub `ci.yml` on `main`. This unblocks every other check.
2. **Re-run `cd server && node scripts/run-detectors.js --diff --ci`.** Triage the week-long scheduled failures. If `cpu-self-pin.js` is the high, switch `execSync` to `execFile` (tiny, safe). If schema-drift is a real critical, fix the drift — do not refresh `BASELINE.json` to silence it (`guard.mjs` exists specifically to stop that).
3. **Close the SEC-3 leftover (H1).** Either:
   - add `requireRbacAdmin` / `manage_roles` checks to the **live** `server.js` RBAC block and to `revokeRole`, reject client-supplied `ownerId`, take `/api/rbac` **off** `publicReadPaths` (especially `audit-export`), and extend `rbac-roles-authz.test.js` to hit these routes; or
   - delete/410 the live routes if enterprise RBAC is unused (the alias surface is already a no-op).  
   Do not leave two surfaces with opposite security stories.
4. **Lock down webhooks (H2).** Scope `webhook.list` to the caller; require auth on GET `/api/webhooks` and GET `/api/webhooks/:id`; require auth on deactivate. Prefer one webhook implementation.
5. **Reconcile deploy templates with the local-disk DB + 8 GB heap truth.** Edit `.env.runpod` comments/paths, `docs/OPERATOR.md`, `infra/cloudflare/README.md`, and the `startup.sh` 32 GB `NODE_OPTIONS` export so a future operator cannot recreate the volume-SQLite 503 incident.
6. **Refresh the numeric claims** in CLAUDE.md / `docs/STATE_OF_CONCORD.md` from the table in §2 (or run `npm run check-doc-claims` after P0-1). Kill the “27 dead client events” and “JWT FATAL but continues” lines; they are actively misleading.
7. **Un-track `concord-frontend/.env.production`** (`git rm --cached`) so the ignore rule can work.
8. **Only then** pull from `docs/NEXT_ARC_PLAN.md` §D. Wave 1 is marked shipped; the next work is the ranked backlog, not another “Phase 2.”

---

## 8. Scope limits and hunches

- Did not execute the full 38k-test suite or a production boot. Test-count badges in the README were not re-measured.
- Did not hit live `concord-os.org`. Incident comments in `cpu-self-pin.js` and the rate-limit commits are treated as operator-reported, then checked against code.
- Did not dump or decode any secret material. Tracked env files were classified empty / placeholder / nonempty-name-only.
- World-shard write-boundary and IDOR across the full `publicReadPaths` list were sampled, not exhaustively proven.
- Hunch: several other Gate-1 prefixes (`/api/notifications`, `/api/compliance`) may have the same “list-all, no owner filter” shape as webhooks. Worth a dedicated pass after H2.
- Hunch: the user’s local dirty tree and non-git runtime may already contain lockfile or env fixes that are not on GitHub. This audit cannot see them.

---

## Evidence index

| Area | Primary paths |
|---|---|
| Boot / heap / shards | `ecosystem.config.cjs`, `startup.sh`, `docker-compose.yml`, `server/package.json` |
| Auth gates | `server/server.js` (3373–3391, 7205–7231, 7400–7673, 7976–8006, 14115–14118), `server/middleware/index.js` |
| RBAC | `server/emergent/rbac.js`, `server/server.js:61958–62013`, `server/routes/helpers-extended.js:456–492` |
| Webhooks | `server/server.js:52391–52448, 52640, 62060–62064`, `server/emergent/public-api.js:93–111` |
| SSRF / RCE fixes | `server/domains/cooking.js`, `server/domains/invariant.js`, `server/domains/whiteboard.js`, `server/lib/external-fetch.js` |
| Durability | `scripts/db-backup.sh`, `scripts/preflight-production.sh`, `server/server.js` (3038–3182, 5827–5910) |
| CI | `.github/workflows/ci.yml`, `audits.yml`, `detectors-cartography.yml`, `security-detectors-gate.yml` |
| Baseline | `audit/detectors/BASELINE.json` |
| Docs that drifted | `CLAUDE.md`, `docs/STATE_OF_CONCORD.md`, `docs/OPERATOR.md`, `.env.runpod` |
| GitHub runs | CI `32637278999` (fail @ npm ci); detectors scheduled failures 2026-08-27–08-31 |

---

*End of audit. Next work should be P0-1 (lockfile), not a new feature.*
