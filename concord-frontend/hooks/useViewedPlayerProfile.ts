'use client';

import { useCallback, useEffect, useState } from 'react';

interface ViewPlayerProfileDetail {
  playerId?: string;
}

/**
 * Subscribes to the `concordia:view-player-profile` CustomEvent and tracks
 * which OTHER player's profile is currently being viewed.
 *
 * The dead-wire bug this fixes (V1.2 Wave A, "Society & Presence" capability
 * 4 — reputation + citation graph): `PlayerPresence.tsx`'s "View Profile"
 * button calls `onViewProfile(playerId)`, and `app/lenses/world/page.tsx`'s
 * handler dispatches this event AND opens the profile panel — but nothing
 * ever captured the `playerId` payload. The panel always rendered
 * `<PlayerProfile isOwnProfile />` with no target, so clicking "View Profile"
 * on ANY other player silently reopened the caller's own profile. This hook
 * is the fix: `viewedProfileUserId` feeds `targetUserId` into the shared
 * `PlayerProfile` panel (the same component the self-view already uses —
 * `server/domains/profile.js`'s new `targetUserId` param resolves it to a
 * real, peer-safe view of that player instead).
 */
export function useViewedPlayerProfile() {
  const [viewedProfileUserId, setViewedProfileUserId] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ViewPlayerProfileDetail>).detail;
      const playerId = detail?.playerId;
      if (playerId) setViewedProfileUserId(playerId);
    };
    window.addEventListener('concordia:view-player-profile', handler);
    return () => window.removeEventListener('concordia:view-player-profile', handler);
  }, []);

  // Reset back to "viewing my own profile" — call when the caller opens
  // their own profile panel through a different entry point (e.g. the
  // CurrencyHUD button), or when the profile panel closes.
  const clearViewedProfile = useCallback(() => setViewedProfileUserId(null), []);

  return { viewedProfileUserId, setViewedProfileUserId, clearViewedProfile };
}

export default useViewedPlayerProfile;
