# A — Sentinel Contract

**The first continuous-monitoring organ.** Consumes signals from Browser Organ + F0 audit + Concord deep-health + drift-monitor + concord-gate detector suite.

---

## Purpose

Sentinel is the **autonomous health watchdog** for the whole system. It continuously:

1. **Watches** streams of signals from every organ and authority subsystem
2. **Reviews** recent signal history against known thresholds
3. **Records** sentinel state + every observation to a queryable store
4. **Decides** whether any combination of signals crosses an alert threshold
5. **Acts** by routing alerts via Telegram (best-effort) + writing DTUs

**No autonomous intervention.** Sentinel is observability-only. When it detects a problem, it surfaces it via Telegram + DTU; remediation is the role of Opportunity Engine (C) and Initiative Engine (F).

## Sentinel vs Browser Organ

| | Browser Organ | Sentinel |
|---|---|---|
| Reads | external state (Coinbase, providers, status) | internal organs (Browser Organ output, F0 audit, deep-health) |
| Writes | observations table | sentinel_state + sentinel_alerts + Telegram |
| Cadence | every 15 min | every 5 min (faster — internal state changes faster) |
| Authority | read-only | read-only |

## The Organ Contract (per master plan)

```
WATCH     — pull latest signals from each signal source
   ↓
REVIEW    — compare against thresholds, detect anomalies
   ↓
RECORD    — persist sentinel_state, sentinel_alerts to SQLite
   ↓
DECIDE    — alert_level = none | info | warn | critical
   ↓
ACT       — route alert via Telegram if level >= warn
   ↓
VERIFY    — confirm alert was actually delivered (best-effort)
```

## Signal sources (consumed)

| Source | What it provides | Refresh |
|---|---|---|
| Browser Organ observation store (`browser_organ.db`) | Latest BTC/price, alert_level, indicator | every 15 min |
| F0 audit log | Per-capability decision/gates_run/capability_ok/not | every call |
| Concord `/health` endpoint | Basic up/down + brain status | every 5 min |
| Concord deep-health (`emergent/deep-health.js`) | 5 deep checks | every 5 min |
| Concord drift-monitor (`emergent/drift-monitor.js`) | 4 drift categories | every 5 min |
| Concord-gate detector scripts (`scripts/run-detectors.js`) | 234-file fingerprint diff vs baseline | every 5 min |
| SQLite DB metrics | row counts in critical tables | every 5 min |

## Tools exposed (4)

| Tool | Purpose | Inputs |
|---|---|---|
| `sentinel_watch` | Full sweep: read all signal sources, write sentinel_state, decide alert_level | none |
| `sentinel_review_alerts` | List recent sentinel_alerts (warn/critical only) since timestamp | optional `since_minutes` |
| `sentinel_health_snapshot` | Just the deep-health + drift-monitor summary | none |
| `sentinel_gate_diff` | Run concord-gate detector diff against BASELINE | none |

**No data fabrication.** Each tool hits a real endpoint or fails with `ok: false, reason: "..."`.

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/sentinel.db`:

```sql
CREATE TABLE sentinel_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_at TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  sources_json TEXT NOT NULL,    -- which signal sources ran
  signals_json TEXT NOT NULL,    -- all signals aggregated
  alert_level TEXT NOT NULL,     -- none | info | warn | critical
  alert_reasons_json TEXT,       -- list of reasons if alert_level >= warn
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sentinel_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state_id INTEGER NOT NULL REFERENCES sentinel_state(id),
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL,           -- browser_organ | f0_audit | deep_health | drift | gate_diff | db_metrics
  severity TEXT NOT NULL,         -- warn | critical
  message TEXT NOT NULL,
  delivered_via TEXT,             -- telegram | telegram_skipped | telegram_failed
  telegram_message_id INTEGER,
  sent_at TEXT,
  trace_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sentinel_state_time ON sentinel_state(observed_at DESC);
CREATE INDEX idx_sentinel_alerts_time ON sentinel_alerts(created_at DESC);
```

## Alert thresholds

| Signal | warn | critical |
|---|---|---|
| Browser Organ observation with `alert_level="critical"` | — | always |
| Browser Organ `alert_level="warn"` (3 consecutive ticks) | yes | — |
| Deep Health returns UNHEALTHY or CRITICAL | — | always |
| Deep Health returns DEGRADED | yes | — |
| Drift Monitor detects Goodharting or Capability Creep | yes | — |
| Drift Monitor detects Self-Referential Loops | — | always |
| Concord-gate diff: > 0 added critical findings | — | yes |
| Concord-gate diff: > 5 added info findings | yes | — |
| F0 audit: any `replay_detected` in last 5 min | yes | — |
| F0 audit: any `capability_unregistered` in last 5 min | yes | — |

## Heartbeat

- launchd plist runs `sentinel_tick.sh` every 5 minutes
- Each tick: invoke `sentinel_watch` via concord-local MCP (HTTP `/mcp/call` → F0)
- Decision persisted; alert routed if level >= warn

## Integration with F0

Every sentinel tool call goes through:
1. `dispatchMCP(tool, args, ctx)` (F0's chokepoint)
2. Auth-gate evaluate runs 10 pre-dispatch checks (10 modules in gates/; verification is post-tool)
3. Result returned with `envelope`, `decision`, `gates_run`, `auth_gate_mode: "observe"`

**No new authority model. No new policy.** F0 + Sentinel = same composition pattern as F0 + Browser Organ.

## Verification (A.5)

Independent evaluator test:
- Each tool returns `ok: true` OR `ok: false` with a real reason
- sentinel_state grows by exactly 1 row per successful watch
- sentinel_alerts only created when threshold crossed (no spam)
- Restart clears nothing (SQLite persistent)
- Hermes chat can read sentinel_state and explain the latest decision

## Stop list (from prior turns, plus additions)

- Do not auto-restart Concord from Sentinel (escalate, don't act)
- Do not bypass F0 for sentinel alerts (route through F0 dispatch)
- Do not modify deep-health.js or drift-monitor.js (compose, don't replace)
- Do not invent a new persistence layer (dedicated SQLite at `~/.local/share/concord/`)
- Do not auto-resolve sovereignty violations (only alert)