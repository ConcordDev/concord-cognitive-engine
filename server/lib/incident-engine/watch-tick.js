// Chunked incident_watch tick — in-process so the Node event loop can yield.
//
// Previously every tick spawned ~/.local/bin/incident-engine.py via organCall
// and ran detect→classify→decide→act→verify→record in one synchronous Python
// pass (5–21s+ wall, holding /mcp/call). This module keeps the same decisions
// and 5-minute class/source dedupe, but processes at most K signals per sync
// slice, awaits setImmediate between slices, and caps per-tick wall time so
// remaining signals carry to the next tick (dedupe makes re-seeing them safe).

import { randomUUID } from "node:crypto";
import { classifyForWatch } from "./classify.js";

/** K — signals per sync slice. Shape: one SQLite write + classify per signal;
 *  10 keeps a slice comfortably under the ~25ms event-loop budget. */
export const INCIDENT_SIGNALS_PER_SLICE = Math.max(
  1,
  Number(process.env.CONCORD_INCIDENT_SIGNALS_PER_SLICE) || 10,
);

/** Per-tick wall budget (ms). Leftover signals carry to the next tick. */
export const INCIDENT_TICK_WALL_MS = Math.max(
  100,
  Number(process.env.CONCORD_INCIDENT_TICK_WALL_MS) || 2000,
);

export const DEDUPE_WINDOW_MINUTES = 5;

export function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export function ensureIncidentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS incident_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      detected_at TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      incident_class TEXT NOT NULL,
      source TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      outcome TEXT,
      signal_json TEXT NOT NULL,
      context_json TEXT,
      escalation_target TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS incident_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id INTEGER NOT NULL REFERENCES incident_state(id),
      action_at TEXT NOT NULL,
      action_kind TEXT NOT NULL,
      action_target TEXT,
      action_args_json TEXT,
      action_result TEXT NOT NULL,
      action_result_detail TEXT,
      trace_id TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_incident_state_status ON incident_state(status, detected_at);
    CREATE INDEX IF NOT EXISTS idx_incident_state_class_source_detected
      ON incident_state(incident_class, source, detected_at);
    CREATE INDEX IF NOT EXISTS idx_incident_actions_incident ON incident_actions(incident_id, action_at);
  `);
}

function findRecentIncident(db, incidentClass, source, dedupeMinutes, nowIso) {
  const cutoffMs = Date.parse(nowIso) - dedupeMinutes * 60_000;
  const cutoff = new Date(cutoffMs).toISOString();
  const row = db
    .prepare(
      `SELECT id, status, outcome FROM incident_state
       WHERE incident_class = ? AND source = ? AND detected_at > ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(incidentClass, source, cutoff);
  return row || null;
}

/**
 * Set-based recent-incident lookup for a slice.
 * Returns a Map keyed by `${incident_class}\x00${source}` -> { id, status, outcome }.
 * One query per slice instead of one query per signal.
 */
function buildRecentIncidentMap(db, pairs, cutoff) {
  const map = new Map();
  if (pairs.length === 0) return map;
  const unique = [];
  const seen = new Set();
  for (const [incidentClass, source] of pairs) {
    const key = `${incidentClass}\x00${source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([incidentClass, source]);
  }
  const values = unique.map(() => "(?,?)").join(",");
  const params = unique.flat();
  const rows = db
    .prepare(
      `SELECT s.incident_class, s.source, s.id, s.status, s.outcome
       FROM incident_state s
       JOIN (
         SELECT incident_class, source, MAX(id) AS max_id
         FROM incident_state
         WHERE detected_at > ? AND (incident_class, source) IN (VALUES ${values})
         GROUP BY incident_class, source
       ) m ON s.incident_class = m.incident_class
          AND s.source = m.source
          AND s.id = m.max_id`,
    )
    .all(cutoff, ...params);
  for (const r of rows) {
    map.set(`${r.incident_class}\x00${r.source}`, {
      id: r.id,
      status: r.status,
      outcome: r.outcome,
    });
  }
  return map;
}

function persistIncident(db, row) {
  const info = db
    .prepare(
      `INSERT INTO incident_state
        (detected_at, trace_id, incident_class, source, severity, status, outcome,
         signal_json, context_json, escalation_target)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.detected_at,
      row.trace_id,
      row.incident_class,
      row.source,
      row.severity,
      row.status,
      row.outcome,
      JSON.stringify(row.signal),
      row.context != null ? JSON.stringify(row.context) : null,
      row.escalation_target,
    );
  return Number(info.lastInsertRowid);
}

