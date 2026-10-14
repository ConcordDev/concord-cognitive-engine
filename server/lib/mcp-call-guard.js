// server/lib/mcp-call-guard.js
//
// Admission control for POST /mcp/call.
//
// Why not a wall-clock Promise.race timeout (Option A): macros run in-process
// through callMCPTool → runMacro / lens handlers with no AbortSignal plumbing.
// Racing a timer would return early to the HTTP client while the work keeps
// occupying the event loop (and retries would amplify load). That is the
// documented antipattern in embodied/npc-dialogue.js. Interruption is unsafe.
//
// What this does (Option B):
//   1. Cap concurrent /mcp/call executions (env CONCORD_MCP_CALL_MAX_CONCURRENT).
//      Excess calls get 503 busy_retry + Retry-After — same shape as load-shed.
//   2. Log each admitted call's tool name + durationMs for future tuning.
//
// In-budget calls keep identical semantics and results. This module does not
// wrap dispatchMCP for non-HTTP callers (mission runtime, organs).

import logger from "../logger.js";

const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_RETRY_AFTER_S = 5;

let _active = 0;
/** @type {((entry: {tool:string, durationMs:number, ok:boolean}) => void) | null} */
let _logSinkForTest = null;

function _positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export function getMcpCallMaxConcurrent() {
  return _positiveInt(process.env.CONCORD_MCP_CALL_MAX_CONCURRENT, DEFAULT_MAX_CONCURRENT);
}

export function getMcpCallRetryAfterS() {
  return _positiveInt(process.env.CONCORD_MCP_CALL_RETRY_AFTER_S, DEFAULT_RETRY_AFTER_S);
}

export function getMcpCallActiveCount() {
  return _active;
}

/**
 * Try to admit one /mcp/call execution slot.
 * @returns {{ ok: true } | { ok: false, retryAfterS: number, body: object }}
 */
export function tryAcquireMcpCall() {
  const limit = getMcpCallMaxConcurrent();
  if (_active >= limit) {
    const retryAfterS = getMcpCallRetryAfterS();
    return {
      ok: false,
      retryAfterS,
      body: {
        ok: false,
        error: "service_overloaded",
        code: "busy_retry",
        message: "Server is busy. Retry shortly.",
        reason: "mcp_call_concurrency_cap",
        active: _active,
        limit,
        retryAfterS,
      },
    };
  }
  _active += 1;
  return { ok: true };
}

export function releaseMcpCall() {
  _active = Math.max(0, _active - 1);
}

function _logDuration(tool, durationMs, ok) {
  const entry = { tool: String(tool || ""), durationMs, ok: ok !== false };
  if (typeof _logSinkForTest === "function") {
    try { _logSinkForTest(entry); } catch { /* test sink must not break prod path */ }
  }
  try {
    logger.log("info", "mcp", "mcp/call duration", entry);
  } catch { /* logging never fails the call */ }
}

/**
 * Run an admitted /mcp/call body under the concurrency cap + duration log.
 * Rejects admission without invoking `fn` when the cap is full.
 *
 * @param {string} tool
 * @param {() => Promise<any>} fn
 * @returns {Promise<
 *   | { admitted: true, result: any, durationMs: number }
 *   | { admitted: false, status: 503, retryAfterS: number, body: object }
 * >}
 */
export async function runGuardedMcpCall(tool, fn) {
  const gate = tryAcquireMcpCall();
  if (!gate.ok) {
    return {
      admitted: false,
      status: 503,
      retryAfterS: gate.retryAfterS,
      body: gate.body,
    };
  }
  const started = Date.now();
  let result;
  let ok = true;
  try {
    result = await fn();
    ok = result?.ok !== false;
    return { admitted: true, result, durationMs: Date.now() - started };
  } catch (err) {
    ok = false;
    throw err;
  } finally {
    const durationMs = Date.now() - started;
    releaseMcpCall();
    _logDuration(tool, durationMs, ok);
  }
}

/** @param {((entry: {tool:string, durationMs:number, ok:boolean}) => void) | null} sink */
export function _setMcpCallLogSinkForTest(sink) {
  _logSinkForTest = sink;
}

export function _resetMcpCallGuardForTest() {
  _active = 0;
  _logSinkForTest = null;
  delete process.env.CONCORD_MCP_CALL_MAX_CONCURRENT;
  delete process.env.CONCORD_MCP_CALL_RETRY_AFTER_S;
}
