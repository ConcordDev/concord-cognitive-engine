/**
 * csrfFetch — a thin `fetch()` wrapper for the handful of call sites that
 * can't go through the shared axios client (`lib/api/client.ts`) but still
 * hit a mutating, CSRF-enforced route.
 *
 * Every route the axios client calls gets an `X-CSRF-Token` header
 * automatically via a request interceptor. A bare `fetch()` never carries
 * that header, so a POST/PUT/PATCH/DELETE against any route NOT in
 * server.js's `csrfMiddleware` exempt list (only `/api/auth/*`, `/api/chat`,
 * `/api/lens`, `/api/stripe/webhook`, `/mcp`) is a deterministic 403 in
 * production. Found live on `components/world-lens/FishingMinigameOverlay.tsx`
 * (cast/reel) — `/api/fishing/*` is not exempt — see
 * audit/LENS_DESIGN_UPGRADE_PLAN.md #94/#142.
 */

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

export function csrfFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  const headers = new Headers(init.headers);
  if (needsCsrf) {
    const token = readCsrfCookie();
    if (token) headers.set('X-CSRF-Token', token);
  }
  return fetch(input, { ...init, headers, credentials: init.credentials || 'same-origin' });
}

/**
 * Ghost-blocker fix: many lenses still call bare `fetch()` for POSTs with
 * credentials but no X-CSRF-Token. In production that is a deterministic
 * CSRF_FAILED 403 — toast looks like "permission" / "on our end".
 * Install once from Providers so every same-origin /api mutation gets the
 * double-submit header when the csrf_token cookie exists.
 */
let _csrfFetchGuardInstalled = false;

export function installCsrfFetchGuard(): void {
  if (typeof window === 'undefined' || _csrfFetchGuardInstalled) return;
  if (typeof window.fetch !== 'function') return;
  _csrfFetchGuardInstalled = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (
      init?.method ||
      (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET') ||
      'GET'
    ).toUpperCase();
    const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    let urlStr = '';
    try {
      if (typeof input === 'string') urlStr = input;
      else if (input instanceof URL) urlStr = input.toString();
      else if (typeof Request !== 'undefined' && input instanceof Request) urlStr = input.url;
    } catch {
      urlStr = '';
    }

    const isApi =
      urlStr.startsWith('/api/') ||
      urlStr.startsWith('api/') ||
      (() => {
        try {
          const u = new URL(urlStr, window.location.origin);
          return u.origin === window.location.origin && u.pathname.startsWith('/api/');
        } catch {
          return false;
        }
      })();

    if (!needsCsrf || !isApi) {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init?.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    if (!headers.has('X-CSRF-Token') && !headers.has('x-csrf-token')) {
      const token = readCsrfCookie();
      if (token) headers.set('X-CSRF-Token', token);
    }

    const nextInit: RequestInit = {
      ...init,
      headers,
      // Prefer include so httpOnly session cookies always ride along on /api
      credentials: init?.credentials ?? 'same-origin',
    };
    return nativeFetch(input, nextInit);
  };
}
