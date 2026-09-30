# F — Initiative Engine Contract

**The composition + submission substrate.** Reads approved opportunities + proactive predictions, composes them into F0-submittable proposals, validates against authority gates, tracks execution. **Never auto-executes** — every submission requires F0 authority gate.

---

## Purpose

Initiative Engine answers:
1. **"What should we do?"** — Compose approved opportunities into actionable proposals
2. **"Can we do it?"** — Validate required authority + dependencies + budget
3. **"Did it work?"** — Track execution outcomes back to opportunity_proposals

The **daemon-vs-LLM rule** says: F is **primarily deterministic**. Validation = boolean checks, composition = template substitution, submission = HTTP call to F0.

## Why "never auto-execute"

This is the **single most critical contract** in the system:
- Wallet operations require explicit intent
- Trade execution is destructive (cannot undo)
- Composition must be transparent to operator
- F0 authority gate is the ONLY path to execution

The chain: `READ (C, C.5) → COMPOSE (F) → SUBMIT (F0) → EXECUTE (target) → RECORD (C, E)`

**Every step is F0-gated. F itself only proposes — F0 executes.**

## The Organ Contract

```
READ         — Pull from upstream:
                - opportunity_proposals WHERE status = 'approved' (C)
                - proactive_predictions WHERE horizon IN ('near', 'soon') (C.5)
                - economic_check safe_to_proceed (E)
   ↓
COMPOSE      — For each approved opportunity:
                - Source: opportunity_id + kind + summary
                - Target: derived from opportunity.required_authority
                - Action: derived from opportunity.proposed_action
                - Risk: derived from authority gate required
                - Required capabilities: list of MCP tools needed
                - Dependencies: other initiatives queued
                - Estimated cost: USD from E
   ↓
VALIDATE     — Deterministic checks:
                - Authority: opportunity.required_authority exists in capability registry?
                - Dependencies: all dependent initiatives ready?
                - Budget: economic_check.safe_to_proceed == true?
                - Idempotency: not already submitted?
                - Risk: read/write/execute matches capability?
   ↓
SUBMIT       — For each validated initiative:
                - Generate F0 envelope (decision_id, trace_id, gates_run)
                - Call F0 authority gate (read-only by default)
                - If F0 approves: persist as ready
                - If F0 denies: persist as blocked (with reason_code)
                - Notify operator via Telegram for any execute/trade/deploy
   ↓
TRACK        — Update initiative_state:
                - initiatives_composed
                - initiatives_validated
                - initiatives_submitted
                - initiatives_approved_by_f0
                - initiatives_blocked_by_f0
                - initiatives_executed (manual confirmation)
                - alert_level
```

## Tools exposed (6)

| Tool | Purpose | Risk |
|---|---|---|
| `initiative_compose` | READ approved opportunities + compose into initiatives | read |
| `initiative_list` | List initiatives (with filters: status, source) | read |
| `initiative_get` | Get full initiative details | read |
| `initiative_validate` | Validate a specific initiative | read |
| `initiative_submit` | Submit initiative to F0 authority gate | write |
| `initiative_record_execution` | Operator records execution outcome (manual) | write |

**No `initiative_execute`.** Initiative is composition + submission. Execution is F0's job + operator confirmation.

## Submission semantics

```
initiative_submit(initiative_id):
  1. Re-validate (gates may have changed)
  2. Generate F0 envelope
  3. Call F0:
     - sovereignty check
     - capability check (tool must be registered)
     - refusal check (no prompt injection)
     - provenance check (trace_id valid)
     - expiration check (5min window)
     - preconditions check (deps met)
  4. If F0 returns ALLOW + observation has no errors:
     - status = "submitted" (waiting for execution)
     - Notify operator via Telegram (execute/trade/deploy only)
  5. If F0 returns DENY:
     - status = "blocked"
     - reason_code persisted
     - No notification (operator can query)
```

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/initiative.db`:

```sql
CREATE TABLE initiative_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    sources_observed INTEGER NOT NULL DEFAULT 0,
    initiatives_composed INTEGER NOT NULL DEFAULT 0,
    initiatives_validated INTEGER NOT NULL DEFAULT 0,
    initiatives_submitted INTEGER NOT NULL DEFAULT 0,
    initiatives_approved_by_f0 INTEGER NOT NULL DEFAULT 0,
    initiatives_blocked_by_f0 INTEGER NOT NULL DEFAULT 0,
    alert_level TEXT NOT NULL DEFAULT 'none',
    alert_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE initiative_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER,
    initiative_id TEXT NOT NULL,        -- composite: source + source_id + hash
    source TEXT NOT NULL,                -- opportunity | proactive | manual
    source_id INTEGER NOT NULL,          -- opportunity_proposals.id or proactive_predictions.id
    kind TEXT NOT NULL,                  -- recovery_optimization, capability_gap, etc.
    summary TEXT NOT NULL,
    target_tool TEXT,                    -- which MCP tool to call
    target_args_json TEXT,               -- args to pass
    required_authority TEXT,             -- read | write | execute | trade | deploy
    estimated_cost_usd REAL,
    risk_level TEXT NOT NULL DEFAULT 'low',
    dependencies_json TEXT,              -- other initiative_ids required first
    status TEXT NOT NULL DEFAULT 'composed',  -- composed | validated | submitted | blocked | executed | failed
    f0_decision_id TEXT,
    f0_reason_code TEXT,
    f0_envelope_json TEXT,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source, source_id, initiative_id)
);

