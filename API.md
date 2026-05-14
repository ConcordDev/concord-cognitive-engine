# Concord Cognitive Engine -- API Reference

Base URL: `http://localhost:5050`

All authenticated endpoints require the header:

```
Authorization: Bearer <token>
```

Alternatively, use httpOnly session cookies (set automatically on login) or an API key via `X-API-Key` header.

For the complete OpenAPI 3.1 specification, see `server/openapi.yaml`.

---

## Authentication

### POST /api/auth/register

Create a new user account.

```bash
curl -X POST http://localhost:5050/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","email":"alice@example.com","password":"s3cure-passw0rd!"}'
```

Response `201`:
```json
{"ok": true, "token": "<jwt>", "refreshToken": "<refresh>", "user": {"id": "...", "username": "alice"}}
```

### POST /api/auth/login

Authenticate with username/email and password. Sets an httpOnly cookie and returns a JWT.

```bash
curl -X POST http://localhost:5050/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"s3cure-passw0rd!"}'
```

### POST /api/auth/refresh

Exchange a refresh token for a new access token pair.

```bash
curl -X POST http://localhost:5050/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"<refresh-token>"}'
```

### POST /api/auth/logout

Invalidate the current session and clear auth cookies.

```bash
curl -X POST http://localhost:5050/api/auth/logout \
  -H "Authorization: Bearer <token>"
```

### GET /api/auth/me

Return the authenticated user's profile.

```bash
curl http://localhost:5050/api/auth/me \
  -H "Authorization: Bearer <token>"
```

### GET /api/auth/csrf-token

Fetch a CSRF token for state-changing requests from the browser.

### POST /api/auth/api-keys

Create a scoped API key (owner/admin only). The raw key is returned once.

```bash
curl -X POST http://localhost:5050/api/auth/api-keys \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"ci-pipeline","scopes":["read:dtus","write:dtus"]}'
```

### POST /api/auth/revoke-all-sessions

Invalidate all active sessions for the current user.

---

## Chat

### POST /api/chat

Send a message and get a response from the cognitive engine.

```bash
curl -X POST http://localhost:5050/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"What do you know about quantum computing?","mode":"deep"}'
```

Modes: `overview` (default), `deep`, `creative`.

Response:
```json
{"ok": true, "reply": "...", "meta": {"model": "concord-conscious:latest", "tokens": 342}}
```

### POST /api/chat (streaming)

Add `"stream": true` or set `Accept: text/event-stream` to receive Server-Sent Events.

```bash
curl -X POST http://localhost:5050/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message":"Explain DTU consolidation","stream":true}'
```

### POST /api/ask

General-purpose inference endpoint (same auth, simpler response).

```bash
curl -X POST http://localhost:5050/api/ask \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message":"Summarize my recent DTUs"}'
```

---

## DTUs (Discrete Thought Units)

### GET /api/dtus

List DTUs with pagination.

```bash
curl "http://localhost:5050/api/dtus?limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

### POST /api/dtus

Create a new DTU.

```bash
curl -X POST http://localhost:5050/api/dtus \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Quantum Entanglement","body":"Two particles linked across distance...","tags":["physics","quantum"]}'
```

### GET /api/dtus/:id

Retrieve a single DTU by ID.

### PUT /api/dtus/:id

Update a DTU (creates a new version).

### DELETE /api/dtus/:id

Soft-delete a DTU (converts to tombstone).

### GET /api/dtu_view/:id

Read-only view of a DTU (public-read compatible).

### POST /api/dtus/dedupe

Find and merge duplicate DTUs.

### POST /api/dtus/cluster

Run cluster detection across DTUs.

### POST /api/dtus/reconcile

Reconcile conflicting DTUs.

### GET /api/search/indexed

Full-text search across all DTUs.

```bash
curl "http://localhost:5050/api/search/indexed?q=quantum&limit=10" \
  -H "Authorization: Bearer <token>"
