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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OpsRepos } from '@/components/ops/OpsRepos';
import { OpsActionPanel } from '@/components/ops/OpsActionPanel';
import { IncidentConsole } from '@/components/ops/IncidentConsole';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useUIStore } from '@/store/ui';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { apiHelpers, isForbidden } from '@/lib/api/client';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { useState } from 'react';
import {
  Cpu, Database, Wrench, Eye, Compass, Hammer,
  Loader2, RefreshCw, Siren, PhoneCall, GitBranch,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'incidents' | 'attention' | 'repair_network' | 'physical' | 'explore' | 'dtu' | 'oncall' | 'repos';

// The `attention_alloc` / `repair_network` / `physical` / `explore` macro
// domains are operator-only (server-side gate: requireOpsSubstrateAdminRole
// in server.js) — but POST /api/lens/run always answers HTTP 200 with
// `{ ok: true, result }`, where `result` carries the macro's OWN
// `{ ok: false, error }` on a denial. A plain `.data?.result` read would
// silently treat that denial as data (undefined fields → a stuck spinner,
// never the friendly gate below). Surface it as a thrown query error so
// `isForbidden(query.error)` — which the `forbidden` check further down
// relies on — can actually see it.
async function runGatedDomain<T>(domain: string, action: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await apiHelpers.lens.runDomain(domain, action, input);
  const result = (r.data?.result ?? r.data) as ({ ok?: boolean; error?: string } & T) | undefined;
  if (result && typeof result === 'object' && 'ok' in result && (result as { ok?: boolean }).ok === false) {
    throw { ok: false, error: (result as { error?: string }).error || 'request failed' };
  }
  return result as T;
}

export default function OpsLensPage() {
  useLensNav('ops');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('incidents');

  const attention = useQuery({
    queryKey: ['ops-attention'],
    queryFn: () => runGatedDomain<{ allocations?: Record<string, number>; budget?: number }>('attention_alloc', 'status', {}),
    refetchInterval: 30_000,
  });
  const runAttention = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('attention_alloc', 'run', {})).data?.result,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops-attention'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Attention cycle ran.' });
    },
    onError: () => useUIStore.getState().addToast({ type: 'error', message: 'The attention cycle failed.' }),
  });

  const repairNet = useQuery({
    queryKey: ['ops-repair-network'],
    queryFn: () => runGatedDomain<{ connected?: boolean; pendingFixes?: number; lastSync?: string }>('repair_network', 'status', {}),
    refetchInterval: 60_000,
  });
  const pushRepair = useMutation({
    mutationFn: async () => (await apiHelpers.lens.runDomain('repair_network', 'push', {})).data?.result,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ops-repair-network'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Fixes pushed to the repair network.' });
    },
    onError: () => useUIStore.getState().addToast({ type: 'error', message: 'Pushing fixes failed.' }),
  });

  const physical = useQuery({
    queryKey: ['ops-physical'],
    queryFn: async () => {
      const metrics = await runGatedDomain<Record<string, number>>('physical', 'metrics', {});
      const types = await runGatedDomain<{ types?: string[] }>('physical', 'types', {});
      return { metrics, types };
    },
  });

  const explore = useQuery({
    queryKey: ['ops-explore'],
    queryFn: () => runGatedDomain<{ explorations?: Array<{ id: string; domain?: string; createdAt?: string }> }>('explore', 'history', { limit: 20 }),
  });

  const tabs: { key: TabKey; label: string; keys: string; title: string; hint: string; icon: LucideIcon; count?: number }[] = [
    { key: 'incidents', label: 'Incidents', keys: 'i', title: 'Whatever is on fire', hint: 'Incident console: triage, ack, resolve', icon: Siren },
    { key: 'attention', label: 'Attention', keys: 'a', title: 'Where the system is looking', hint: 'Civilization attention allocator', icon: Eye, count: attention.data?.allocations ? Object.keys(attention.data.allocations).length : undefined },
    { key: 'repair_network', label: 'Repair net', keys: 'r', title: 'Who is fixing what', hint: 'Distributed repair network', icon: Wrench, count: repairNet.data?.pendingFixes },
    { key: 'physical', label: 'Physical DTUs', keys: 'p', title: 'What the substrate can measure', hint: 'Physical DTU types and metrics', icon: Database, count: physical.data?.types?.types?.length },
    { key: 'explore', label: 'Explorations', keys: 'x', title: 'Adjacent possibilities', hint: 'Reality explorations history', icon: Compass, count: explore.data?.explorations?.length },
    { key: 'dtu', label: 'DTU substrate', keys: 'd', title: 'The substrate controls', hint: 'Admin-tier DTU macros', icon: Cpu },
    { key: 'oncall', label: 'On-call', keys: 'o', title: 'Who gets paged next', hint: 'On-call, runbook, escalation and post-mortem workbench', icon: PhoneCall },
    { key: 'repos', label: 'SRE repos', keys: 'g', title: 'Tooling worth stealing', hint: 'Ops / SRE tooling repos on GitHub', icon: GitBranch },
  ];

  useLensCommand(
    [
      ...tabs.map((t) => ({
        id: `ops-tab-${t.key}`,
        keys: t.keys,
        description: `${t.label} — ${t.hint}`,
        category: 'navigation' as const,
        action: () => setActiveTab(t.key),
      })),
      { id: 'ops-run-attention', keys: 'c', description: 'Run attention cycle', category: 'actions' as const, action: () => runAttention.mutate() },
    ],
    { lensId: 'ops' },
  );

  const forbidden = [attention, repairNet, physical, explore].some(q => isForbidden(q.error));
  if (forbidden) return (
    <LensShell lensId="ops" asMain={false}>
      <AdminRequiredState roles={['admin', 'operator']} />
    </LensShell>
  );

  const current = tabs.find((t) => t.key === activeTab)!;
  const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';
  const btn = 'inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-zinc-100 hover:bg-white/15 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400/40';
  const spin = <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />;

  return (
    <LensShell lensId="ops" asMain={false}>
      <FirstRunTour lensId="ops" />
      <DepthBadge lensId="ops" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="ops"
        crumb="Ops"
        title={`${current.title}${activeTab === 'incidents' && who ? `, ${who}` : ''}`}
        subtitle="Incidents, attention budget, repair network, physical DTUs, explorations and on-call, with the substrate's admin macros one tab away."
        tabs={tabs.map((t) => ({ id: t.key, label: t.count != null ? `${t.label} ${t.count}` : t.label, icon: t.icon, keys: t.keys, hint: t.hint }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as TabKey)}
        tabsLabel="Ops sections"
        cta={{
          label: runAttention.isPending ? 'Running cycle…' : 'Run attention cycle',
          icon: RefreshCw,
          onClick: () => runAttention.mutate(),
          disabled: runAttention.isPending,
          title: 'Run the civilization attention allocator (C)',
        }}
      >
        <div className="space-y-5">
          {activeTab === 'incidents' && <IncidentConsole />}

          {activeTab === 'attention' && (
            <section className={card}>
              {attention.data?.allocations ? (
                <>
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">Civilization attention budget</h2>
                    <button onClick={() => runAttention.mutate()} disabled={runAttention.isPending} className={btn}>
                      {runAttention.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Run cycle
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    {Object.entries(attention.data.allocations).map(([dom, weight]) => (
                      <Stat key={dom} label={dom} value={typeof weight === 'number' ? weight.toFixed(2) : String(weight)} />
                    ))}
                  </div>
                </>
              ) : spin}
            </section>
          )}

          {activeTab === 'repair_network' && (
            <section className={card}>
              <h2 className="mb-3 text-sm font-semibold text-white">Distributed repair network</h2>
              {repairNet.data ? (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <Stat label="Connected" value={repairNet.data.connected ? 'yes' : 'no'} />
                  <Stat label="Pending fixes" value={repairNet.data.pendingFixes ?? 0} />
                  <Stat label="Last sync" value={repairNet.data.lastSync ? new Date(repairNet.data.lastSync).toLocaleTimeString() : '—'} />
                </div>
              ) : spin}
              <button onClick={() => pushRepair.mutate()} disabled={pushRepair.isPending} className={`mt-4 ${btn}`}>
                {pushRepair.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />} Push fixes
              </button>
            </section>
          )}

          {activeTab === 'physical' && (
            <section className={card}>
              <h2 className="mb-3 text-sm font-semibold text-white">Physical DTU types</h2>
              {physical.data ? (
                <>
                  <ul className="mb-4 flex flex-wrap gap-1">
                    {(physical.data.types?.types ?? []).map(t => (
                      <li key={t} className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-xs text-slate-300">{t}</li>
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
              ) : spin}
            </section>
          )}

          {activeTab === 'explore' && (
            <section className={card}>
              <h2 className="mb-3 text-sm font-semibold text-white">Reality explorations</h2>
              {(explore.data?.explorations ?? []).length === 0 ? (
                <Empty>No explorations yet — reality-explorer macros surface adjacent possibilities here.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(explore.data?.explorations ?? []).map(e => (
                    <li key={e.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                      <Compass className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      <span className="font-mono text-slate-300">{e.id}</span>
                      {e.domain && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">{e.domain}</span>}
                      {e.createdAt && <span className="ml-auto text-[10px] text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {activeTab === 'dtu' && (
            <section className={card}>
              <h2 className="mb-3 text-sm font-semibold text-white">DTU substrate</h2>
              <p className="text-xs text-slate-400">
                The DTU substrate exposes admin-tier macros for direct CRUD and lifecycle control.
                Most are reached through the Marketplace and Author lenses; the list below names them.
              </p>
              <ul className="mt-4 grid grid-cols-2 gap-1 font-mono text-xs text-slate-400 sm:grid-cols-4">
                {['create', 'update', 'delete', 'search', 'export', 'import', 'cluster', 'gapPromote'].map((m) => (
                  <li key={m}><Hammer className="mr-1 inline h-3 w-3" aria-hidden /> dtu.{m}</li>
                ))}
              </ul>
            </section>
          )}

          {activeTab === 'oncall' && (
            <section className={card}>
              <PipingProvider>
                <OpsActionPanel />
              </PipingProvider>
            </section>
          )}

          {activeTab === 'repos' && (
            <section className={card}>
              <OpsRepos />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-slate-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs text-slate-400">{children}</p>;
}
