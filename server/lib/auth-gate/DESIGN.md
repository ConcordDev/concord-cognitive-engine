# F0.2 — Dispatch Chokepoint Design

## Problem

Concord has two MCP entry paths that bypass the existing authority infrastructure:

1. **REST** — `app.post("/mcp/call")` at `server/server.js:36733-36747`
   ```js
   const result = await callMCPTool(db, tool, args || {}, globalThis.STATE || null);
   ```

2. **JSON-RPC** — `app.post("/api/mcp")` → `createMCPServer` → `handleToolsCall` at `server/lib/mcp-server.js`

Both call tool handlers directly with no:
- Capability Registry lookup
- Sovereignty Invariants check
- Refusal Field check
- Provenance Guard `screenAction`
- Risk tier enforcement
- Trace ID / audit emission
- Verification post-condition probe
- Idempotency check
- 5-decision outcome (ALLOW/DENY/DEFER/OBSERVE/ESCALATE)

The existing `lib/runtime/execution-envelope.js::runCapability(request)` already does:
- Capability Registry lookup
- Health gate
- Audit emission (`capability.invoked`, `capability.failed`, `capability.completed`)
- Trace ID generation
- Structured result envelope

…but is **not wired into the dispatch path**. It is currently used by other consumers (heartbeats, agents) but not the MCP chokepoint.

## Design

### Architecture: composition, not replacement

```
HTTP/JSON-RPC request
        │
        ↓
[EXISTING] routes/mcp.js::authorizeToolCall(req, toolName)         ← HTTP gate
        │
        ↓
[NEW]     lib/auth-gate/dispatch.js::dispatchMCP(tool, args, ctx)  ← orchestration
        │
        ├── [NEW] AuthGate.evaluate(envelope)                       ← auth composition
        │     ├── sovereingty_hard_veto (existing)
        │     ├── capability_existence (existing)
        │     ├── risk_classification (existing)
        │     ├── refusal_field (existing)
        │     ├── provenance_guard.screenAction (existing)
        │     ├── expiration_ttl (NEW)
        │     ├── preconditions (NEW)
        │     └── idempotency (NEW)
        │
        ├── [DECISION] ALLOW | DENY | DEFER | OBSERVE | ESCALATE
        │
        ├── [EXISTING] callMCPTool(db, tool, args, STATE)           ← tool dispatch
        │
        ├── [NEW] verification probe                                ← post-condition
        │
        └── [EXISTING] event-bus publish                             ← audit
```

### Single integration point

`server/server.js:36742` becomes:
```js
const result = await dispatchMCP(tool, args || {}, {
  actor: req.user,
  req,
  db,
  STATE: globalThis.STATE,
  trace_id: req.headers['x-trace-id'] || null,  // OTel-style pass-through
});
res.json(result);
```

`server/lib/mcp-server.js::handleToolsCall` becomes:
```js
const result = await dispatchMCP(name, args, {
  actor: req?.user,
  req,
  db,
  STATE: globalThis.STATE,
  trace_id: req?.headers?.['x-trace-id'] || null,
});
```

### Where the new module lives

```
server/lib/auth-gate/
├── authority-map.json        ← F0.1 (DONE)
├── envelope.js               ← F0.4 (envelope construction)
├── dispatch.js               ← F0.2 + F0.5 (chokepoint)
├── index.js                  ← F0.3 (AuthGate.evaluate)
├── gates/                    ← 10 modules (not eight; risk is inline in evaluate)
│   ├── sovereignty.js        ← wraps sovereignty_invariants
│   ├── capability.js         ← wraps capability-registry (+ risk escalate inline)
│   ├── refusal.js            ← wraps refusal-field
│   ├── provenance.js         ← wraps provenance-guard.screenAction
│   ├── expiration.js         ← TTL check
│   ├── preconditions.js      ← state check
│   ├── idempotency.js        ← replay protection
│   ├── resource.js           ← budget / resource limits
│   ├── rollback.js           ← mutation rollback spec
│   └── verification.js       ← post-condition probe (dispatch, not evaluate)
└── INTERFACE.md              ← F0.8
```

### Critical design rules

