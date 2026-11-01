import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ANON_BROWSE_HEADER, PUBLIC_BROWSE_LENSES } from '@/lib/anon-browse';

/**
 * GB-0664 (Ramaj): signed-out visitors may browse Music and Market; every other lens keeps its login
 * redirect. Drives the real middleware function with a NextResponse mock that records the headers
 * forwarded to the page render (that is how the root layout learns "visitor browse").
 */
const makeHeaders = () => { const m = new Map<string, string>(); return { set: vi.fn((k: string, v: string) => m.set(k, v)), get: (k: string) => m.get(k) }; };
const mockRedirect = vi.fn((url: URL, status?: number) => ({ type: 'redirect', url: url.toString(), pathname: url.pathname, search: url.search, status, headers: makeHeaders() }));
const mockNext = vi.fn((opts?: { request?: { headers: Headers } }) => ({ type: 'next', forwarded: opts?.request?.headers, headers: makeHeaders() }));
vi.mock('next/server', () => ({ NextResponse: { redirect: (u: URL, s?: number) => mockRedirect(u, s), next: (o?: { request?: { headers: Headers } }) => mockNext(o) } }));

function req(pathname: string, cookies: Record<string, string> = {}, headers: Record<string, string> = {}) {
  return {
    nextUrl: { pathname },
    url: `http://localhost:3000${pathname}`,
    headers: new Headers(headers),
    cookies: { has: (n: string) => n in cookies, get: (n: string) => (cookies[n] ? { value: cookies[n] } : undefined) },
  };
}
type Res = { type: string; pathname?: string; search?: string; forwarded?: Headers; headers: { get: (k: string) => string | undefined } };

describe('middleware: signed-out browsing of Music + Market', () => {
  let middleware: (r: ReturnType<typeof req>) => Res;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    middleware = (await import('@/middleware')).middleware as unknown as typeof middleware;
  });

  it.each(['/lenses/music', '/lenses/market'])('signed-out %s renders (no /login redirect) and is flagged as visitor browse', (p) => {
    const r = middleware(req(p));
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(r.type).toBe('next');
    expect(r.forwarded?.get(ANON_BROWSE_HEADER)).toBe('1');
  });

  it('the CSP is still applied to the visitor page', () => {
    const r = middleware(req('/lenses/music'));
    expect(r.headers.get('Content-Security-Policy')).toMatch(/script-src/);
  });

  it.each(['/lenses/chat', '/lenses/studio', '/lenses/marketplace', '/lenses/code', '/lenses/wallet'])('signed-out %s still redirects to /login', (p) => {
    const r = middleware(req(p));
    expect(r.type).toBe('redirect');
    expect(r.pathname).toBe('/login');
    expect(r.search).toBe(`?from=${encodeURIComponent(p)}`);
  });

  it('the open set is exactly Music and Market: look-alike and nested paths are NOT opened', () => {
    for (const p of ['/lenses/music/whatever', '/lenses/musicbox', '/lenses/market/orders', '/lenses/marketing', '/lenses/music-theory', '/lenses/musi']) {
      mockRedirect.mockClear();
      const r = middleware(req(p));
      expect(r.type, p).toBe('redirect');
      expect(r.pathname, p).toBe('/login');
    }
  });

  it('a member (session cookie) gets the normal lens, not the visitor flag', () => {
    for (const cookie of ['concord_auth', 'concord_refresh']) {
      const r = middleware(req('/lenses/music', { [cookie]: 'x' }));
      expect(r.type).toBe('next');
      expect(r.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
    }
  });

  it('a client cannot forge the visitor flag: any inbound copy is dropped on every route', () => {
    const forged = { [ANON_BROWSE_HEADER]: '1' };
    // a public page the visitor-flag is not meant for
    const a = middleware(req('/explore', {}, forged));
    expect(a.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
    // a member on a normal lens
    const b = middleware(req('/lenses/chat', { concord_auth: 'x' }, forged));
    expect(b.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
    // and it does not unlock a gated lens for a visitor
    const c = middleware(req('/lenses/chat', {}, forged));
    expect(c.type).toBe('redirect');
  });

  it("the edge middleware's literal copies match the client constants (they cannot drift)", async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(src).toContain(`const ANON_BROWSE_HEADER = '${ANON_BROWSE_HEADER}';`);
    const m = /const PUBLIC_BROWSE_LENSES = new Set\(\[([^\]]+)\]\)/.exec(src);
    const literal = (m?.[1] || '').split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(literal).toEqual([...PUBLIC_BROWSE_LENSES].sort());
  });
});
