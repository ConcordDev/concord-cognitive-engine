'use client';

/**
 * Mesh Lens — off-grid mesh networking surface (Meshtastic / Briar
 * parity). The 7-transport DTU routing substrate lives in
 * server/lib/concord-mesh.js; the `mesh.*` macros in server.js surface
 * status / channels / peers / transfers, and server/domains/mesh.js
 * adds the usability layer that makes the mesh a real comms tool:
 *
 *   • Send DTU — the lens's namesake capability: transmit a real DTU
 *     through the routing substrate (mesh.send → sendDTU: channel
 *     selection, fragmentation, store-and-forward)
 *   • Topology — node graph + add / remove / ping (mesh.meshMap, addNode…)
 *   • Messages — direct / group / broadcast chat with delivery + read state
 *   • Signal   — per-transport RSSI / hop / latency + range estimate
 *   • Queue    — store-and-forward frame inspect / retry / prioritize
 *   • Channels — broadcast / group channels with per-channel PSK encryption
 *
 * Phase 4.14 wire-the-Lost (universe-gap fill). Wave 4 gap-closure (2026-07)
 * added the Send DTU tab — see docs/lens-specs/mesh-capability-map.md.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MeshRepos } from '@/components/mesh/MeshRepos';
import { MeshTopology } from '@/components/mesh/MeshTopology';
import { MeshSendDtu } from '@/components/mesh/MeshSendDtu';
import { MeshMessaging } from '@/components/mesh/MeshMessaging';
import { MeshSignal } from '@/components/mesh/MeshSignal';
import { MeshQueue } from '@/components/mesh/MeshQueue';
import { MeshChannels } from '@/components/mesh/MeshChannels';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import {
  Radio, Loader2, Network, Send, MessageSquare, SignalHigh, Hash, PackagePlus,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'overview' | 'transmit' | 'topology' | 'messages' | 'signal' | 'queue' | 'channels';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  useLensCommand(
    [
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActiveTab('overview') },
      { id: 'tab-transmit', keys: 't', description: 'Send DTU', category: 'navigation', action: () => setActiveTab('transmit') },
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

  const tabs: { key: TabKey; label: string; icon: LucideIcon; keys: string; title: string; hint: string; count?: number }[] = [
    { key: 'overview', label: 'Overview', icon: Network, keys: 'o', title: 'Your mesh at a glance', hint: 'Nodes, messages, channels and queue depth' },
    { key: 'transmit', label: 'Send DTU', icon: PackagePlus, keys: 't', title: 'Send a DTU over the mesh', hint: 'Transmit a real DTU through the routing substrate' },
    { key: 'topology', label: 'Topology', icon: Radio, keys: 'g', title: 'Who is on the mesh', hint: 'Node graph: add, remove and ping', count: overview.data?.nodes },
    { key: 'messages', label: 'Messages', icon: MessageSquare, keys: 'm', title: 'Direct and group messages', hint: 'Delivery and read state', count: overview.data?.unread || undefined },
    { key: 'signal', label: 'Signal', icon: SignalHigh, keys: 's', title: 'How strong the links are', hint: 'RSSI, hops, latency and range estimate' },
    { key: 'queue', label: 'Queue', icon: Send, keys: 'q', title: 'What is waiting to forward', hint: 'Store-and-forward frames', count: overview.data?.queueDepth || undefined },
    { key: 'channels', label: 'Channels', icon: Hash, keys: 'c', title: 'Encrypted group channels', hint: 'Broadcast and PSK-encrypted channels', count: overview.data?.channels },
  ];
  const current = tabs.find((t) => t.key === activeTab)!;

  return (
    <LensShell lensId="mesh" asMain={false}>
      <FirstRunTour lensId="mesh" />
      <DepthBadge lensId="mesh" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="mesh"
        crumb="Mesh"
        title={`${current.title}${activeTab === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="7-transport DTU routing, off-grid comms, built to survive infrastructure collapse."
        tabs={tabs.map((t) => ({
          id: t.key,
          label: t.count != null ? `${t.label} (${t.count})` : t.label,
          icon: t.icon,
          keys: t.keys,
          hint: t.hint,
        }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as TabKey)}
        tabsLabel="Mesh sections"
        cta={{ label: 'Send a DTU', icon: PackagePlus, onClick: () => setActiveTab('transmit'), title: 'Transmit a DTU over the mesh' }}
      >
        <div className="space-y-5">
          {activeTab === 'overview' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <h2 className="mb-4 text-base font-semibold text-white">Mesh roll-up</h2>
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
                    Add your first peer node in <span className="text-teal-400">Topology</span>, then send a DTU in{' '}
                    <span className="text-teal-400">Send DTU</span> to start building the mesh.
                  </p>
                </div>
              ) : (
                <div data-testid="mesh-overview-grid" className="grid grid-cols-2 gap-3 md:grid-cols-5">
                  <Stat label="Nodes" value={ov?.nodes ?? 0} hint={`${ov?.onlineNodes ?? 0} online`} />
                  <Stat label="Messages" value={ov?.messages ?? 0} hint={`${ov?.unread ?? 0} unread`} />
                  <Stat label="Channels" value={ov?.channels ?? 0} hint={`${ov?.encryptedChannels ?? 0} encrypted`} />
                  <Stat label="Queue depth" value={ov?.queueDepth ?? 0} hint="store-and-forward" />
                  <Stat label="Transports" value={ov?.transports ?? 0} hint="routing layers" />
                </div>
              )}
            </section>
          )}
          {activeTab === 'transmit' && <MeshSendDtu />}
          {activeTab === 'topology' && <MeshTopology />}
          {activeTab === 'messages' && <MeshMessaging />}
          {activeTab === 'signal' && <MeshSignal />}
          {activeTab === 'queue' && <MeshQueue />}
          {activeTab === 'channels' && <MeshChannels />}

          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <MeshRepos />
          </section>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div
      className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-3 text-teal-200"
    >
      <div className="mb-1 text-[11px] uppercase tracking-wider text-teal-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-teal-600">{hint}</div>}
    </div>
  );
}
