'use client';

/**
 * MountStatusHUD — Wave 4b. Small bottom-center pill that shows the
 * player's mount status when mounted. Surfaces:
 *   - Mount topology + name (so the player knows what they're riding)
 *   - Flight altitude (if winged) — driven by the page's flightYRef
 *     pushed into a window event so this component doesn't reach into
 *     the parent's ref
 *   - F to dismount hint
 */

import { useEffect, useState } from 'react';
import { useMountedRide } from '@/hooks/useMountedRide';

export default function MountStatusHUD() {
  const m = useMountedRide();
  const [altitude, setAltitude] = useState(0);

  // The world page dispatches concordia:mount-pose every frame; sample
  // its detail.y - playerAvatar baseline as a rough altitude proxy.
  useEffect(() => {
    if (!m.mounted) return;
    let lastBase = 0;
    let raf: number | null = null;
    const onPose = (e: Event) => {
      const ce = e as CustomEvent<{ y: number }>;
      if (typeof ce.detail?.y === 'number') {
        if (lastBase === 0) lastBase = ce.detail.y;
        setAltitude(Math.max(0, ce.detail.y - lastBase));
      }
    };
    window.addEventListener('concordia:mount-pose', onPose as EventListener);
    return () => {
      window.removeEventListener('concordia:mount-pose', onPose as EventListener);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [m.mounted]);

  if (!m.mounted) return null;

  const topology = m.blueprint?.topology?.replace(/_/g, ' ') ?? 'mount';

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 z-30">
      <div className="bg-slate-950/85 border border-amber-400/40 rounded-md px-3 py-1.5 backdrop-blur flex items-center gap-3 text-xs">
        <div className="text-amber-300 font-semibold uppercase tracking-wider">Mounted</div>
        <div className="text-white">{topology}</div>
        {m.isWinged && (
          <div className="text-cyan-300 font-mono">↑ {altitude.toFixed(1)}m</div>
        )}
        <div className="text-slate-400 text-[10px] font-mono">
          {m.isWinged && 'Space/⇧ · '}F dismount
        </div>
      </div>
    </div>
  );
}
