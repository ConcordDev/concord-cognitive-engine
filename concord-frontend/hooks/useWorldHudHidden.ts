'use client';

/**
 * Lets globally-mounted chrome (BrainMonitor, SystemStatus — both mounted
 * once in the app shell / lens layout, above every lens page) respect the
 * World Lens's manual "hide HUD" toggle (H key / Photo Mode) without a
 * page.tsx -> layout.tsx prop channel.
 *
 * World Lens Phase 6b — this used to run its own independent
 * `concordia:hide-hud` window-event listener with its own local `useState`
 * copy (a second copy of the exact same listener world/page.tsx also kept,
 * each tracking the flag separately). `HUDContextProvider` (mounted once
 * at the World Lens root) now owns the ONE listener that folds that event
 * into the shared `useHUDContext` store's `manualHidden` field, so this
 * hook just reads it — the pathname gate stays, since `manualHidden` is
 * global store state that (correctly) doesn't reset itself just because
 * the World Lens's own provider unmounted when the player navigated away.
 */

import { usePathname } from 'next/navigation';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';

export function useWorldHudHidden(): boolean {
  const pathname = usePathname();
  const onWorldLens = pathname?.startsWith('/lenses/world') ?? false;
  const manualHidden = useHUDContext((s) => s.manualHidden);
  return onWorldLens && manualHidden;
}
