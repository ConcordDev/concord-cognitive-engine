/**
 * lensRun must not report success when the body is a nested failure.
 * The historical shape was HTTP 200 { ok:true, result:{ ok:false, error } }.
 * The lifted shape is { ok:false, error, result? } (now also a 4xx).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.hoisted(() => vi.fn());

vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn(() => mockAxios),
    get: vi.fn().mockResolvedValue({ data: {} }),
    post,
    put: vi.fn().mockResolvedValue({ data: {} }),
    patch: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    isCancel: () => false,
    CanceledError: class CanceledError extends Error {},
  };
  return { default: mockAxios };
});

describe('lensRun failure envelope', () => {
  beforeEach(() => {
    vi.resetModules();
    post.mockReset();
  });

  it('returns ok:false for a nested {ok:true, result:{ok:false}} failure', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { ok: true, result: { ok: false, error: 'insufficient_balance' } },
    });
    const { lensRun } = await import('@/lib/api/client');
    const r = await lensRun('staking', 'open_stake', { principalCc: 100 });
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('insufficient_balance');
    expect(r.data.result).toBeNull();
  });

  it('returns ok:false for a lifted failure that still carries a result payload', async () => {
    post.mockResolvedValue({
      status: 409,
      data: { ok: false, error: 'insufficient_balance', result: { balance: 0, required: 100 } },
    });
    const { lensRun } = await import('@/lib/api/client');
    const r = await lensRun('staking', 'open_stake', { principalCc: 100 });
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('insufficient_balance');
  });

  it('returns ok:false with the response body error when the request rejects', async () => {
    const err = new Error('Request failed with status code 409') as Error & {
      response?: { data?: { error?: string } };
    };
    err.response = { data: { error: 'insufficient_balance' } };
    post.mockRejectedValue(err);
    const { lensRun } = await import('@/lib/api/client');
    const r = await lensRun('staking', 'open_stake', {});
    expect(r.data.ok).toBe(false);
    expect(r.data.error).toBe('insufficient_balance');
  });

  it('unwraps a real success down to the payload', async () => {
    post.mockResolvedValue({
      status: 200,
      data: { ok: true, result: { position: { id: 'stk_1' } } },
    });
    const { lensRun } = await import('@/lib/api/client');
    const r = await lensRun('staking', 'open_stake', {});
    expect(r.data.ok).toBe(true);
    expect(r.data.error).toBeNull();
    expect(r.data.result).toEqual({ position: { id: 'stk_1' } });
  });
});
