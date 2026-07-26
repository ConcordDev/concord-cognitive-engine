// server/lib/marathon-tick-durability.js
//
// ConKay-E — crash-forensics primitive for marathon tool calls.
//
// NOT a general logging framework. This module exists to answer exactly
// one question after a marathon process is killed mid-tick: "which tool
// call was in flight when the process died?" (migration 394,
// `agent_marathon_tool_log`.)
//
// Durability contract:
//   - recordToolDispatch performs a SYNCHRONOUS (better-sqlite3) INSERT
//     that lands on disk BEFORE the caller (agent-marathon.js#createToolGate)
//     lets the tool actually execute. If the process is killed between that
//     insert and the matching recordToolOutcome call, the row is left at
//     status='dispatched' forever — that IS the evidence. A resumed
//     marathon (or an operator) can query
//     `SELECT * FROM agent_marathon_tool_log WHERE session_id = ? AND
//      status = 'dispatched'` to find exactly the call that was running at
//     time of death.
//   - recordToolOutcome is a best-effort UPDATE once the tool call actually
//     resolves (ok or error) — it flips the row to 'completed'/'failed'.
//
// Both functions are best-effort from the CALLER's point of view (the
// caller wraps them in try/catch) but recordToolDispatch's own write must
// stay a real, immediate, synchronous write — never deferred/batched/async
// — or it stops being trustworthy evidence of an in-flight crash.
//
// call_seq is a monotonic per-session sequence computed fresh from the DB
// (MAX(call_seq)+1 for that session_id) rather than an in-memory counter,
// so numbering survives across ticks AND across process restarts: a
// crashed tick's dispatched-but-never-completed row keeps its call_seq,
// and the NEXT tick (a fresh process, a fresh createToolGate closure)
// simply continues counting forward from wherever the DB left off.

const MAX_PARAMS_LEN = 2000;
const MAX_SUMMARY_LEN = 2000;

/**
 * A truncated JSON rendering of a tool call's params — deliberately NOT a
 * bare hash/fingerprint. This table's whole purpose is crash forensics: a
 * human resuming a marathon after a crash needs to see what the in-flight
 * call was actually doing, not just verify equality against an opaque
 * digest. Truncated defensively so a pathologically large payload (e.g. a
 * huge browser_act actions array) can't bloat the log table.
 */
function _safeParamsJson(params) {
  try {
    const s = JSON.stringify(params ?? {});
    if (typeof s !== "string") return null;
    return s.length > MAX_PARAMS_LEN ? s.slice(0, MAX_PARAMS_LEN) : s;
  } catch {
    return null;
  }
}

function _safeSummary(resultSummary) {
  try {
    const s = typeof resultSummary === "string" ? resultSummary : JSON.stringify(resultSummary ?? null);
    if (typeof s !== "string") return null;
    return s.length > MAX_SUMMARY_LEN ? s.slice(0, MAX_SUMMARY_LEN) : s;
  } catch {
    return null;
  }
}

/**
 * Write the 'dispatched' row for a real tool-call attempt. MUST be called
 * synchronously, right before the tool actually executes — that's what
 * makes a stuck 'dispatched' row meaningful crash evidence.
 *
 * @param {object} db          better-sqlite3 handle
 * @param {string} sessionId   agent_marathon_sessions.id
 * @param {number} [tickSeq]   which tickMarathon() call this happened in (informational)
 * @param {string} toolName    call.tool
 * @param {object} [params]    call.params — stored truncated, see _safeParamsJson
 * @returns {number|null}      the new log row id, or null on any failure
 *                              (missing table, closed db, etc. — never throws)
 */
export function recordToolDispatch(db, sessionId, tickSeq, toolName, params) {
  if (!db || !sessionId || !toolName) return null;
  try {
    const row = db.prepare(`
      SELECT COALESCE(MAX(call_seq), 0) AS m FROM agent_marathon_tool_log WHERE session_id = ?
    `).get(sessionId);
    const callSeq = (row?.m || 0) + 1;
    const info = db.prepare(`
      INSERT INTO agent_marathon_tool_log
        (session_id, tick_seq, call_seq, tool_name, params_json, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'dispatched', unixepoch())
    `).run(
      sessionId,
      Number.isFinite(tickSeq) ? tickSeq : null,
      callSeq,
      String(toolName),
      _safeParamsJson(params),
    );
    return info.lastInsertRowid;
  } catch {
    // Table absent (pre-394 schema) or any other write failure — this is a
    // best-effort forensics log, never a gate on the tool call itself.
    return null;
  }
}

/**
 * Flip a dispatched row to its terminal outcome. Safe to call at most once
 * per logRowId — a second call would just re-write the same terminal state.
 *
 * @param {object} db
 * @param {number|bigint} logRowId  the id returned by recordToolDispatch
 * @param {string} status           'completed' | 'failed' (anything else
 *                                   is coerced to 'failed' — an outcome
 *                                   write always means SOME terminal state,
 *                                   never a silent no-op)
 * @param {*} [resultSummary]       short human-legible outcome — an error
 *                                   message, or the tool result — stored
 *                                   truncated, see _safeSummary
 * @returns {boolean} true if the row was updated
 */
export function recordToolOutcome(db, logRowId, status, resultSummary) {
  if (!db || logRowId == null) return false;
  const safeStatus = (status === "completed" || status === "failed") ? status : "failed";
  try {
    db.prepare(`
      UPDATE agent_marathon_tool_log
      SET status = ?, result_summary = ?, completed_at = unixepoch()
      WHERE id = ?
    `).run(safeStatus, _safeSummary(resultSummary), logRowId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read helper (not used on the hot path) — every dispatched-but-never-
 * completed call for a session, in call order. This is the exact query an
 * operator or a resumed marathon would run to find "what was in flight
 * when things died."
 *
 * @param {object} db
 * @param {string} sessionId
 * @returns {Array<object>}
 */
export function findStuckDispatches(db, sessionId) {
  if (!db || !sessionId) return [];
  try {
    return db.prepare(`
      SELECT * FROM agent_marathon_tool_log
      WHERE session_id = ? AND status = 'dispatched'
      ORDER BY call_seq ASC
    `).all(sessionId);
  } catch {
    return [];
  }
}
