/**
 * Concord Cognitive Engine — Async Route Handler Wrapper
 *
 * Wraps Express async route handlers to ensure unhandled promise rejections
 * are properly caught and forwarded to Express error middleware.
 *
 * Without this, Express 4.x silently swallows async errors, causing
 * requests to hang indefinitely.
 *
 * @example
 *   import { asyncHandler } from "./lib/async-handler.js";
 *   app.get("/api/dtus", asyncHandler(async (req, res) => {
 *     const result = await fetchDtus();
 *     res.json(result);
 *   }));
 */

import { ConcordError } from "./errors.js";
import { trySendShutdownError } from "./shutdown-http.js";

/**
 * Wrap an async Express route handler so rejected promises flow to next(err).
 *
 * @param {Function} fn - Async route handler (req, res, next) => Promise<void>
 * @returns {Function} Express-compatible route handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Central Express error-handling middleware.
 * Converts ConcordError instances into structured JSON responses
 * and logs all errors via structuredLog.
 *
 * @param {Function} structuredLog - The server's structured logger
 * @returns {Function} Express error middleware (err, req, res, next)
 */
export function createErrorMiddleware(structuredLog) {
  return (err, req, res, _next) => {
    // If headers already sent, delegate to Express default handler
    if (res.headersSent) {
      return;
    }

    if (trySendShutdownError(err, res)) {
      try {
        structuredLog("warn", "shutdown_request_after_close", {
          requestId: req.id,
          method: req.method,
          path: req.path,
          error: String(err?.message || err),
        });
      } catch { /* logging must not turn a 503 into an unhandled throw */ }
      return;
    }

    const statusCode = err instanceof ConcordError ? err.statusCode : 500;
    const code = err instanceof ConcordError ? err.code : "INTERNAL_ERROR";
    const message = err instanceof ConcordError ? err.message : "An unexpected error occurred";

    // Log with full context (stack included in logs, not in response)
    structuredLog(
      statusCode >= 500 ? "error" : "warn",
      "request_error",
      {
        requestId: req.id,
        method: req.method,
        path: req.path,
        statusCode,
        code,
        error: err.message,
        ...(statusCode >= 500 ? { stack: err.stack } : {}),
        ...(err.context || {}),
      }
    );

    res.status(statusCode).json({
      ok: false,
      error: message,
      code,
      ...(req.id ? { requestId: req.id } : {}),
    });
  };
}
