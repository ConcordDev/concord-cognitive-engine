/**
 * Centralized HTTP error responder.
 *
 * Why: many routes return `res.status(5xx).json({ error: e.message })` which
 * leaks internal stack fragments / table names / SQL snippets to authenticated
 * clients in production. The fix is a one-call helper that:
 *
 *   - logs a structured error with the route name + sanitized payload
 *   - returns a redacted error message in production (NODE_ENV === "production")
 *   - returns the real e.message in dev/test for fast debugging
 *   - optionally accepts a `hint` string that is ALWAYS safe to surface
 *     (e.g. "world not found"), distinct from the redacted internal error
 *
 * Usage:
 *
 *   import { serverError } from "../lib/http-errors.js";
 *   try { ... } catch (e) { return serverError(res, e); }
 *
 *   // with status + safe hint:
 *   try { ... } catch (e) { return serverError(res, e, 503, "ollama unavailable"); }
 *
 * Distinct from 4xx responses: 4xx codes (validation, auth) are caused by
 * client input and benefit the caller — keep their messages plain.
 */

let _structuredLog = null;

/**
 * Allow callers (server.js bootstrap) to inject the structured logger.
 * Without injection, we fall back to console.error so the helper is
 * import-safe in tests that don't boot the full server.
 */
export function configureHttpErrorLogger(fn) {
  if (typeof fn === "function") _structuredLog = fn;
}

function safeLog(level, event, payload) {
  try {
    if (_structuredLog) _structuredLog(level, event, payload);
    else console.error(`[${level}] ${event}`, payload);
  } catch { /* logging best-effort */ }
}

/**
 * @param {import("express").Response} res
 * @param {unknown} err
 * @param {number} [statusCode=500]
 * @param {string} [hint]  user-safe explanation; surfaced to client in BOTH prod and dev
 * @returns {import("express").Response}
 */
export function serverError(res, err, statusCode = 500, hint = "") {
  const isProd = process.env.NODE_ENV === "production";
  const message = err?.message ? String(err.message) : String(err);
  const stack = err?.stack ? String(err.stack) : undefined;

  // Always log the real error server-side. The redaction is purely on
  // the wire response — operators reading logs see everything.
  safeLog("error", "http_500_response", {
    statusCode,
    message,
    stack,
    hint,
    path: res.req?.originalUrl || res.req?.url || null,
    method: res.req?.method || null,
  });

  const body = {
    error: isProd ? "Internal server error" : message,
  };
  if (hint) body.hint = hint;
  if (!isProd && stack) body.stack = stack;

  return res.status(statusCode).json(body);
}

/**
 * 4xx counterpart: client-friendly errors that always surface the message.
 * Use for validation / auth / not-found responses where the message is
 * itself the affordance ("missing required field 'name'").
 */
export function clientError(res, message, statusCode = 400, fields = undefined) {
  const body = { error: String(message) };
  if (fields) body.fields = fields;
  return res.status(statusCode).json(body);
}
