'use client';

/**
 * System Lens — surfaces the cognitive OS internals that the cartographer
 * inventoried but were previously headless (no UI). Calls the
 * `system.cartograph` macro to fetch the latest SYSTEMS.json + crossRef
 * arrays and renders them as a live operational dashboard.
 *
 * Phase 3 wire-the-Lost: the `system` macro domain has 7 macros but no
 * UI surface; this lens is its frontend.
 *
 * Frontend Parity: loading/empty/error/populated/realtime; Framer Motion
 * entry animations; mobile-responsive grid; ARIA-labelled tables; dark
 * mode via design system; tooltips on stat cards.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, Database, Globe, Heart, Layers, Map as MapIcon,
  RefreshCw, AlertTriangle, CheckCircle2, XCircle, Loader2,
  Zap, BookOpen, GitBranch,
} from 'lucide-react';

interface CartographStats {
  tableCount: number;
  routeCount: number;
  macroCount: number;
  macroDomainCount: number;
  heartbeatCount: number;
  lensCount: number;
  moduleCount: number;
  deadTableCount: number;
  orphanModuleCount: number;
  dormantModuleCount: number;
  coverageInScope: number;
  coveragePresent: number;
}

interface HeartbeatEntry { id: string; frequency: number; neverDisable?: boolean }
interface DriftEntry { file: string; line: number; claim: string; actual: number; delta: number }
interface CoverageEntry {
  category: string;
  status: 'present' | 'partial' | 'missing';
  scope: 'in' | 'out';
  matchedManifests: string[];
  matchedMacroDomains: string[];
  matchedRoutes: string[];
  proposedTargetLens: string | null;
  priority: number | null;
}

interface SystemsReport {
  generatedAt: string;
  stats: CartographStats;
  static: { heartbeatCallsites?: HeartbeatEntry[] };
  runtime: { booted: boolean; heartbeats: HeartbeatEntry[]; reason?: string };
  crossRef: {
    deadTables: { name: string; migration: string }[];
    dormantModules: { id: string; subsystem: string | null; importedBy: number }[];
    headlessBackends: { domain: string; macroCount: number }[];
    orphanLenses: { frontendDir: string; reason: string }[];
  };
  coverage: CoverageEntry[];
  drift: DriftEntry[];
}

export default function SystemLensPage() {
  useLensNav('system');

  const [activeTab, setActiveTab] = useState<'overview' | 'heartbeats' | 'gaps' | 'coverage' | 'drift'>('overview');
  const [coverageFilter, setCoverageFilter] = useState<'all' | 'present' | 'partial' | 'missing'>('all');
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['system-cartograph', refreshKey],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('system', 'cartograph', {});
      const payload = (r.data?.result ?? r.data) as { ok: boolean; systems?: SystemsReport; reason?: string };
      if (!payload?.ok) throw new Error(payload?.reason ?? 'cartograph_unavailable');
      return payload.systems as SystemsReport;
    },
    refetchInterval: 60_000,
    retry: 0,
  });

  const heartbeats = useMemo(() => {
    if (!data) return [];
    const src = data.runtime.booted && data.runtime.heartbeats?.length
      ? data.runtime.heartbeats
      : (data.static.heartbeatCallsites ?? []);
    return [...src].sort((a, b) => a.frequency - b.frequency);
  }, [data]);

  const filteredCoverage = useMemo(() => {
    if (!data) return [];
    return data.coverage.filter(c => {
      if (c.scope !== 'in') return false;
      if (coverageFilter !== 'all' && c.status !== coverageFilter) return false;
      return true;
    });
  }, [data, coverageFilter]);

  const handleRefresh = () => {
    setRefreshKey(k => k + 1);
    setTimeout(() => refetch(), 100);
  };

  // ── Loading state ──────────────────────────────────────────────────────
  if (isLoading && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-black text-cyan-400">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
        >
          <Loader2 className="h-8 w-8" aria-label="Loading cartographer data" />
        </motion.div>
        <span className="ml-3 font-mono text-sm">Reading SYSTEMS.json…</span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────
  if (isError || !data) {
    const reason = (error as Error)?.message ?? 'cartograph_unavailable';
    const isStale = reason === 'cartograph_not_run';
    return (
      <div className="flex h-screen items-center justify-center bg-black px-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-lg rounded-lg border border-yellow-500/40 bg-yellow-950/20 p-6 text-yellow-200"
          role="alert"
        >
          <AlertTriangle className="mb-3 h-6 w-6" aria-hidden />
          <h2 className="mb-2 text-lg font-semibold">
            {isStale ? 'Cartographer not yet run' : 'Cartograph unavailable'}
          </h2>
          <p className="mb-4 text-sm text-yellow-300/80">
            {isStale
              ? 'Run npm run cartograph:static from the server directory to generate audit/cartograph/SYSTEMS.json. The System Lens reads from that file.'
              : `Reason: ${reason}`}
          </p>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 rounded border border-yellow-500/50 bg-yellow-500/10 px-3 py-1.5 text-sm font-medium hover:bg-yellow-500/20 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Retry
          </button>
        </motion.div>
      </div>
    );
  }

  const coveragePct = data.stats.coverageInScope
    ? Math.round((data.stats.coveragePresent / data.stats.coverageInScope) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-black pb-12 text-cyan-50">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-cyan-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-cyan-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">System Lens</h1>
              <p className="text-xs text-cyan-700">Cognitive OS internals · cartographer ground truth</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-cyan-700" title={data.generatedAt}>
              Last cartograph: {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 rounded border border-cyan-700/50 bg-cyan-900/20 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-800/40 focus:outline-none focus:ring-2 focus:ring-cyan-400"
              aria-label="Refresh cartographer data"
            >
              <RefreshCw className="h-3 w-3" aria-hidden /> Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="border-b border-cyan-900/30 px-4 md:px-8" aria-label="System Lens sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {([
            { key: 'overview', label: 'Overview', icon: Activity },
            { key: 'heartbeats', label: `Heartbeats (${heartbeats.length})`, icon: Heart },
            { key: 'gaps', label: `Gaps (${data.crossRef.dormantModules.length + data.crossRef.headlessBackends.length})`, icon: AlertTriangle },
            { key: 'coverage', label: `Coverage (${coveragePct}%)`, icon: MapIcon },
            { key: 'drift', label: `Drift (${data.drift.length})`, icon: GitBranch },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
                activeTab === key
                  ? 'border-cyan-400 text-cyan-200'
                  : 'border-transparent text-cyan-700 hover:text-cyan-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'overview' && (
            <motion.section
              key="overview"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="overview-heading"
            >
              <h2 id="overview-heading" className="sr-only">Overview</h2>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
                <StatCard label="Tables" value={data.stats.tableCount} sub={`${data.stats.deadTableCount} dead`} icon={Database} />
                <StatCard label="Routes" value={data.stats.routeCount} icon={Globe} />
                <StatCard label="Macros" value={data.stats.macroCount} sub={`${data.stats.macroDomainCount} domains`} icon={Zap} />
                <StatCard label="Heartbeats" value={data.stats.heartbeatCount} icon={Heart} />
                <StatCard label="Lenses" value={data.stats.lensCount} icon={BookOpen} />
                <StatCard label="Modules" value={data.stats.moduleCount} icon={Layers} />
                <StatCard label="Dormant" value={data.stats.dormantModuleCount} sub="modules without heartbeat or macros" icon={AlertTriangle} tone={data.stats.dormantModuleCount > 0 ? 'warn' : 'ok'} />
                <StatCard label="Coverage" value={`${coveragePct}%`} sub={`${data.stats.coveragePresent}/${data.stats.coverageInScope} categories`} icon={CheckCircle2} tone={coveragePct >= 90 ? 'ok' : coveragePct >= 70 ? 'warn' : 'bad'} />
              </div>

              <div className="mt-6 rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-4">
                <h3 className="mb-2 text-sm font-semibold text-cyan-300">Cartographer status</h3>
                <dl className="grid grid-cols-1 gap-1 text-xs text-cyan-500 md:grid-cols-2">
                  <div><dt className="inline text-cyan-700">Runtime introspect:</dt> <dd className="inline">{data.runtime.booted ? <span className="text-emerald-400">booted</span> : <span className="text-yellow-400">{data.runtime.reason ?? 'static-only'}</span>}</dd></div>
                  <div><dt className="inline text-cyan-700">Headless backends:</dt> <dd className="inline">{data.crossRef.headlessBackends.length}</dd></div>
                  <div><dt className="inline text-cyan-700">Orphan lenses:</dt> <dd className="inline">{data.crossRef.orphanLenses.length}</dd></div>
                  <div><dt className="inline text-cyan-700">Drift entries:</dt> <dd className="inline">{data.drift.length}</dd></div>
                </dl>
              </div>
            </motion.section>
          )}

          {activeTab === 'heartbeats' && (
            <motion.section
              key="heartbeats"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              aria-labelledby="heartbeats-heading"
            >
              <h2 id="heartbeats-heading" className="mb-3 text-base font-semibold text-cyan-200">
                Heartbeat-registered modules
              </h2>
              {heartbeats.length === 0 ? (
                <EmptyHint text="No heartbeats found. Cartographer may need a fresh run." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-cyan-900/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-cyan-950/40 text-cyan-400">
                      <tr>
                        <th className="px-3 py-2 text-left">ID</th>
                        <th className="px-3 py-2 text-right">Frequency</th>
                        <th className="px-3 py-2 text-right">Approx interval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {heartbeats.map(hb => (
                        <tr key={hb.id} className="border-t border-cyan-900/20 hover:bg-cyan-950/20">
                          <td className="px-3 py-2 text-cyan-200">{hb.id}</td>
                          <td className="px-3 py-2 text-right text-cyan-500">{hb.frequency}</td>
                          <td className="px-3 py-2 text-right text-cyan-700">{intervalLabel(hb.frequency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          )}

          {activeTab === 'gaps' && (
            <motion.section
              key="gaps"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Wire-the-Lost candidates</h2>
              <div className="grid gap-4 md:grid-cols-2">
                <GapCard
                  title="Dormant modules"
                  count={data.crossRef.dormantModules.length}
                  rows={data.crossRef.dormantModules.slice(0, 20).map(m => ({ key: m.id, primary: m.id, secondary: `${m.subsystem ?? '-'} · importedBy ${m.importedBy}` }))}
                />
                <GapCard
                  title="Headless backend domains"
                  count={data.crossRef.headlessBackends.length}
                  rows={data.crossRef.headlessBackends.slice(0, 20).map(h => ({ key: h.domain, primary: h.domain, secondary: `${h.macroCount} macros — needs UI lens` }))}
                />
                <GapCard
                  title="Orphan lens dirs"
                  count={data.crossRef.orphanLenses.length}
                  rows={data.crossRef.orphanLenses.slice(0, 20).map(o => ({ key: o.frontendDir, primary: o.frontendDir, secondary: o.reason }))}
                />
                <GapCard
                  title="Dead tables"
                  count={data.crossRef.deadTables.length}
                  rows={data.crossRef.deadTables.slice(0, 20).map(d => ({ key: d.name, primary: d.name, secondary: d.migration }))}
                />
              </div>
            </motion.section>
          )}

          {activeTab === 'coverage' && (
            <motion.section
              key="coverage"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-cyan-200">Software-universe coverage</h2>
                <div className="flex gap-1 rounded border border-cyan-900/40 bg-cyan-950/20 p-0.5 text-xs">
                  {(['all', 'present', 'partial', 'missing'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setCoverageFilter(f)}
                      className={`rounded px-2 py-1 ${coverageFilter === f ? 'bg-cyan-700/30 text-cyan-200' : 'text-cyan-600 hover:text-cyan-400'}`}
                      aria-pressed={coverageFilter === f}
                    >{f}</button>
                  ))}
                </div>
              </div>
              {filteredCoverage.length === 0 ? (
                <EmptyHint text="No categories match the current filter." />
              ) : (
                <ul className="space-y-1.5">
                  {filteredCoverage.map(c => (
                    <li key={c.category} className="flex items-center gap-3 rounded border border-cyan-900/30 bg-cyan-950/10 px-3 py-2 text-sm">
                      <CoverageBadge status={c.status} />
                      <span className="font-mono text-cyan-200">{c.category}</span>
                      {c.priority != null && <span className="rounded bg-cyan-700/20 px-1.5 py-0.5 text-[10px] font-medium text-cyan-300">P{c.priority}</span>}
                      <span className="ml-auto text-xs text-cyan-600">
                        {c.proposedTargetLens ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'drift' && (
            <motion.section
              key="drift"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <h2 className="mb-3 text-base font-semibold text-cyan-200">Comment-vs-truth drift</h2>
              {data.drift.length === 0 ? (
                <EmptyHint text="✓ No comment drifts detected. Documentation matches reality." />
              ) : (
                <div className="overflow-x-auto rounded-lg border border-yellow-700/40">
                  <table className="w-full font-mono text-xs">
                    <thead className="bg-yellow-950/30 text-yellow-300">
                      <tr>
                        <th className="px-3 py-2 text-left">File</th>
                        <th className="px-3 py-2 text-right">Line</th>
                        <th className="px-3 py-2 text-left">Claim</th>
                        <th className="px-3 py-2 text-right">Actual</th>
                        <th className="px-3 py-2 text-right">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.drift.map((d, i) => (
                        <tr key={`${d.file}:${d.line}:${i}`} className="border-t border-yellow-900/20 hover:bg-yellow-950/15">
                          <td className="px-3 py-2 text-cyan-300">{d.file}</td>
                          <td className="px-3 py-2 text-right text-cyan-600">{d.line}</td>
                          <td className="px-3 py-2 text-yellow-400">{d.claim}</td>
                          <td className="px-3 py-2 text-right text-emerald-400">{d.actual}</td>
                          <td className="px-3 py-2 text-right font-semibold">
                            <span className={d.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                              {d.delta > 0 ? '+' : ''}{d.delta}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ── Small helpers ────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, tone = 'ok' }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneCls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
                : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
                : 'border-cyan-900/40 text-cyan-200';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`rounded-lg border bg-cyan-950/10 p-3 ${toneCls}`}
      title={sub}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-cyan-700">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-cyan-700">{sub}</div>}
    </motion.div>
  );
}

function GapCard({ title, count, rows }: {
  title: string;
  count: number;
  rows: { key: string; primary: string; secondary: string }[];
}) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10">
      <div className="flex items-center justify-between border-b border-cyan-900/30 px-3 py-2">
        <h3 className="text-sm font-semibold text-cyan-300">{title}</h3>
        <span className="rounded bg-cyan-800/30 px-2 py-0.5 text-xs font-mono text-cyan-300">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-cyan-600">None.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-cyan-900/20 text-xs">
          {rows.map(r => (
            <li key={r.key} className="px-3 py-1.5">
              <div className="font-mono text-cyan-200">{r.primary}</div>
              <div className="text-[10px] text-cyan-700">{r.secondary}</div>
            </li>
          ))}
          {rows.length >= 20 && <li className="px-3 py-1.5 text-[10px] text-cyan-600">…showing first 20</li>}
        </ul>
      )}
    </div>
  );
}

function CoverageBadge({ status }: { status: 'present' | 'partial' | 'missing' }) {
  if (status === 'present') return <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300"><CheckCircle2 className="h-2.5 w-2.5" aria-hidden />present</span>;
  if (status === 'partial') return <span className="inline-flex items-center gap-1 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300"><AlertTriangle className="h-2.5 w-2.5" aria-hidden />partial</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-300"><XCircle className="h-2.5 w-2.5" aria-hidden />missing</span>;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
      {text}
    </div>
  );
}

function intervalLabel(frequency: number): string {
  const sec = frequency * 15;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
