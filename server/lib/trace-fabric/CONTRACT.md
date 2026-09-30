# F3 — Trace Fabric Contract

**The first central trace store.** Trace ID is already propagated everywhere (F0 dispatch, browser-organ, sentinel, request-trace middleware, OTel exporter). What's missing is a **central queryable index** that lets you ask "what happened with trace_id=X across every subsystem?"

---

## Purpose

Trace Fabric answers:
1. **"Show me everything that happened with trace_id=X"** — joins F0 envelope → tool dispatch → organ persistence → external effects → verification
2. **"What was the last time tool Y ran successfully?"** — tool lifecycle queries
3. **"What caused the last alert?"** — root-cause trace backtracking from sentinel_alerts to the original signal
4. **"How long did this whole action take?"** — end-to-end latency per trace

It does NOT:
- Replace OTel exporter (that's the wire protocol for external collectors)
- Replace request-trace middleware (that's the per-request context manager)
- Replace per-organ trace_id columns (those are the **source of truth** for that organ's data)

It **adds** a central index that knows about all of them.

## The Organ Contract

```
WATCH    — Trace Fabric listens to F0 dispatch events (post-tool-call)
   ↓
NORMALIZE — Each event becomes {trace_id, source, kind, observed_at, payload, parent_trace_id}
   ↓
PERSIST   — Write to trace_correlation table (SQLite)
   ↓
INDEX     — Build secondary indexes by (tool_name, observed_at) and (trace_id, observed_at)
   ↓
QUERY     — Expose MCP tools to query the index
```

## Storage schema

**SQLite database** at `/Users/dutch/.local/share/concord/trace-fabric.db`:

```sql
CREATE TABLE trace_correlation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id TEXT NOT NULL,
  parent_trace_id TEXT,            -- if this trace was triggered by another trace
  source TEXT NOT NULL,             -- f0_dispatch | browser_organ | sentinel | hermes_chat | external_agent
  source_event TEXT NOT NULL,       -- tool_call_started | tool_call_completed | gate_decision | organ_persistence | external_effect | verification
  tool_name TEXT,                   -- tool that was called (if any)
  observed_at TEXT NOT NULL,        -- ISO 8601 UTC
  duration_ms INTEGER,               -- for tool_call_completed events
  payload_json TEXT NOT NULL,       -- full event payload (decision, gates_run, etc.)
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_trace_correlation_trace_id ON trace_correlation(trace_id, observed_at);
CREATE INDEX idx_trace_correlation_source ON trace_correlation(source, observed_at);
CREATE INDEX idx_trace_correlation_tool ON trace_correlation(tool_name, observed_at);
```

## Tools exposed (4)

| Tool | Purpose |
|---|---|
| `trace_lookup` | All events for a given trace_id, ordered by observed_at |
| `trace_recent` | Recent traces (last N minutes), with summary fields |
| `trace_tool_history` | All events for a given tool_name, ordered by observed_at |
| `trace_root_cause` | For a sentinel_alert, find the originating trace that caused it |

## Integration with F0 (F3.3)

Trace Fabric hooks into F0's `dispatch.js` `dispatchMCP` function. After every gate decision is made (ALLOW/DENY/etc.) and before the tool is invoked, a `tool_call_started` event is written. After the tool completes, a `tool_call_completed` event is written.

This is **non-invasive** — Trace Fabric sits alongside the existing dispatch, never blocks. If Trace Fabric's DB is unavailable, F0 still works (the write happens after the decision is made, in a try/except).

## Sources consumed

| Source | Events captured |
|---|---|
| F0 dispatch.js | Every MCP tool call: started, completed, gate decision, duration |
| Browser Organ observations table | Backfilled from `trace_id` column on insert |
| Sentinel state rows | Backfilled from `trace_id` column on insert |
| External agents (hermes_chat) | Direct write via `trace_record` tool (if a trace_id was provided) |

## Heartbeat (optional)

Trace Fabric doesn't need its own heartbeat — it captures events as they happen. But it can run a periodic sweep to backfill from organ DBs (browser_organ.db, sentinel.db) on a 15-minute cadence for any events that didn't go through F0 (e.g., direct organ calls).

## Verification (F3.4)

Independent evaluator test:
- `trace_lookup(trace_id)` returns all events for that trace, ordered chronologically
- F0 dispatch writes a `tool_call_started` event before tool runs
- F0 dispatch writes a `tool_call_completed` event after tool completes (with duration_ms)
- Trace backfill from browser_organ and sentinel DBs works
- 24-hour-old trace is still queryable (persistence works)

## Stop list (carry-forward)

- Do not replace existing request-trace.js (compose with it, don't replace)
- Do not replace OTel exporter (compose with it, don't replace)
- Do not introduce a second trace_id schema — use the existing `trace_id` format
- Do not invent a new transport — stdio MCP like the other organs
- Do not block F0 dispatch if Trace Fabric DB is down (best-effort writes)

## What "trace" means here

A **trace** = all events with the same `trace_id` across time and subsystems.

A trace is initiated by:
1. An HTTP request with `X-Trace-Id` header → F0 dispatch → tool → organ
2. A launchd tick (browser-organ, sentinel) → creates a new trace_id per tick
3. An external agent (hermes_chat) → provides trace_id via params

A trace ends when:
- The tool returns (or fails)
- The organ persistence is complete
- 5 minutes of inactivity (timeout — future work)