/**
 * Centralized error class hierarchy for Concord.
 *
 * Usage:
 *   throw new ValidationError('Email is required', { field: 'email' });
 *   throw new AuthError('Session expired', 'SESSION_EXPIRED');
 *   throw new NetworkError('Unable to reach server');
 *
 * All errors extend ConcordError which carries a `code` for programmatic handling.
 */

export class ConcordError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code = 'CONCORD_ERROR',
    statusCode = 500,
    context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ConcordError';
    this.code = code;
    this.statusCode = statusCode;
    this.context = context;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.context ? { context: this.context } : {}),
    };
  }
}

/** Authentication / authorization errors (401, 403) */
export class AuthError extends ConcordError {
  constructor(message = 'Authentication required', code = 'AUTH_ERROR') {
    super(message, code, 401);
    this.name = 'AuthError';
  }
}

/** Session expired specifically */
export class SessionExpiredError extends AuthError {
  constructor() {
    super('Session expired. Please log in again.', 'SESSION_EXPIRED');
    this.name = 'SessionExpiredError';
  }
}

/** Forbidden - user lacks permission */
export class ForbiddenError extends ConcordError {
  constructor(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    super(message, code, 403);
    this.name = 'ForbiddenError';
  }
}

/** Input validation errors (400) */
export class ValidationError extends ConcordError {
  readonly field?: string;

  constructor(message: string, context?: { field?: string; [key: string]: unknown }) {
    super(message, 'VALIDATION_ERROR', 400, context);
    this.name = 'ValidationError';
    this.field = context?.field as string | undefined;
  }
}

/** Resource not found (404) */
export class NotFoundError extends ConcordError {
  constructor(resource = 'Resource', id?: string) {
    super(
      id ? `${resource} "${id}" not found` : `${resource} not found`,
      'NOT_FOUND',
      404,
      { resource, id }
    );
    this.name = 'NotFoundError';
  }
}

/** Network / connectivity errors */
export class NetworkError extends ConcordError {
  constructor(message = 'Unable to connect to the server') {
    super(message, 'NETWORK_ERROR', 0);
    this.name = 'NetworkError';
  }
}

/** Rate limit exceeded (429) */
export class RateLimitError extends ConcordError {
  readonly retryAfter?: number;

  constructor(retryAfter?: number) {
    super(
      retryAfter
        ? `Too many requests. Please wait ${retryAfter} seconds.`
        : 'Too many requests. Please wait a moment.',
      'RATE_LIMITED',
      429,
      retryAfter ? { retryAfter } : undefined
    );
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/** Version conflict (409) */
export class ConflictError extends ConcordError {
  constructor(message = 'This resource was modified by another process') {
    super(message, 'CONFLICT', 409);
    this.name = 'ConflictError';
  }
}

/** Server error (500+) */
export class ServerError extends ConcordError {
  constructor(message = 'An internal server error occurred', statusCode = 500) {
    super(message, 'SERVER_ERROR', statusCode);
    this.name = 'ServerError';
  }
}

/**
 * Convert an axios error (or unknown error) into the appropriate ConcordError subclass.
 * Useful in catch blocks to normalize errors.
 */
export function fromAxiosError(error: unknown): ConcordError {
  if (error instanceof ConcordError) return error;

  // Axios error shape
  const axiosErr = error as {
    response?: { status: number; data?: { error?: string; code?: string; message?: string } };
    message?: string;
    code?: string;
  };

  if (!axiosErr.response) {
    // Network error
    if (axiosErr.code === 'ECONNABORTED') {
      return new NetworkError('Request timed out');
    }
    return new NetworkError(axiosErr.message);
  }

  const { status, data } = axiosErr.response;
  const body = data as {
    error?: string;
    code?: string;
    message?: string;
    reason?: string;
    violations?: string[];
  } | undefined;
  if (status === 503 && (body?.reason === 'shutting_down' || body?.code === 'shutting_down')) {
    return new ServerError('Server restarting, try again.', 503);
  }
  const msg = data?.error || data?.message || axiosErr.message || 'Unknown error';
  const violations = Array.isArray(body?.violations) ? body.violations : undefined;

  switch (status) {
    case 400: {
      const fullMsg = violations?.length ? `${msg}: ${violations.join('; ')}` : msg;
      return new ValidationError(fullMsg, {
        ...(violations ? { violations } : {}),
        ...(body?.code ? { apiCode: body.code } : {}),
      });
    }
    case 401:
      return new SessionExpiredError();
    case 403:
      if (data?.code === 'CSRF_FAILED') {
        return new ForbiddenError('CSRF token expired. Please retry.');
      }
      return new ForbiddenError(msg);
    case 404:
      return new NotFoundError(msg);
    case 409:
      return new ConflictError(msg);
    case 429:
      return new RateLimitError();
    default:
      if (status >= 500) return new ServerError(msg, status);
      return new ConcordError(msg, data?.code || 'UNKNOWN', status);
  }
}

/**
 * Get a user-friendly message from any error.
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof ConcordError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}
