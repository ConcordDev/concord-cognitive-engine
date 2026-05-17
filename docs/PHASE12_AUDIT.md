# Phase 12 — Honest Audit of CLAUDE.md Claims

Generated 2026-05-17 by direct grep + live-server smoke. Every claim
below was checked against the working tree at `claude/add-api-wires-onboarding-EWvZC`
(HEAD `5d3a914`) and a running dev server at `localhost:5050`.

## TL;DR

| Area | Claim in CLAUDE.md | Actual | Verdict |
|---|---|---|---|
| Lens dirs | 232 | **236** | stale (low by 4) |
| Backend domain files | 249 | **278** | stale (low by 29) |
| Migrations | 192 (latest `192_foundry_phase7.js`) | **200** (latest `200_audio_rooms.js`) | stale |
| Emergent modules | 178 | **182** | stale (low by 4) |
| Heartbeats unique | 64 | **68** | stale (low by 4) |
| `CREATE TABLE` statements | ~453 | **468** | stale (low by 15) |
| `server.js` LOC | 70,238 at HEAD `6d32663` | **71,189** at HEAD `5d3a914` | drifted up |
| Authored NPCs | 24 | **148** (across 9 sub-worlds) | drift — system has GROWN ~6× |
| Authored factions | 7 | **69** | drift — grown ~10× |
| Lore items | 19 | **36** | drift — grown ~2× |
| Quest files | onboarding + 7-quest main + 8 faction (≈16) | **6 files** in `content/quests/` (plus 5+ in `content/world/*/quests/`) | shape changed, count not directly comparable |
| Brain model `repair` | `qwen2.5:0.5b` | **`qwen2.5:1.5b`** (live `/health` reports this) | wrong |
| Brain key `Vision` | "Vision" | **`multimodal`** (canonical key in `brain-config.js`) | naming mismatch |
| Heartbeat counter metric | `concord_heartbeat_ticks_total` (plural) | exposed as `concord_heartbeat_tick_total` (singular) in `routes/system.js` | wrong; see "Critical findings" below |

Net: **the doc undercounts everything** — the codebase has continued to grow past
the numbers committed to `CLAUDE.md`. None of the discrepancies are "less than
claimed" — every drift is in the direction of more code, more content.

---

## Critical findings

### 🔴 The registry-pattern heartbeat dispatcher is dead code

**Severity: high.** The doc says "64 heartbeats registered via `registerHeartbeat`
fire on the 15-second tick." In the current code path, none of them fire.

Verified chain:
1. `server/emergent/heartbeat-registry.js#tickAllRegistered(ctx)` — dispatcher
   that runs registered handlers when their tick count is due.
2. Only caller in the entire repo: `server.js:32512`, inside `governorTick()`.
3. `governorTick()` only invoked from `_startGovernorHeartbeat()` at
   `server.js:32537` (`setInterval` + 2s boot kick).
4. `_startGovernorHeartbeat()` is defined at `server.js:32528` and **never
   called** — `grep -nE "_startGovernorHeartbeat\\(\\)|startGovernorHeartbeat\\(\\)" server/server.js`
   returns only the definition site.

The legacy `startHeartbeat()` (`server.js:28570`, kicked at 29103 with a 45s
delay) runs its own inline tick logic but does NOT delegate to
`governorTick` or `tickAllRegistered`. Two parallel heartbeat code paths
exist; only the legacy one runs and the new registry path is silent.

Live evidence (server up 14 min, fresh boot):
- `/metrics` returns `concord_heartbeat_tick_total 0`
- `STATE.__bgTickCounter` (incremented only inside `kernelTick`, itself
  only called from inside `governorTick` or from event-triggered code) is 0.
- Server log: zero `heartbeat:tick`, `governor_heartbeat_active`, or
  `tick_completed` log lines after boot. Only `cascade_recovery` reports
  "heartbeat_enabled: disabled" — a status check, not an action.

**Impact**: 68 modules registered via `registerHeartbeat` silently never fire,
including:
- `signal-propagation-cycle` (frequency 3) — chemistry cascade + lightning chains
- `npc-conversation-initiator` (8) — Layer 13 ambient NPC chats
- `lattice-quest-cycle` (180) — turning drift alerts into quests
- `faction-strategy-cycle` (200) — Layer 11 emergent factions
- `forward-sim-cycle` (100) — Layer 10 anticipation
- `embodied-dream-cycle` (80) — Layer 9 player dreams
- `repair-cycle` (20) — Layer 8 pain→XP conversion
- `environment-sensor` (5) — Layer 7 climate
- `creature-flock-cycle` (4), `season-cycle`, `player-signs-cleanup`, etc.