CREATE INDEX idx_initiative_proposals_status
    ON initiative_proposals(status);
CREATE INDEX idx_initiative_proposals_authority
    ON initiative_proposals(required_authority);
```

## Validation rules

```python
def validate_initiative(initiative, f0_gates, economic_check):
    checks = []
    # 1. Authority: required_authority must be in capability registry
    if initiative.required_authority not in CAPABILITY_AUTHORITIES:
        checks.append(("FAIL", "unknown_authority", f"{initiative.required_authority} not in capability registry"))
    else:
        checks.append(("PASS", "authority_known", f"{initiative.required_authority} is registered"))

    # 2. Budget: economic_check must allow new spend
    if economic_check.get("safe_to_proceed") == False:
        checks.append(("FAIL", "budget_blocked", economic_check.get("reason", "budget blocked")))
    elif initiative.required_authority in ("execute", "trade", "deploy"):
        # High-risk actions require explicit budget allowance
        checks.append(("PASS", "budget_checked", "budget allows high-risk action"))
    else:
        checks.append(("PASS", "budget_checked", "budget allows"))

    # 3. Dependencies: all required deps must be ready
    deps = initiative.dependencies or []
    unmet = [d for d in deps if d.status not in ("executed", "ready")]
    if unmet:
        checks.append(("FAIL", "deps_unmet", f"unmet deps: {unmet}"))
    else:
        checks.append(("PASS", "deps_ready", f"{len(deps)} deps ready"))

    # 4. Idempotency: not already submitted (same source+source_id)
    # (This is enforced by UNIQUE constraint, so it's a DB-level check)

    # 5. Risk: high-risk actions require operator notification
    if initiative.required_authority in ("execute", "trade", "deploy"):
        checks.append(("INFO", "operator_notification_required", "Will notify operator via Telegram"))
    else:
        checks.append(("PASS", "no_notification_needed", "Read-only"))

    return checks
```

## F0 submission envelope

```python
def submit_to_f0(initiative):
    """Returns (decision, envelope_json, error)."""
    envelope = {
        "tool": initiative.target_tool,
        "args": json.loads(initiative.target_args_json or "{}"),
        "decision_id": str(uuid.uuid4()),
        "trace_id": initiative.trace_id,
        "authority_required": {
            "execute": initiative.required_authority == "execute",
            "trade": initiative.required_authority == "trade",
            "deploy": initiative.required_authority == "deploy",
            "write": initiative.required_authority == "write",
            "read": initiative.required_authority == "read",
            "destructive": False,
        },
        "tier0_dry_run": True,  # ALWAYS dry-run first — operator must confirm execute
    }

    # POST to F0 (concord backend)
    response = http_post("http://127.0.0.1:5050/mcp/call", envelope)
    return response
```

## Integration with F0

Every `initiative_*` tool goes through F0 dispatch:
- `initiative_compose`, `initiative_list`, `initiative_get` — read
- `initiative_validate` — read (validates against F0 capability registry)
- `initiative_submit` — write (but F0 authority-gated)
- `initiative_record_execution` — write (operator confirmation only)

F **never bypasses F0**. F composes + submits. F0 decides.

## Composition rules (deterministic mapping)

```
opportunity.kind → initiative.target_tool mapping:
  cost_reduction          → browser.check_rate_limits
  recovery_optimization   → browser.check_coins
  capability_gap          → research.get (read-only)
  security_review         → browser.check_auth
  data_opportunity        → economic.snapshot (read-only)

proactive.kind → initiative.target_tool mapping:
  rate_limit_imminent     → browser.check_rate_limits (warn only)
  recovery_recurring      → incident.history
  opportunity_cluster     → opportunity.list (read-only)
  sentinel_alert_growing  → sentinel.review_alerts
  provider_degrading      → browser.check_rate_limits
  dedupe_pending          → opportunity.list
```

High-risk target_tools (require execute/trade/deploy authority):
- (None in the initial mapping — all are read-only diagnostics)

## Stop list

- Do NOT create `initiative_execute` (F0 does that)
- Do NOT bypass F0 authority gate
- Do NOT auto-promote pending initiatives to submitted without operator action
- Do NOT compose initiatives from non-approved opportunities
- Do NOT compose initiatives from far-horizon predictions
- Do NOT invoke LLM for composition (deterministic template substitution)
- Do NOT execute high-risk actions even if F0 allows (operator must confirm)

## Daemon-vs-LLM status

Initiative Engine is **primarily deterministic**:
- Composition: opportunity_kind → target_tool mapping (lookup table)
- Validation: boolean checks (authority, budget, deps)
- Submission: HTTP call to F0
- Tracking: SQL updates
- LLM invocation: zero

If a complex initiative needs interpretation (e.g., "should we run this trade?"), operator uses Research Frontier.

## What's next after F

Once F is built, the next phase (F.5 — Capability Forge) would:
- Take F execution outcomes
- Convert successful patterns into reusable capabilities
- Register new capabilities in the registry

Then G (A2A boundary) handles inter-agent communication, and H (Experience-to-learning) handles long-term memory.

The complete loop:
```
WATCH (Sentinel) → DETECT (Incident)
                → PROPOSE (Opportunity) [operator approves]
                → PREDICT (Proactive)
                → COMPOSE+SUBMIT (Initiative) [F0 gate]
                → EXECUTE (F0 → target organ)
                → RECORD (Economic Controller reads outcome)
                → Attribution flows back to E
```

F is the **handoff from proposal to execution**. Critical: F0 is sacred.