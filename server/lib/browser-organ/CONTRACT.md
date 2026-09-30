# O001 — Browser Organ Contract

**The first externally-visible autonomous organ.** Validates the organ contract end-to-end.

---

## Purpose

Continuously observe external-world state that's reachable from a browser, persist observations to a queryable store, and alert when state crosses thresholds. Acts as a **sensory organ** for the larger autonomic system — feeding Sentinel (A), Opportunity Engine (C), and Economic Controller (E) with real-time external data.

## The Organ Contract (per the master plan)

Every organ follows the same 8-stage contract:

```
OBSERVE
  ↓
NORMALIZE (parse + standardize)
  ↓
PERSIST (write to durable store)
  ↓
EVALUATE (compare against thresholds)
  ↓
REQUEST AUTHORITY (via F0 envelope)
  ↓
ACT (alert / escalate / noop)
  ↓
VERIFY (post-condition: alert actually sent?)
  ↓
RECORD OUTCOME (as DTU)
```

## Tools exposed (3)

| Tool | Purpose | Source URL |
|------|---------|-----------|
| `browser_check_coins` | Get current USD balance + portfolio value from Coinbase Advanced Trade | coinbase.com (authenticated) |
| `browser_check_rate_limits` | Check Anthropic + OpenRouter + Groq rate limit dashboards | provider consoles |
| `browser_check_incidents` | Check Coinbase + status.coinbase.com for active incidents | status.coinbase.com/api/v2/status.json |

**No data fabrication.** Each tool MUST hit a real URL or fail with `ok: false, reason: "..."`.

## Public API (stdio MCP)

```js
// Request
{"tool": "browser_check_coins", "args": {}}
{"tool": "browser_check_rate_limits", "args": {}}
{"tool": "browser_check_incidents", "args": {}}

// Response (each tool)
{
  ok: boolean,
  observed_at: ISO timestamp,
  source_url: string,
  observation: {  // normalizes per-tool shape
    ...tool-specific...
  },
  alert_level: "none" | "info" | "warn" | "critical",
  alert_reason: string | null,
  trace_id: UUID  // F0 envelope
}
```

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/browser_organ.db`:

```sql
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool TEXT NOT NULL,
  source_url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  alert_level TEXT NOT NULL,
  alert_reason TEXT,
  trace_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  tool TEXT NOT NULL,
  alert_level TEXT NOT NULL,
  reason TEXT NOT NULL,
  delivered_via TEXT,  -- "telegram" | "telegram_pending" | "noop"
  telegram_message_id INTEGER,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_observations_tool_time ON observations(tool, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_tool_time ON alerts(tool, created_at DESC);
```

## Alert routing

| Alert level | Trigger | Action |
|---|---|---|
| `none` | healthy | noop |
| `info` | noteworthy but not actionable | log + DTU |
| `warn` | approaching threshold | log + DTU + Telegram |
| `critical` | threshold crossed | log + DTU + Telegram + escalate |

**Telegram delivery** via `imsg` CLI to `concord_ops_bot` (chat 6776710732).

## Thresholds (per tool)

| Tool | warn | critical |
|------|------|----------|
| `browser_check_coins` | balance < $50 | balance < $10 |
| `browser_check_rate_limits` | remaining < 20% | remaining < 5% |
| `browser_check_incidents` | indicator != "none" | indicator in ["critical", "major"] |

## Heartbeat (O001.7)

- launchd plist runs `browser-organ-tick.py` every 15 minutes
- Each tick: invokes all 3 tools in sequence
- Each invocation: calls tool via concord-local MCP (stdio)
- Observation persisted
- Alert routed if level >= warn

## Integration with F0

Every browser-organ tool call goes through:
1. `dispatchMCP(tool, args, ctx)` (F0's chokepoint)
2. Auth-gate evaluate runs 10 pre-dispatch checks (10 modules in gates/; verification is post-tool)
3. Result returned with `envelope`, `decision`, `gates_run`, `auth_gate_mode: "observe"`

**No new authority model. No new policy.** F0 + organ = standard organ-on-substrate pattern.

## Verification (O001.6)

Independent evaluator test:
- Each tool returns `ok: true` OR `ok: false` with a real reason (never silent fail)
- Each observation has `observed_at`, `source_url`, `observation`, `alert_level`, `trace_id`
- Storage grows by exactly 1 row per successful observation
- 4 consecutive ticks → 4 observations in DB
- Restart clears nothing (SQLite persistent)

## Stop list (from prior turns, plus additions)

- Do not store Coinbase API keys in plain text (use existing secure store or environment)
- Do not bypass F0's envelope (every observation has a trace_id)
- Do not auto-send Telegram messages during tests
- Do not modify `lib/browser-engine.js` (use the existing class)
- Do not invent a new persistence layer (use the dedicated SQLite at `~/.local/share/concord/`)