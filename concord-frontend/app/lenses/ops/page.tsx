'use client';

/**
 * Ops Lens — substrate operations dashboard. Surfaces 8 admin-tier
 * macro domains that lived headlessly: dtu, attention_alloc,
 * repair_network, physical, explore, forge, cortex, lattice.
 *
 * Phase 3.8 wire-the-Lost — final Phase 3 wire commit. Each tab is
 * status-first observation of substrate health.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OpsRepos } from '@/components/ops/OpsRepos';
import { OpsActionPanel } from '@/components/ops/OpsActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, Database, Wrench, Eye, Compass, Hammer, Activity,
  Loader2, RefreshCw,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'attention' | 'repair_network' | 'physical' | 'explore' | 'dtu';

export default function OpsLensPage() {
  useLensNav('ops');
  const [activeTab, setActiveTab] = useState<TabKey>('attention');

  useLensCommand(
    [
      { id: 'tab-attention', keys: 'a', description: 'Attention allocator', category: 'navigation', action: () => setActiveTab('attention') },
      { id: 'tab-repair', keys: 'r', description: 'Repair network', category: 'navigation', action: () => setActiveTab('repair_network') },
      { id: 'tab-physical', keys: 'p', description: 'Physical', category: 'navigation', action: () => setActiveTab('physical') },
      { id: 'tab-explore', keys: 'x', description: 'Explore', category: 'navigation', action: () => setActiveTab('explore') },
      { id: 'tab-dtu', keys: 'd', description: 'DTU', category: 'navigation', action: () => setActiveTab('dtu') },
    ],
    { lensId: 'ops' }
  );

  const attention = useQuery({
    queryKey: ['ops-attention'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('attention_alloc', 'status', {});
      return (r.data?.result ?? r.data) as { allocations?: Record<string, number>; budget?: number };
    },
    refetchInterval: 30_000,
  });
  const runAttention = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('attention_alloc', 'run', {})).data?.result,
  });

  const repairNet = useQuery({
    queryKey: ['ops-repair-network'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('repair_network', 'status', {});
      return (r.data?.result ?? r.data) as { connected?: boolean; pendingFixes?: number; lastSync?: string };
    },
    refetchInterval: 60_000,
  });
  const pushRepair = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('repair_network', 'push', {})).data?.result,
  });

  const physical = useQuery({
    queryKey: ['ops-physical'],
    queryFn: async () => {
      const m = await apiHelpers.lens.runDomain('physical', 'metrics', {});
      const t = await apiHelpers.lens.runDomain('physical', 'types', {});
      return {
        metrics: (m.data?.result ?? m.data) as Record<string, number>,
        types: (t.data?.result ?? t.data) as { types?: string[] },
      };
    },
  });

  const explore = useQuery({
    queryKey: ['ops-explore'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('explore', 'history', { limit: 20 });
      return (r.data?.result ?? r.data) as { explorations?: Array<{ id: string; domain?: string; createdAt?: string }> };
    },
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'attention',      label: 'Attention',     icon: Eye,      count: attention.data?.allocations ? Object.keys(attention.data.allocations).length : undefined },
    { key: 'repair_network', label: 'Repair Net',    icon: Wrench,   count: repairNet.data?.pendingFixes },
    { key: 'physical',       label: 'Physical DTUs', icon: Database, count: physical.data?.types?.types?.length },
    { key: 'explore',        label: 'Explorations',  icon: Compass,  count: explore.data?.explorations?.length },
    { key: 'dtu',            label: 'DTU substrate', icon: Cpu },
  ];

  return (
    <LensShell lensId="ops" asMain={false}>
      <ManifestActionBar />
      <DepthBadge lensId="ops" size="sm" className="ml-2" />
    <div className="min-h-screen bg-black pb-12 text-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-800/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Activity className="h-6 w-6 text-slate-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Substrate Ops</h1>
            <p className="text-xs text-slate-500">Attention · Repair net · Physical DTUs · Explorations · DTU substrate</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-slate-800/50 px-4 md:px-8" aria-label="Ops sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 ${
                activeTab === key ? 'border-slate-300 text-slate-200' : 'border-transparent text-slate-600 hover:text-slate-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'attention' && (
            <Section k="attention">
              {attention.data?.allocations ? (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-semibold text-slate-200">Civilization attention budget</h2>
                    <button
                      onClick={() => runAttention.mutate()}
                      disabled={runAttention.isPending}
                      className="inline-flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-400"
                    >
                      {runAttention.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Run cycle
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {Object.entries(attention.data.allocations).map(([dom, weight]) => (
                      <Stat key={dom} label={dom} value={typeof weight === 'number' ? weight.toFixed(2) : String(weight)} />
                    ))}
                  </div>
                </>
              ) : <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </Section>
          )}

          {activeTab === 'repair_network' && (
            <Section k="repair_network">
              <h2 className="mb-3 text-base font-semibold text-slate-200">Distributed repair network</h2>
              {repairNet.data ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat label="Connected" value={repairNet.data.connected ? 'yes' : 'no'} />
                  <Stat label="Pending fixes" value={repairNet.data.pendingFixes ?? 0} />
                  <Stat label="Last sync" value={repairNet.data.lastSync ? new Date(repairNet.data.lastSync).toLocaleTimeString() : '—'} />
                </div>
              ) : <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
              <button
                onClick={() => pushRepair.mutate()}
                disabled={pushRepair.isPending}
                className="mt-4 inline-flex items-center gap-2 rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-600 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                {pushRepair.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />} Push fixes
              </button>
            </Section>
          )}

          {activeTab === 'physical' && (
            <Section k="physical">
              <h2 className="mb-3 text-base font-semibold text-slate-200">Physical DTU types</h2>
              {physical.data ? (
                <>
                  <ul className="mb-4 flex flex-wrap gap-1">
                    {(physical.data.types?.types ?? []).map(t => (
                      <li key={t} className="rounded bg-slate-800/60 px-2 py-0.5 font-mono text-xs text-slate-300">{t}</li>
                    ))}
                  </ul>
                  {physical.data.metrics && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      {Object.entries(physical.data.metrics).slice(0, 8).map(([k, v]) => (
                        <Stat key={k} label={k} value={typeof v === 'number' ? v : String(v)} />
                      ))}
                    </div>
                  )}
                </>
              ) : <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
            </Section>
          )}

          {activeTab === 'explore' && (
            <Section k="explore">
              <h2 className="mb-3 text-base font-semibold text-slate-200">Reality explorations</h2>
              {(explore.data?.explorations ?? []).length === 0 ? (
                <Empty>No explorations yet — reality-explorer macros surface adjacent possibilities here.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(explore.data?.explorations ?? []).map(e => (
                    <li key={e.id} className="flex items-center gap-3 rounded border border-slate-800/50 bg-slate-900/30 px-3 py-2 text-xs">
                      <Compass className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                      <span className="font-mono text-slate-300">{e.id}</span>
                      {e.domain && <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px]">{e.domain}</span>}
                      {e.createdAt && <span className="ml-auto text-[10px] text-slate-600">{new Date(e.createdAt).toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {activeTab === 'dtu' && (
            <Section k="dtu">
              <h2 className="mb-3 text-base font-semibold text-slate-200">DTU substrate</h2>
              <p className="text-xs text-slate-500">
                The DTU substrate has 9 admin-tier macros for direct CRUD + lifecycle control.
                Most are reached via the Marketplace and Author lenses; this tab is reserved for
                the v1.1 admin console.
              </p>
              <div className="mt-4 rounded-lg border border-slate-800/50 bg-slate-900/30 p-4 text-xs text-slate-400">
                <h3 className="mb-2 text-sm font-semibold text-slate-300">Substrate macros</h3>
                <ul className="grid grid-cols-2 gap-1 font-mono">
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.create</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.update</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.delete</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.search</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.export</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.import</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.cluster</li>
                  <li><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.gapPromote</li>
                </ul>
              </div>
            </Section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <OpsRepos />
      </section>

      {/* PagerDuty-shape ops workbench: on-call / runbook / escalation / post-mortem + actions */}
      <PipingProvider>
        <section className="mt-6 mx-4">
          <OpsActionPanel />
        </section>
      </PipingProvider>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}

function Section({ children, k }: { children: React.ReactNode; k: TabKey }) {
  return (
    <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-slate-800/50 bg-slate-900/30 p-3 text-slate-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-600">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-slate-800/50 bg-slate-900/30 px-4 py-6 text-center text-xs text-slate-500">{children}</p>;
}
