# E — Economic Controller Contract

**The capital-efficiency substrate.** Aggregates costs, fees, P&L, and budget state across all organs. **Never auto-trades** — every economic observation is a read, no side effects on wallets or accounts.

---

## Purpose

Economic Controller answers:
1. **"How much have we spent?"** — Per-organ cost attribution
2. **"What is our budget state?"** — Cloudflare budget, OpenCode quota, fee drag
3. **"What is our net P&L?"** — Trading P&L ex-airdrops, fee drag decomposition
4. **"What would the operator want to know?"** — Read-only audit reports

The **daemon-vs-LLM rule** says: E is **purely deterministic aggregation**. No LLM required for arithmetic, classification, or budget projections.

## Why "never auto-trade"

- Wallet APIs require explicit user intent and approval
- Trading belongs to v10 trader + F0 authority gate, not E
- E exists to **inform**, not to **act**

## The Organ Contract

```
WATCH        — Pull state from upstream sources:
                 - cf-budget-tracker.json (Cloudflare neurons/cost)
                 - resource_budget.json (per-model cost estimates)
                 - trade_economics.py output (trader v10 P&L, fee ratio)
                 - decision_ledger.py output (trader decisions)
                 - capital_ledger.py output (capital state)
                 - v10_daily_pnl.json (trading P&L)
                 - research_roi_ledger.json (research ROI)
                 - browser_organ observations (wallet balances from Coinbase)
   ↓
TRACK        — Compute totals:
                 - total_spend_usd (CF + OpenCode + paid models)
                 - total_pnl_usd (trader v10 net, ex-airdrops)
                 - fee_drag_usd (Coinbase fees paid)
                 - airdrop_income_usd (separate line)
                 - net_pnl_ex_airdrops (real P&L)
   ↓
ATTRIBUTE    — Per-organ cost attribution:
                 - trace_fabric cost (LLM spend for trace generation)
                 - research_frontier cost (LLM spend for findings)
                 - opportunity_engine cost (no LLM, ~0)
                 - proactive_engine cost (no LLM, ~0)
                 - sentinel cost (no LLM, ~0)
                 - browser_organ cost (HTTP requests, ~0)
                 - cf_budget_direct (Cloudflare direct calls)
   ↓
REPORT       — economic_report:
                 - summary: total_spend, total_pnl, net_pnl_ex_airdrops
                 - per_organ_breakdown: array
                 - fee_drag: array of fee events
                 - budget_state: cf_daily_pct, cf_monthly_pct, opencode_quota_pct
   ↓
GATE         — budget_check:
                 - cf_daily_ok / cf_daily_warn / cf_daily_block
                 - opencode_quota_ok / opencode_quota_exhausted
                 - net_pnl_negative_threshold
                 - recommended_action (continue | throttle | halt_optional | alert)
```

## Tools exposed (6)

| Tool | Purpose | Risk |
|---|---|---|
| `economic_snapshot` | Full unified snapshot: budget + costs + P&L + attribution | read |
| `economic_budget` | Just budget state (CF daily/monthly, OpenCode quota) | read |
| `economic_costs` | Per-organ cost attribution for window | read |
| `economic_pnl` | Trading P&L ex-airdrops with fee drag breakdown | read |
| `economic_attribution` | Map specific costs to specific organs | read |
| `economic_check` | Budget gate: is it safe to proceed with new spend? | read |

**No `economic_act`, `economic_trade`, `economic_pay`.** E is read-only.

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/economic.db`:

```sql
CREATE TABLE economic_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_at TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    total_spend_usd REAL,
    total_pnl_usd REAL,
    net_pnl_ex_airdrops REAL,
    fee_drag_usd REAL,
    airdrop_income_usd REAL,
    budget_alert_level TEXT NOT NULL DEFAULT 'none',
    alert_reason TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE economic_costs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER,
    organ TEXT NOT NULL,
    category TEXT NOT NULL,         -- llm_spend | http_request | trade_fee | api_call
    amount_usd REAL NOT NULL,
    period_start TEXT,
    period_end TEXT,
    source TEXT NOT NULL,           -- cf_budget | resource_budget | trade_ledger | browser_organ
    details_json TEXT,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE economic_pnl (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state_id INTEGER,
    period TEXT NOT NULL,           -- YYYY-MM-DD
    trading_pnl_usd REAL,
    fee_drag_usd REAL,
    airdrop_income_usd REAL,
    net_pnl_ex_airdrops REAL,
    source TEXT NOT NULL,
    trace_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(period, source)
);

