# Concord Session Manifest — 2026-02-24

> **STATUS — HISTORICAL (as of 2026-05-06).** Every change documented in this
> manifest has long since been committed to the repo. Do NOT re-apply these
> patches; they are already live in `server/server.js`. Treat this file as
> documentation of *what was changed in the Feb 2026 session*, not as a
> pending task list. The line numbers below are also stale (server.js has
> grown from ~6k to 62k LOC since this was written).
>
> For the current state of the codebase, read `CLAUDE.md` and `WIRING_SPEC.md`.
> The most recent meaningful audit is described in CLAUDE.md's "Recent
> shipped work" table under "Production Audit (May 2026)."

---

## ARCHITECTURE: Three Permission Gates

Every public-read API route **must** be added to ALL THREE gates. Missing any
single gate results in a blocked request (401, 403, or 500).

| # | Gate | Location | Match Type |
|---|------|----------|------------|
| 1 | **Auth middleware** `publicReadPaths` | `authMiddleware()` ~line 3814 | Path prefix |
| 2 | **publicReadDomains** | ~line 5698 | Domain + macro name allowlist |
| 3 | **Chicken2 bypass** `safeReadBypass` | ~line 5740 | Path prefix + domain/name checks |

### Critical Pattern for Adding ANY New Public Route

```
1. Add path prefix to publicReadPaths in authMiddleware (~line 3814)
2. Add domain.macroName to publicReadDomains (~line 5698)
3. Add domain.macroName to Chicken2 safeReadBypass (~line 5740)

All three. Every time. Missing one = broken.
```

---

## CHANGE 1: Auth Middleware — Public Read Split

**Location**: `authMiddleware` function — `server/server.js` ~line 3814

Split public paths into two categories:

**`alwaysPublic`** (any HTTP method):
- `/health`
- `/ready`
- `/metrics`
- `/api/auth/*`
- `/api/docs`
- `/api/status`

**`publicReadPaths`** (GET only):
- `/api/dtus`
- `/api/lenses`
- `/api/lens`
- `/api/emergent`
- `/api/knowledge`
- `/api/search`
- `/api/brain/status`
- `/api/system/settings`
- `/api/species`
- `/api/events`
- `/api/lattice`
- `/api/system/health`
- `/api/guidance`
- `/api/graph`
- `/api/scope`
- `/api/scope/metrics`
- `/api/inspect`
- `/api/worldmodel`

---

## CHANGE 2: Sovereign Bypass in requireRole

**Location**: `requireRole` function — `server/server.js` ~line 3911

Added early return so sovereign role passes ALL role checks:

```javascript
if (req.user.role === "sovereign") return next();
```

---

## CHANGE 3: publicReadDomains Expanded

**Location**: `server/server.js` ~line 5698

```javascript
const publicReadDomains = {
  emergent: new Set(["status", "get", "list", "schema", "patterns", "reputation", "scope.metrics", "bridge.heartbeatTick"]),
  dtu: new Set(["list", "get", "search", "recent", "stats", "count", "export"]),
  lens: new Set(["list", "get", "export"]),
  system: new Set(["status", "getStatus", "health"]),
  settings: new Set(["get", "status"]),
  scope: new Set(["metrics", "status"]),
  lattice: new Set(["resonance", "status", "stats"]),
  guidance: new Set(["suggestions", "status"]),
  graph: new Set(["visual", "visualData", "forceGraph", "edges", "stats"]),
  events: new Set(["list", "recent"]),
  worldmodel: new Set(["list_relations", "get", "status"]),
};
```

---

## CHANGE 4: Chicken2 safeReadBypass Expanded

**Location**: `server/server.js` ~line 5740, inside the `safeReadBypass` conditional

Added these domain/name checks:

```javascript
(domain === "emergent" && (name === "status" || name === "get" || name === "list" || name === "schema" || name === "patterns" || name === "reputation" || name === "scope.metrics")) ||
(domain === "scope" && (name === "metrics" || name === "status")) ||
(domain === "lattice" && (name === "resonance" || name === "status" || name === "stats")) ||
(domain === "guidance" && (name === "suggestions" || name === "status")) ||
(domain === "graph" && (name === "visual" || name === "visualData" || name === "forceGraph" || name === "edges" || name === "stats")) ||
(domain === "worldmodel" && (name === "list_relations" || name === "get" || name === "status")) ||
(domain === "events" && (name === "list" || name === "recent"))
```

Added these path prefixes:

```javascript
_path.startsWith("/api/emergent") ||
_path.startsWith("/api/plugins") ||
_path.startsWith("/api/scope") ||
_path.startsWith("/api/events") ||
_path.startsWith("/api/lattice") ||
_path.startsWith("/api/guidance") ||
_path.startsWith("/api/graph") ||
_path.startsWith("/api/system/health") ||
_path.startsWith("/api/inspect") ||
_path.startsWith("/api/worldmodel")
```

---

## CHANGE 5: Direct Emergent Routes (Router Bypass)

**Location**: `server/server.js` ~line 18386, BEFORE the emergent router mount

These routes bypass the emergent router and call macros directly:

