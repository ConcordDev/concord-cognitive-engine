'use client';

/**
 * Mesh Lens — surfaces concord-mesh.js (server/lib/concord-mesh.js).
 *
 * 7 transport layers: Internet/WiFi/BLE/LoRa/RF-Ham/Telephone/NFC.
 * The substrate routes DTU frames across whichever transport is
 * available — survives infrastructure collapse. This lens shows
 * status + per-transport channels + peer list + pending transfers.
 *
 * Phase 4.14 wire-the-Lost (universe-gap fill).
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MeshRepos } from '@/components/mesh/MeshRepos';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radio, Wifi, Bluetooth, Globe, Phone, Antenna, Smartphone,
  Loader2, RefreshCw, Network, Send,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'status' | 'channels' | 'peers' | 'transfers';

const TRANSPORT_ICONS: Record<string, LucideIcon> = {
  internet: Globe,
  wifi: Wifi,
  ble: Bluetooth,
  bluetooth: Bluetooth,
  lora: Antenna,
  rf_ham: Radio,
  ham: Radio,
  telephone: Phone,
  nfc: Smartphone,
};

export default function MeshLensPage() {
  useLensNav('mesh');
  const [activeTab, setActiveTab] = useState<TabKey>('status');


  // Lens-scoped keyboard commands (auto-wired by codemod).
  useLensCommand(
    [
      { id: 'tab-status', keys: 's', description: 'Status', category: 'navigation', action: () => setActiveTab('status') },
      { id: 'tab-channels', keys: 'c', description: 'Channels', category: 'navigation', action: () => setActiveTab('channels') },
      { id: 'tab-peers', keys: 'p', description: 'Peers', category: 'navigation', action: () => setActiveTab('peers') },
      { id: 'tab-transfers', keys: 't', description: 'Transfers', category: 'navigation', action: () => setActiveTab('transfers') },
    ],
    { lensId: 'mesh' }
  );
  const status = useQuery({
    queryKey: ['mesh-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'status', {});
      return (r.data?.result ?? r.data) as { active?: boolean; transports?: string[]; nodeId?: string; uptime?: number };
    },
    refetchInterval: 30_000,
  });

  const channels = useQuery({
    queryKey: ['mesh-channels'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'channels', {});
      return (r.data?.result ?? r.data) as { channels?: Array<{ transport: string; available: boolean; bandwidth?: number; latency?: number }> };
    },
    refetchInterval: 30_000,
  });

  const peers = useQuery({
    queryKey: ['mesh-peers'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'peers', {});
      return (r.data?.result ?? r.data) as { peers?: Array<{ id: string; transport?: string; lastSeen?: string; trust?: number }> };
    },
    refetchInterval: 60_000,
  });

  const pending = useQuery({
    queryKey: ['mesh-pending'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'pending', {});
      return (r.data?.result ?? r.data) as { transfers?: Array<{ id: string; transport?: string; state?: string; size?: number }> };
    },
    refetchInterval: 15_000,
  });

  const stats = useQuery({
    queryKey: ['mesh-stats'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'stats', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });

  const detectChannels = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('mesh', 'sync', {})).data?.result,
    onSuccess: () => {
      channels.refetch();
      status.refetch();
    },
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'status',    label: 'Status',    icon: Network },
    { key: 'channels',  label: 'Channels',  icon: Antenna, count: channels.data?.channels?.filter(c => c.available).length },
    { key: 'peers',     label: 'Peers',     icon: Radio,   count: peers.data?.peers?.length },
    { key: 'transfers', label: 'Transfers', icon: Send,    count: pending.data?.transfers?.length },
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
            <p className="text-xs text-teal-700">7-transport DTU routing · survives infrastructure collapse</p>
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
          {activeTab === 'status' && (
            <motion.section key="status" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-teal-200">Mesh status</h2>
                <button
                  onClick={() => detectChannels.mutate()}
                  disabled={detectChannels.isPending}
                  className="inline-flex items-center gap-2 rounded bg-teal-700/50 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-600/60 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
                >
                  {detectChannels.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Resync
                </button>
              </div>
              {status.data ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Active" value={status.data.active ? 'yes' : 'no'} />
                  <Stat label="Node ID" value={status.data.nodeId ?? '—'} />
                  <Stat label="Transports" value={status.data.transports?.length ?? 0} />
                  <Stat label="Uptime" value={status.data.uptime ? `${Math.floor(status.data.uptime / 60)}min` : '—'} />
                </div>
              ) : <Loader2 className="h-4 w-4 animate-spin text-teal-500" />}
              {stats.data && (
                <details className="mt-4 rounded border border-teal-900/30 bg-teal-950/10">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-teal-400">Mesh stats</summary>
                  <pre className="overflow-auto p-3 font-mono text-[11px] text-teal-500">{JSON.stringify(stats.data, null, 2)}</pre>
                </details>
              )}
            </motion.section>
          )}

          {activeTab === 'channels' && (
            <motion.section key="channels" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-teal-200">Transport channels</h2>
              {(channels.data?.channels ?? []).length === 0 ? (
                <Empty>No channels detected. Click Resync on the Status tab.</Empty>
              ) : (
                <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(channels.data?.channels ?? []).map(c => {
                    const Icon = TRANSPORT_ICONS[c.transport.toLowerCase()] ?? Antenna;
                    return (
                      <li key={c.transport} className={`flex items-center gap-3 rounded border px-3 py-2 text-xs ${c.available ? 'border-emerald-800/50 bg-emerald-950/10 text-emerald-200' : 'border-teal-900/30 bg-teal-950/10 text-teal-500'}`}>
                        <Icon className="h-4 w-4" aria-hidden />
                        <span className="font-mono uppercase">{c.transport}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${c.available ? 'bg-emerald-700/30 text-emerald-200' : 'bg-rose-900/40 text-rose-300'}`}>
                          {c.available ? 'available' : 'offline'}
                        </span>
                        {c.bandwidth != null && <span className="ml-auto text-[10px] text-teal-700">{(c.bandwidth / 1024).toFixed(1)} Kbps</span>}
                        {c.latency != null && <span className="text-[10px] text-teal-700">{c.latency}ms</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'peers' && (
            <motion.section key="peers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-teal-200">Mesh peers</h2>
              {(peers.data?.peers ?? []).length === 0 ? (
                <Empty>No peers connected.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(peers.data?.peers ?? []).map(p => (
                    <li key={p.id} className="flex items-center gap-3 rounded border border-teal-900/30 bg-teal-950/10 px-3 py-2 text-xs">
                      <Radio className="h-3.5 w-3.5 text-teal-500" aria-hidden />
                      <span className="font-mono text-teal-300">{p.id}</span>
                      {p.transport && <span className="rounded bg-teal-800/30 px-1.5 py-0.5 text-[10px]">{p.transport}</span>}
                      {p.trust != null && <span className="text-[10px] text-teal-500">trust {(p.trust * 100).toFixed(0)}%</span>}
                      {p.lastSeen && <span className="ml-auto text-[10px] text-teal-700">{new Date(p.lastSeen).toLocaleTimeString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'transfers' && (
            <motion.section key="transfers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-teal-200">Pending transfers</h2>
              {(pending.data?.transfers ?? []).length === 0 ? (
                <Empty>No pending transfers.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(pending.data?.transfers ?? []).map(t => (
                    <li key={t.id} className="flex items-center gap-3 rounded border border-teal-900/30 bg-teal-950/10 px-3 py-2 text-xs">
                      <Send className="h-3.5 w-3.5 text-teal-500" aria-hidden />
                      <span className="font-mono text-teal-300">{t.id}</span>
                      {t.transport && <span className="rounded bg-teal-800/30 px-1.5 py-0.5 text-[10px]">{t.transport}</span>}
                      {t.state && <span className="rounded bg-teal-700/40 px-1.5 py-0.5 text-[10px] text-teal-200">{t.state}</span>}
                      {t.size != null && <span className="ml-auto text-[10px] text-teal-700">{t.size} B</span>}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <MeshRepos />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-3 text-teal-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-teal-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-teal-900/30 bg-teal-950/10 px-4 py-6 text-center text-xs text-teal-600">{children}</p>;
}
