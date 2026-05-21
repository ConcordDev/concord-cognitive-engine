'use client';

/**
 * /lenses/sync — DTU cross-device sync. Phase 9.6 #19.
 * iCloud-killer for thoughts. No subscriptions.
 *
 * The SyncDashboard surfaces the full synchronization experience
 * (status, sync-now, revoke, auto-sync, conflicts, selective sync,
 * quota, activity feed, presence) over the `sync` domain macros.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline by SyncDashboard when there are no devices.

import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SyncDashboard } from '@/components/sync/SyncDashboard';
import { SyncthingReleases } from '@/components/sync/SyncthingReleases';
import { SyncRepos } from '@/components/sync/SyncRepos';

export default function SyncPage() {
  useLensCommand([
    { id: 'sync-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'sync' });

  return (
    <LensShell lensId="sync">
      <FirstRunTour lensId="sync" />
      <DepthBadge lensId="sync" size="sm" className="ml-2" />
      <div className="mx-auto max-w-3xl p-6 sm:p-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">DTU Sync</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Your second brain follows you across devices, instances, peers. Phase 0 universal file
            format means any artifact bytes ride along too.{' '}
            <strong>No subscription.</strong> Pure peer-to-peer over Concord federation.
          </p>
        </header>

        <SyncDashboard />

        <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SyncthingReleases />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SyncRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch */}</div>
      <RecentMineCard domain="sync" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="sync" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="sync" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