```

### GET /api/megas

List MEGA-level consolidated DTUs.

### GET /api/hypers

List HYPER-level consolidated DTUs.

### GET /api/definitions

List defined terms. `GET /api/definitions/:term` for a specific term.

---

## Forge (DTU Creation Modes)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/forge/manual` | POST | Create DTU with full manual control |
| `/api/forge/hybrid` | POST | LLM-assisted DTU creation |
| `/api/forge/auto` | POST | Fully automated DTU generation |

---

## Lens / Domain

Domain-scoped operations for lens interactions and artifacts.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/atlas/dtu` | POST | Store a DTU in the epistemic atlas |
| `/api/atlas/search` | GET | Search the atlas |
| `/api/atlas/council/resolve` | POST | Resolve council disputes |

Lens-specific routes are in `server/routes/lens-compliance.js`, `lens-culture.js`, and `lens-features.js`.

---

## Economy / Credits

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/economy/balance` | GET | Get account balance |
| `/api/economy/fees` | GET | Current fee schedule |
| `/api/credits/earn` | POST | Record earned credits |
| `/api/credits/spend` | POST | Spend credits on an action |

```bash
curl http://localhost:5050/api/economy/balance \
  -H "Authorization: Bearer <token>"
```

---

## Sovereign

Sovereign governance endpoints (mounted at `/api/sovereign`).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sovereign/pulse` | GET | Sovereign system pulse |
| `/api/sovereign/decree` | POST | Issue a sovereign decree |
| `/api/sovereign/audit` | GET | Sovereign audit log |
| `/api/sovereign/eval` | POST | Evaluate a sovereign expression |
| `/api/sovereign/dashboard` | GET | Sovereign dashboard data |

---

## Council / Governance

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/council/vote` | POST | Submit a council vote |
| `/api/personas` | GET | List AI personas |

---

## Social / Collaboration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/social/profile` | GET | Get own social profile |
| `/api/social/profile/:userId` | GET | Get another user's profile |
| `/api/social/follow` | POST | Follow a user |
| `/api/social/feed` | GET | Activity feed |
| `/api/social/trending` | GET | Trending content |
| `/api/collab/workspaces` | GET | List workspaces |
| `/api/collab/workspace` | POST | Create workspace |
| `/api/collab/workspace/:id` | GET/PUT/DELETE | Manage workspace |

---

## Emergent Agents

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/emergent/register` | POST | Register an emergent agent |
| `/api/emergent/list` | GET | List agents |
| `/api/emergent/:id` | GET | Agent details |
| `/api/emergent/:id/deactivate` | POST | Deactivate an agent |
| `/api/emergent/session/create` | POST | Create agent session |
| `/api/emergent/session/turn` | POST | Submit a session turn |
| `/api/emergent/status` | GET | Emergent system status |
| `/api/emergent/lattice/propose/dtu` | POST | Propose DTU via lattice |
| `/api/emergent/lattice/commit` | POST | Commit lattice proposal |
| `/api/emergent/lattice/metrics` | GET | Lattice metrics |

---

## System / Health

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `GET /health` | GET | No | Liveness check |
| `GET /ready` | GET | No | Readiness probe (503 if not ready) |
| `GET /api/status` | GET | No | Detailed system status |
| `GET /api/health/capabilities` | GET | No | Feature capabilities |
| `GET /api/metrics` | GET | No | Prometheus metrics |
| `GET /api/llm/status` | GET | Yes | LLM pipeline status |
| `POST /api/llm/generate` | POST | Yes | Direct LLM generation |
| `GET /api/llm/mode` | GET | Yes | Current LLM mode |

### Additional System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/backup` | POST | Create a backup |
| `/api/backups` | GET | List backups |
| `/api/backup/restore` | POST | Restore from backup |
| `/api/system/continuity` | GET | System continuity status |
| `/api/system/gap-scan` | POST | Run gap scan |
| `/api/heartbeat/tick` | POST | Trigger manual heartbeat |
| `/api/organs` | GET | List system organs |
| `/api/growth` | GET | Growth metrics |

---

## WebSocket Events

