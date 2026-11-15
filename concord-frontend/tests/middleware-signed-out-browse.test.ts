import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ANON_BROWSE_HEADER, PUBLIC_BROWSE_LENSES } from '@/lib/anon-browse';
import { GUEST_HEADER } from '@/lib/guest-constants';

/**
 * GB-1536 "Enter means Enter" (supersedes GB-0664's scope): a signed-out
 * visitor guest-passes to /hub and EVERY non-admin lens, read-only, in
 * the normal shell — the middleware mints x-concord-guest and the root
 * layout turns it into GuestProvider. Music + Market keep the GB-0664
 * anon-browse flag as well (their 30 s preview machinery reads it).
 * Desk-only lenses and non-lens app routes keep the /login redirect,
 * and the removed post-Enter screens 308 to /hub.
 *
 * Drives the real middleware function with a NextResponse mock that
 * records the headers forwarded to the page render.
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
type Res = { type: string; pathname?: string; search?: string; status?: number; forwarded?: Headers; headers: { get: (k: string) => string | undefined } };

describe('middleware: guest entry (GB-1536)', () => {
  let middleware: (r: ReturnType<typeof req>) => Res;
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    middleware = (await import('@/middleware')).middleware as unknown as typeof middleware;
  });

  it.each(['/lenses/music', '/lenses/market'])('signed-out %s renders with BOTH the visitor flag and the guest flag', (p) => {
    const r = middleware(req(p));
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(r.type).toBe('next');
    expect(r.forwarded?.get(ANON_BROWSE_HEADER)).toBe('1');
    expect(r.forwarded?.get(GUEST_HEADER)).toBe('1');
  });

  it('the CSP is still applied to the guest page', () => {
    const r = middleware(req('/lenses/music'));
    expect(r.headers.get('Content-Security-Policy')).toMatch(/script-src/);
  });

  it.each(['/hub', '/lenses/chat', '/lenses/studio', '/lenses/code', '/lenses/marketplace', '/lenses/wallet', '/lenses/chem'])(
    'signed-out %s guest-passes (no /login redirect) with the guest flag and no visitor flag',
    (p) => {
      const r = middleware(req(p));
      expect(mockRedirect).not.toHaveBeenCalled();
      expect(r.type).toBe('next');
      expect(r.forwarded?.get(GUEST_HEADER)).toBe('1');
      expect(r.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
    },
  );

  it('signed-out /lenses/conkay renders the lens in guest mode (no more bounce to the demo)', () => {
    const r = middleware(req('/lenses/conkay'));
    expect(r.type).toBe('next');
    expect(r.forwarded?.get(GUEST_HEADER)).toBe('1');
  });

  it.each([
    '/lenses/admin', '/lenses/security', '/lenses/vault', '/lenses/privacy',
    '/lenses/sentinel', '/lenses/debug', '/lenses/ops', '/lenses/system',
    '/lenses/lock', '/lenses/byo-keys', '/lenses/admin/users',
  ])('desk-only %s still redirects a guest to /login', (p) => {
    const r = middleware(req(p));
    expect(r.type).toBe('redirect');
    expect(r.pathname).toBe('/login');
    expect(r.search).toBe(`?from=${encodeURIComponent(p)}`);
  });

  it.each(['/profile', '/messages'])('non-lens app route %s still redirects a guest to /login', (p) => {
    const r = middleware(req(p));
    expect(r.type).toBe('redirect');
    expect(r.pathname).toBe('/login');
    expect(r.search).toBe(`?from=${encodeURIComponent(p)}`);
  });

  it.each(['/explore', '/explore/engine', '/explore/world', '/onboarding', '/onboarding/location'])(
    'removed screen %s 308-redirects to /hub for everyone',
    (p) => {
      for (const cookies of [{}, { concord_auth: 'x' }]) {
        mockRedirect.mockClear();
        const r = middleware(req(p, cookies));
        expect(r.type, p).toBe('redirect');
        expect(r.status, p).toBe(308);
        expect(r.pathname, p).toBe('/hub');
      }
    },
  );

  it('the 18+ confirm-age gate stays public (and is not a guest page)', () => {
    const r = middleware(req('/onboarding/confirm-age'));
    expect(r.type).toBe('next');
    expect(r.forwarded?.get(GUEST_HEADER)).toBeNull();
  });

  it('brain-mode STAYS a live public route (founder ruling on the GB-1536 flag — no 308, not a guest page)', () => {
    for (const cookies of [{}, { concord_auth: 'x' }]) {
      const r = middleware(req('/onboarding/brain-mode', cookies));
      expect(r.type).toBe('next');
      expect(r.forwarded?.get(GUEST_HEADER)).toBeNull();
    }
  });

  it('a member (session cookie) gets the normal lens, not the visitor or guest flag', () => {
    for (const cookie of ['concord_auth', 'concord_refresh']) {
      const r = middleware(req('/lenses/music', { [cookie]: 'x' }));
      expect(r.type).toBe('next');
      expect(r.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
      expect(r.forwarded?.get(GUEST_HEADER)).toBeNull();
    }
  });

  it('a client cannot forge the flags: any inbound copy is dropped on every route', () => {
    // forged guest flag on a member request to a normal page
    const a = middleware(req('/lenses/chat', { concord_auth: 'x' }, { [GUEST_HEADER]: '1' }));
    expect(a.forwarded?.get(GUEST_HEADER)).toBeNull();
    // forged guest flag does not unlock a non-lens app route
    const b = middleware(req('/profile', {}, { [GUEST_HEADER]: '1' }));
    expect(b.type).toBe('redirect');
    // forged visitor flag on a guest lens page: anon stays unset, guest is middleware-minted
    const c = middleware(req('/lenses/chat', {}, { [ANON_BROWSE_HEADER]: '1' }));
    expect(c.type).toBe('next');
    expect(c.forwarded?.get(ANON_BROWSE_HEADER)).toBeNull();
    expect(c.forwarded?.get(GUEST_HEADER)).toBe('1');
  });

  it("the edge middleware's literal copies match the client constants (they cannot drift)", async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');
    expect(src).toContain(`const ANON_BROWSE_HEADER = '${ANON_BROWSE_HEADER}';`);
    expect(src).toContain(`const GUEST_HEADER = '${GUEST_HEADER}';`);
    const m = /const PUBLIC_BROWSE_LENSES = new Set\(\[([^\]]+)\]\)/.exec(src);
    const literal = (m?.[1] || '').split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean).sort();
    expect(literal).toEqual([...PUBLIC_BROWSE_LENSES].sort());
  });
});
