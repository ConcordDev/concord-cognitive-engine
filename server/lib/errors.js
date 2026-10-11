import { trySendShutdownError } from "./shutdown-http.js";

/**
 * Concord Cognitive Engine — Custom Error Hierarchy
 *
 * Provides structured, typed errors with error codes, HTTP status mapping,
 * and context preservation through the call stack.
 *
 * Usage:
 *   import { ValidationError, AuthError, NotFoundError } from './lib/errors.js';
 *
 *   throw new ValidationError('Email is required', { field: 'email' });
 *   throw new AuthError('Token expired');
 *   throw new NotFoundError('DTU', 'abc123');
 *
 * In error middleware:
 *   if (err instanceof ConcordError) {
 *     return res.status(err.statusCode).json(err.toJSON());
 *   }
 */

/**
 * Base error for all Concord-specific errors.
 * Preserves error context and provides consistent serialization.
 */
export class ConcordError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {object} [options]
   * @param {string} [options.code] - Machine-readable error code (e.g. "DTU_NOT_FOUND")
   * @param {number} [options.statusCode] - HTTP status code (default: 500)
   * @param {object} [options.context] - Additional context for debugging
   * @param {Error}  [options.cause] - Original error that caused this one
   */
  constructor(message, { code = "INTERNAL_ERROR", statusCode = 500, context = {}, cause } = {}) {
    super(message, { cause });
    this.name = "ConcordError";
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
    this.timestamp = new Date().toISOString();
  }

  /** Serialize for API responses (safe for clients — no stack trace). */
  toJSON() {
    return {
      ok: false,
      error: this.message,
      code: this.code,
      ...(this.context && Object.keys(this.context).length > 0 ? { context: this.context } : {}),
    };
  }
}

/** 400 — client sent invalid input. */
export class ValidationError extends ConcordError {
  constructor(message, context = {}) {
    super(message, { code: "VALIDATION_ERROR", statusCode: 400, context });
    this.name = "ValidationError";
  }
}

/** 401 — authentication required or failed. */
export class AuthenticationError extends ConcordError {
  constructor(message = "Authentication required", context = {}) {
    super(message, { code: "AUTH_REQUIRED", statusCode: 401, context });
    this.name = "AuthenticationError";
  }
}

/** 401 — alias for AuthenticationError. */
export { AuthenticationError as AuthError };

/** 403 — authenticated but not authorized for this action. */
export class AuthorizationError extends ConcordError {
  constructor(message = "Insufficient permissions", context = {}) {
    super(message, { code: "FORBIDDEN", statusCode: 403, context });
    this.name = "AuthorizationError";
  }
}

/** 403 — alias for AuthorizationError. */
export { AuthorizationError as ForbiddenError };

/** 404 — requested resource doesn't exist. */
export class NotFoundError extends ConcordError {
  constructor(resource = "Resource", id, context = {}) {
    super(`${resource} not found${id ? `: ${id}` : ""}`, {
      code: "NOT_FOUND",
      statusCode: 404,
      context: { resource, id, ...context },
    });
    this.name = "NotFoundError";
  }
}

/** 409 — write conflict (optimistic concurrency). */
export class ConflictError extends ConcordError {
  constructor(message = "Resource conflict", context = {}) {
    super(message, { code: "CONFLICT", statusCode: 409, context });
    this.name = "ConflictError";
  }
}

/** 429 — rate limit exceeded. */
export class RateLimitError extends ConcordError {
  constructor(message = "Rate limit exceeded", context = {}) {
    super(message, { code: "RATE_LIMITED", statusCode: 429, context });
    this.name = "RateLimitError";
  }
}

/** 503 — downstream service (LLM, DB, etc.) unavailable. */
export class ServiceUnavailableError extends ConcordError {
  constructor(service = "service", context = {}) {
    super(`${service} is currently unavailable`, {
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      context: { service, ...context },
    });
    this.name = "ServiceUnavailableError";
  }
}

/** 500 — database operation failed. */
export class DatabaseError extends ConcordError {
  constructor(message, context = {}) {
    super(message, { code: "DATABASE_ERROR", statusCode: 500, context });
    this.name = "DatabaseError";
  }
}

/** 500 — alias for generic server error. */
export class ServerError extends ConcordError {
  constructor(message = "Internal server error", statusCode = 500) {
    super(message, { code: "SERVER_ERROR", statusCode });
    this.name = "ServerError";
  }
}

/**
 * Express error handler middleware that knows about ConcordError subclasses.
 *
 * Usage: app.use(concordErrorHandler);
 */
export function concordErrorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  // Closed SQLite, or a write refused because shutdown already sealed it,
  // is a restart — 503 shutting_down, never a 500.
  if (trySendShutdownError(err, res)) return;

  if (err instanceof ConcordError) {
    return res.status(err.statusCode).json(err.toJSON());
  }

  // Fallback for unknown errors
  const msg = String(err?.message || err || 'Unknown error');
  res.status(500).json({ ok: false, error: msg, code: 'INTERNAL_ERROR' });
}
