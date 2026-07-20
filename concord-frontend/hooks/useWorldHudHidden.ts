'use client';

/**
 * Lets globally-mounted chrome (BrainMonitor, SystemStatus — both mounted
 * once in the app shell / lens layout, above every lens page) respect the
 * World Lens's manual "hide HUD" toggle (H key / Photo Mode) without a
 * page.tsx -> layout.tsx prop channel. The World Lens already broadcasts
 * `concordia:hide-hud` on toggle (app/lenses/world/page.tsx) and listens
 * to its own broadcast; this just adds a second, pathname-gated listener
 * so the effect never leaks onto any other lens (the event is only ever
 * dispatched from the World Lens page in the first place, but the
 * pathname check keeps that invariant explicit rather than implicit).
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function useWorldHudHidden(): boolean {
  const pathname = usePathname();
  const onWorldLens = pathname?.startsWith('/lenses/world') ?? false;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!onWorldLens) { setHidden(false); return; }
    const onHideHud = (e: Event) => {
      const detail = (e as CustomEvent<{ hide?: boolean }>).detail;
      setHidden(!!detail?.hide);
    };
    window.addEventListener('concordia:hide-hud', onHideHud);
    return () => window.removeEventListener('concordia:hide-hud', onHideHud);
  }, [onWorldLens]);

  return onWorldLens && hidden;
}
