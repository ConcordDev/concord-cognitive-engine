/**
 * Non-React bridge for guest mode — GB-1536.
 *
 * lib/api/client.ts is not a React module, but its backstop needs two
 * things only the React tree can provide: whether this page is a guest
 * page, and a way to open the signup modal. The GuestProvider (lib/
 * guest.tsx) registers both here on mount; client.ts reads them
 * through this leaf module, so there is no import cycle and no React
 * dependency in the API layer.
 */

import { GUEST_READ_ACTIONS } from './guest-constants';
import { currentReturnTo } from './return-to';

let guestMode = false;
let authOpener: ((returnTo: string) => void) | null = null;

export function setGuestMode(value: boolean): void {
  guestMode = value;
}

export function isGuestMode(): boolean {
  return guestMode;
}

export function registerGuestAuthOpener(fn: ((returnTo: string) => void) | null): void {
  authOpener = fn;
}

/**
 * Open the signup modal for the current page. Falls back to the login
 * page (with from=) when no modal host is mounted — a guest is never
 * left with a dead click.
 */
export function openGuestAuth(returnTo?: string): void {
  const target = returnTo ?? currentReturnTo();
  if (authOpener) {
    authOpener(target);
    return;
  }
  if (typeof window !== 'undefined') {
    window.location.href = `/login?from=${encodeURIComponent(target)}`;
  }
}

/** Typed rejection for a guest action the client refused to send. */
export class GuestActionBlocked extends Error {
  readonly isGuestActionBlocked = true;
  readonly returnTo: string;
  constructor(returnTo: string) {
    super('Sign up to do that — guests browse read-only.');
    this.name = 'GuestActionBlocked';
    this.returnTo = returnTo;
  }
}

export function isGuestActionBlocked(err: unknown): err is GuestActionBlocked {
  return !!err && typeof err === 'object' && (err as { isGuestActionBlocked?: unknown }).isGuestActionBlocked === true;
}

/**
 * May this /api/lens/run body go to the server for a guest? Only the
 * guestRead mirror list — and the server re-checks against its own
 * spec registry, which is the authority.
 */
export function lensRunAllowedForGuest(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as { domain?: unknown; action?: unknown };
  if (typeof b.domain !== 'string' || typeof b.action !== 'string') return false;
  return GUEST_READ_ACTIONS.has(`${b.domain}.${b.action}`);
}