Connect via WebSocket at `ws://localhost:5050` (enabled when `CONCORD_WS_ENABLED=true`).

| Event | Direction | Description |
|-------|-----------|-------------|
| `dtu:created` | Server -> Client | New DTU created |
| `dtu:updated` | Server -> Client | DTU modified |
| `dtu:deleted` | Server -> Client | DTU removed |
| `chat:response` | Server -> Client | Chat reply chunk (streaming) |
| `heartbeat:tick` | Server -> Client | Heartbeat tick notification |
| `entity:event` | Server -> Client | Entity lifecycle event |
| `system:status` | Server -> Client | System status update |

---

## Error Responses

All errors follow a consistent format:

```json
{"ok": false, "error": "Human-readable error message"}
```

Common HTTP status codes:

| Code | Meaning |
|------|---------|
| 400 | Bad request / validation error |
| 401 | Not authenticated |
| 403 | Forbidden (insufficient permissions) |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 429 | Rate limited |
| 503 | Service unavailable |

---

## Rate Limiting

Auth endpoints have stricter rate limits. General API rate limits depend on server configuration. Rate-limited responses return `429` with a `Retry-After` header.

For the complete OpenAPI 3.1 specification with request/response schemas, see [`server/openapi.yaml`](server/openapi.yaml).

---

## Phase F2 — Emergent Concordia Endpoints

Routes added in Phase F / F2 (Concordia AAA polish + emergent creatures + skills + crossbreeding + combat netcode + world clock + weather + social pings).

