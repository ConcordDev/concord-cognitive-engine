import { describe, it, expect } from 'vitest';
import {
  ConcordError,
  AuthError,
  SessionExpiredError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  NetworkError,
  RateLimitError,
  ConflictError,
  ServerError,
  fromAxiosError,
  getUserMessage,
} from '@/lib/errors';

describe('Error Classes', () => {
  describe('ConcordError (base)', () => {
    it('creates with defaults', () => {
      const err = new ConcordError('test');
      expect(err.message).toBe('test');
      expect(err.code).toBe('CONCORD_ERROR');
      expect(err.statusCode).toBe(500);
      expect(err.name).toBe('ConcordError');
    });

    it('serializes to JSON', () => {
      const err = new ConcordError('test', 'CODE', 400, { extra: true });
      const json = err.toJSON();
      expect(json.message).toBe('test');
      expect(json.code).toBe('CODE');
      expect(json.statusCode).toBe(400);
      expect(json.context).toEqual({ extra: true });
    });

    it('is an instance of Error', () => {
      expect(new ConcordError('test')).toBeInstanceOf(Error);
    });
  });

  describe('AuthError', () => {
    it('defaults to 401', () => {
      const err = new AuthError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('AUTH_ERROR');
    });

    it('is instanceof ConcordError', () => {
      expect(new AuthError()).toBeInstanceOf(ConcordError);
    });
  });

  describe('SessionExpiredError', () => {
    it('has specific message and code', () => {
      const err = new SessionExpiredError();
      expect(err.message).toContain('Session expired');
      expect(err.code).toBe('SESSION_EXPIRED');
      expect(err.statusCode).toBe(401);
    });
  });

  describe('ForbiddenError', () => {
    it('defaults to 403', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });
  });

  describe('ValidationError', () => {
    it('carries field context', () => {
      const err = new ValidationError('Email is required', { field: 'email' });
      expect(err.statusCode).toBe(400);
      expect(err.field).toBe('email');
      expect(err.context?.field).toBe('email');
    });
  });

  describe('NotFoundError', () => {
    it('formats resource name and id', () => {
      const err = new NotFoundError('DTU', 'abc123');
      expect(err.message).toBe('DTU "abc123" not found');
      expect(err.statusCode).toBe(404);
    });

    it('works without id', () => {
      const err = new NotFoundError('Lens');
      expect(err.message).toBe('Lens not found');
    });
  });

  describe('NetworkError', () => {
    it('has statusCode 0 (no HTTP response)', () => {
      const err = new NetworkError();
      expect(err.statusCode).toBe(0);
      expect(err.code).toBe('NETWORK_ERROR');
    });
  });

  describe('RateLimitError', () => {
    it('includes retryAfter in message', () => {
      const err = new RateLimitError(30);
      expect(err.message).toContain('30 seconds');
      expect(err.retryAfter).toBe(30);
      expect(err.statusCode).toBe(429);
    });

    it('works without retryAfter', () => {
      const err = new RateLimitError();
      expect(err.message).toContain('Please wait');
    });
  });

  describe('ConflictError', () => {
    it('defaults to 409', () => {
      expect(new ConflictError().statusCode).toBe(409);
    });
  });

  describe('ServerError', () => {
    it('defaults to 500', () => {
      expect(new ServerError().statusCode).toBe(500);
    });

    it('accepts custom status codes', () => {
      expect(new ServerError('Bad gateway', 502).statusCode).toBe(502);
    });
  });
});