1. **No policy in auth-gate.** Auth-gate calls existing systems. It does not decide.
2. **No replacement.** `callMCPTool`, `runCapability`, `authorizeToolCall` all stay. Auth-gate wraps them.
3. **Single integration point.** Server.js:36742 + mcp-server.js::handleToolsCall. Two lines changed.
4. **Observe-only mode first.** Auth-gate starts logging decisions, not enforcing. Feature flag controls.
5. **Existing audit wins.** Use event-bus publish for capability.{invoked,failed,completed} as execution-envelope.js already does.
6. **Sovereign is bypass-safe.** ESCALATE routes to existing governance proposal/vote flow. Never bypass.

### The envelope shape (F0.4 deliverable)

```js
{
  WHO:        "hermes-agent",
  WHAT:       "web_search",
  WHY:        null,                           // or initiative_id etc.
  SCOPE:      [],                              // resource paths
  RESOURCE:   { compute_budget: null, financial_budget: null, ... },
  RISK:       "read",                         // mapped from capability registry
  AUTHORITY:  { observe: true, read: true, write: false, ... },
  EXPIRATION: null,                           // ISO timestamp
  PRECONDITIONS: {},
  VERIFICATION: { kind: "result_shape", params: {...} },
  ROLLBACK:   null,                           // required for mutations
  PROVENANCE: { origin: "user", parent_trace_id: null, ... },
  TRACE_ID:   "uuid-here",
  DECISION:   null,                           // populated by evaluate()
}
```

### The 5 decision outcomes (FROZEN enum)

```js
const DECISION = Object.freeze({
  ALLOW:     "ALLOW",     // Proceed. Handler may execute.
  DENY:      "DENY",      // Reject. No execution. reason_code required.
  DEFER:     "DEFER",     // Conditions not favorable. Caller may retry.
  OBSERVE:   "OBSERVE",   // Watch but don't act. Recorded.
  ESCALATE:  "ESCALATE",  // Route to Sovereign/Governance.
});
```

### Evaluation order (matches authority-map.json)

1. HTTP gate (routes/mcp.js::authorizeToolCall)
2. Sovereignty hard veto
3. Capability existence + health
4. Risk classification (high → ESCALATE)
5. Refusal field
6. Provenance action-time (screenAction)
7. Expiration TTL (NEW)
8. Preconditions (NEW)
9. Idempotency (NEW)
10. → ALLOW → callMCPTool
11. Verification probe (NEW)
12. Audit emission (event-bus)
13. Event → DTU bridge

### Idempotency strategy

Hash = sha256(tool + canonicalize(args) + trace_id). Stored in `auth_gate_idempotency` table:
- (trace_id, hash, expires_at) → first execution succeeds, subsequent with same trace_id return cached result
- Replay attack (different trace_id, same hash, within idempotency window) → DENY with reason_code `replay_detected`

### Expiration strategy

If envelope.EXPIRATION is set and < now → DENY with reason_code `authority_expired`.
If unset → use default_ttl (configurable, default 5 minutes for ad-hoc, 24h for initiatives).

### Verification probe

After callMCPTool returns:
- If VERIFICATION.kind is null → no probe, accept result as-is
- If `kind: "result_shape"` → check result matches schema
- If `kind: "dtu_exists"` → query DB for DTU created by this trace_id
- If `kind: "state_match"` → query state store for expected post-state
- If probe fails → return result with status: "error", reason_code: "verification_failed" (the tool ran but objective not achieved)

### Backwards compatibility

Existing 77 tools continue working unchanged. AuthGate is a wrapper, not a replacement. In observe-only mode, all 77 tools pass through; AuthGate logs decision per call without denying.

## Deliverables for next steps

- F0.3: `lib/auth-gate/index.js` — `evaluate(envelope) → {decision, reason_code, ...}`
- F0.4: `lib/auth-gate/envelope.js` — `buildEnvelope(tool, args, ctx) → envelope`
- F0.5: `lib/auth-gate/dispatch.js` — `dispatchMCP(tool, args, ctx) → result`

Then F0.5 wires them into server.js:36742 and mcp-server.js::handleToolsCall.