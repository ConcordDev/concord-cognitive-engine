# C — Opportunity Engine Contract

**The proposal substrate.** Detects, scores, classifies, and persists opportunity proposals. **Never auto-acts** — every proposal is a stored candidate awaiting operator review or F0 authority gating.

---

## Purpose

Opportunity Engine answers:
1. **"What opportunities exist right now?"** — Watch signals from all upstream organs
2. **"What's the expected value?"** — Deterministic EV scoring
3. **"What's the action tier?"** — Auto-eligible, propose-only, observe-only
4. **"What was proposed before?"** — Persistence + history

The **daemon-vs-LLM rule** says: C is primarily deterministic. LLM is only invoked at the cognitive boundary (rare). Most opportunity scoring is math.

## Why "never auto-act"

Auto-trading / auto-investing / auto-deploying without operator review is exactly the failure mode the user warned about:
- "Not one of the fleet workers ever completed their job"
- "we don’t really need [LLMs] for majority"

Opportunity Engine **stores proposals, never executes**. Execution requires:
- Operator explicit OK (manual review), OR
- F0 authority gate (trade/deploy/execute authority + verification)

This is the **propose-only** principle.

## The Organ Contract

```
WATCH       — Consume signals from:
                - sentinel_alerts (incidents + alerts)
                - browser_organ observations (rate limits, Coinbase, prices)
                - research_findings (novel patterns)
                - incident_engine outcomes (recovery actions taken)
                - trace_fabric events (errors, slow operations)
   ↓
CLASSIFY    — Map each signal to an opportunity kind:
                - cost_reduction (sentinel says something failing repeatedly)
                - capability_gap (research found missing capability)
                - recovery_optimization (recovery_action worked but slow)
                - signal_anomaly (browser_organ detected price/provider anomaly)
                - data_opportunity (browser_organ sees recurring provider issue)
   ↓
SCORE       — Deterministic EV calculation:
                EV = p_success * upside - p_failure * downside - costs
                where:
                  p_success = signal strength from source
                  upside = expected benefit
                  downside = expected cost (bounded by F0 authority)
                  costs = compute + human review
   ↓
TIER        — Classify by EV + risk:
                tier1: EV > 0.8, low risk, F0 read-only authority (auto-eligible after review)
                tier2: EV 0.4-0.8, medium risk, requires operator OK
                tier3: EV < 0.4 OR high risk, observe only (no action)
   ↓
PROPOSE     — Persist as opportunity_proposal row
                - signal_id (composite key for dedupe)
                - kind, source, summary
                - ev_score, tier, confidence
                - proposed_action (concrete executable step)
                - required_authority (F0 capability name)
                - estimated_cost_usd, estimated_benefit_usd
                - expires_at (when this opportunity is no longer actionable)
                - status: pending | approved | rejected | expired | executed
   ↓
RECORD      — Update opportunity_state (one row per sweep)
                - signals_observed
                - opportunities_proposed
                - opportunities_approved
                - opportunities_rejected
                - alert_level (none | info | warn | critical)
   ↓
NOTIFY      — Tier1/2 → notify operator (telegram)
                Tier3 → silent
```

## EV scoring formula

```python
def compute_ev(signal_strength, upside_usd, downside_usd, costs_usd, time_decay_minutes):
    """
    p_success = signal_strength (0-1, from source-specific computation)
    p_failure = 1 - p_success
    upside    = upside_usd (best case benefit)
    downside  = downside_usd (worst case cost)
    costs     = costs_usd (compute + human review)

    EV = p_success * upside - p_failure * downside - costs

    Time decay: opportunities expire after `time_decay_minutes` minutes
    """
    p_success = max(0, min(1, signal_strength))
    p_failure = 1 - p_success
    ev = p_success * upside_usd - p_failure * downside_usd - costs_usd
    # Normalize to [0, 1]
    ev_normalized = (ev + downside_usd + costs_usd) / (upside_usd + downside_usd + costs_usd) if (upside_usd + downside_usd + costs_usd) > 0 else 0.5
    return ev, ev_normalized
```

## Tier classification

```python
def classify_tier(ev_normalized, downside_usd, required_authority):
    """
    tier1: high EV, low downside, read-only authority required
    tier2: medium EV, medium downside, write authority required
    tier3: low EV OR high downside OR trade/deploy authority required
    """
    if ev_normalized >= 0.8 and downside_usd <= 10 and "read" in required_authority:
        return "tier1"  # Auto-eligible after review
    if ev_normalized >= 0.4 and downside_usd <= 100 and "write" in required_authority:
        return "tier2"  # Requires operator OK
    return "tier3"  # Observe only
```

## Tools exposed (5)

| Tool | Purpose |
|---|---|
| `opportunity_scan` | Run full sweep — consume all upstream signals, score, propose |
| `opportunity_list` | List proposals (with filters: tier, status, since) |
| `opportunity_get` | Get full details of a proposal |
| `opportunity_approve` | Operator approval (changes status pending → approved) |
| `opportunity_reject` | Operator rejection (changes status pending → rejected) |

