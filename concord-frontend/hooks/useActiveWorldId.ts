'use client';

// useActiveWorldId — the single same-tab-reactive read of the active world.
//
// `concordia:activeWorldId` lives in localStorage. The native `storage` event
// only fires in OTHER tabs, so HUDs that read it once on mount went stale on
// world travel inside the SAME tab. useWorldTravel dispatches the
// `concordia:active-world-changed` CustomEvent on the active tab when it writes
// the new world — this hook is the real consumer of that event (it had none),
// so any HUD using it re-renders + re-fetches the moment the player travels.

import { useEffect, useState } from 'react';

export const ACTIVE_WORLD_KEY = 'concordia:activeWorldId';
export const ACTIVE_WORLD_CHANGED_EVENT = 'concordia:active-world-changed';

function readActiveWorld(fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(ACTIVE_WORLD_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Returns the current active world id, updating live on world travel (same tab
 * via `concordia:active-world-changed`, other tabs via the `storage` event).
 */
export function useActiveWorldId(fallback = 'concordia-hub'): string {
  const [worldId, setWorldId] = useState<string>(fallback);

  useEffect(() => {
    setWorldId(readActiveWorld(fallback));
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as { worldId?: string } | undefined;
      setWorldId(detail?.worldId || readActiveWorld(fallback));
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === ACTIVE_WORLD_KEY) setWorldId(readActiveWorld(fallback));
    };
    window.addEventListener(ACTIVE_WORLD_CHANGED_EVENT, onChange as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ACTIVE_WORLD_CHANGED_EVENT, onChange as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [fallback]);

  return worldId;
}