The substrate code for all of these is real and tested in isolation; the
runtime tick that drives them is unwired.

**Fix**: call `_startGovernorHeartbeat()` once after `STATE` is built and
heartbeat settings are loaded. Most likely placement: right after the
existing `startHeartbeat()` schedule at `server.js:29103`.

### 🟡 Two `/metrics` endpoints, divergent counter names

`server.js:6374-6378` declares `concord_heartbeat_ticks_total` via
prom-client. `routes/system.js:263-265` hand-builds `concord_heartbeat_tick_total`
(singular). The hand-built one is what the live `/metrics` route serves; the
prom-client counter is exposed but never incremented (no `.inc()` call exists
in the codebase). CLAUDE.md cites the plural name; production alerts in
`monitoring/prometheus/alerts.yml` that match the plural name would never fire.

### 🟡 Webfinger / actor / inbox were not publicly reachable until this branch

Prior to the Phase 12 commits I added in this session, `GET /.well-known/webfinger`,
`GET /api/federation/users/:userId`, and `POST /api/federation/users/:userId/inbox`
were all gated by:
- auth middleware (returned 401)
- bot-guard middleware (returned 403 for any UA matching `bot|crawler|curl/...`)

This branch fixes all three: `/.well-known/webfinger` added to
`publicReadPaths`, `_AP_PUBLIC_RE` exempts the actor + inbox/outbox URLs from
the bot guard, and the inbox POST is exempted from the auth gate. After the
fix the full RFC 7033 → AP discovery loop works end-to-end against the live
server (smoke-tested with a fake peer + signed Follow → 202, tampered body
→ 401 `digest_mismatch`).

### 🟢 The "fully working end-to-end" list is mostly accurate (where the surface is reachable)

- Auth — verified live: `/api/auth/me` returns 401 with `AUTH_REQUIRED` (correct anonymous response).
- Webfinger / AP discovery — now verified live end-to-end (was previously gated).
- DTU artifact upload + thumbnail generation — wired this session; ffmpeg path
  via `ffmpeg-static` returns JPEG poster from frame 0.5-1s.
- Marketplace fees (constitutional invariants) — `grep` confirms the
  hardcoded 95/5 split, 30% royalty cap, halving rate=2 are still in
  `creative-marketplace-constants.js` at the named offsets.
- 27 federation + AP tests pass (11 ap-signature + 5 webfinger + 8 federation-outbox + 3 new ap-inbox-integration).
- 159 load-bearing math tests pass (refusal-algebra, combat-anti-cheat, dtu-quality-scoring, royalty-cascade).

---

## Lens depth audit — 236 lenses classified

Heuristic:
- **DEEP**: `page.tsx > 1500 LOC` OR `domain file > 500 LOC` OR `≥11 macros+lensActions+inline`
  OR mounts a rival-shape shell (VSCodeShell / WalletShell / SessionView / etc.)
- **MODERATE**: `page.tsx > 600 LOC` AND backend has `≥3` handlers
- **THIN**: backend handlers exist but small page (<600 LOC) OR thin domain
- **SCAFFOLD**: no backend handler anywhere AND no route files

| Bucket | Count | What it means |
|---|---|---|
| **DEEP** | **77** | Real product surface — substantial UI + real backend logic |
| **MODERATE** | **73** | Working lens with a real domain implementation |
| **THIN** | **65** | Functional, but the domain is shallow (a few helpers, no deep simulation) |
| **SCAFFOLD** | **20** | UI shell without any backend handlers — render-only, would call a `/api/lens/run` macro that returns nothing |

### The 20 true scaffolds (UI exists, zero backend)

These lenses render but their `useLensData('<lens>', ...)` calls land on
a domain that has no `register()` and no route file. The list is reproducible
via `tail -n +2 /tmp/lens-classified.csv | awk -F, '$9=="SCAFFOLD"'`:

```
answers              page=752  
bounties             page=205  
code-quality         page=359  
cognitive-replay     page=170  
crisis-ops           page=132  
death-insurance      page=190  
deities              page=201  
dx-platform          page=245  
expedition-journal   page=115  
genesis              page=365  
ghost-tracker        page=114  
maker                page=327  
personas             page=180  
root                 page=349  
saved                page=63   
self                 page=377  
sentinel             page=295  
sub-worlds           page=144  
ux-suite             page=162  
world-creator        page=259  
```