```javascript
app.get("/api/emergent/status", async (req, res) => {
  try {
    const out = await runMacro("emergent", "status", {}, makeCtx(req));
    const listOut = await runMacro("emergent", "list", {}, makeCtx(req));
    out.emergents = listOut?.emergents || [];
    out.entities = out.emergents;
    return res.json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/emergent/entities", async (req, res) => {
  const out = await runMacro("emergent", "list", {}, makeCtx(req));
  return res.json(out);
});
```

---

## CHANGE 6: Dedup Gates on BOTH Write Paths

Two DTU write paths exist:
1. `upsertDTU` (~line 8095) — used by some routes
2. `pipelineCommitDTU` (~line 12000) — used by dream/autogen pipelines

Added identical dedup gates to **BOTH**:

```javascript
// Only for system-generated DTUs
if (dtu.source !== "user" && dtu.source !== "import") {
  const firstDef = dtu.core?.definitions?.[0] || "";
  if (firstDef.startsWith("Working definition:") || firstDef.includes("synthesis from")) {
    console.log("[DEDUP] Blocked template DTU:", dtu.title?.slice(0, 60));
    return dtu;
  }
  for (const existing of STATE.dtus.values()) {
    if (existing.title === dtu.title) {
      console.log("[DEDUP] Blocked duplicate title:", dtu.title?.slice(0, 60));
      return dtu;
    }
  }
}
```

---

## CHANGE 7: Analogize Engine

**Location**: Registered after `system.synthesize` — `server/server.js` ~line 14245

New macro `system.analogize`:
- Picks a random DTU that has no analogy
- Sends to subconscious brain for analogy generation
- Creates a linked analogy DTU

Features:
- **Entity personality system**: synthesizer=warm/connective, critic=sharp/precise, builder=practical
- **Forgiving JSON parser**: tries clean parse → regex extract → raw text fallback
- **Meta includes**: `voice`, `entityId`, `entityRole`, `personality`, `analogyDomain`

---

## CHANGE 8: Analogize Wired into Heartbeat (Staggered)

**Location**: Inside the `Promise.allSettled(tasks).then()` callback — `server/server.js` ~line 18022

Runs AFTER the four main heartbeat pipelines with a 5-second delay:

```javascript
await new Promise(resolve => setTimeout(resolve, 5000));
const aResult = await runMacro("system", "analogize", {}, ctx);
```

---

## CHANGE 9: Repair Agent Tick (Lattice Health Audit)

**Location**: `server/emergent/index.js`, `register("emergent", "repair.agent.tick")`

Was empty/stub, now performs:
- Stale DTU detection
- Orphaned lineage check
- Low-quality scan
- Contradiction detection

Wired into heartbeat after `bridge.heartbeatTick`.

---

## CHANGE 10: `snap` Bug Fix

**Location**: `pipelineCommitDTU` — `server/server.js` ~line 12140

**Changed**:
```javascript
// BEFORE (broken — snap was never defined in scope):
p.install = { installedAt: nowISO(), snapshotBefore: snap }

// AFTER (fixed):
p.install = { installedAt: nowISO(), snapshotBefore: null }
```

---

## CHANGE 11: Sovereign Account

- `admin` user renamed to `Concord_Founder_Dutch`, role=`sovereign`
- `Concord_Anchor_Jole` created with role=`admin`
- `SOVEREIGN_USERNAME=Concord_Founder_Dutch` set in `docker-compose.yml`

---

## CHANGE 12: Worker Pool LIGHT_OVERRIDES

**Location**: `server/workers/macro-pool.js` — LIGHT_OVERRIDES set (~line 41)

Added to LIGHT_OVERRIDES so they don't get dispatched to the heavy worker pool:
- `emergent.status`
- `emergent.schema`
- `emergent.patterns`
- `emergent.reputation`

---

## REMAINING WORK

### Frontend Route Scan (High Priority)
- Frontend has ~115 lenses making hundreds of API calls, many still blocked
- **Action**: Scan ALL `api.get`/`api.post` calls in frontend source, extract every route, map to backend macros, add ALL missing routes to the three gates

### Known Bugs
| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Chat lens returns "No response" | Conscious brain LLM route needs wiring | Wire the chat macro to the LLM endpoint |
| `scope/metrics` times out | Macro is computationally heavy | Optimize or add timeout/skip |
| Entity status shows "Unknown" | Frontend checks `e.state` but backend uses `e.active` | Align field names |

---

## Verified Line References (from repo at 37,419 lines)

| Reference | Manifest ~Line | Actual Line | Status |
|-----------|---------------|-------------|--------|
| `authMiddleware` | ~3814 | 3813 | Confirmed |
| `requireRole` | ~3911 | 3899 | Confirmed |
| `safeReadBypass` | ~5740 | 5690-5745 | Confirmed |
| `upsertDTU` | ~8095 | 8065 | Confirmed |
| `pipelineCommitDTU` | ~12000 | 11931 | Confirmed |
| `LIGHT_OVERRIDES` | macro-pool.js | line 41 | Confirmed (already applied) |
