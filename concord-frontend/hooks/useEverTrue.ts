'use client';

import { useState, useEffect } from 'react';

/**
 * Once `value` has been true at least once, keeps returning true forever
 * (for the life of this mount) — even after `value` itself goes back to
 * false.
 *
 * Used across the shell-diet pass (AppShell.tsx, Providers.tsx) to lazily
 * mount a gated overlay/provider the first time it's actually needed, then
 * leave it mounted so its own isOpen-driven show/hide (exit animations,
 * in-memory state that re-hydrates from the backend on mount, etc.) keeps
 * behaving exactly like an always-mounted component — the only change is
 * *when* it first mounts, never how it behaves once mounted.
 */
export function useEverTrue(value: boolean): boolean {
  const [ever, setEver] = useState(value);
  useEffect(() => {
    if (value && !ever) setEver(true);
  }, [value, ever]);
  return ever;
}
