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

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SyncDashboard } from '@/components/sync/SyncDashboard';
import { SyncthingReleases } from '@/components/sync/SyncthingReleases';
import { SyncRepos } from '@/components/sync/SyncRepos';

export default function SyncPage() {
  const [showReleases, setShowReleases] = useState(false);
  const [showRepos, setShowRepos] = useState(false);
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
          <button
            type="button"
            onClick={() => setShowReleases(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Syncthing releases (GitHub)</span>
            {showReleases ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showReleases && (
            <div className="mt-3">
              <SyncthingReleases />
            </div>
          )}
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowRepos(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Sync tooling (GitHub)</span>
            {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showRepos && (
            <div className="mt-3">
              <SyncRepos />
            </div>
          )}
        </section>
      </div>      <CrossLensRecentsPanel lensId="sync" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
