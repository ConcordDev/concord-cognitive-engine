'use client';

import { useState, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ServiceWorkerPanel } from '@/components/offline/ServiceWorkerPanel';
import { StorageQuotaPanel } from '@/components/offline/StorageQuotaPanel';
import { ReplicationPanel } from '@/components/offline/ReplicationPanel';
import { ConflictMergePanel, type Conflict } from '@/components/offline/ConflictMergePanel';
import { BackoffPanel } from '@/components/offline/BackoffPanel';
import { SyncAnalysisPanel } from '@/components/offline/SyncAnalysisPanel';
import { OfflineRepos } from '@/components/offline/OfflineRepos';
import { RefreshCw } from 'lucide-react';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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

  const jumpReplication = useCallback(() => {
    document.getElementById('offline-replication')?.scrollIntoView({ behavior: 'smooth' });
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
      <FirstRunTour lensId="offline" />      <DepthBadge lensId="offline" size="sm" className="ml-2" />

      <NorthStarFrame
        lensId="offline"
        crumb="Offline"
        title={`Work without a connection${who ? `, ${who}` : ''}`}
        subtitle="Local-first sync workbench: IndexedDB write-through, service-worker caching, CRDT conflict resolution and bidirectional replication."
        cta={{ label: 'Open replication', icon: RefreshCw, onClick: jumpReplication, title: 'Jump to replication (S)' }}
      >
        <div className="space-y-6">
          {/* Connectivity + retry backoff */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <BackoffPanel onRetryDue={handleRetryDue} />
          </section>

          {/* Conflict resolution — only renders when there are conflicts */}
          {conflicts.length > 0 && (
            <section className="rounded-2xl border border-amber-500/25 bg-[#111] p-4">
              <ConflictMergePanel conflicts={conflicts} onResolved={handleResolved} />
            </section>
          )}

          {/* Bidirectional replication + IndexedDB write-through */}
          <section
            id="offline-replication"
            className="rounded-2xl border border-white/10 bg-[#111] p-4"
          >
            <ReplicationPanel
              key={replicationKey}
              onConflicts={handleConflicts}
              onStateChange={handleRetryDue}
            />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Service worker / Workbox */}
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <ServiceWorkerPanel />
            </section>

            {/* Browser storage quota */}
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <StorageQuotaPanel />
            </section>
          </div>

          {/* Sync intelligence — CRDT / cache / delta analysis */}
          <section
            id="offline-analysis"
            className="rounded-2xl border border-white/10 bg-[#111] p-4"
          >
            <SyncAnalysisPanel />
          </section>

          {/* Real-world offline-first tooling (GitHub reference) */}
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <h2 className="mb-3 text-sm font-semibold text-white">Real-world offline-first tooling (GitHub)</h2>
            <OfflineRepos />
          </section>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
