'use client';

import { SpaceflightNewsPanel } from '@/components/space/SpaceflightNewsPanel';
import { UpcomingLaunchesPanel } from '@/components/space/UpcomingLaunchesPanel';
import { ds } from '@/lib/design-system';

/** Folded from page accordion "Spaceflight news & upcoming launches". */
export function NewsLaunchesPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Spaceflight news & launches</h2>
        <p className={ds.textMuted}>Live Spaceflight News API + Launch Library 2 upcoming.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SpaceflightNewsPanel domain="space" />
        <UpcomingLaunchesPanel domain="space" />
      </div>
    </div>
  );
}
