# System Architecture Overview

**Last updated:** 2026-05-14

---

## System Components

### server/ — Node.js / Express Backend

The backend is a single Node.js process built on Express, backed by SQLite via `better-sqlite3`.

| Fact | Detail |
|------|--------|
| Entry point | `server/server.js` (70,238 lines) |
| Inline route handlers | 1,087 (active extraction in progress) |
| Extracted route modules | 131 files under `server/routes/` |
| Database | SQLite with WAL mode enabled |
| LLM inference | Ollama (local; optional per-user BYO external API keys via the BYO key router) |

`server.js` contains two conceptually distinct layers that currently live in the same file:

- **Route layer** — REST handlers being incrementally moved to `server/routes/`.
- **Macro/lifecycle layer** — DB initialisation, WebSocket setup, Feed Manager startup, heartbeat, state bootstrap. This layer stays in `server.js`; it is not an Express router and cannot be extracted without larger architectural refactoring.

### concord-frontend/ — Next.js 15 Web App

The primary user interface (Next.js 15.5, React 19, TypeScript 5.9). Key areas:

- `app/lenses/` — 232 domain-specific lens pages.
- `components/` — Shared UI: `LensPageShell`, `FeedDTUCard`, `LiveIndicator`, `DTUExportButton`, `RealtimeDataPanel`.
- `hooks/` — `useSocket`, `useLensDTUs`, `useAuth`, `useRealtimeLens`.
- `lib/` — `lens-registry`, `realtime/event-bus`, `design-system`.

### concord-mobile/ — React Native Companion App

Mobile companion exposing a subset of lens and DTU functionality. Communicates with the same REST/WebSocket surface as the web frontend.

### Ollama — Local LLM Inference

Runs locally alongside the server. The server calls Ollama over HTTP for AI-assisted DTU enrichment, tagging, and summarisation. No data leaves the host machine.

---

## Communication Patterns

### REST API

- Base URL: `http://localhost:5050/api/`
- All write endpoints require authentication (see [Security](#security)).
- Route naming follows resource-first convention: `/api/{namespace}/{action}`.

### WebSocket — socket.io Real-Time Events

- socket.io is mounted on the same port (5050) as the REST API.
- The server maintains **per-user rooms**: each authenticated socket joins a room keyed by the user's ID, so broadcasts are user-scoped.
- Server-side utility: `realtimeEmit(userId, event, payload)` in `server.js`.
- Client-side: `FORWARDED_EVENTS` list in `hooks/useSocket.ts` declares which server events the hook forwards to the React event bus.

### Authentication

Two authentication mechanisms are supported:

| Mechanism | Header / Cookie | Typical consumer |
|-----------|----------------|-----------------|
| JWT bearer token | `Authorization: Bearer <token>` or `HttpOnly` cookie | Browser sessions |
| API key | `X-API-Key: csk_...` | SDK / programmatic clients |

Both resolve to `req.user` and are checked by the shared `requireAuth()` middleware. See [ADR-002](adr/ADR-002-auth-pattern.md) for the actor-identity rule.

---

## Key Concepts

### DTU — Discrete Thought Unit

The atomic content type of the system. Every piece of content — a note, a feed item, a task, a market listing — is a DTU.

| Field | Purpose |
|-------|---------|
| `id` | UUID primary key |
| `title` | Short human-readable label |
| `body` | Rich-text or Markdown content |
| `domain` | The lens domain this DTU belongs to (e.g. `finance`, `health`) |
| `tags` | Array of freeform strings for cross-lens retrieval |
| `meta` | Arbitrary JSON blob for domain-specific extensions |
| `marketplace` | Marketplace listing metadata (price, visibility, etc.) |

### Lens Domains

232 domain-specific workspaces (e.g. `finance`, `health`, `law`, `philosophy`), backed by 249 domain handler files. Each lens:

- Has a dedicated page under `concord-frontend/app/lenses/`.
- Is registered in `lib/lens-registry`.
- Receives real-time DTU updates filtered to its domain.

### Feed Manager

Located in `server/lib/feed-manager.js`. Polls RSS and JSON feed sources on configurable intervals, parses entries, and emits them as DTUs tagged with the appropriate lens domain. Feed source definitions live in `server/lib/feed-sources.js`.

### Lens Action Registry

A dispatch table mapping `domain.action` keys to handler functions. All 232 lenses use this registry pattern for their server-side logic, keeping route files thin and testable.

---

## Data Layer

```
┌──────────────────────────────────┐
│  SQLite (better-sqlite3)         │  ← persistent source of truth
│  WAL mode enabled                │
└──────────────┬───────────────────┘
               │  hydrated at startup
               ▼
┌──────────────────────────────────┐
│  STATE.dtus  (in-memory Map)     │  ← fast reads; all queries go here
└──────────────────────────────────┘
```

Writes go to SQLite first, then update `STATE.dtus`. Reads come from the in-memory Map, avoiding disk I/O for the hot path. WAL mode allows concurrent reads during writes.

---

## Real-Time Layer

```
Server                          Client (Next.js)
──────                          ────────────────
realtimeEmit(userId, evt, data)
       │                        useSocket (hooks/useSocket.ts)
       │  socket.io room        │
       └──────────────────────► FORWARDED_EVENTS list
                                       │
                                realtime/event-bus
                                       │
                               useRealtimeLens / useLensDTUs
                                       │
                               React component re-render
```

Events not in `FORWARDED_EVENTS` are silently dropped by `useSocket`, acting as an allowlist.

---

## Security

| Control | Implementation |
|---------|---------------|
| Route authentication | `requireAuth()` middleware applied to all mutation routes |
| Actor identity | `req.user.id` (from JWT/API-key decode) — never `req.body.userId` |
| Target identifier | `req.body.userId` is acceptable only as a target (e.g., invite recipient) and must be annotated `// safe: target-identifier` |
| CSRF | `SameSite` cookie attribute; no custom CSRF tokens needed for same-site requests |
| Rate limiting | Express rate-limit middleware on public and auth endpoints |
| CI gate | `grep -rn "req\.body\.userId" server/ --include="*.js" \| grep -v "// safe:"` must return 0 results |

See [ADR-002](adr/ADR-002-auth-pattern.md) for full rationale.

---

## Directory Structure

```
server/                   # Node.js backend
  server.js               # 70K-line monolith (active extraction in progress)
  routes/                 # 131 extracted route modules
  lib/                    # feed-manager, feed-sources, storage, etc.
  tests/                  # node:test test suite

concord-frontend/         # Next.js 15 app
  app/lenses/             # 232 lens pages
  components/             # Shared UI: LensPageShell, FeedDTUCard, etc.
  hooks/                  # useSocket, useLensDTUs, useAuth, useRealtimeLens
  lib/                    # lens-registry, realtime/event-bus, design-system

concord-mobile/           # React Native companion app

docs/                     # This documentation
  architecture/           # System overview and ADRs (this directory)
  adr/                    # Legacy ADR location (pre-quality-sprint)
  operations/             # Runbooks and operational guides

reports/quality-progress/ # Quality sprint task reports
```

---

## Related Documents

- [ADR-001: LensPageShell Adoption](adr/ADR-001-lens-page-shell.md)
- [ADR-002: Auth Pattern](adr/ADR-002-auth-pattern.md)
- [ADR-003: Server Modularity](adr/ADR-003-server-modularity.md)
- [Task 6.2 Report](../../reports/quality-progress/task-6-2-architecture-docs.md)
