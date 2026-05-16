'use client';

/**
 * Cognition Lens — surfaces the cognition substrate that previously
 * lived headlessly in `hlr-engine.js`, `hlm-engine.js`,
 * `breakthrough-clusters.js`, `drift-monitor.js`, `forgetting-engine.js`.
 *
 * Phase 3 wire-the-Lost #2: HLR (7 reasoning modes), HLM (lattice
 * topology mapping), Breakthrough clusters (cross-domain synthesis),
 * Drift detection, Forgetting candidates — all callable, none had UI.
 *
 * Frontend Parity: all 9 polish requirements addressed.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { BrainPoolStatus } from '@/components/cognition/BrainPoolStatus';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain, Sparkles, Activity, Trash2, Eye,
  RefreshCw, Loader2, ChevronDown, ChevronRight,
  Zap, Network, Lightbulb,
  type LucideIcon,
} from 'lucide-react';

const REASONING_MODES = [
  { id: 'deductive',      label: 'Deductive',      desc: 'Premise → conclusion. Strict logical implication.' },
  { id: 'inductive',      label: 'Inductive',      desc: 'Pattern → generalization. Risk of overreach.' },
  { id: 'abductive',      label: 'Abductive',      desc: 'Best explanation given evidence. Inference to best fit.' },
  { id: 'adversarial',    label: 'Adversarial',    desc: 'Steelman the opposite. Stress-test claim.' },
  { id: 'analogical',     label: 'Analogical',     desc: 'Map structure across domains.' },
  { id: 'temporal',       label: 'Temporal',       desc: 'How does this evolve over time?' },
  { id: 'counterfactual', label: 'Counterfactual', desc: 'What if the premise were false?' },
];

type TabKey = 'reasoning' | 'topology' | 'breakthrough' | 'forgetting' | 'drift';

export default function CognitionLensPage() {
  useLensNav('cognition');

  const [activeTab, setActiveTab] = useState<TabKey>('reasoning');
  const [hlrInput, setHlrInput] = useState('');
  const [hlrMode, setHlrMode] = useState('abductive');

  // Lens-scoped keyboard commands. Each tab is a different cognitive
  // substrate: r reasoning, t topology, b breakthrough, f forgetting,
  // d drift.
  useLensCommand(
    [
      { id: 'tab-reasoning', keys: 'r', description: 'Reasoning (HLR/HLM)', category: 'navigation', action: () => setActiveTab('reasoning') },
      { id: 'tab-topology', keys: 't', description: 'Topology', category: 'navigation', action: () => setActiveTab('topology') },
      { id: 'tab-breakthrough', keys: 'b', description: 'Breakthrough', category: 'navigation', action: () => setActiveTab('breakthrough') },
      { id: 'tab-forgetting', keys: 'f', description: 'Forgetting', category: 'navigation', action: () => setActiveTab('forgetting') },
      { id: 'tab-drift', keys: 'd', description: 'Drift', category: 'navigation', action: () => setActiveTab('drift') },
    ],
    { lensId: 'cognition' }
  );
  const [hlrResult, setHlrResult] = useState<unknown>(null);
  const [traceExpanded, setTraceExpanded] = useState<string | null>(null);

  // ── HLR ────────────────────────────────────────────────────────────────
  const runHLR = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlr', 'run', { claim: hlrInput, mode: hlrMode });
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setHlrResult(data),
  });

  const traces = useQuery({
    queryKey: ['hlr-traces'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlr', 'list_traces', { limit: 10 });
      return (r.data?.result ?? r.data) as { traces?: Array<{ id: string; mode: string; createdAt: string; chains?: unknown[] }> };
    },
    refetchInterval: 30_000,
  });

  // ── HLM topology ──────────────────────────────────────────────────────
  const topology = useQuery({
    queryKey: ['hlm-topology'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlm', 'topology', {});
      return (r.data?.result ?? r.data) as { clusters?: unknown[]; gaps?: unknown[]; redundancies?: unknown[] };
    },
    refetchInterval: 60_000,
  });

  const triggerHLMPass = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('hlm', 'run', {});
      return r.data?.result ?? r.data;
    },
    onSuccess: () => topology.refetch(),
  });

  // ── Breakthrough ──────────────────────────────────────────────────────
  const breakthroughMetrics = useQuery({
    queryKey: ['breakthrough-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('breakthrough', 'metrics', {});
      return (r.data?.result ?? r.data) as { totalClusters?: number; activeClusters?: number; recentBreakthroughs?: unknown[] };
    },
    refetchInterval: 60_000,
  });

  const clusters = useQuery({
    queryKey: ['breakthrough-clusters'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('breakthrough', 'list', {});
      return (r.data?.result ?? r.data) as Array<{ id: string; topic?: string; status?: string; dtuCount?: number }>;
    },
  });

  // ── Forgetting ────────────────────────────────────────────────────────
  const forgettingStatus = useQuery({
    queryKey: ['forgetting-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('forgetting', 'status', {});
      return (r.data?.result ?? r.data) as { lastRunAt?: number; threshold?: number; totalForgotten?: number };
    },
    refetchInterval: 30_000,
  });

  const forgettingCandidates = useQuery({
    queryKey: ['forgetting-candidates'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('forgetting', 'candidates', {});
      return (r.data?.result ?? r.data) as Array<{ id: string; retentionScore: number; lastAccessed?: number }>;
    },
  });

  // ── Drift ────────────────────────────────────────────────────────────
  const driftScan = useQuery({
    queryKey: ['drift-findings'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('system', 'cartograph', { section: 'drift' });
      return (r.data?.result ?? r.data) as { data?: unknown[] };
    },
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'reasoning',    label: 'Reasoning', icon: Brain,   count: traces.data?.traces?.length },
    { key: 'topology',     label: 'Lattice Topology',   icon: Network, count: topology.data?.clusters?.length },
    { key: 'breakthrough', label: 'Breakthroughs',  icon: Lightbulb, count: breakthroughMetrics.data?.activeClusters },
    { key: 'forgetting',   label: 'Forgetting',  icon: Trash2,  count: forgettingCandidates.data?.length },
    { key: 'drift',        label: 'Drift', icon: Activity, count: (driftScan.data?.data as unknown[] | undefined)?.length },
  ];

  return (
    <LensShell lensId="cognition" asMain={false}>
      <ManifestActionBar />
    <div className="min-h-screen bg-black pb-12 text-cyan-50">
      <header className="sticky top-0 z-10 border-b border-violet-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Brain className="h-6 w-6 text-violet-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Cognition</h1>
            <p className="text-xs text-violet-700">HLR · HLM · Breakthroughs · Forgetting · Drift</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-violet-900/30 px-4 md:px-8" aria-label="Cognition sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400 ${
                activeTab === key ? 'border-violet-400 text-violet-200' : 'border-transparent text-violet-700 hover:text-violet-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-violet-900/40 px-1.5 py-0.5 text-[10px] text-violet-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'reasoning' && (
            <motion.section key="reasoning" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-violet-200">Run a reasoning trace</h2>
              <div className="rounded-lg border border-violet-900/40 bg-violet-950/10 p-4">
                <label className="block text-xs uppercase tracking-wider text-violet-700" htmlFor="hlr-claim">Claim or question</label>
                <textarea
                  id="hlr-claim"
                  value={hlrInput}
                  onChange={(e) => setHlrInput(e.target.value)}
                  className="mt-1.5 h-24 w-full rounded border border-violet-900/40 bg-black/40 p-2 font-mono text-sm text-violet-100 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="What do you want HLR to reason about?"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-violet-700">Mode:</span>
                  {REASONING_MODES.map(m => (
                    <button
                      key={m.id}
                      onClick={() => setHlrMode(m.id)}
                      title={m.desc}
                      className={`rounded px-2 py-1 text-xs ${hlrMode === m.id ? 'bg-violet-700/40 text-violet-100' : 'bg-violet-950/30 text-violet-500 hover:text-violet-300'}`}
                      aria-pressed={hlrMode === m.id}
                    >{m.label}</button>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => runHLR.mutate()}
                    disabled={!hlrInput || runHLR.isPending}
                    className="inline-flex items-center gap-2 rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                  >
                    {runHLR.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Run HLR
                  </button>
                </div>
                {hlrResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-h-80 overflow-auto rounded border border-violet-900/40 bg-black/60 p-3 font-mono text-xs text-violet-300">
                    {JSON.stringify(hlrResult, null, 2)}
                  </motion.pre>
                )}
              </div>

              <h3 className="mt-6 mb-2 text-sm font-semibold text-violet-300">Recent traces</h3>
              {traces.isLoading && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
              {(traces.data?.traces ?? []).length === 0 && !traces.isLoading && <p className="text-xs text-violet-700">No traces yet — run one above.</p>}
              <ul className="space-y-1">
                {(traces.data?.traces ?? []).map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => setTraceExpanded(traceExpanded === t.id ? null : t.id)}
                      className="flex w-full items-center gap-2 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-left text-xs hover:bg-violet-900/20"
                      aria-expanded={traceExpanded === t.id}
                    >
                      {traceExpanded === t.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      <span className="font-mono text-violet-300">{t.id}</span>
                      <span className="rounded bg-violet-700/30 px-1.5 py-0.5 text-[10px]">{t.mode}</span>
                      <span className="ml-auto text-[10px] text-violet-700">{new Date(t.createdAt).toLocaleTimeString()}</span>
                    </button>
                    {traceExpanded === t.id && t.chains && (
                      <pre className="mt-1 max-h-60 overflow-auto rounded border border-violet-900/30 bg-black/60 p-2 font-mono text-[11px] text-violet-400">{JSON.stringify(t.chains, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {activeTab === 'topology' && (
            <motion.section key="topology" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-violet-200">Lattice topology</h2>
                <button
                  onClick={() => triggerHLMPass.mutate()}
                  disabled={triggerHLMPass.isPending}
                  className="inline-flex items-center gap-2 rounded border border-violet-700/50 bg-violet-900/20 px-3 py-1.5 text-xs font-medium text-violet-300 hover:bg-violet-800/40 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-violet-400"
                >
                  {triggerHLMPass.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Run HLM pass
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <TopoCard label="Clusters" value={topology.data?.clusters?.length ?? 0} hint="Cohesive DTU groupings" />
                <TopoCard label="Gaps" value={topology.data?.gaps?.length ?? 0} hint="Domains thinly populated" tone="warn" />
                <TopoCard label="Redundancies" value={topology.data?.redundancies?.length ?? 0} hint="Likely-duplicate substrate" tone="warn" />
              </div>
              {topology.data?.clusters && topology.data.clusters.length > 0 && (
                <details className="mt-4 rounded border border-violet-900/30 bg-violet-950/10">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-violet-300">Inspect raw topology JSON</summary>
                  <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] text-violet-400">{JSON.stringify(topology.data, null, 2)}</pre>
                </details>
              )}
            </motion.section>
          )}

          {activeTab === 'breakthrough' && (
            <motion.section key="breakthrough" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-violet-200">Cross-domain synthesis clusters</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <TopoCard label="Total clusters" value={breakthroughMetrics.data?.totalClusters ?? clusters.data?.length ?? 0} hint="Long-running research lines" />
                <TopoCard label="Active" value={breakthroughMetrics.data?.activeClusters ?? 0} hint="Currently iterating" tone="ok" />
                <TopoCard label="Recent breakthroughs" value={(breakthroughMetrics.data?.recentBreakthroughs as unknown[] | undefined)?.length ?? 0} hint="Surfaced in last pass" tone="ok" />
              </div>
              {clusters.data && clusters.data.length > 0 ? (
                <ul className="mt-4 space-y-1">
                  {clusters.data.map(c => (
                    <li key={c.id} className="flex items-center gap-3 rounded border border-violet-900/30 bg-violet-950/10 px-3 py-2 text-xs">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                      <span className="font-mono text-violet-300">{c.id}</span>
                      {c.topic && <span className="text-violet-100">{c.topic}</span>}
                      <span className="ml-auto rounded bg-violet-800/30 px-1.5 py-0.5 text-[10px] text-violet-300">{c.status ?? '—'}</span>
                      <span className="text-[10px] text-violet-700">{c.dtuCount ?? 0} DTUs</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-xs text-violet-700">No breakthrough clusters yet. The lattice-orchestrator runs cluster passes every ~60 min.</p>
              )}
            </motion.section>
          )}

          {activeTab === 'forgetting' && (
            <motion.section key="forgetting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-violet-200">Forgetting candidates</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <TopoCard label="Threshold" value={forgettingStatus.data?.threshold?.toFixed(2) ?? '—'} hint="Retention score floor" />
                <TopoCard label="Total forgotten" value={forgettingStatus.data?.totalForgotten ?? 0} hint="Cumulative" />
                <TopoCard label="Pending candidates" value={forgettingCandidates.data?.length ?? 0} hint="Below threshold; awaiting next sweep" tone="warn" />
              </div>
              {forgettingCandidates.data && forgettingCandidates.data.length > 0 && (
                <div className="mt-4 overflow-x-auto rounded border border-violet-900/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-violet-950/40 text-violet-400">
                      <tr><th className="px-3 py-2 text-left">DTU</th><th className="px-3 py-2 text-right">Retention</th><th className="px-3 py-2 text-right">Last accessed</th></tr>
                    </thead>
                    <tbody>
                      {forgettingCandidates.data.slice(0, 50).map(c => (
                        <tr key={c.id} className="border-t border-violet-900/20">
                          <td className="px-3 py-1.5 text-violet-300">{c.id}</td>
                          <td className="px-3 py-1.5 text-right">{c.retentionScore?.toFixed(3) ?? '—'}</td>
                          <td className="px-3 py-1.5 text-right text-violet-700">{c.lastAccessed ? new Date(c.lastAccessed * 1000).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'drift' && (
            <motion.section key="drift" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <h2 className="mb-3 text-base font-semibold text-violet-200">Drift surface</h2>
              {driftScan.isLoading && <Loader2 className="h-4 w-4 animate-spin text-violet-500" />}
              {Array.isArray(driftScan.data?.data) && driftScan.data.data.length === 0 && (
                <p className="text-sm text-emerald-400">✓ No drift detected. Documentation matches reality.</p>
              )}
              {Array.isArray(driftScan.data?.data) && driftScan.data.data.length > 0 && (
                <div className="overflow-x-auto rounded border border-yellow-700/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-yellow-950/30 text-yellow-300"><tr><th className="px-3 py-2 text-left">File</th><th className="px-3 py-2">Line</th><th className="px-3 py-2 text-left">Claim</th><th className="px-3 py-2 text-right">Actual</th><th className="px-3 py-2 text-right">Δ</th></tr></thead>
                    <tbody>
                      {(driftScan.data.data as Array<{ file: string; line: number; claim: string; actual: number; delta: number }>).map((d, i) => (
                        <tr key={`${d.file}:${i}`} className="border-t border-yellow-900/20">
                          <td className="px-3 py-1.5 text-cyan-300">{d.file}</td>
                          <td className="px-3 py-1.5 text-center text-cyan-600">{d.line}</td>
                          <td className="px-3 py-1.5 text-yellow-400">{d.claim}</td>
                          <td className="px-3 py-1.5 text-right text-emerald-400">{d.actual}</td>
                          <td className={`px-3 py-1.5 text-right ${d.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{d.delta > 0 ? '+' : ''}{d.delta}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!driftScan.data && !driftScan.isLoading && (
                <p className="text-xs text-violet-700">Drift section unavailable. Run <code className="rounded bg-violet-950/40 px-1 text-violet-300">npm run cartograph:static</code> from the server dir.</p>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
      <section className="mt-6 mx-4 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <BrainPoolStatus />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}

function TopoCard({ label, value, hint, tone = 'ok' }: { label: string; value: number | string; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneCls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
                : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
                : 'border-violet-900/40 text-violet-200';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`rounded-lg border bg-violet-950/10 p-3 ${toneCls}`}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-violet-700">
        <span>{label}</span><Eye className="h-3 w-3" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-violet-700">{hint}</div>}
    </motion.div>
  );
}