### Procedural Creatures

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/creature/spawn` | yes | Generate a physics-validated creature blueprint from a description seed. Body: `{ description, worldId?, topology?, massKg?, heightM?, traits?, origin? }`. Returns `{ ok, blueprint }` with `blueprint.parts`, `blueprint.gait`, `blueprint.skillIds`, `blueprint.validation`. Auto-rescales mass when wing/leg proportions can't support declared mass; `provenance.rescaled` is true when this happened. |
| GET | `/api/creature/topologies` | no | List supported topologies (humanoid, quadruped, winged_quadruped, winged_biped, serpentine, polyped, amorphous). |
| GET | `/api/creature/baselines/:worldId` | no | Authored baseline creatures for a world (5 each per superhero / fantasy / crime / cyber). Includes topology hint, size band, starting behavior, emergent ability seeds. |
| POST | `/api/creature/validate` | no | Dry-run physics validation against an existing blueprint. Returns `{ ok, reason?, fix? }` where `fix.suggestedMassKg` advises the rescale that would pass. |
| POST | `/api/creature/encounter` | yes | Bump bond between two creatures. Body: `{ aId, bId, worldA, worldB, environment?, sameEnvironmentBonus?, sharedThreatBonus? }`. Bonds decay if not refreshed every 60s. |
| POST | `/api/creature/crossbreed` | yes | Record encounter + try to generate hybrid. Body: `{ a, b, environment?, sameEnvironmentBonus?, sharedThreatBonus? }`. Returns `{ ok, hybrid, stability, crossWorld, inheritedSkillIds, tensionSkill, parents, generation }`. Cross-world hybrids require bond ≥ 200 (vs 100 same-world) and stability caps at 0.4. |
| POST | `/api/creature/hybrid` | yes | Direct hybrid generation (skips encounter step). Same response shape. |
| GET | `/api/creature/lineage/:id` | no | Parents + descendants of a creature: `{ self, descendants[] }`. |

### Emergent Skills

Mounted at `/api/emergent-skills/*` to avoid colliding with the existing `/api/skills/*` import/export router.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/emergent-skills/create` | yes | Author a new skill. Body: `{ name, verb, requires?, costs?, effects[] }`. Effects must use only `EFFECT_KINDS` (damage, heal, displace, stun, buff, debuff, summon, transform, terrain, ranged_projectile, channel). Unknown kinds are rejected. |
| POST | `/api/emergent-skills/evolve` | yes | Derive a child skill. Body: `{ parentId, mutation }`. Sets `provenance.parentId` so chains are traceable. |
| GET | `/api/emergent-skills/list` | no | List skills. Optional `?origin=...&parentId=...` filters. |
| GET | `/api/emergent-skills/:id` | no | Read one skill. |

### Combat Netcode

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/combat/attack` | yes | Declare an attack swing. Body: `{ weapon?, animation?, direction?, cooldownMs? }`. Cooldown floor 200ms. Broadcasts `combat:attack` to peers within 1500m. 429 on cooldown. |
| POST | `/api/combat/hit` | yes | Submit a damage event. Body: `{ victimId, damage, isCrit?, weapon?, hitDirection? }`. Server validates: reach (3m melee / 80m ranged), damage cap (`weapon.maxDamage * 2.5` w/ crit), cross-city, self-target. Failed validation returns 400 and is NOT broadcast. Consults victim's combat state — i-frames → `combat:miss` event, block → 0.5× damage, depleted poise → `staggered: true` in payload. |
| POST | `/api/combat/death` | yes | Self-report death. Body: `{ victimId?, killerId? }`. Broadcasts `combat:death` to peers. |
| GET | `/api/combat/state/:actorId` | no | Snapshot: `{ poise, poiseMax, staggered, iframed, blocking, knockbackVel }`. |
| POST | `/api/combat/iframes` | yes | Grant 50–800ms i-frames (post-dodge). Body: `{ durationMs }`. |
| POST | `/api/combat/block` | yes | Open a 100–2000ms block window. Body: `{ durationMs }`. |

### Social

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social/ping` | yes | Spatial ping to nearby players. Body: `{ type, target?, text? }`. Types: `wave / needs_help / loot_here / meet_here / danger / inspect`. 800m radius, 12/min + 4s same-type cooldown. Broadcasts `social:ping`. 429 on rate limit. |

### World Clock + Weather + NPC Schedules

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/world/clock` | no | Current `{ phase, segment, dayLengthMs, serverTime }`. 24-real-minute cycle, 6 segments (dawn / morning / midday / afternoon / dusk / night). Server emits `world:clock` over socket.io every 30s. |
| GET | `/api/world/weather/:worldId` | no | Current weather state for a world: `{ type, intensity, since, windDirection }`. Server emits `world:weather` after each Markov step (every 40 ticks ≈ 10 min). |
| GET | `/api/world/npc-behavior` | no | What an NPC should be doing right now: `?id=...&archetype=...` → `{ behavior, segment }`. |
| GET | `/api/world/npc-archetypes` | no | List of registered schedule archetypes. |
| POST | `/api/world/npc-schedule` | yes | Override an NPC's schedule. Body: `{ npcId, schedule }`. Pass `null` schedule to clear. |

### Phase F WebSocket Events

| Event | Payload | Source |
|---|---|---|
| `world:clock` | `{ phase, segment, epochMs, dayLengthMs, ts }` | Every 30s from world-clock broadcast |
| `world:weather` | `{ worldId, type, intensity, since, windDirection, ts }` | Per-world Markov step |
| `concord-link:delivered` | `{ messageId, ts }` | Walker journey final hop succeeded |
| `combat:attack` | `{ attackerId, weapon, animation, direction, position, ts }` | On `/api/combat/attack` |
| `combat:hit` | `{ attackerId, victimId, damage, isCrit, blocked, staggered, hitDirection, magnitude, position, weapon, ts }` | On validated `/api/combat/hit` |
| `combat:miss` | `{ attackerId, victimId, missed:true, ts }` | When victim is in i-frames |
| `combat:death` | `{ victimId, killerId, position, ts }` | On `/api/combat/death` |
| `social:ping` | `{ from, type, position, cityId, target, text, ts }` | On `/api/social/ping` |
| `quest:new` | `{ questId, worldId, title, description, giverNpcId, rewardJson, ts }` | Quest emergence per heartbeat |

---

## Onboarding + First Cycle Tutorial

The first-hour onboarding routes the new player from `/register` into the cook → eat → fight → commune flow defined in `content/quests/onboarding.json`. The wizard is mounted in `AppShell.tsx`; these endpoints back its state.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET  | `/api/onboarding`                  | no  | Read the player's onboarding state. Returns `{ ok, state }` with completed step ids. |
| POST | `/api/onboarding/start`            | yes | Mark onboarding as started for the authenticated user. |
| POST | `/api/onboarding/complete`         | yes | Record completion of an onboarding step. Body: `{ stepId }`. |
| GET  | `/api/onboarding/wizard-status`    | yes | Server-confirmed first-visit completion: `{ ok, completed, completedAt }`. |
| POST | `/api/onboarding/wizard-complete`  | yes | Mark the wizard complete on the server (survives device/login changes). |
| GET  | `/api/tutorial/first-cycle?worldId=` | no | Player progress through the four First-Cycle quests. Returns `{ ok, tutorial:'first_cycle', currentPhase, complete, phases:[{questId, phase, status, complete, progress}] }`. `currentPhase` is one of `cook`/`eat`/`fight`/`commune`/`complete`. Logic shared with E2E test via `lib/tutorial-first-cycle.js`. |

---

## Creator Economy

Surfaces creator-facing analytics for the marketplace lens.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/creator/leaderboard`         | no  | Top creators by influence-weighted earnings. Optional `?limit=`, `?window=` (24h/7d/30d/all). |
| GET | `/api/creator/trending-citations`  | no  | DTUs whose citation rate is rising fastest in the recent window. |
| GET | `/api/creator/influence-drift`     | no  | Creator influence score deltas (rising / falling list). |
| GET | `/api/creator/badges`              | yes | Badges earned by the authenticated creator. |
| GET | `/api/creator/badges/:userId`      | no  | Public badge wall for any user. |
| GET | `/api/creator/listings`            | yes | The authenticated user's marketplace listings. |
| GET | `/api/creator/dashboard`           | yes | Aggregate dashboard: earnings, royalty cascade snapshot, listing health. |

---

## OpenAPI Spec + API Docs

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/openapi.json`        | no | Live OpenAPI 3.1 spec (machine-readable). |
| GET | `/api/openapi.yaml`        | no | Same spec in YAML. |
| GET | `/api/docs`                | no | Renders an HTML viewer for the spec. |
| GET | `/api/docs/openapi.json`   | no | Spec under the docs prefix (alias). |
| GET | `/api/docs/openapi.yaml`   | no | YAML alias under docs prefix. |

---

## Concord Link (cross-world messaging)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/concord-link/send`     | yes | Dispatch a message from world A → world B via walker journey. Body: `{ toWorld, payload, prefer? }`. Returns `{ messageId, walkers, etaSec }`. |
| GET  | `/api/concord-link/status/:messageId` | no | Lookup walker journey progress: `{ status, hops, lastHopAt }`. |
| GET  | `/api/concord-link/inbox`    | yes | Messages addressed to the authenticated player. |

The `concord-link:delivered` socket event fires when the final hop succeeds (also documented above).

---

## Black Market (intercepted-message economy)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET  | `/api/black-market/listings`  | no  | Active intercepted-message listings. Filterable by topic and price band. |
| POST | `/api/black-market/intercept` | yes | Record a Sovereign-authorized message interception. Body: `{ messageId, evidenceTier }`. |
| POST | `/api/black-market/buy`       | yes | Purchase intercepted intel. Body: `{ listingId }`. Burns CC; transfers payload to buyer. |

---

## World Bazaar + Performance Telemetry

| Method | Path | Auth | Description |
|---|---|---|---|
| GET  | `/api/world/bazaar`           | no  | Aggregate marketplace surface for a world: trending recipes, top creators, hot DTUs. Used by the bazaar district overlay. |
| POST | `/api/world/perf-telemetry`   | no  | Client → server telemetry beacon (FPS, draw calls, GPU memory). Capped at 8kb body. |
| GET  | `/api/world/perf-telemetry`   | no  | Aggregated client-perf snapshot for ops monitoring. |
