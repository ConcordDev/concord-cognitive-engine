// server/lib/auth-gate/dispatch.js
//
// F0.5 — dispatchMCP(): the single integration point that wraps every
// MCP tool call with authority composition.
//
// Architecture (per locked F0.0 + F0.2 spec):
//   1. routes/mcp.js authorizeToolCall() — HTTP-level coarse gate (existing)
//   2. AuthGate.evaluate(envelope)       — composition of 10 pre-dispatch checks (gates/ has 10 modules; verification is post-tool)
//   3. callMCPTool(db, tool, args, STATE) — tool dispatch (EXISTING)
//   4. Verification probe                — post-condition (NEW)
//   5. Event-bus publish                 — audit emission (EXISTING)
//
// This module does NOT replace callMCPTool. It calls it AFTER authorization.

import { callMCPTool } from "../mcp-tools.js";
import { buildEnvelope } from "./envelope.js";
import { evaluate, DECISION } from "./index.js";
import * as verificationGate from "./gates/verification.js";
import { recordResult as recordIdempotentResult } from "./gates/idempotency.js";
import { resolveAuthGateMode } from "./policy.js";

/**
 * F3.3 — Trace Fabric hook: write a trace event to the central trace_correlation
 * table. Best-effort — never blocks, never throws. If Trace Fabric DB is
 * unreachable, the dispatch still completes normally.
 *
 * Implementation: lazy-import a sqlite3 connection to the trace-fabric DB.
 */
let _traceDb = null;
let _traceDbPath = null;
let _traceDbPromise = null;

function getTraceDbPath() {
  if (_traceDbPath) return _traceDbPath;
  _traceDbPath = `${process.env.HOME || "/Users/dutch"}/.local/share/concord/trace-fabric.db`;
  return _traceDbPath;
}

async function ensureTraceDb() {
  if (_traceDb) return _traceDb;
  if (_traceDbPromise) return _traceDbPromise;
  _traceDbPromise = (async () => {
    try {
      // ESM dynamic import for better-sqlite3
      const DatabaseMod = await import("better-sqlite3");
      const Database = DatabaseMod.default || DatabaseMod;
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dbPath = getTraceDbPath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const db = new Database(dbPath);
      db.exec(`CREATE TABLE IF NOT EXISTS trace_correlation (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          trace_id TEXT NOT NULL,
          parent_trace_id TEXT,
          source TEXT NOT NULL,
          source_event TEXT NOT NULL,
          tool_name TEXT,
          observed_at TEXT NOT NULL,
          duration_ms INTEGER,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_trace_correlation_trace_id ON trace_correlation(trace_id, observed_at);`);
      _traceDb = db;
      return db;
    } catch (e) {
      if (process.env.CONCORD_TRACE_DEBUG === "true") {
        console.error(`[trace-fabric] init failed: ${e.message}`);
      }
      return null;
    }
  })();
  return _traceDbPromise;
}

// 2026-09-05: same defect class as event_timeline_log (see server.js's
// event-timeline-prune heartbeat) -- trace_correlation is written on every
// organ tick (13 organs, 60s/300s/900s launchd cadences) with no retention
// anywhere: not here, not in the standalone organ .py scripts. 78,685 rows
// already at the time this was found, on a separate small db file that had
// been growing since inception with nothing to stop it. 30 days matches the
// event-timeline retention window for consistency, not a load-bearing choice.
const TRACE_PRUNE_OLDER_THAN_SECONDS = 30 * 24 * 3600;

/** Delete trace_correlation rows older than the retention window. Best-effort,
 * mirrors writeTraceEvent's own never-throw contract -- a prune failure must
 * never affect dispatch. */
export async function pruneOldTraceEvents(olderThanSeconds = TRACE_PRUNE_OLDER_THAN_SECONDS) {
  const db = await ensureTraceDb();
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const cutoffIso = new Date(Date.now() - olderThanSeconds * 1000).toISOString();
    const r = db.prepare(`DELETE FROM trace_correlation WHERE created_at < ?`).run(cutoffIso);
    return { ok: true, deleted: r.changes };
  } catch (e) {
    return { ok: false, reason: "prune_failed", error: e.message };
  }
}

