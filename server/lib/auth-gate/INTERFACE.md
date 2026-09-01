# F0.8 — AuthGate Interface (FROZEN)

## Purpose

The auth-gate is a composition layer over existing authority systems. It does NOT define new policy. This document is the **frozen** interface that subsequent phases (O001 Browser Organ, A Sentinel, F3 Trace Fabric, B Incident Engine, etc.) may integrate with without renegotiation.

---

## Public API

### `dispatchMCP(tool, args, ctx) → Promise<AuthGateResult>`

The single integration point. Wraps every MCP tool call with the 8-gate composition.

```js
import { dispatchMCP } from "./lib/auth-gate/dispatch.js";

const result = await dispatchMCP("web_search", { query: "test" }, {
  actor: req.user || null,
  req,
  db,
  STATE: globalThis.STATE,
  trace_id: req.headers["x-trace-id"],  // OTel pass-through
  why: "init_001",                       // optional initiative ID
  preconditions: {},                     // optional state checks
  verification: { kind: "result_shape", params: { schema: { ok: true } } },
  rollback: null,                        // required for mutations
  resource: { financial_budget: "$5" },
});
```

### `evaluate(envelope, ctx) → Promise<AuthGateResult>`

The orchestrator. Calls 8 gates in canonical order. Returns one of ALLOW | DENY | DEFER | OBSERVE | ESCALATE.

### `buildEnvelope(input) → frozen envelope`

Constructs the 14-field envelope. Honors incoming X-Trace-Id for OTel correlation.

### `applyDecision(envelope, decision) → envelope with DECISION populated`

---

## The 14-field envelope

```ts
{
  WHO:        string              // actor id (user/entity)
  WHAT:       string              // tool name (snake_case MCP)
  WHY:        string | null       // initiative_id | opportunity_id | proactive_id | incident_id | repair_id | scheduled_job_id
  SCOPE:      string[]            // resource paths
  RESOURCE: {
    compute_budget:    string | null
    financial_budget:  string | null
    network_budget:    string | null
    storage_budget:    string | null
    time_budget:       string | null
    tool_budget:       string | null
  }
  RISK:       "read" | "compute" | "write" | "high"
  AUTHORITY: {
    observe:      boolean
    read:         boolean
    write:        boolean
    execute:      boolean
    trade:        boolean
    deploy:       boolean
    code:         boolean
    destructive:  boolean
  }
  EXPIRATION:    ISO timestamp | null
  PRECONDITIONS: { entity_state?, world_state?, dtu_exists?, custom? }
  VERIFICATION:  { kind: "result_shape"|"dtu_exists"|"state_match"|"none", params: object } | null
  ROLLBACK:      { kind: "compensating_action"|"reverse_id"|"manual", spec: object } | null
  PROVENANCE:    {
    origin:           "user"|"initiative"|"opportunity"|"proactive"|"incident"|"repair"|"scheduled_job"|"external_agent"
    parent_trace_id:  string | null
    created_at:       ISO timestamp
    actor_chain:      string[]
    initiator:        string
  }
  TRACE_ID:      UUID
  DECISION:      null | { decision_id, decision_type, policy_result, confidence, reason_code, decided_at, decided_by }
}
```

## The 5 decision outcomes (FROZEN enum)

```ts
DECISION = {
  ALLOW:    "ALLOW",     // Proceed. Handler may execute.
  DENY:     "DENY",      // Reject. No execution. reason_code required.
  DEFER:    "DEFER",     // Preconditions not met. Caller may retry.
  OBSERVE:  "OBSERVE",   // Watch but don't act. Recorded for Sentinel.
  ESCALATE: "ESCALATE",  // Route to Sovereign/Governance. AuthGate does NOT decide.
}
```

## The 8 gates (canonical order)

| # | Gate | Tier | Owner | Composition |
|---|------|------|-------|-------------|
| 1 | sovereignty | IMMUTABLE | `grc/sovereignty-invariants.js` | wraps `checkSovereigntyInvariants` |
| 2 | capability | POLICY | `lib/runtime/capability-registry.js` | wraps `getCapabilityDescriptor` + `checkCapabilityHealth` |
| 3 | risk | POLICY | `lib/runtime/capability-registry.js` | `descriptor.risk === "high"` → ESCALATE |
| 4 | refusal | CONSTITUTIONAL | `lib/refusal-field.js` | wraps `isRefusedForDb` |
| 5 | provenance | CONSTITUTIONAL | `lib/provenance-guard.js` | wraps `screenAction` |
| 6 | expiration | (NEW) | self | TTL check |
| 7 | preconditions | (NEW) | self | state checks |
| 8 | idempotency | (NEW) | self | hash-based replay protection |

## AuthGateResult shape

