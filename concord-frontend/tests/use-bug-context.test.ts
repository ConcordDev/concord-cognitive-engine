// E4/E6 frontend contract — useBugContext auto-context + reporter.
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useBugContext', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('gatherBugContext reads route, viewport, worldId, and defaults buildId', async () => {
    const { gatherBugContext } = await import('@/hooks/useBugContext');
    window.localStorage.setItem('concordia:activeWorldId', 'tunya');
    const ctx = gatherBugContext();
    expect(ctx.worldId).toBe('tunya');
    expect(typeof ctx.route).toBe('string');
    expect(ctx.viewport).toMatch(/^\d+x\d+$/);
    expect(ctx.buildId).toBe('dev'); // NEXT_PUBLIC_BUILD_ID unset in test
    expect(Array.isArray(ctx.breadcrumbs)).toBe(true);
  });

  it('extra overrides win over derived context', async () => {
    const { gatherBugContext } = await import('@/hooks/useBugContext');
    const ctx = gatherBugContext({ lensId: 'code', route: '/lenses/code', buildId: 'abc123' });
    expect(ctx.lensId).toBe('code');
    expect(ctx.route).toBe('/lenses/code');
    expect(ctx.buildId).toBe('abc123');
  });

  it('breadcrumb ring buffer keeps only the last 20', async () => {
    const { pushBreadcrumb, gatherBugContext } = await import('@/hooks/useBugContext');
    for (let i = 0; i < 50; i++) pushBreadcrumb(`crumb-${i}`);
    const { breadcrumbs } = gatherBugContext();
    expect(breadcrumbs.length).toBe(20);
    expect(breadcrumbs[breadcrumbs.length - 1]).toContain('crumb-49');
    expect(breadcrumbs[0]).toContain('crumb-30');
  });

  it('reportClientError POSTs a merged envelope to /api/client-error', async () => {
    const { reportClientError } = await import('@/hooks/useBugContext');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);

    reportClientError({ kind: 'white_screen', error: new Error('boom'), lensId: 'world' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/client-error');
    expect(opts.method).toBe('POST');
    expect(opts.keepalive).toBe(true);
    const body = JSON.parse(opts.body);
    expect(body.kind).toBe('white_screen');
    expect(body.message).toBe('boom');
    expect(body.context.lensId).toBe('world');
    expect(typeof body.stack).toBe('string');
  });

  it('reportClientError never throws when fetch rejects', async () => {
    const { reportClientError } = await import('@/hooks/useBugContext');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    expect(() => reportClientError({ kind: 'uncaught_throw', error: new Error('x') })).not.toThrow();
  });

  it('throttles a report storm (cap 20/min) so it cannot self-DoS the route', async () => {
    const { reportClientError } = await import('@/hooks/useBugContext');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 100; i++) reportClientError({ kind: 'uncaught_throw', error: new Error(`e${i}`) });
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });
});