function persistAction(db, action) {
  db.prepare(
    `INSERT INTO incident_actions
      (incident_id, action_at, action_kind, action_target, action_args_json,
       action_result, action_result_detail, trace_id, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    action.incident_id,
    action.action_at,
    action.action_kind,
    action.action_target ?? null,
    action.action_args != null ? JSON.stringify(action.action_args) : null,
    action.action_result,
    action.action_result_detail ?? null,
    action.trace_id,
    action.duration_ms ?? 0,
  );
}

function updateIncidentStatus(db, incidentId, status, outcome, resolvedAt = null) {
  if (resolvedAt) {
    db.prepare(
      `UPDATE incident_state SET status=?, outcome=?, resolved_at=? WHERE id=?`,
    ).run(status, outcome, resolvedAt, incidentId);
  } else {
    db.prepare(`UPDATE incident_state SET status=?, outcome=? WHERE id=?`).run(
      status,
      outcome,
      incidentId,
    );
  }
}

/**
 * Sync decision for one signal (classify + dedupe + persist). No side effects.
 * @returns {{ result: object, pendingAction: object|null, syncMs: number }}
 */
export function decideOneSignal(db, sig, opts = {}) {
  const t0 = performance.now();
  const nowIso = opts.nowIso || new Date().toISOString();
  const traceId = opts.traceId || randomUUID();
  const dedupeMinutes = opts.dedupeMinutes ?? DEDUPE_WINDOW_MINUTES;
  const cls = classifyForWatch(sig);
  const source = sig?.source || "unknown";

  const recent =
    opts.recentIncident !== undefined
      ? opts.recentIncident
      : findRecentIncident(db, cls.incidentClass, source, dedupeMinutes, nowIso);
  if (recent) {
    return {
      result: {
        incident_class: cls.incidentClass,
        status: "deduped",
        recent_incident_id: recent.id,
        reason: `same class from same source within ${dedupeMinutes}m`,
      },
      pendingAction: null,
      syncMs: performance.now() - t0,
    };
  }

  let status = "active";
  let outcome = null;
  if (cls.recovery) {
    status = "recovering";
    outcome = "recovery_pending";
  } else if (cls.escalateTo) {
    status = "escalated";
    outcome = `escalate_${cls.escalateTo}`;
  } else if (cls.incidentClass !== "unknown_class") {
    status = "observed";
    outcome = "observe";
  }

  const incidentId = persistIncident(db, {
    detected_at: nowIso,
    trace_id: sig?.trace_id || traceId,
    incident_class: cls.incidentClass,
    source,
    severity: cls.severity,
    status,
    outcome,
    signal: sig,
    context: null,
    escalation_target: cls.escalateTo,
  });

  const syncMs = performance.now() - t0;
  const baseResult = {
    incident_id: incidentId,
    incident_class: cls.incidentClass,
    source,
    severity: cls.severity,
    status,
    outcome,
    actions: [],
  };

  if (cls.recovery) {
    return {
      result: baseResult,
      pendingAction: {
        kind: "recovery",
        incidentId,
        recovery: cls.recovery,
        signal: sig,
        detectedAt: nowIso,
        traceId: sig?.trace_id || traceId,
      },
      syncMs,
    };
  }
  if (cls.escalateTo) {
    return {
      result: baseResult,
      pendingAction: {
        kind: "escalate_telegram",
        incidentId,
        severity: cls.severity,
        incidentClass: cls.incidentClass,
        signal: sig,
        traceId: sig?.trace_id || traceId,
      },
      syncMs,
    };
  }
  return { result: baseResult, pendingAction: null, syncMs };
}

async function defaultExecuteRecovery() {
  return { ok: false, detail: "recovery_not_wired_in_js_tick", duration_ms: 0, verified: false, verify_detail: "skipped" };
}

async function defaultSendTelegram() {
  return false;
}

async function applyPendingAction(db, pending, hooks, result) {
  if (!pending) return;
  const nowIso = new Date().toISOString();
  if (pending.kind === "recovery") {
    const exec = hooks.executeRecovery || defaultExecuteRecovery;
    const { ok, detail, duration_ms, verified, verify_detail } = await exec(
      pending.recovery,
      pending.signal,
      pending.traceId,
    );
    persistAction(db, {
      incident_id: pending.incidentId,
      action_at: nowIso,
      action_kind: pending.recovery,
      action_target: pending.signal?.daemon_name ?? null,
      action_args: pending.signal,
      action_result: ok ? "ok" : "failed",
      action_result_detail: detail,
      trace_id: pending.traceId,
      duration_ms: duration_ms ?? 0,
    });
    result.actions.push({ action: pending.recovery, ok, detail });
    if (ok && verified) {
      updateIncidentStatus(db, pending.incidentId, "resolved", "recovery_succeeded", pending.detectedAt);
      result.status = "resolved";
      result.outcome = "recovery_succeeded";
    } else {
      updateIncidentStatus(db, pending.incidentId, "escalated", "recovery_failed", pending.detectedAt);
      result.status = "escalated";
      result.outcome = "recovery_failed";
      result.actions.push({
        action: "escalate",
        ok: true,
        detail: `recovery failed: ${detail}, verify: ${verify_detail}`,
      });
    }
    return;
  }
  if (pending.kind === "escalate_telegram") {
    const send = hooks.sendTelegram || defaultSendTelegram;
    const message = `🚨 [Incident/${pending.severity}] ${pending.incidentClass}: ${
      pending.signal?.message || JSON.stringify(pending.signal).slice(0, 200)
    }`;
    const sent = await send(message);
    result.actions.push({
      action: "send_telegram",
      ok: sent,
      detail: sent ? "escalation sent" : "send_failed",
    });
    persistAction(db, {
      incident_id: pending.incidentId,
      action_at: nowIso,
      action_kind: "send_telegram",
      action_target: null,
      action_args: { message },
      action_result: sent ? "ok" : "failed",
      action_result_detail: "telegram_delivery",
      trace_id: pending.traceId,
      duration_ms: 0,
    });
  }
}

/**
 * Process a signal list with slice yields + wall-time cap.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {object[]} signals
 * @param {object} [opts]
 * @param {number} [opts.signalsPerSlice] K (default INCIDENT_SIGNALS_PER_SLICE)
 * @param {number} [opts.tickWallMs] wall budget (default INCIDENT_TICK_WALL_MS); Infinity = unchunked drain
 * @param {boolean} [opts.chunked=true] when false: no yields, unlimited wall (reference path)
 * @param {function} [opts.now] () => ms
 * @param {function} [opts.onSyncSlice] ({ sliceIndex, signalCount, syncMs }) => void
 * @param {object} [opts.hooks] { executeRecovery, sendTelegram }
 */
export async function processSignalBacklog(db, signals, opts = {}) {
  ensureIncidentSchema(db);
  const chunked = opts.chunked !== false;
  const K = chunked
    ? Math.max(1, opts.signalsPerSlice ?? INCIDENT_SIGNALS_PER_SLICE)
    : Math.max(signals.length, 1);
  const wallMs = chunked
    ? opts.tickWallMs ?? INCIDENT_TICK_WALL_MS
    : Number.POSITIVE_INFINITY;
  const now = opts.now || (() => Date.now());
  const started = now();
  const traceId = opts.traceId || randomUUID();
  const hooks = opts.hooks || {};
  const results = [];
  const sliceSyncMs = [];
  let cursor = 0;
  let sliceIndex = 0;
  let truncated = false;

  while (cursor < signals.length) {
    if (chunked && now() - started >= wallMs) {
      truncated = true;
      break;
    }

    const slice = signals.slice(cursor, cursor + K);
    const syncT0 = performance.now();

    // Batch the dedupe lookup for this slice: one set-based query instead of
    // one per-row .get() per signal. The recent map is keyed by
    // `${incident_class}\x00${source}`.
    const dedupeCutoff = new Date(
      Date.parse(opts.nowIso || new Date().toISOString()) -
        DEDUPE_WINDOW_MINUTES * 60_000,
    ).toISOString();
    const classSourcePairs = slice.map((sig) => {
      const cls = classifyForWatch(sig);
      return [cls.incidentClass, sig?.source || "unknown"];
    });
    const recentMap = buildRecentIncidentMap(db, classSourcePairs, dedupeCutoff);

    const decided = [];
    /** @type {Map<string, number>} tracks first inserts within this slice for exact same-pass dedupe parity. */
    const sliceFirstInsert = new Map();
    for (const sig of slice) {
      // Stop mid-slice only between signals if wall already blown (rare).
      if (chunked && decided.length > 0 && now() - started >= wallMs) {
        truncated = true;
        break;
      }
      const cls = classifyForWatch(sig);
      const source = sig?.source || "unknown";
      const key = `${cls.incidentClass}\x00${source}`;
      let recent = recentMap.get(key) || null;
      if (sliceFirstInsert.has(key)) {
        // A prior signal in this same slice already inserted for this class/source.
        // Preserve exact old behavior: subsequent ones dedupe against that insert.
        recent = { id: sliceFirstInsert.get(key), status: "active", outcome: null };
      }
      const d = decideOneSignal(db, sig, {
        traceId,
        nowIso: opts.nowIso,
        recentIncident: recent,
      });
      if (d.result.incident_id && d.result.status !== "deduped" && !sliceFirstInsert.has(key)) {
        sliceFirstInsert.set(key, d.result.incident_id);
      }
      decided.push(d);
    }
    const syncMs = performance.now() - syncT0;
    sliceSyncMs.push(syncMs);
    if (typeof opts.onSyncSlice === "function") {
      opts.onSyncSlice({
        sliceIndex,
        signalCount: decided.length,
        syncMs,
      });
    }

    for (const d of decided) {
      await applyPendingAction(db, d.pendingAction, hooks, d.result);
      results.push(d.result);
    }

    cursor += decided.length;
    sliceIndex += 1;

    if (truncated) break;
    if (cursor < signals.length && chunked) {
      await yieldToEventLoop();
    }
  }

  return {
    results,
    processed: results.length,
    remaining: signals.length - cursor,
    truncated,
    sliceSyncMs,
    signalsPerSlice: K,
    tickWallMs: wallMs,
    durationMs: now() - started,
    traceId,
  };
}

/** Process-local carry: unprocessed tail from a wall-truncated tick. */
let _signalBacklog = [];

/** Test/helper: peek or replace the carry-over backlog. */
export function _backlogForTest(next) {
  if (arguments.length > 0) {
    _signalBacklog = Array.isArray(next) ? next.slice() : [];
  }
  return _signalBacklog.slice();
}

/**
 * Full incident_watch observation (MCP shape), from an explicit signal list
 * or a gatherSignals() hook.
 *
 * Backlog carry: when the ~2s wall truncates, the unprocessed tail is kept
 * and drained on the next tick before a fresh gather. Dedupe (5m class/source)
 * still applies, so overlapping gathers cannot double-create.
 */
export async function runIncidentWatchTick(opts = {}) {
  const db = opts.db;
  if (!db) throw new Error("runIncidentWatchTick requires opts.db");
  const sinceMinutes = opts.since_minutes ?? opts.sinceMinutes ?? 10;

  let signals;
  if (opts.signals) {
    signals = opts.signals;
  } else if (_signalBacklog.length > 0 && opts.useBacklog !== false) {
    signals = _signalBacklog;
  } else if (typeof opts.gatherSignals === "function") {
    signals = await opts.gatherSignals(sinceMinutes);
  } else {
    signals = [];
  }

  const pass = await processSignalBacklog(db, signals, opts);

  if (opts.useBacklog !== false && !opts.signals) {
    _signalBacklog = pass.remaining > 0
      ? signals.slice(signals.length - pass.remaining)
      : [];
  }

  const alertLevel = pass.results.some((r) => r.status === "escalated")
    ? "warn"
    : "none";
  const observation = {
    kind: "incident_watch",
    trace_id: pass.traceId,
    since_minutes: sinceMinutes,
    signals_observed: signals.length,
    incidents_processed: pass.processed,
    signals_remaining: pass.remaining,
    truncated: pass.truncated,
    signals_per_slice: pass.signalsPerSlice,
    results: pass.results,
  };
  return {
    ok: true,
    tool: "incident_watch",
    source_url: "incident://watch",
    observed_at: new Date().toISOString(),
    observation,
    alert_level: alertLevel,
    alert_reason: null,
    trace_id: pass.traceId,
    _tick: {
      sliceSyncMs: pass.sliceSyncMs,
      durationMs: pass.durationMs,
      truncated: pass.truncated,
      remaining: pass.remaining,
      backlog: _signalBacklog.length,
    },
  };
}

/** Stable decision fingerprint for chunked vs unchunked equality checks. */
export function decisionFingerprint(results) {
  return results.map((r) => {
    if (r.status === "deduped") {
      return `deduped:${r.incident_class}:${r.recent_incident_id != null ? "has_id" : "no_id"}`;
    }
    return [
      r.incident_class,
      r.source || "",
      r.severity || "",
      r.status,
      r.outcome || "",
    ].join("|");
  });
}

/** Persisted-row fingerprint (ignores ids / timestamps) for multi-tick drain checks. */
export function persistedDecisionFingerprint(db) {
  const rows = db
    .prepare(
      `SELECT incident_class, source, severity, status, outcome
       FROM incident_state ORDER BY incident_class, source`,
    )
    .all();
  return rows.map(
    (r) =>
      `${r.incident_class}|${r.source}|${r.severity}|${r.status}|${r.outcome || ""}`,
  );
}
