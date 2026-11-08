import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * /dtu/:id must answer a missing or hidden DTU with a real HTTP 404.
 * app/loading.tsx makes every page stream, which commits 200 before
 * page.tsx's notFound() can run (Next streaming guide, "Status codes"), so
 * the existence check happens in the middleware, before the page renders.
 */
const fetchOwnerDtu = vi.fn(); // the middleware's lookupOwnerDtu
vi.mock('@/lib/dtu/public-fetch', () => ({ lookupOwnerDtu: (...a: unknown[]) => fetchOwnerDtu(...a) }));
vi.mock('../lib/dtu/public-fetch', () => ({ lookupOwnerDtu: (...a: unknown[]) => fetchOwnerDtu(...a) }));

const headers = () => { const m = new Map<string, string>(); return { set: (k: string, v: string) => m.set(k, v), get: (k: string) => m.get(k) }; };
const rewrite = vi.fn((url: URL, init?: { status?: number }) => ({ type: 'rewrite', pathname: url.pathname, status: init?.status, headers: headers() }));
const next = vi.fn(() => ({ type: 'next', headers: headers() }));
vi.mock('next/server', () => ({ NextResponse: { redirect: vi.fn(), next: () => next(), rewrite: (u: URL, i?: { status?: number }) => rewrite(u, i) } }));

function req(pathname: string, cookie = '') {
  const url = new URL(`http://localhost:3000${pathname}`);
  return {
    nextUrl: Object.assign(url, { clone: () => new URL(url.toString()) }),
    url: url.toString(),
    headers: new Headers(cookie ? { cookie } : {}),
    cookies: { has: () => false, get: () => undefined },
  };
}

describe('middleware: /dtu/:id status', () => {
  let middleware: (r: ReturnType<typeof req>) => Promise<{ type: string; pathname?: string; status?: number }>;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    middleware = (await import('@/middleware')).middleware as unknown as typeof middleware;
  });

  it('rewrites a missing DTU to the not-found page with status 404', async () => {
    fetchOwnerDtu.mockResolvedValue({ status: 404, dtu: null, reachable: true });
    const res = await middleware(req('/dtu/missing-prb-id'));
    expect(res.type).toBe('rewrite');
    expect(res.status).toBe(404);
    expect(res.pathname).toBe('/dtu-not-found');
    expect(fetchOwnerDtu).toHaveBeenCalledWith('missing-prb-id', null);
  });

  it('passes the viewer cookies so an owner still reaches the page', async () => {
    fetchOwnerDtu.mockResolvedValue({ status: 200, dtu: { id: 'd1' }, reachable: true });
    const res = await middleware(req('/dtu/d1', 'concord_auth=abc'));
    expect(res.type).toBe('next');
    expect(fetchOwnerDtu).toHaveBeenCalledWith('d1', 'concord_auth=abc');
  });

  it('treats a hidden (401/403) DTU like a missing one, as the page does', async () => {
    fetchOwnerDtu.mockResolvedValue({ status: 401, dtu: null, reachable: true });
    expect((await middleware(req('/dtu/private'))).status).toBe(404);
  });

  it('falls through to the page when the backend could not be asked', async () => {
    fetchOwnerDtu.mockResolvedValue({ status: 404, dtu: null, reachable: false });
    expect((await middleware(req('/dtu/slow'))).type).toBe('next');
  });

  it('does not touch deeper paths or other routes', async () => {
    const deeper = middleware(req('/dtu/d1/extra'));
    expect(deeper).not.toBeInstanceOf(Promise);
    expect(fetchOwnerDtu).not.toHaveBeenCalled();
  });

  it('survives a malformed escape in the id', async () => {
    fetchOwnerDtu.mockResolvedValue({ status: 404, dtu: null, reachable: true });
    const res = await middleware(req('/dtu/%E0%A4%A'));
    expect(res.status).toBe(404);
    expect(fetchOwnerDtu).toHaveBeenCalledWith('%E0%A4%A', null);
  });
});