**No `opportunity_execute`.** Execution is gated by F0 authority and requires either operator manual call or future initiative engine (F phase). C **stores proposals** only.

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/opportunity.db`:

```sql
CREATE TABLE opportunity_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    signals_observed INTEGER NOT NULL DEFAULT 0,
    signals_processed INTEGER NOT NULL DEFAULT 0,
    opportunities_proposed INTEGER NOT NULL DEFAULT 0,
    opportunities_tier1 INTEGER NOT NULL DEFAULT 0,
    opportunities_tier2 INTEGER NOT NULL DEFAULT 0,
    opportunities_tier3 INTEGER NOT NULL DEFAULT 0,
    alert_level TEXT NOT NULL DEFAULT 'none',
    alert_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE opportunity_proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER REFERENCES opportunity_state(id),
    signal_id TEXT NOT NULL,                  -- composite: source + signature
    kind TEXT NOT NULL,                        -- cost_reduction, capability_gap, etc.
    source TEXT NOT NULL,                      -- sentinel, browser_organ, research, incident, trace_fabric
    source_signal TEXT NOT NULL,               -- JSON of the original signal
    summary TEXT NOT NULL,                     -- human-readable summary
    ev_usd REAL NOT NULL,                      -- expected value in USD
    ev_normalized REAL NOT NULL,               -- 0-1 normalized
    p_success REAL NOT NULL,                   -- probability of success
    upside_usd REAL NOT NULL,
    downside_usd REAL NOT NULL,
    costs_usd REAL NOT NULL,
    tier TEXT NOT NULL,                        -- tier1 | tier2 | tier3
    confidence REAL NOT NULL,                  -- 0-1
    proposed_action TEXT NOT NULL,             -- concrete step
    required_authority TEXT NOT NULL,          -- F0 capability name (e.g., "browser.check_coins")
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | approved | rejected | expired | executed
    approved_at TEXT,
    approved_by TEXT,
    rejection_reason TEXT,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_opportunity_proposals_pending ON opportunity_proposals(status, tier, ev_normalized DESC);
CREATE INDEX idx_opportunity_proposals_recent ON opportunity_proposals(created_at DESC);
```

## Integration with F0

Every `opportunity_*` tool goes through F0 dispatch:
- `opportunity_scan` — write (creates proposals)
- `opportunity_list`, `opportunity_get` — read (query state)
- `opportunity_approve`, `opportunity_reject` — write (modify state)

Approval/rejection requires operator identity (mcp-anonymous is auto-rejected by F0 capability gate unless `observe: true` is sufficient).

## What an opportunity looks like

```json
{
  "id": 7,
  "kind": "cost_reduction",
  "source": "browser_organ",
  "summary": "Coinbase free tier rate limit hit 4x in last hour; upgrading to paid tier saves 30min latency",
  "ev_usd": 12.50,
  "ev_normalized": 0.82,
  "p_success": 0.85,
  "upside_usd": 50.00,
  "downside_usd": 5.00,
  "costs_usd": 1.50,
  "tier": "tier1",
  "confidence": 0.7,
  "proposed_action": "Subscribe to Coinbase Advanced Trade API ($29/mo) to bypass free-tier rate limits",
  "required_authority": "billing.subscribe",
  "expires_at": "2026-09-07T00:00:00Z",
  "status": "pending",
  "trace_id": "opp-scan-20260831-150012-7"
}
```

## Verification (C.5)

Independent evaluator test:
- `opportunity_scan` returns at least one proposal from real signals
- `opportunity_list` returns proposals filtered by tier/status
- `opportunity_approve` transitions status pending → approved
- `opportunity_reject` transitions status pending → rejected
- Tier classification is reproducible (same inputs → same tier)
- No auto-execute (no `opportunity_execute` tool exists)
- EV calculation deterministic (same inputs → same EV)

## Stop list

- Do NOT create `opportunity_execute` tool
- Do NOT auto-approve tier1 opportunities
- Do NOT bypass F0 for opportunity tools
- Do NOT invoke LLM for tier3 opportunities (observe only)
- Do NOT propose opportunities without grounding in real signals
- Do NOT propose duplicate opportunities within 1 hour

## Daemon-vs-LLM status

Opportunity Engine is **purely deterministic**:
- Signal watching: deterministic DB queries
- Classification: deterministic pattern matching
- EV scoring: deterministic math
- Tier classification: deterministic thresholds
- Persistence: deterministic SQL
- Approval/rejection: explicit operator action (no LLM)

LLM is never invoked by C. If a proposal needs interpretation, the operator can use Research Frontier (D) to research it.

## What's next after C

Once proposals are stored, the next phase (F — Initiative Engine) would:
- Read proposals from opportunity_proposals
- Apply risk kernel gates (spec_engine already has this)
- Submit to F0 for execution IF approved status
- Track execution outcomes

C is the **propose half**. F is the **execute half**. C must complete first.