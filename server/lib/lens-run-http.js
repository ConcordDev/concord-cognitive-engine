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
 * set; nothing this module returns is in that set, with ONE opt-in exception:
 * the geocoder's `geocoder_unavailable` code returns 503, and the client is
 * taught not to auto-retry that code (see httpStatusForLensFailure).
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

  // The ONE opt-in 503: atlas (and automotive's shop locator) mark a real
  // Nominatim outage with code / error "geocoder_unavailable". The body
  // carries retryAfterS for the user, and the client never auto-retries
  // this code (lib/api/client.ts), so the 503 cannot turn into a retry
  // storm against the geocoder's 1 req/s door. Exact match only — every
  // other upstream failure keeps the 200 treatment below.
  if (e === "geocoder_unavailable" || code === "geocoder_unavailable") return 503;

  // Upstream outages are not client faults either (Phase-1 C2). A handler
  // that flags its failure as an upstream problem — `upstream_unavailable`,
  // the `<source>_unreachable` reason family the live-feed macros return
  // (opentdb_unreachable, nasa_apod_unreachable, usda_unreachable, …), or
  // `upstream_rate_limited` — gets the same HTTP 200 treatment as
  // `missing_api_key`: the body still says { ok:false, reason }, panels
  // render their honest "unavailable" state, and the browser does not log
  // a 4xx resource error for a third-party outage. The check reads the
  // reason channel as well as the error string, because most feed
  // handlers put the exception text in `error` and the stable token in
  // `reason`.
  //
  // Bare `rate_limited` is deliberately NOT here: it is Concord's OWN
  // per-user / per-macro throttle (runMacro's checkMacroRateLimit,
  // quests.reportObjective's cooldown, combat/chat limiters). Those are
  // client-side "slow down" answers and must stay non-200. Only a handler
  // that explicitly marks a third-party 429 as `upstream_rate_limited`
  // gets the 200 treatment.
  const reason = String(raw?.reason || "").trim().toLowerCase();
  if (
    e === "upstream_unavailable" || e.endsWith("_unreachable") || e === "upstream_rate_limited" ||
    reason === "upstream_unavailable" || reason.endsWith("_unreachable") || reason === "upstream_rate_limited"
  ) {
    return 200;
  }

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

  // A handler that did async work and then FAILED because the work timed out or an upstream was unreachable
  // is not a client fault: it used to fall through to the 400 below, so 19-25 s calls (the 20 s catch-all /
  // upstream abort windows) came back as "400 Bad Request" and read as bad input. Same 200 + { ok:false }
  // treatment as the `_unreachable` family above: non-retryable (502/503/504 are the axios retry set), honest
  // body, no browser resource error. Placed AFTER the validation rules so `invalid_timeout`-style input names
  // keep their 422, and matched on whole tokens of the error or reason channel.
  if (UPSTREAM_FAILURE_RE.test(e) || UPSTREAM_FAILURE_RE.test(reason)) return 200;

  // Any other handler refusal is still a client-visible failure, not a 200.
  // 400 stays out of the axios retry set.
  return 400;
}

const UPSTREAM_FAILURE_RE = /(^|[^a-z])(timeout|timed out|aborted|fetch failed|etimedout|econnrefused|econnreset|enotfound|eai_again|socket hang up)([^a-z]|$)/;

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
