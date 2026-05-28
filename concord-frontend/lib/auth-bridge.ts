// Phase G4.1 — auth bridge.
//
// When the page runs inside the mobile AuthedWebView wrapper, the mobile
// app injects window.__CONCORD_JWT__ before page content loads. Code that
// would normally rely on the JWT cookie should fall back to this injected
// token when present.
//
// Returns the bearer token string or null. fetch() callers can use it
// directly via fetch(url, { headers: { Authorization: `Bearer ${tok}` } }).

interface InjectedWindow extends Window {
  __CONCORD_JWT__?: string;
}

export function getInjectedJwt(): string | null {
  if (typeof window === 'undefined') return null;
  const w = window as InjectedWindow;
  return w.__CONCORD_JWT__ || null;
}

/**
 * Returns headers ready to merge into a fetch() request. Includes the
 * Authorization bearer header when an injected JWT is available.
 */
export function authedHeaders(extras: Record<string, string> = {}): Record<string, string> {
  const tok = getInjectedJwt();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...extras,
  };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  return headers;
}
