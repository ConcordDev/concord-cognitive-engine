# B — Incident Engine Contract

**First deterministic incident response organ.** Consumes Sentinel alerts + Trace Fabric events + Reflex Cortex detector findings, classifies them, executes bounded recovery OR escalates.

---

## Purpose

Incident Engine answers:
1. **"What incidents are active right now?"** — Active incidents with status
2. **"Can we auto-fix this incident?"** — Match against known-recovery playbook
3. **"Did the recovery work?"** — Verification probe post-recovery
4. **"Why was this escalated?"** — Incident timeline with full audit trail

The **daemon-vs-LLM rule applies here**: 95% of incidents should be classified deterministically by pattern matching. LLM is only invoked when classification reaches genuine novelty.

## The Organ Contract

```
DETECT     — Pull recent signals from Sentinel DB + Trace Fabric DB
   ↓
CLASSIFY   — Pattern-match against known incident classes
   ↓
DECIDE     — For each incident:
              - known + recovery exists → execute bounded recovery
              - known + no recovery    → escalate (alert only)
              - unknown class         → escalate (alert only)
   ↓
ACT        — Bounded execution only (no trading, no destructive ops)
              Actions: restart-launchd-daemon, run-detector-dry-run,
              clear-stuck-cache, send-telegram
   ↓
VERIFY     — Probe the system post-recovery; re-detect
   ↓
RECORD     — Persist incident_state, incident_actions to SQLite
```

## Decision outcomes (5)

| Outcome | When | Authority |
|---|---|---|
| `recovery_succeeded` | bounded recovery ran + verification passed | engine — autonomous |
| `recovery_failed` | bounded recovery ran + verification failed | escalate to operator |
| `escalate_no_recovery` | known class but no playbook exists | escalate to operator |
| `escalate_unknown_class` | pattern doesn't match any known class | escalate to operator (LLM boundary) |
| `observe` | transient, auto-resolving | continue monitoring |

## Known incident classes (initial)

| Class | Detection | Recovery | Authority |
|---|---|---|---|
| `concord_backend_down` | /health returns 503/connection refused | alert-only (don't restart core) | escalate |
| `launchd_daemon_stuck` | plist running but last_tick > 5min ago | restart-launchd-daemon | engine |
| `browser_organ_observation_stale` | No new observation in 30min | re-run browser-organ tick | engine |
| `sentinel_state_growing_fast` | > 50 alert_level=warn rows in 1h | alert-only | escalate |
| `f0_idempotency_cache_miss` | replay_detected > 10/min | alert-only | escalate |
| `concord_gate_diff_ci_failing` | detector CI exit != 0 | alert-only | escalate |
| `coinbase_balance_low` | Browser Organ: USDC < $50 | alert-only | escalate (no auto-buy) |
| `refusal_field_active` | refusal_field returns fields > 0 | alert-only | escalate |
| `telegram_delivery_failing` | sentinel alerts but no telegram_message_id | retry-once then alert | engine |

**No autonomous destructive actions.** Recovery set is restricted to:
- Restart a launchd daemon (com.concord.browser-organ, com.concord.sentinel, etc.)
- Clear a known cache
- Retry a known-failing probe
- Send a Telegram notification

## Storage

**SQLite database** at `/Users/dutch/.local/share/concord/incident-engine.db`:

```sql
CREATE TABLE incident_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  incident_class TEXT NOT NULL,
  source TEXT NOT NULL,            -- sentinel | trace_fabric | reflex_cortex | browser_organ | external
  severity TEXT NOT NULL,          -- info | warn | critical
  status TEXT NOT NULL,            -- active | recovering | resolved | escalated | observed
  outcome TEXT,                    -- recovery_succeeded | recovery_failed | escalate_no_recovery | escalate_unknown_class | observe
  signal_json TEXT NOT NULL,       -- the signal that triggered this incident
  context_json TEXT,               -- additional context (db metrics, process state, etc.)
  escalation_target TEXT,          -- telegram | operator | sovereign | null
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE incident_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incident_state(id),
  action_at TEXT NOT NULL,
  action_kind TEXT NOT NULL,       -- restart_daemon | clear_cache | retry_probe | send_telegram | escalate
  action_target TEXT,              -- daemon name / cache name / probe name
  action_args_json TEXT,
  action_result TEXT,              -- ok | failed | skipped | escalated
  action_result_detail TEXT,
  trace_id TEXT NOT NULL,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_incident_state_status ON incident_state(status, detected_at);
CREATE INDEX idx_incident_actions_incident ON incident_actions(incident_id, action_at);
```

## Tools exposed (5)

| Tool | Purpose |
|---|---|
| `incident_watch` | Full sweep: consume sentinel + trace-fabric signals, classify, decide, act, verify, record |
| `incident_active` | List currently active incidents |
| `incident_history` | List recent resolved/escalated incidents |
| `incident_classify` | Manually classify a given signal (for testing or operator override) |
| `incident_recover` | Manually trigger recovery for a known incident (for testing or operator override) |

## Integration with F0

Every `incident_*` tool goes through F0 dispatch (like the other organs). Risk levels:
- `incident_watch` — write (persists incident_state)
- `incident_active`, `incident_history` — read
- `incident_classify` — read (classification is a query, not an action)
- `incident_recover` — execute (with bounded scope)

`incident_recover` is the riskiest. Per F0's authority field: requires `execute: true, destructive: false`. No trade authority.

## Heartbeat

- launchd plist runs `incident_tick.sh` every 60 seconds
- Each tick: invoke `incident_watch` via concord-local MCP
- Decision persists; recovery attempted (if safe); escalation routed via Telegram

## Verification (B.5)

Independent evaluator test:
- Each tool returns real data or honest error
- Known-recovery executes (e.g., restart_daemon for stuck browser-organ)
- Unknown-class escalates (no false autonomous action)
- Recovery verification probes actually probe
- Restart preserves state (SQLite persistent)
- No spam: same incident doesn't duplicate within 5 minutes (dedupe window)

## Stop list (carry-forward)

- Do not modify repair-cortex.js (compose with it, don't replace)
- Do not modify reflex-cortex.js (compose with it, don't replace)
- Do not invent a new recovery framework — use existing playbook pattern from reflex-cortex
- Do not bypass Sovereign for destructive ops
- Do not auto-restart concord.backend itself (core service)
- Do not auto-trade even if Coinbase is down

## What "incident" means here

An **incident** = a signal that triggered a classification decision. Lifecycle:
1. Signal arrives (sentinel alert, trace-fabric event, reflex-cortex finding)
2. Classifier runs (deterministic pattern match)
3. Decision made (recovery | escalate | observe)
4. If recovery: execute bounded action + verify
5. Status transitions: active → recovering → resolved | escalated | observed
6. Record to incident_state + incident_actions

A known-recovery that fails transitions to `escalate_recovery_failed` so the operator gets notified.