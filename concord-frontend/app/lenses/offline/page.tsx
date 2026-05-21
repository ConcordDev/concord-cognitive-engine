'use client';

import { useState, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ServiceWorkerPanel } from '@/components/offline/ServiceWorkerPanel';
import { StorageQuotaPanel } from '@/components/offline/StorageQuotaPanel';
import { ReplicationPanel } from '@/components/offline/ReplicationPanel';
import { ConflictMergePanel, type Conflict } from '@/components/offline/ConflictMergePanel';
import { BackoffPanel } from '@/components/offline/BackoffPanel';
import { SyncAnalysisPanel } from '@/components/offline/SyncAnalysisPanel';
import { OfflineRepos } from '@/components/offline/OfflineRepos';
import { Layers, ChevronDown } from 'lucide-react';

/**
 * Offline lens — a real PWA offline-sync workbench (PouchDB/Dexie + Workbox
 * analog). Every panel is wired to a live backend macro or a real browser API:
 *  - ServiceWorkerPanel  → registers /sw.js + offline.swManifest
 *  - StorageQuotaPanel   → navigator.storage.estimate()
 *  - ReplicationPanel    → IndexedDB write-through + offline.replication{Pull,Push,Status} + syncCheckpoint
 *  - ConflictMergePanel  → offline.mergeResolve side-by-side picker
 *  - BackoffPanel        → navigator.onLine + offline.backoffSchedule
 *  - SyncAnalysisPanel   → offline.syncConflict / cacheStrategy / deltaCompute on real local data
 */
export default function OfflineLensPage() {
  useLensNav('offline');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [replicationKey, setReplicationKey] = useState(0);
  const [showFeatures, setShowFeatures] = useState(false);

  // Conflicts surfaced by a push are held until the user resolves them.
  const handleConflicts = useCallback((c: Conflict[]) => {
    setConflicts((prev) => {
      const merged = [...prev];
      for (const next of c) {
        const idx = merged.findIndex((m) => m.id === next.id);
        if (idx >= 0) merged[idx] = next;
        else merged.push(next);
      }
      return merged;
    });
  }, []);

  const handleResolved = useCallback((id: string) => {
    setConflicts((prev) => prev.filter((c) => c.id !== id));
    setReplicationKey((k) => k + 1);
  }, []);

  // A connectivity restore / backoff window remounts the replication panel so
  // it re-reads the local store and re-syncs.
  const handleRetryDue = useCallback(() => {
    setReplicationKey((k) => k + 1);
  }, []);

  useLensCommand(
    [
      {
        id: 'jump-replication',
        keys: 's',
        description: 'Focus the replication panel',
        category: 'view',
        action: () => {
          document.getElementById('offline-replication')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
      {
        id: 'jump-analysis',
        keys: 'a',
        description: 'Focus the sync-analysis panel',
        category: 'view',
        action: () => {
          document.getElementById('offline-analysis')?.scrollIntoView({ behavior: 'smooth' });
        },
      },
    ],
    { lensId: 'offline' },
  );

  return (
    <LensShell lensId="offline" asMain={false}>
      <FirstRunTour lensId="offline" />
      <ManifestActionBar />
      <DepthBadge lensId="offline" size="sm" className="ml-2" />
      <LensVerticalHero lensId="offline" className="mx-6 mt-4" />

      <div data-lens-theme="offline" className="space-y-6 p-6">
        <header className="flex items-center gap-3">
          <span className="text-2xl">📴</span>
          <div>
            <h1 className="text-xl font-bold">Offline Lens</h1>
            <p className="text-sm text-gray-400">
              Local-first sync workbench — IndexedDB write-through, service-worker
              caching, CRDT conflict resolution, and bidirectional replication.
            </p>
          </div>
        </header>

        <UniversalActions domain="offline" artifactId={null} compact />

        {/* Connectivity + retry backoff */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <BackoffPanel onRetryDue={handleRetryDue} />
        </section>

        {/* Conflict resolution — only renders when there are conflicts */}
        {conflicts.length > 0 && (
          <section className="rounded-xl border border-amber-500/25 bg-zinc-950/40 p-4">
            <ConflictMergePanel conflicts={conflicts} onResolved={handleResolved} />
          </section>
        )}

        {/* Bidirectional replication + IndexedDB write-through */}
        <section
          id="offline-replication"
          className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
        >
          <ReplicationPanel
            key={replicationKey}
            onConflicts={handleConflicts}
            onStateChange={handleRetryDue}
          />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Service worker / Workbox */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <ServiceWorkerPanel />
          </section>

          {/* Browser storage quota */}
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <StorageQuotaPanel />
          </section>
        </div>

        {/* Sync intelligence — CRDT / cache / delta analysis */}
        <section
          id="offline-analysis"
          className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4"
        >
          <SyncAnalysisPanel />
        </section>

        {/* Lens features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg bg-white/[0.02] px-4 py-3 text-sm text-gray-300 transition-colors hover:bg-white/[0.04] hover:text-white"
          >
            <span className="flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Lens Features &amp; Capabilities
            </span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
            />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId="offline" />
            </div>
          )}
        </div>

        {/* Real-world offline-first tooling */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <OfflineRepos />
        </section>

        <RecentMineCard domain="offline" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="offline" hideWhenEmpty className="mt-3" />
        <CrossLensRecentsPanel lensId="offline" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
