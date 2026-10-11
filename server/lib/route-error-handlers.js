/**
 * The two Express error handlers mounted from server.js.
 * Response bodies are unchanged. Each 5xx (and each 403/422/429) is
 * reported to the repair cortex before the response is written, so the
 * access log cannot double-count it.
 */

import { ConcordError } from "./errors.js";
import { isShutdownDbError, trySendShutdownError } from "./shutdown-http.js";
import { reportHttpFailure } from "./cortex-failure-signals.js";

function report(req, err, status) {
  try { reportHttpFailure(req, err, status); }
  catch { /* cortex must never change the response */ }
}

/**
 * First error handler (mounted before the later route groups).
 * @param {{ structuredLog: Function, repairError?: Function, extractFileFromStack?: Function, extractLineFromStack?: Function }} deps
 */
export function createEarlyRouteErrorHandler(deps) {
  const { structuredLog, repairError, extractFileFromStack, extractLineFromStack } = deps;
  return function earlyRouteErrorHandler(err, req, res, _next) {
    if (res.headersSent) return;

    if (isShutdownDbError(err)) report(req, err, 503);
    if (trySendShutdownError(err, res)) {
      structuredLog("warn", "shutdown_request_after_close", {
        requestId: req.id, method: req.method, path: req.path, error: String(err?.message || err),
      });
      return;
    }

    // Handle ConcordError subclasses with proper HTTP status and code
    if (err instanceof ConcordError) {
      report(req, err, err.statusCode);
      structuredLog(
        err.statusCode >= 500 ? "error" : "warn",
        "request_error",
        { requestId: req.id, method: req.method, path: req.path, statusCode: err.statusCode, code: err.code, error: err.message, ...(err.statusCode >= 500 ? { stack: err.stack } : {}), ...err.context }
      );
      return res.status(err.statusCode).json(err.toJSON());
    }

    // Handle CORS/Origin blocks
    if (err?.code === "ORIGIN_BLOCKED") {
      report(req, err, 403);
      structuredLog("warn", "origin_blocked", { ip: req.ip, reason: err?.reason });
      return res.status(403).json({ ok:false, error:"Origin blocked", code:"ORIGIN_BLOCKED" });
    }

    // Fallback for unknown errors — log full stack, return safe message
    const msg = String(err?.message || err);
    report(req, err, 500);
    structuredLog("error", "unhandled_route_error", { requestId: req.id, method: req.method, path: req.path, error: msg, stack: String(err?.stack || "") });
    res.status(500).json({ ok:false, error: "An unexpected error occurred", code: "INTERNAL_ERROR" });

    // Trigger repair cortex in background for 500-level errors
    if (typeof repairError === "function") {
      repairError({
        type: "api-error",
        message: msg,
        stack: String(err?.stack || ""),
        file: extractFileFromStack?.(String(err?.stack || "")) || null,
        line: extractLineFromStack?.(String(err?.stack || "")) || null,
        meta: { method: req.method, path: req.path },
      }).catch(() => {});
    }
  };
}

/**
 * Second error handler (routes mounted after the first one land here).
 * @param {{ structuredLog: Function, uid: Function, uiJson: Function, withAck: Function, version: string }} deps
 */
export function createLateRouteErrorHandler(deps) {
  const { structuredLog, uid, uiJson, withAck, version } = deps;
  return function lateRouteErrorHandler(err, req, res, _next) {
    if (res.headersSent) return;
    if (isShutdownDbError(err)) report(req, err, 503);
    if (trySendShutdownError(err, res)) {
      try {
        structuredLog("warn", "shutdown_request_after_close", {
          method: req.method, path: req.path, error: String(err?.message || err),
        });
      } catch { /* response already 503 */ }
      return;
    }
    // Routes mounted after the earlier error handler (including DELETE
    // /api/media/:id) land here. ConcordError already carries the right status
    // (404 not found, 403 forbidden, 400 validation). res.json() without a
    // status is HTTP 200, which made those deletes look successful.
    if (err instanceof ConcordError) {
      const status = err.statusCode || 500;
      report(req, err, status);
      return res.status(status).json({
        ok: false,
        error: err.message,
        code: err.code,
      });
    }
    const errorId = uid("err");
    const msg = String(err?.message || err || "Unknown error");
    const out = {
      ok: false,
      error: msg,
      mode: req?.body?.mode || "chat",
      sessionId: req?._concordSessionId || req?.body?.sessionId || req?.query?.sessionId || "default",
      llmUsed: false
    };
    try {
      return uiJson(res, withAck(out, req, ["logs"], ["/api/logs"], { id: errorId, status: "error" }, { errorId }), req, { errorId });
    } catch {
      report(req, err, 500);
      return res.status(500).json({
        ok: false,
        reply: "Internal error.",
        meta: { sessionId: out.sessionId, mode: out.mode, llmUsed: false, version, errorId }
      });
    }
  };
}
