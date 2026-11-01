'use client';

import { createContext, useContext } from 'react';

/**
 * Header the middleware sets (never trusted from the client; it strips any inbound copy) on a
 * signed-out request for one of the lenses open to visitors. The root layout turns it into this
 * context so the shell and the lens entry can show the visitor surface from the very first render:
 * no flash, no extra /api/auth/me round trip, no guessing from an httpOnly cookie.
 */
// The values live in a server-safe module (the root layout is a server component and must get the real string).
export { ANON_BROWSE_HEADER, PUBLIC_BROWSE_LENSES } from './anon-browse-constants';

const AnonBrowseContext = createContext(false);

export function AnonBrowseProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <AnonBrowseContext.Provider value={value}>{children}</AnonBrowseContext.Provider>;
}

/** True on a signed-out visit to a visitor-browsable lens. */
export function useAnonBrowse(): boolean {
  return useContext(AnonBrowseContext);
}