function writeTraceEvent(traceId, source, sourceEvent, toolName, durationMs, observedAt, payload, parentTraceId) {
  if (!traceId) return;
  // Fire-and-forget async write; sync-fire is fine since better-sqlite3 is sync
  // but we use async init to avoid blocking dispatch on module load.
  ensureTraceDb().then(db => {
    if (!db) return;
    try {
      const obs = observedAt || new Date().toISOString();
      const info = db.prepare(`INSERT INTO trace_correlation
        (trace_id, parent_trace_id, source, source_event, tool_name, observed_at, duration_ms, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(traceId, parentTraceId || null, source, sourceEvent, toolName || null, obs,
          durationMs != null ? durationMs : null, JSON.stringify(payload || {}));
      if (process.env.CONCORD_TRACE_DEBUG === "true") {
        console.error(`[trace-fabric] wrote event ${info.lastInsertRowid} trace=${traceId} ${sourceEvent}`);
      }
    } catch (e) {
      if (process.env.CONCORD_TRACE_DEBUG === "true") {
        console.error(`[trace-fabric] write failed: ${e.message}`);
      }
    }
  });
}

/**
 * Default mode is observe-only. Set CONCORD_AUTH_GATE_MODE=enforce to deny all.
 * Set CONCORD_AUTH_GATE_ENFORCE_AUTONOMOUS=true or CONCORD_DILA_RUNTIME_ENFORCE=1
 * to enforce only for system/autonomous sources.
 */
function getMode(ctx = {}) {
  return resolveAuthGateMode(ctx);
}

/**
 * Dispatch an MCP tool call through AuthGate.
 *
 * @param {string} tool              — Tool name (snake_case MCP)
 * @param {Object} args              — Tool arguments
 * @param {Object} [ctx]             — Context
 * @param {Object} [ctx.actor]       — {id, role, ...}
 * @param {Object} [ctx.req]         — Express req (for headers)
 * @param {Object} [ctx.db]          — Database handle
 * @param {Object} [ctx.STATE]       — Concord STATE
 * @param {Object} [ctx.why]         — WHY field (initiative_id etc.)
 * @param {Object} [ctx.preconditions]
 * @param {Object} [ctx.verification]
 * @param {Object} [ctx.rollback]
 * @param {Object} [ctx.resource]
 * @param {string} [ctx.trace_id]    — Override trace_id (OTel pass-through)
 * @returns {Promise<Object>}        — {ok, decision, reason_code, decision_id, gates_run, result}
 */
export async function dispatchMCP(tool, args = {}, ctx = {}) {
  const startMs = Date.now();
  const mode = getMode(ctx);
  const observeOnly = mode !== "enforce";

  // 1. Build envelope
  const envelope = buildEnvelope({
    tool,
    args,
    ctx: {
      actor: ctx.actor,
      user: ctx.actor,
      trace_id: ctx.trace_id,
    },
    why: ctx.why,
    provenance: ctx.provenance,
    preconditions: ctx.preconditions,
    verification: ctx.verification,
    rollback: ctx.rollback,
    resource: ctx.resource,
  });

  // 2. Run AuthGate composition
  let auth;
  try {
    auth = await evaluate(envelope, {
      db: ctx.db,
      STATE: ctx.STATE,
      observe_only: observeOnly,
    });
  } catch (e) {
    // AuthGate itself failed — fail closed (but only in enforce mode)
    if (observeOnly) {
      auth = {
        envelope,
        decision: DECISION.OBSERVE,
        reason_code: "auth_gate_threw",
        gates_run: [{ name: "__error__", error: e?.message }],
      };
    } else {
      return {
        ok: false,
        decision: DECISION.DENY,
        reason_code: "auth_gate_threw",
        error: e?.message || String(e),
        durationMs: Date.now() - startMs,
      };
    }
  }

  // 3. Decision routing
  switch (auth.decision) {
    case DECISION.DENY:
      return {
        ok: false,
        decision: DECISION.DENY,
        reason_code: auth.reason_code,
        decision_id: auth.decision_id,
        gates_run: auth.gates_run,
        envelope: serializeEnvelope(auth.envelope),
        durationMs: Date.now() - startMs,
        auth_gate_mode: mode,
      };

    case DECISION.ESCALATE:
      // ESCALATE: do not execute; return escalation request
      return {
        ok: false,
        decision: DECISION.ESCALATE,
        reason_code: auth.reason_code,
        decision_id: auth.decision_id,
        gates_run: auth.gates_run,
        envelope: serializeEnvelope(auth.envelope),
        message: "Action requires escalation to Sovereign/Governance. Use lib/governance.js::openProposal to file a proposal.",
        durationMs: Date.now() - startMs,
        auth_gate_mode: mode,
      };

    case DECISION.DEFER:
      return {
        ok: false,
        decision: DECISION.DEFER,
        reason_code: auth.reason_code,
        decision_id: auth.decision_id,
        gates_run: auth.gates_run,
        envelope: serializeEnvelope(auth.envelope),
        message: "Preconditions not met. Caller may retry when conditions change.",
        durationMs: Date.now() - startMs,
        auth_gate_mode: mode,
      };

    case DECISION.OBSERVE:
      // Observe-only mode: log and proceed as if ALLOWED
      // (downgraded from a deny by observe-only mode)
      if (!observeOnly) {
        return {
          ok: false,
          decision: DECISION.OBSERVE,
          reason_code: auth.reason_code,
          decision_id: auth.decision_id,
          gates_run: auth.gates_run,
          envelope: serializeEnvelope(auth.envelope),
          durationMs: Date.now() - startMs,
          auth_gate_mode: mode,
        };
      }
      // Fall through to execute in observe-only mode
      // INTENTIONAL: OBSERVE in observe-only mode = log + execute
      break;

    case DECISION.ALLOW:
    default:
      // Authorized; proceed to execute
      break;
  }

  // 4. Idempotent cached result short-circuit
  if (auth.cached_result !== undefined) {
    return {
      ok: true,
      decision: DECISION.ALLOW,
      reason_code: "idempotent_replay_cached",
      decision_id: auth.decision_id,
      gates_run: auth.gates_run,
      result: auth.cached_result,
      envelope: serializeEnvelope(auth.envelope),
      durationMs: Date.now() - startMs,
      auth_gate_mode: mode,
    };
  }

  // 5. Execute via existing callMCPTool
  // Propagate trace_id so down-stream wrappers (e.g. browser-organ) can correlate.
  if (auth.envelope && auth.envelope.TRACE_ID) {
    args = { ...(args || {}), __trace_id: auth.envelope.TRACE_ID };
    globalThis.__concordLastTraceId = auth.envelope.TRACE_ID;
  }
  let rawResult;
  const traceCallStart = Date.now();
  // F3.3 — Trace Fabric: write tool_call_started event (best-effort, never blocks)
  writeTraceEvent(auth.envelope.TRACE_ID, "f0_dispatch", "tool_call_started",
                  auth.envelope.WHAT, null, null, {
                    envelope_summary: {
                      who: auth.envelope.WHO,
                      what: auth.envelope.WHAT,
                      risk: auth.envelope.RISK,
                      authority: auth.envelope.AUTHORITY,
                      provenance: auth.envelope.PROVENANCE,
                    },
                  });
  try {
    rawResult = await callMCPTool(ctx.db, tool, args, ctx.STATE || globalThis.STATE || null);
  } catch (e) {
    // Tool handler threw — still record outcome
    recordIdempotentResult(auth.envelope, { ok: false, error: e?.message });
    return {
      ok: false,
      decision: DECISION.ALLOW,
      reason_code: "handler_threw",
      decision_id: auth.decision_id,
      gates_run: auth.gates_run,
      error: e?.message || String(e),
      envelope: serializeEnvelope(auth.envelope),
      durationMs: Date.now() - startMs,
      auth_gate_mode: mode,
    };
  }

  // 6. Post-condition verification
  let verification = { pass: true, reason_code: "no_verification_required" };
  if (auth.envelope.VERIFICATION) {
    try {
      verification = await verificationGate.check(auth.envelope, rawResult, ctx.db, ctx.STATE);
    } catch (e) {
      verification = { pass: false, reason_code: "verification_threw", detail: e?.message };
    }
  }

  // 7. Record idempotent result (so future true replays return cached)
  recordIdempotentResult(auth.envelope, rawResult);

  // 8. Audit emission (preserves existing event-bus shape)
  emitAudit(auth, rawResult, verification, Date.now() - startMs);

  // F3.3 — Trace Fabric: write tool_call_completed event with duration + decision
  writeTraceEvent(auth.envelope.TRACE_ID, "f0_dispatch", "tool_call_completed",
                  auth.envelope.WHAT, Date.now() - traceCallStart, null, {
                    ok: rawResult?.ok !== false,
                    verification_pass: verification.pass,
                    verification_reason: verification.reason_code,
                    reason_code: verification.pass ? "allowed_and_verified" : "allowed_verification_failed",
                    decision_id: auth.decision_id,
                    result_summary: rawResult?.result ? Object.keys(rawResult.result).slice(0, 10) : (rawResult ? Object.keys(rawResult).slice(0, 10) : []),
                    alert_level: rawResult?.result?.alert_level || rawResult?.alert_level || null,
                  });

  // 9. Compose final result
  const finalOk = verification.pass !== false && rawResult?.ok !== false;
  return {
    ok: finalOk,
    decision: DECISION.ALLOW,
    reason_code: verification.pass ? "allowed_and_verified" : "allowed_verification_failed",
    decision_id: auth.decision_id,
    gates_run: auth.gates_run,
    verification,
    result: rawResult,
    envelope: serializeEnvelope(auth.envelope),
    durationMs: Date.now() - startMs,
    auth_gate_mode: mode,
  };
}

function serializeEnvelope(envelope) {
  // Strip _internal from serialization (args + ctx)
  const { _internal, ...rest } = envelope;
  return rest;
}

function emitAudit(auth, result, verification, durationMs) {
  try {
    // Lazy-load event-bus to avoid circular deps
    const eventBus = globalThis.__concordEventBus;
    if (eventBus && typeof eventBus.publish === "function") {
      eventBus.publish("auth_gate.evaluated", {
        decision_id: auth.decision_id,
        trace_id: auth.envelope.TRACE_ID,
        who: auth.envelope.WHO,
        what: auth.envelope.WHAT,
        why: auth.envelope.WHY,
        decision: auth.decision,
        reason_code: auth.reason_code,
        verification: verification.pass ? "passed" : "failed",
        durationMs,
      });
    }
  } catch {
    // Audit emission is best-effort
  }
}