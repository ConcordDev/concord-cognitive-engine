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
{"ok": true, "reply": "...", "meta": {"model": "qwen2.5:14b-instruct-q4_K_M", "tokens": 342}}
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
