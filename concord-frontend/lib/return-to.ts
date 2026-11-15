/**
 * returnTo validation — GB-1536.
 *
 * A return-to is where a visitor lands back after signing up / logging
 * in: exactly where they were. It is attacker-controllable input (it
 * arrives via ?from= and via the OAuth state), so every consumer —
 * modal, login/register pages, confirm-age, the OAuth callback —
 * validates it the same way: a same-origin RELATIVE path only.
 *
 * Rules: must start with '/', must not start with '//' (protocol-
 * relative), must carry no scheme, and must not point back into the
 * auth flow itself ('/login', '/register', '/signup', '/onboarding…'),
 * which would loop or strand the user. Anything invalid → '/hub'.
 */

export const DEFAULT_RETURN_TO = '/hub';

const BLOCKED_PREFIXES = ['/login', '/register', '/signup', '/onboarding'];

export function validateReturnTo(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    return DEFAULT_RETURN_TO;
  }
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_RETURN_TO;
  if (raw.includes('\\')) return DEFAULT_RETURN_TO;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return DEFAULT_RETURN_TO;
  const path = raw.split(/[?#]/)[0];
  for (const prefix of BLOCKED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return DEFAULT_RETURN_TO;
  }
  return raw;
}

/** The current page as a returnTo: path + search + hash, validated. */
export function currentReturnTo(): string {
  if (typeof window === 'undefined') return DEFAULT_RETURN_TO;
  const { pathname, search, hash } = window.location;
  return validateReturnTo(`${pathname}${search}${hash}`);
}
