/**
 * A 503 { reason: "shutting_down" } is a restart (~10–20s), not a
 * successful write and not a generic 500. Idempotent GETs retry with a
 * bounded backoff. Writes reject and say the server is restarting.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { useUIStore } from '@/store/ui';

vi.mock('axios', () => {
  class CanceledError extends Error {
    constructor(message?: string) {
      super(message);
      this.name = 'CanceledError';
    }
  }
  const mockAxios = {
    create: vi.fn(() => mockAxios),
    get: vi.fn().mockResolvedValue({ data: { ok: true } }),
    post: vi.fn().mockResolvedValue({ data: { ok: true } }),
    put: vi.fn().mockResolvedValue({ data: { ok: true } }),
    patch: vi.fn().mockResolvedValue({ data: { ok: true } }),
    delete: vi.fn().mockResolvedValue({ data: { ok: true } }),
    request: vi.fn().mockResolvedValue({ data: { ok: true } }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    isCancel: (e: unknown) => (e as { name?: string })?.name === 'CanceledError',
    isAxiosError: (e: unknown) => Boolean((e as { isAxiosError?: boolean })?.isAxiosError),
    CanceledError,
  };
  return { default: mockAxios };
});

function responseHandlers() {
  const calls = (axios as unknown as {
    interceptors: { response: { use: { mock: { calls: unknown[][] } } } };
  }).interceptors.response.use.mock.calls;
  const retry = calls.find((c) => c[0] == null && typeof c[1] === 'function');
  const main = calls.find((c) => typeof c[0] === 'function' && typeof c[1] === 'function');
  return {
    retry: retry?.[1] as (error: unknown) => Promise<unknown>,
    failure: main?.[1] as (error: unknown) => Promise<unknown>,
  };
}

function shutdownErr(method: string, retryAfter = '20') {
  return {
    isAxiosError: true,
    message: 'Request failed with status code 503',
    config: { method, url: '/api/lens/run', headers: {} as Record<string, string>, _retryCount: 0 },
    response: {
      status: 503,
      headers: { 'retry-after': retryAfter },
      data: { ok: false, reason: 'shutting_down' },
    },
  };
}

describe('API client shutting_down', () => {
  let retry: (error: unknown) => Promise<unknown>;
  let failure: (error: unknown) => Promise<unknown>;

  beforeAll(async () => {
    await import('@/lib/api/client');
    // tests/setup.ts clears mock call history before each test. Keep the
    // interceptor functions themselves; they do not live on the call list.
    const handlers = responseHandlers();
    retry = handlers.retry;
    failure = handlers.failure;
  });

  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
    vi.mocked(axios.request).mockReset();
    vi.mocked(axios.request).mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not retry a write, and surfaces an honest restart error', async () => {
    vi.useFakeTimers();
    const write = shutdownErr('post');
    const rejected = retry(write);
    const assertion = expect(rejected).rejects.toBe(write);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(axios.request).not.toHaveBeenCalled();

    vi.useRealTimers();
    useUIStore.setState({ toasts: [] });
    await expect(failure(write)).rejects.toMatchObject({
      message: 'Server restarting, try again.',
      statusCode: 503,
    });
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.type).toBe('error');
    expect(toasts[0]?.message).toBe('Server restarting, try again.');
    expect(toasts.some((t) => /went wrong|retrying/i.test(t.message))).toBe(false);
  });

  it('retries an idempotent GET with bounded backoff and does not invent success', async () => {
    vi.useFakeTimers();
    (axios.request as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: { ok: true, fromServer: true } });
    const pending = retry(shutdownErr('get', '60'));
    let settled = false;
    pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(axios.request).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(settled).toBe(true);
    expect(axios.request).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: { ok: true, fromServer: true } });

    (axios.request as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('still down'));
    const again = retry(shutdownErr('get', '20'));
    const failed = expect(again).rejects.toThrow(/still down/);
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
  });
});