describe('fromAxiosError', () => {
  it('returns existing ConcordError unchanged', () => {
    const err = new AuthError();
    expect(fromAxiosError(err)).toBe(err);
  });

  it('converts 401 to SessionExpiredError', () => {
    const err = fromAxiosError({
      response: { status: 401, data: { error: 'Unauthorized' } },
    });
    expect(err).toBeInstanceOf(SessionExpiredError);
  });

  it('converts 403 to ForbiddenError', () => {
    const err = fromAxiosError({
      response: { status: 403, data: { error: 'Forbidden' } },
    });
    expect(err).toBeInstanceOf(ForbiddenError);
  });

  it('converts 403 with CSRF_FAILED code', () => {
    const err = fromAxiosError({
      response: { status: 403, data: { code: 'CSRF_FAILED' } },
    });
    expect(err.message).toContain('CSRF');
  });

  it('converts 400 to ValidationError', () => {
    const err = fromAxiosError({
      response: { status: 400, data: { error: 'Bad input' } },
    });
    expect(err).toBeInstanceOf(ValidationError);
  });

  it('converts 404 to a NOT_FOUND ConcordError carrying the server message verbatim', () => {
    const err = fromAxiosError({
      response: { status: 404, data: { error: 'Not found' } },
    });
    expect(err).toBeInstanceOf(ConcordError);
    expect(err).not.toBeInstanceOf(NotFoundError);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Not found');
  });

  // F10 regression: the server's 404 message is COMPLETE ("DTU not
  // found"), not a bare resource name. The 404 branch must pass it
  // through as the message — feeding it to NotFoundError composed a
  // second "not found" onto it at every sighting below.
  describe('404 message passthrough (F10)', () => {
    it('keeps "DTU not found" verbatim (Debug Inspector sighting)', () => {
      const err = fromAxiosError({
        response: { status: 404, data: { error: 'DTU not found' } },
      });
      expect(err.message).toBe('DTU not found');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.statusCode).toBe(404);
    });

    it('keeps "recipient not found" verbatim (Linguistics DM sighting)', () => {
      const err = fromAxiosError({
        response: { status: 404, data: { error: 'recipient not found' } },
      });
      expect(err.message).toBe('recipient not found');
    });

    it('keeps a data.message 404 verbatim (Philosophy "user not found" sighting)', () => {
      const err = fromAxiosError({
        response: { status: 404, data: { message: 'user not found' } },
      });
      expect(err.message).toBe('user not found');
    });

    it('keeps a bare "not_found" code-message verbatim (Understanding Evolution sighting)', () => {
      const err = fromAxiosError({
        response: { status: 404, data: { error: 'not_found' } },
      });
      expect(err.message).toBe('not_found');
    });

    it('falls back to the axios message without composing onto it', () => {
      const err = fromAxiosError({
        response: { status: 404, data: {} },
        message: 'Request failed with status code 404',
      });
      expect(err.message).toBe('Request failed with status code 404');
      expect(err.code).toBe('NOT_FOUND');
    });
  });

  it('converts 409 to ConflictError', () => {
    const err = fromAxiosError({
      response: { status: 409, data: {} },
    });
    expect(err).toBeInstanceOf(ConflictError);
  });

  it('converts 429 to RateLimitError', () => {
    const err = fromAxiosError({
      response: { status: 429, data: {} },
    });
    expect(err).toBeInstanceOf(RateLimitError);
  });

  it('converts 500+ to ServerError', () => {
    const err = fromAxiosError({
      response: { status: 502, data: { error: 'Bad Gateway' } },
    });
    expect(err).toBeInstanceOf(ServerError);
  });

  it('converts network errors (no response) to NetworkError', () => {
    const err = fromAxiosError({
      message: 'Network Error',
    });
    expect(err).toBeInstanceOf(NetworkError);
  });

  it('converts timeout to NetworkError', () => {
    const err = fromAxiosError({
      code: 'ECONNABORTED',
      message: 'timeout',
    });
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.message).toContain('timed out');
  });
});

describe('getUserMessage', () => {
  it('returns ConcordError message', () => {
    expect(getUserMessage(new AuthError('Login please'))).toBe('Login please');
  });

  it('returns Error message', () => {
    expect(getUserMessage(new Error('oops'))).toBe('oops');
  });

  it('returns fallback for non-errors', () => {
    expect(getUserMessage('some string')).toBe('An unexpected error occurred');
    expect(getUserMessage(null)).toBe('An unexpected error occurred');
  });
});
