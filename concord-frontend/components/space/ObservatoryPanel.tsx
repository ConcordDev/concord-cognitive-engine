'use client';

import { SpaceObservatory } from '@/components/space/SpaceObservatory';
import { ds } from '@/lib/design-system';

/** Live Observatory deck — ISS, passes, orbit-3d, countdown, sky map, APOD. */
export function ObservatoryPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Live Observatory</h2>
        <p className={ds.textMuted}>ISS tracking, visible passes, 3D orbit, countdowns, sky map, NASA imagery.</p>
      </div>
      <SpaceObservatory />
    </div>
  );
}
