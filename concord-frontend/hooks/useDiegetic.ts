'use client';

// useDiegetic — true when the current page was opened with ?diegetic=1.
//
// Lens-as-Station loads a lens inside an iframe (LensStationOverlay) framed by
// the in-world StationOverlayShell. In that context the app's own chrome — the
// global sidebar/topbar (AppShell) and the per-lens nav/context-bar/timeline/FAB
// stack (LensLayout) — is redundant and breaks the illusion. Diegetic mode trims
// it so the lens renders full-bleed inside the station frame.
//
// Hydration-safe: returns false on the server + first client render (matching
// SSR), then flips after mount — at most a one-frame chrome flash inside the
// iframe, which the AppShell `mounted` gate already largely hides.

import { useEffect, useState } from 'react';

/** Read a boolean query flag from the current URL (client-only). */
export function readDiegetic(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('diegetic') === '1';
  } catch {
    return false;
  }
}

export function useDiegetic(): boolean {
  const [diegetic, setDiegetic] = useState(false);
  useEffect(() => { setDiegetic(readDiegetic()); }, []);
  return diegetic;
}

export default useDiegetic;