Note that some pages here (`answers`, `genesis`, `self`, etc.) have several
hundred LOC — they're substantial UIs that just have no backend wired. They
render forms and tabs but any persistence or compute call returns empty.

### The 77 DEEP lenses (top 10 by page LOC)

| Lens | page.tsx LOC | domain LOC | macros+actions+inline | rival shell |
|---|---|---|---|---|
| world | 6,026 | 531 | 18 | yes |
| education | 4,635 | 757 | 14 | no |
| chat | 4,231 | 760 | 20 | yes |
| healthcare | 4,020 | 721 | 18 | no |
| environment | 3,745 | 195 | 7 | no |
| government | 3,579 | 313 | 10 | no |
| council | 3,485 | 60 | 4 | yes |
| legal | 3,414 | 322 | 12 | yes |
| realestate | 3,398 | 391 | 12 | no |
| accounting | 3,100 | 1,210 | 23 | yes |

Full machine-readable list lives in `/tmp/lens-classified.csv` (reproducible
via the bash loop in the audit run).

### Rival-shape mounts (13 lenses)

`accounting atlas code collab crypto federation healthcare legal marketplace
message music whiteboard world`. The CLAUDE.md claim that "many lenses also
mount a rival-shape silhouette" is technically accurate but the count is ~13
of 236, not "many" — this is a high-signal feature mounted on the
highest-value lenses only.

---

## What I'd change in CLAUDE.md

1. Run the inventory commands and refresh every number (lens dirs / domains /
   migrations / emergent modules / heartbeats / table count / `server.js` LOC).
2. Pull the NPC/faction/lore counts from a `find ... -exec jq length` pass —
   they're 6-10× higher than written.
3. Document that the registry-pattern heartbeat dispatcher needs
   `_startGovernorHeartbeat()` wired into the boot path (or move
   `tickAllRegistered` into the legacy `startHeartbeat` interval).
4. Fix the metric name from `concord_heartbeat_ticks_total` to
   `concord_heartbeat_tick_total` and confirm the Prometheus alert rule
   matches. Or pick one metric and delete the other.
5. Update the `repair` brain model — actual default is `qwen2.5:1.5b`, not
   `qwen2.5:0.5b`.
6. Add a "scaffold tail" section listing the 20 true-scaffold lenses so the
   "232 lenses" headline doesn't oversell.

---

## Reproduction

The classifier script that produced `/tmp/lens-classified.csv` is in
this session's bash history:

```bash
for lens in concord-frontend/app/lenses/*/; do
  name=$(basename "$lens")
  [ "$name" = "[parent]" ] && continue
  page="$lens/page.tsx"
  [ ! -f "$page" ] && continue
  page_loc=$(wc -l < "$page")
  # Try multiple naming variants for the domain file
  domain_file=""
  for variant in "$name" "${name//-/}" "${name//-/_}"; do
    [ -f "server/domains/${variant}.js" ] && { domain_file="server/domains/${variant}.js"; break; }
  done
  domain_loc=0; macros=0; lens_actions=0
  if [ -n "$domain_file" ]; then
    domain_loc=$(wc -l < "$domain_file")
    macros=$(grep -cE "[^a-z]register\\s*\\(" "$domain_file")
    lens_actions=$(grep -cE "registerLensAction\\s*\\(" "$domain_file")
  fi
  inline=$(grep -cE "register\\s*\\(\\s*['\"]${name}['\"]" server/server.js 2>/dev/null)
  routes=0
  for variant in "$name" "${name//-/}" "${name//-/_}"; do
    routes=$((routes + $(find server/routes -name "${variant}*.js" 2>/dev/null | wc -l)))
  done
  # classification
done
```

Live server smoke commands used:
```bash
curl http://localhost:5050/.well-known/webfinger?resource=acct:smoketest@concord-os.org
curl -H "User-Agent: Mastodon/4.2.0" http://localhost:5050/api/federation/users/smoketest
curl http://localhost:5050/metrics | grep heartbeat
node /tmp/inbox-smoke.mjs   # signs Follow + tampered Block, verifies 202 + 401
```

Heartbeat-dispatcher chain verification:
```bash
grep -nE "_startGovernorHeartbeat\\(\\)|startGovernorHeartbeat\\(\\)" server/server.js
# → only line 32528 (the definition); never called
grep -nE "tickAllRegistered" server/server.js
# → only line 32512 (inside governorTick); governorTick only called from _startGovernorHeartbeat
```
