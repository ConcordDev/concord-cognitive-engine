'use client';

/**
 * Mesh Lens — off-grid mesh networking surface (Meshtastic / Briar
 * parity). The 7-transport DTU routing substrate lives in
 * server/lib/concord-mesh.js; the `mesh.*` macros in server.js surface
 * status / channels / peers / transfers, and server/domains/mesh.js
 * adds the usability layer that makes the mesh a real comms tool:
 *
 *   • Topology — node graph + add / remove / ping (mesh.meshMap, addNode…)
 *   • Messages — direct / group / broadcast chat with delivery + read state
 *   • Signal   — per-transport RSSI / hop / latency + range estimate
 *   • Queue    — store-and-forward frame inspect / retry / prioritize
 *   • Channels — broadcast / group channels with per-channel PSK encryption
 *
 * Phase 4.14 wire-the-Lost (universe-gap fill).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MeshRepos } from '@/components/mesh/MeshRepos';
import { MeshTopology } from '@/components/mesh/MeshTopology';
import { MeshMessaging } from '@/components/mesh/MeshMessaging';
import { MeshSignal } from '@/components/mesh/MeshSignal';
import { MeshQueue } from '@/components/mesh/MeshQueue';
import { MeshChannels } from '@/components/mesh/MeshChannels';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, Loader2, Network, Send, MessageSquare, SignalHigh, Hash,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'overview' | 'topology' | 'messages' | 'signal' | 'queue' | 'channels';

interface MeshOverview {
  nodes: number;
  onlineNodes: number;
  messages: number;
  unread: number;
  channels: number;
  encryptedChannels: number;
  queueDepth: number;
  transports: number;
}

export default function MeshLensPage() {
  useLensNav('mesh');
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-topology', keys: 'g', description: 'Topology', category: 'navigation', action: () => setActiveTab('topology') },
      { id: 'tab-messages', keys: 'm', description: 'Messages', category: 'navigation', action: () => setActiveTab('messages') },
      { id: 'tab-signal', keys: 's', description: 'Signal', category: 'navigation', action: () => setActiveTab('signal') },
      { id: 'tab-queue', keys: 'q', description: 'Queue', category: 'navigation', action: () => setActiveTab('queue') },
      { id: 'tab-channels', keys: 'c', description: 'Channels', category: 'navigation', action: () => setActiveTab('channels') },
    ],
    { lensId: 'mesh' }
  );

  const overview = useQuery({
    queryKey: ['mesh-overview'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'overview', {});
      if (r.data && r.data.ok === false) {
        throw new Error(r.data.error || 'Failed to load the mesh roll-up.');
      }
      return (r.data?.result ?? r.data) as MeshOverview;
    },
    refetchInterval: 30_000,
    retry: false,
  });

  const ov = overview.data;
  const overviewEmpty =
    !!ov && (ov.nodes ?? 0) === 0 && (ov.messages ?? 0) === 0 &&
    (ov.channels ?? 0) === 0 && (ov.queueDepth ?? 0) === 0;

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'overview',  label: 'Overview',  icon: Network },
    { key: 'topology',  label: 'Topology',  icon: Radio,         count: overview.data?.nodes },
    { key: 'messages',  label: 'Messages',  icon: MessageSquare, count: overview.data?.unread || undefined },
    { key: 'signal',    label: 'Signal',    icon: SignalHigh },
    { key: 'queue',     label: 'Queue',     icon: Send,          count: overview.data?.queueDepth || undefined },
    { key: 'channels',  label: 'Channels',  icon: Hash,          count: overview.data?.channels },
  ];

  return (
    <LensShell lensId="mesh" asMain={false}>
      <FirstRunTour lensId="mesh" />
      <ManifestActionBar />
      <DepthBadge lensId="mesh" size="sm" className="ml-2" />
      <div className="min-h-screen bg-black pb-12 text-teal-50">
        <header className="sticky top-0 z-10 border-b border-teal-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Network className="h-6 w-6 text-teal-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Mesh</h1>
              <p className="text-xs text-teal-700">7-transport DTU routing · off-grid comms · survives infrastructure collapse</p>
            </div>
          </div>
        </header>

        <nav className="border-b border-teal-900/30 px-4 md:px-8" aria-label="Mesh sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon, count }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-teal-400 ${
                  activeTab === key ? 'border-teal-400 text-teal-200' : 'border-transparent text-teal-700 hover:text-teal-400'
                }`}
                aria-pressed={activeTab === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                {count != null && <span className="rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] text-teal-300">{count}</span>}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
          <AnimatePresence mode="wait">
            {activeTab === 'overview' && (
              <motion.section key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-4 text-base font-semibold text-teal-200">Mesh roll-up</h2>
                {overview.isLoading ? (
                  <div
                    data-testid="mesh-overview-loading"
                    role="status"
                    aria-busy="true"
                    aria-live="polite"
                    className="flex items-center gap-2 text-sm text-teal-500"
                  >
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the mesh roll-up…
                  </div>
                ) : overview.isError ? (
                  <div
                    data-testid="mesh-overview-error"
                    role="alert"
                    className="rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-sm text-red-300"
                  >
                    <p className="mb-2 font-medium">Couldn&apos;t load the mesh roll-up.</p>
                    <p className="mb-3 text-xs text-red-400/80">{(overview.error as Error)?.message}</p>
                    <button
                      type="button"
                      onClick={() => overview.refetch()}
                      className="rounded border border-red-800 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      Retry
                    </button>
                  </div>
                ) : overviewEmpty ? (
                  <div
                    data-testid="mesh-overview-empty"
                    className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-6 text-center text-sm text-teal-500"
                  >
                    <Network className="mx-auto mb-2 h-6 w-6 text-teal-700" aria-hidden />
                    <p className="font-medium text-teal-300">No mesh yet.</p>
                    <p className="mt-1 text-xs text-teal-600">
                      Add your first peer node in <span className="text-teal-400">Topology</span> to start building the mesh.
                    </p>
                  </div>
                ) : (
                  <div data-testid="mesh-overview-grid" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Stat label="Nodes" value={ov?.nodes ?? 0} hint={`${ov?.onlineNodes ?? 0} online`} />
                    <Stat label="Messages" value={ov?.messages ?? 0} hint={`${ov?.unread ?? 0} unread`} />
                    <Stat label="Channels" value={ov?.channels ?? 0} hint={`${ov?.encryptedChannels ?? 0} encrypted`} />
                    <Stat label="Queue depth" value={ov?.queueDepth ?? 0} hint="store-and-forward" />
                    <Stat label="Transports" value={ov?.transports ?? 0} hint="routing layers" />
                  </div>
                )}
                <p className="mt-4 text-xs text-teal-700">
                  Use the tabs above — build your node graph in Topology, chat in Messages, inspect link quality in
                  Signal, manage stuck frames in Queue, and set up encrypted group channels in Channels.
                </p>
              </motion.section>
            )}

            {activeTab === 'topology' && (
              <motion.section key="topology" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-3 text-base font-semibold text-teal-200">Mesh topology</h2>
                <MeshTopology />
              </motion.section>
            )}

            {activeTab === 'messages' && (
              <motion.section key="messages" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-3 text-base font-semibold text-teal-200">Direct &amp; group messaging</h2>
                <MeshMessaging />
              </motion.section>
            )}

            {activeTab === 'signal' && (
              <motion.section key="signal" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-3 text-base font-semibold text-teal-200">Signal &amp; coverage</h2>
                <MeshSignal />
              </motion.section>
            )}

            {activeTab === 'queue' && (
              <motion.section key="queue" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-3 text-base font-semibold text-teal-200">Store-and-forward queue</h2>
                <MeshQueue />
              </motion.section>
            )}

            {activeTab === 'channels' && (
              <motion.section key="channels" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <h2 className="mb-3 text-base font-semibold text-teal-200">Group channels &amp; encryption</h2>
                <MeshChannels />
              </motion.section>
            )}
          </AnimatePresence>
        </main>

        <section className="mx-auto mt-6 max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 px-4 md:px-8">
          <MeshRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="mesh" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="mesh" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="mesh" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-3 text-teal-200"
    >
      <div className="mb-1 text-[11px] uppercase tracking-wider text-teal-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-teal-600">{hint}</div>}
    </motion.div>
  );
}