CREATE INDEX idx_economic_costs_organ ON economic_costs(organ, period_start);
CREATE INDEX idx_economic_pnl_period ON economic_pnl(period);
```

## Sources (read-only)

| Source | Path | What it provides |
|---|---|---|
| Cloudflare Budget | `~/.hermes/state/cf-budget.json` | daily/monthly neurons + $ cost |
| Resource Budget | `~/.hermes/dila-tools/resource_budget.json` | per-model cost log |
| Trader daily P&L | `~/.hermes/dila-tools/trading/v10_daily_pnl.json` | trading P&L by date |
| Decision ledger | `~/.hermes/dila-tools/trading/decision_ledger.json` | per-trade decisions |
| Capital ledger | `~/.hermes/dila-tools/trading/capital_ledger.json` | capital state |
| Research ROI ledger | `~/.hermes/dila-tools/trading/research_roi_ledger.json` | research ROI |
| Browser Organ DB | `~/.local/share/concord/browser_organ.db` | coin balances, fee events |

## Budget gate rules

```python
def economic_check(cf_daily_pct, cf_monthly_pct, opencode_quota_pct, net_pnl):
    if cf_daily_pct >= 100:
        return ("halt_optional", "CF daily limit reached — no new CF calls")
    if cf_monthly_pct >= 100:
        return ("halt_optional", "CF monthly cap reached — $5 hard cap")
    if cf_daily_pct >= 90:
        return ("alert", "CF daily at 90%+ — consider throttling")
    if opencode_quota_pct >= 100:
        return ("throttle", "OpenCode quota exhausted — fall back to other providers")
    if net_pnl < -10:
        return ("alert", "Net P&L ex-airdrops below -$10 — review trader")
    return ("continue", "All budgets within tolerance")
```

## P&L semantics (no double-counting)

Per operator brief: "not double-counting wallet views."

**Definitions:**
- `trading_pnl_usd`: realized P&L from closed trades (decision_ledger)
- `fee_drag_usd`: total fees paid (Coinbase + spread + slippage)
- `airdrop_income_usd`: free token distributions (separate line — never netted)
- `net_pnl_ex_airdrops` = `trading_pnl_usd - fee_drag_usd` (real P&L after fees)
- **NOT added**: airdrop_income_usd (tracked separately)

This honors: **"Airdrop income > trading P&L currently (~$2 airdrops vs -$1 trading)"**

## Integration with F0

Every `economic_*` tool goes through F0 dispatch with **risk: read**:
- All economic_* tools are read-only
- No execution authority required
- F0 read gate is sufficient

## Stop list

- Do NOT create `economic_trade`, `economic_pay`, `economic_withdraw`
- Do NOT mutate any wallet state
- Do NOT auto-throttle based on budget gate (operator decides)
- Do NOT airdrop P&L into net_pnl (always separate)
- Do NOT invoke LLM for arithmetic
- Do NOT fabricate cost data — only report what's persisted in sources

## Daemon-vs-LLM status

Economic Controller is **purely deterministic**:
- Aggregation: file reads + arithmetic
- Budget gate: threshold math
- Attribution: SQL queries + grouping
- Persistence: deterministic SQL inserts

LLM is never invoked by E. If interpretation is needed (e.g., "is this fee drag concerning?"), operator uses Research Frontier.

## What's next after E

Once E is built, the next phase (F — Initiative Engine) would:
- Read approved opportunities + proactive predictions
- Submit to F0 for execution authority
- Track execution outcomes in opportunity_proposals.execution_result

E is the **read-only audit substrate**. F is the **action substrate** (reading from C, C.5, and operator approval).

The complete loop:
```
READ (Economic Controller) ← ALL organs (cost, pnl, budget, attribution)
   ↑
DETECT (Sentinel/Incident) ← WATCH upstream
   ↑
PROPOSE (Opportunity)        ← Patterns detected
   ↑
PREDICT (Proactive)          ← Trends identified
   ↑
APPROVE (Operator)           ← Decides what to execute
   ↓
EXECUTE (Initiative)         ← F0-authority-gated
   ↓
RECORD (Opportunity)         ← Outcomes stored
   ↓
E reads back → attribution → next cycle
```