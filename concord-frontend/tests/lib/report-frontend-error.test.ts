import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reportFrontendError } from '@/lib/report-frontend-error';

/**
 * Regression pin for the World Lens crash-visibility fix: the inner
 * ErrorBoundary wrapping <ConcordiaScene> (components/world/WorldOsSurface.tsx) used
 * to swallow every 3D-scene crash via `fallback={null}` + a silent
 * `setViewMode('concordia')` — the crash never reached the layout-level
 * RepairBoundary (React error boundaries only bubble on throw, and this one
 * caught locally), so /api/repair/frontend-error never saw it and the
 * player just saw "the world lens is a bunch of panels" with zero signal
 * anything went wrong. reportFrontendError is the shared helper both
 * RepairBoundary and that inner boundary now call directly.
 */
describe('reportFrontendError', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to /api/repair/frontend-error with the error, lens, and componentStack', async () => {
    await reportFrontendError(
      { message: 'boom', stack: 'at foo', name: 'Error' },
      { componentStack: 'in ConcordiaScene', lens: 'world:concordia-scene' }
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/repair/frontend-error');
    const body = JSON.parse(init.body as string);
    expect(body.error).toEqual({ message: 'boom', stack: 'at foo', name: 'Error' });
    expect(body.componentStack).toBe('in ConcordiaScene');
    expect(body.lens).toBe('world:concordia-scene');
    expect(typeof body.timestamp).toBe('string');
  });

  it('defaults lens to "unknown" when not provided', async () => {
    await reportFrontendError({ message: 'boom' });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.lens).toBe('unknown');
  });

  it('truncates componentStack to 500 chars', async () => {
    const long = 'x'.repeat(1000);
    await reportFrontendError({ message: 'boom' }, { componentStack: long });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.componentStack).toHaveLength(500);
  });

  it('never throws when fetch itself rejects (best-effort reporting)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(reportFrontendError({ message: 'boom' })).resolves.toBeUndefined();
  });

  it('sends digest and route, and strips tokens, emails, and query secrets', async () => {
    const token = 'sk_live_abcd1234EFGH5678';
    const email = 'ramaj@example.com';
    await reportFrontendError(
      { message: `failed for ${email} key ${token}`, stack: 'at foo', name: 'Error', digest: 'abc123' },
      { route: `/lenses/world?access_token=${token}`, lens: 'world' },
    );
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.error.digest).toBe('abc123');
    expect(body.route).toBe('/lenses/world');
    expect(body.error.message).not.toContain(token);
    expect(body.error.message).not.toContain(email);
    expect(body.error.message).toContain('[redacted]');
    expect(JSON.stringify(body)).not.toContain(token);
  });
});
