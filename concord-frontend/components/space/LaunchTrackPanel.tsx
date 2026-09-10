'use client';

import { UpcomingLaunches } from '@/components/space/UpcomingLaunches';
import { LaunchWatchlist } from '@/components/space/LaunchWatchlist';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { ds } from '@/lib/design-system';

/** Personal launch track/watchlist — was always stacked at page bottom. */
export function LaunchTrackPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Launch track</h2>
        <p className={ds.textMuted}>Track, watchlist, mark-watched — launch-track / launch-watchlist macros.</p>
      </div>
      <UpcomingLaunches />
      <LensFeedButton domain="space" />
      <LaunchWatchlist />
    </div>
  );
}
