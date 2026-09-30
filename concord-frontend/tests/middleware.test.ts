import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for Next.js auth middleware.
 *
 * We test the middleware function directly by constructing
 * NextRequest-like objects and verifying the response.
 */

// Mock NextResponse and NextRequest
const makeMockHeaders = () => {
  const store = new Map<string, string>();
  return { set: vi.fn((k: string, v: string) => store.set(k, v)), get: (k: string) => store.get(k) };
};

const mockRedirect = vi.fn().mockImplementation((url: URL) => ({
  type: 'redirect',
  url: url.toString(),
  headers: makeMockHeaders(),
}));

const mockNext = vi.fn().mockImplementation(() => ({ type: 'next', headers: makeMockHeaders() }));

vi.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: URL) => mockRedirect(url),
    next: () => mockNext(),
  },
}));

function makeRequest(pathname: string, cookies: Record<string, string> = {}) {
  return {
    nextUrl: { pathname },
    url: `http://localhost:3000${pathname}`,
    headers: new Headers(),
    cookies: {
      has: (name: string) => name in cookies,
      get: (name: string) => cookies[name] ? { value: cookies[name] } : undefined,
    },
  };
}

describe('Auth Middleware', () => {
  let middleware: (req: ReturnType<typeof makeRequest>) => unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('@/middleware');
    middleware = mod.middleware as typeof middleware;
  });

  describe('public paths', () => {
    it('allows / (landing page) without auth', () => {
      middleware(makeRequest('/'));
      expect(mockNext).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('allows /login without auth', () => {
      middleware(makeRequest('/login'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /register without auth', () => {
      middleware(makeRequest('/register'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /forgot-password without auth', () => {
      middleware(makeRequest('/forgot-password'));
      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('public prefixes', () => {
    it('allows /api/* requests through', () => {
      middleware(makeRequest('/api/auth/me'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /_next/* static assets through', () => {
      middleware(makeRequest('/_next/static/chunk.js'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /icons/* through', () => {
      middleware(makeRequest('/icons/icon-192x192.svg'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /manifest.json through', () => {
      middleware(makeRequest('/manifest.json'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /godot-client/* through (Web export index.html/.js/.wasm are not covered by STATIC_ASSET_RE)', () => {
      middleware(makeRequest('/godot-client/index.html'));
      expect(mockNext).toHaveBeenCalled();
      mockNext.mockClear();
      middleware(makeRequest('/godot-client/index.wasm'));
      expect(mockNext).toHaveBeenCalled();
      mockNext.mockClear();
      middleware(makeRequest('/godot-client/index.js'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('allows /unity-client/* through (Unity WebGL index.html/.js/.wasm are not covered by STATIC_ASSET_RE)', () => {
      middleware(makeRequest('/unity-client/index.html'));
      expect(mockNext).toHaveBeenCalled();
      mockNext.mockClear();
      middleware(makeRequest('/unity-client/index.wasm'));
      expect(mockNext).toHaveBeenCalled();
      mockNext.mockClear();
      middleware(makeRequest('/unity-client/index.js'));
      expect(mockNext).toHaveBeenCalled();
    });

    it('lets /lenses/world iframe /unity-client/ (frame-ancestors self, not none)', () => {
      const player = middleware(makeRequest('/unity-client/index.html')) as { headers: { get: (k: string) => string | undefined } };
      expect(player.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'self'");
      expect(player.headers.get('Content-Security-Policy')).not.toContain("frame-ancestors 'none'");

      const app = middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } };
      expect(app.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    });
  });

  describe('protected routes', () => {
    it('redirects to /login when no session cookie', () => {
      middleware(makeRequest('/hub'));
      expect(mockRedirect).toHaveBeenCalled();
      const url = mockRedirect.mock.calls[0][0];
      expect(url.pathname).toBe('/login');
      expect(url.searchParams.get('from')).toBe('/hub');
    });

    it('redirects /lenses/chat to /login with from param', () => {
      middleware(makeRequest('/lenses/chat'));
      expect(mockRedirect).toHaveBeenCalled();
      const url = mockRedirect.mock.calls[0][0];
      expect(url.searchParams.get('from')).toBe('/lenses/chat');
    });

    it('allows through with concord_auth cookie', () => {
      middleware(makeRequest('/hub', { concord_auth: 'jwt-token' }));
      expect(mockNext).toHaveBeenCalled();
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('allows through with concord_refresh cookie', () => {
      middleware(makeRequest('/lenses/graph', { concord_refresh: 'refresh-token' }));
      expect(mockNext).toHaveBeenCalled();
    });

    it('rejects legacy cookie names that are no longer recognised', () => {
      middleware(makeRequest('/lenses/code', { 'connect.sid': 'session-id' }));
      expect(mockRedirect).toHaveBeenCalled();
    });
  });

  describe('CSP nonce (security audit 2026-07-30, flipped to enforced same day)', () => {
    it('sets a fully-enforced Content-Security-Policy header on every response', () => {
      const response = middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } };
      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toBeDefined();
      expect(csp).toContain(`script-src 'self'`);
      expect(csp).toContain('strict-dynamic');
      // Nonces can't cover the `style` HTML attribute (only <style> elements)
      // and this codebase uses React's style={{}} prop pervasively — see the
      // middleware.ts header comment for the full reasoning.
      expect(csp).toContain(`style-src 'self' 'unsafe-inline'`);
      expect(csp).toContain('frame-ancestors');
    });

    it('covers the two verified external iframe destinations via frame-src', () => {
      const response = middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } };
      const csp = response.headers.get('Content-Security-Policy');
      expect(csp).toContain(`frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com`);
    });

    it('no longer sets the report-only header (flipped to enforced)', () => {
      const response = middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } };
      expect(response.headers.get('Content-Security-Policy-Report-Only')).toBeUndefined();
    });

    it('embeds a matching nonce in both the CSP header and the x-nonce header', () => {
      const response = middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } };
      const nonce = response.headers.get('x-nonce');
      expect(nonce).toBeTruthy();
      expect(response.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
    });

    it('generates a fresh nonce per request (never reused)', () => {
      const n1 = (middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } }).headers.get('x-nonce');
      const n2 = (middleware(makeRequest('/')) as { headers: { get: (k: string) => string | undefined } }).headers.get('x-nonce');
      expect(n1).toBeTruthy();
      expect(n2).toBeTruthy();
      expect(n1).not.toBe(n2);
    });

    it('sets the CSP on a redirect response too (protected route, no session)', () => {
      const response = middleware(makeRequest('/hub')) as { headers: { get: (k: string) => string | undefined } };
      expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
      expect(response.headers.get('x-nonce')).toBeTruthy();
    });
  });

  describe('config', () => {
    it('exports matcher config', async () => {
      const mod = await import('@/middleware');
      expect(mod.config).toBeDefined();
      expect(mod.config.matcher).toBeInstanceOf(Array);
      expect(mod.config.matcher.length).toBeGreaterThan(0);
    });
  });
});
