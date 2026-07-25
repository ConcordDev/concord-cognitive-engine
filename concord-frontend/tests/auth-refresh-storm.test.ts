/**
 * Regression test for the logged-out auth-refresh storm.
 *
 * Observed live on 2026-07-25 against a real dev stack: a logged-out browser
 * tab issued 11 `POST /api/auth/refresh` calls in 8 minutes — one per
 * background poller that happened to 401 — because the interceptor's
 * `_authRetried` guard lives on the REQUEST CONFIG and so is per-request, not
 * global. Nothing remembered that the previous refresh had just failed.
 *
 * The server's `authRateLimiter` permits 5 FAILED auth attempts per 15 minutes
 * (`skipSuccessfulRequests: true`), so attempts 6+ returned 429; the wasted
 * traffic also drained the 30/min anonymous bucket, pushing unrelated reads
 * (`/api/system/health`, `/api/events/paginated`) into 429. A tab left on the
 * login page rate-limited itself.
 *
 * These tests pin the two guards that fix it. Both fail against the pre-fix
 * code: without single-flight the first asserts 1 but sees N; without the
 * cooldown the second asserts 1 but sees 2.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Keep the module graph tiny + deterministic: the client pulls in a Zustand UI
// store and a CSRF cookie reader, neither of which this behaviour depends on.
vi.mock('@/store/ui-store', () => ({
  useUIStore: { getState: () => ({ setAuthPosture: () => {} }) },
}));

describe('auth refresh: single-flight + failure cooldown', () => {
  let attemptTokenRefresh: () => Promise<unknown>;
  let clearAuthRefreshBackoff: () => void;
  let api: { post: (...a: unknown[]) => Promise<unknown> };

  beforeEach(async () => {
    vi.resetModules();
    vi.useRealTimers();
    const mod = await import('@/lib/api/client');
    attemptTokenRefresh = mod.attemptTokenRefresh;
    clearAuthRefreshBackoff = mod.clearAuthRefreshBackoff;
    api = mod.api as unknown as typeof api;
    clearAuthRefreshBackoff();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('collapses concurrent refreshes into ONE network call (single-flight)', async () => {
    let resolveIt: (v: unknown) => void = () => {};
    const post = vi.spyOn(api, 'post').mockImplementation(
      () => new Promise((res) => { resolveIt = res; }),
    );

    // Five pollers 401 at the same instant — the real burst shape.
    const all = Promise.all([
      attemptTokenRefresh(), attemptTokenRefresh(), attemptTokenRefresh(),
      attemptTokenRefresh(), attemptTokenRefresh(),
    ]);
    resolveIt({ status: 200 });
    await all;

    // Pre-fix this was 5 — one per caller.
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/auth/refresh');
  });

  it('suppresses further refreshes after a failure, instead of retrying forever', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('no refresh cookie'), { response: { status: 401 } }),
    );

    await expect(attemptTokenRefresh()).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(1);

    // The next poller's 401 arrives moments later. Pre-fix this fired a second
    // network call; that drip is what exhausted the 5-per-15-min budget.
    await expect(attemptTokenRefresh()).rejects.toThrow(/cooling_down/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('a real login lifts the cooldown immediately — it can never strand a live session', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(
      Object.assign(new Error('no refresh cookie'), { response: { status: 401 } }),
    );
    await expect(attemptTokenRefresh()).rejects.toThrow();
    await expect(attemptTokenRefresh()).rejects.toThrow(/cooling_down/);
    expect(post).toHaveBeenCalledTimes(1);

    // Whatever proves the session is live again (a 2xx, or an explicit login)
    // clears the suppression, and refreshes resume at once.
    post.mockResolvedValue({ status: 200 });
    clearAuthRefreshBackoff();
    await expect(attemptTokenRefresh()).resolves.toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
