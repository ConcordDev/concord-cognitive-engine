/**
 * HTTP envelope for POST /api/lens/run and the generic artifact routes.
 *
 * A handler that returns `{ ok:false, error }` used to be wrapped as
 * `res.json({ ok:true, result })` — HTTP 200 — and `_unwrapLensEnvelope`
 * peeled any failure that also carried a `result` key, so the client saw a
 * success payload (staking `insufficient_balance` with `{ balance, required }`
 * is the money-path instance). Callers that check the outer `ok` then report
 * a lock, a created project, a deleted media row that never happened.
 *
 * `shapeLensRunHttp` lifts that failure to the top of the body and picks a
 * 4xx status, except the exact reason `missing_api_key`, which stays HTTP 200.
 * That reason is an operator config gap (AirNow, FRED, NPS, OpenWeatherMap),
 * and the panels render `{ ok:false, reason:'missing_api_key', envVar, signupUrl }`
 * as the honest "needs a key" state. HTTP 422 makes the browser log
 * "Failed to load resource" for that answer. Other `missing_*` reasons stay
 * 422. `unknown_macro` and the brain catch-all stay on their existing
 * explicit HTTP 200 path in server.js — those are non-retryable "not a macro"
 * answers, not a handler refusing the action. 502/503/504 are the axios retry
 * set; nothing this module returns is in that set.
 */

/**
 * @param {string} error
 * @param {object} [raw]
 * @returns {number}
 */
export function httpStatusForLensFailure(error, raw = {}) {
  const e = String(error || "").trim().toLowerCase();
  const code = String(raw?.code || "").trim().toLowerCase();

  if (
    e === "insufficient_balance" ||
    e.includes("insufficient_balance") ||
    e.includes("insufficient balance")
  ) {
    return 409;
  }

  if (
    e === "not_found" ||
    e === "not found" ||
    e.endsWith(" not found") ||
    e.includes("not_found")
  ) {
    return 404;
  }

  if (
    e.startsWith("forbidden") ||
    e.startsWith("unauthorized") ||
    e.includes("unauthorized") ||
    e.includes("not authorized") ||
    e.includes("permission") ||
    e === "scope_denied" ||
    e === "no_actor" ||
    e.includes("authentication required") ||
    code === "forbidden" ||
    code === "auth_required"
  ) {
    return 403;
  }

  // Exact match only. `missing_inputs` / `missing_world_id` and the rest of
  // the missing_* validation family stay 422 below.
  if (e === "missing_api_key") return 200;

  // Shared input validator. Must precede the invalid_* → 422 rule.
  // invalid_status / invalid_transition stay 422.
  if (e === "invalid_input") return 400;

  if (
    e === "validation_failed" ||
    e === "invalid_transition" ||
    e.startsWith("invalid_") ||
    e.startsWith("invalid ") ||
    e.includes("validation") ||
    e.startsWith("missing_") ||
    e.startsWith("min_stake") ||
    e === "unknown_pool" ||
    e.includes("required") ||
    code === "validation_error"
  ) {
    return 422;
  }

  // Any other handler refusal is still a client-visible failure, not a 200.
  // 400 stays out of the axios retry set.
  return 400;
}

function isFailure(value) {
  return !!value && typeof value === "object" && value.ok === false;
}

/**
 * @param {object} raw handler return value
 * @returns {{ status: number, body: object }}
 */
export function shapeLensRunHttp(raw) {
  if (isFailure(raw)) return failureResponse(raw);
  // Peel exactly one success envelope. A failure is never peeled: peeling
  // `{ ok:false, error, result }` is what presented the inner payload as
  // `{ ok:true, result }` to the client.
  const unwrapped =
    raw && typeof raw === "object" && "ok" in raw && "result" in raw && raw.ok !== false
      ? raw.result
      : raw;
  if (isFailure(unwrapped)) return failureResponse(unwrapped);
  const body = { ok: true, result: unwrapped === undefined ? null : unwrapped };
  // An idempotent repeat (e.g. paying an already-paid bill) answers
  // `{ ok:true, unchanged:true, result }`. Peeling the envelope used to drop
  // that flag, so the client could not tell "done now" from "already done".
  if (unwrapped !== raw && raw.unchanged === true) {
    body.unchanged = true;
    if (body.result && typeof body.result === "object" && !Array.isArray(body.result) && body.result.unchanged === undefined) {
      body.result = { ...body.result, unchanged: true };
    }
  }
  return { status: 200, body };
}

function failureResponse(raw) {
  const error = String(raw.error || raw.reason || "lens_failed");
  const status = httpStatusForLensFailure(error, raw);
  const body = { ...raw, ok: false, error };
  return { status, body };
}

/**
 * Artifact create / update / delete. `validation_failed` is 422. Other
 * `{ ok:false }` results use the same status map so a delete does not
 * report HTTP 200 for "not found" or "not authorized".
 *
 * @param {import("express").Response} res
 * @param {object} out
 */
export function respondMacroResult(res, out) {
  if (isFailure(out)) {
    const error = String(out.error || out.reason || "lens_failed");
    return res.status(httpStatusForLensFailure(error, out)).json(out);
  }
  return res.json(out);
}
