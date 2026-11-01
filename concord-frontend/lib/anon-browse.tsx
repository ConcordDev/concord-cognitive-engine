'use client';

import { createContext, useContext } from 'react';

/**
 * Header the middleware sets (never trusted from the client; it strips any inbound copy) on a
 * signed-out request for one of the lenses open to visitors. The root layout turns it into this
 * context so the shell and the lens entry can show the visitor surface from the very first render:
 * no flash, no extra /api/auth/me round trip, no guessing from an httpOnly cookie.
 */
export const ANON_BROWSE_HEADER = 'x-concord-anon-browse';

/** Lenses open to signed-out visitors (browse-only, public items, 30 s previews). Exact paths. */
export const PUBLIC_BROWSE_LENSES: ReadonlySet<string> = new Set(['/lenses/music', '/lenses/market']);

const AnonBrowseContext = createContext(false);

export function AnonBrowseProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <AnonBrowseContext.Provider value={value}>{children}</AnonBrowseContext.Provider>;
}

/** True on a signed-out visit to a visitor-browsable lens. */
export function useAnonBrowse(): boolean {
  return useContext(AnonBrowseContext);
}