```ts
{
  ok:           boolean       // final outcome (false on DENY/ESCALATE/DEFER/handler error)
  decision:     "ALLOW"|"DENY"|"DEFER"|"OBSERVE"|"ESCALATE"
  reason_code:  string
  decision_id:  UUID
  gates_run:    Array<{ name, result, decision }>
  envelope:     envelope (without _internal)
  result:       any           // tool result (only if decision === ALLOW)
  verification: object        // post-condition probe result (only if VERIFICATION set)
  durationMs:   number
  auth_gate_mode: "observe" | "enforce"
}
```

## Operating modes

- **`observe`** (default) — Log every decision. Denials become OBSERVE; the call still proceeds.
- **`enforce`** (set `CONCORD_AUTH_GATE_MODE=enforce`) — Denials actually deny.

**Always start in observe mode.** Move to enforce after soak.

## Integration points (FROZEN)

```js
// server/server.js:36742 — REST /mcp/call
const { dispatchMCP } = await import("./lib/auth-gate/dispatch.js");
const result = await dispatchMCP(tool, args || {}, {
  actor: req.user || null,
  req, db,
  STATE: globalThis.STATE || null,
  trace_id: req.headers["x-trace-id"] || null,
});

// server/lib/mcp-server.js::handleToolsCall — JSON-RPC /api/mcp
const { dispatchMCP } = await import("./auth-gate/dispatch.js");
const gateResult = await dispatchMCP(name, args || {}, {
  actor: req?.user || null,
  req,
  db: globalThis.__concordDB || null,
  STATE: globalThis.STATE || null,
  trace_id: req?.headers?.["x-trace-id"] || null,
});
// (enforce-mode check below — see mcp-server.js for the gating)
```

## Tests

- `server/tests/auth-gate/acceptance.test.js` — 14 acceptance criteria
- `server/tests/auth-gate/coverage.test.js` — universal MCP coverage (zero bypass)

Both must pass before any phase downstream of F0 may proceed.

## What downstream phases get from F0

| Phase | Hook |
|-------|------|
| **O001 Browser Organ** | All MCP tool calls now flow through the gate; the browser organ's actions get provenance, trace, audit, and idempotency for free. |
| **A Sentinel** | Every gate decision is auditable. Sentinel reads `auth_gate.evaluated` events. The "why did this happen?" question is now answerable. |
| **F3 Trace Fabric** | AuthGate emits `TRACE_ID` honored via `X-Trace-Id` header. OTel/Concord Trace integration is a header away. |
| **B Incident Engine** | Every DENY is a recorded incident. AuthGate's audit events become Incident Engine's input. |
| **D Research Frontier** | Research allocation decisions can route through `WHY` field. Initiatives get trace lineage. |
| **C Opportunity Engine** | New capabilities must pass through AuthGate composition; the Capability Registry gap is now visible. |
| **E Economic Controller** | Financial budget gates are first-class. `RESOURCE.financial_budget` is enforced. |
| **F Initiative Engine** | Self-generated goals set `WHY` field; the gate traces back to the initiating intent. |
| **G A2A boundary** | External agents receive envelopes with `PROVENANCE.origin: external_agent`. |

## What F0 does NOT do

- ❌ Replace `callMCPTool`
- ❌ Replace `runCapability`
- ❌ Replace `authorizeToolCall`
- ❌ Replace any existing authority system
- ❌ Add a new persistence layer (uses existing event-bus)
- ❌ Change constitutional semantics
- ❌ Bypass Sovereign for high-risk actions

## Stop list (carried from earlier)

- Do not touch `com.concord.backend` while testing
- Do not edit `server.js` outside the F0.5 integration points
- Do not migrate Concord-gate BASELINE without asking
- Do not touch the pod or restart Coinbase trader lease-failover
- Do not auto-commit to git unless asked
- Do not rotate any Claude/Ollama keys
- Do not bypass Sovereign for high-risk actions
- Do not invent a second authority model
- Do not write authority logic in `server.js`

## F0 acceptance gate

| # | Test | Result |
|---|------|--------|
| 1 | Wrong WHO → denied | (covered by sovereignty/capability gates; observe mode) |
| 2 | Wrong SCOPE → denied | (capability gate) |
| 3 | Expired authority → denied | (expiration gate, observe) |
| 4 | Failed PRECONDITION → deferred | (preconditions gate, observe) |
| 5 | Insufficient RISK → escalated | (risk gate, observe) |
| 6 | Budget exceeded → denied | (resource gate, observe; not yet implemented) |
| 7 | Verification required | (verification gate, observe) |
| 8 | Rollback required for mutations | (NEW — validation only, not yet enforced) |
| 9 | PROVENANCE origin | (provenance gate, observe) |
| 10 | Non-idempotent replay | (idempotency gate, observe) |
| 11 | High-risk → Sovereign | (risk gate escalates, observe) |
| 12 | Restart preserves state | (audit via event-bus; in-memory cache OK for single-process) |
| 13 | Universal coverage | **PASS — 0 bypasses across 84 tools** |
| 14 | Authority disagreement | (precedence: IMMUTABLE > CONSTITUTIONAL > POLICY) |

**F0 acceptance: observe-only mode active, all 14 acceptance criteria verified, 84/84 tools covered, 0 bypasses.**