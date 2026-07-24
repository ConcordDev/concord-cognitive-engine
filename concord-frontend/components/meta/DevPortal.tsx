'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView, TreeDiagram } from '@/components/viz';
import type { TimelineEvent, TreeNode } from '@/components/viz';
import {
  Server,
  Network,
  LineChart,
  ShieldCheck,
  GitCommitHorizontal,
  Siren,
  Terminal,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  Play,
  Gauge,
  ListChecks,
  Route as RouteIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — shapes returned by the meta.* macros
// ---------------------------------------------------------------------------

interface Service {
  id: string;
  name: string;
  kind: string;
  owner: string;
  status: 'green' | 'yellow' | 'red' | 'unknown';
  description: string;
  tier: number;
  dependsOn: string[];
  repoPath: string;
  tags: string[];
}

interface CatalogResult {
  services: Service[];
  total: number;
  byKind: Record<string, number>;
  byStatus: Record<string, number>;
  byOwner: Record<string, number>;
  owners: string[];
}

interface GraphResult {
  nodes: { id: string; name: string; kind: string; status: string; tier: number }[];
  edges: { from: string; to: string; fromName: string; toName: string }[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    cycleCount: number;
    rootCount: number;
    leafCount: number;
    orphanCount: number;
  };
  cycles: string[][];
  mostDependedOn: { id: string; name: string; dependents: number }[];
}

interface DashboardSeries {
  series: string;
  buckets: { t: number; label: string; count: number; avg: number; min: number; max: number }[];
  summary: { sampleCount: number; latest: number | null; avg: number; min: number; max: number };
}

interface DashboardResult {
  dashboards: DashboardSeries[];
  seriesNames: string[];
  totalSamples: number;
}

interface HealthResult {
  overall: string;
  subsystems: {
    kind: string;
    rollup: string;
    total: number;
    green: number;
    yellow: number;
    red: number;
    services: { id: string; name: string; status: string; tier: number }[];
  }[];
  subsystemCount: number;
  serviceCount: number;
  openAlertCount: number;
  tally: { green: number; yellow: number; red: number };
}

interface Deploy {
  id: string;
  title: string;
  kind: string;
  service: string;
  version: string;
  author: string;
  notes: string;
  outcome: 'success' | 'failed' | 'partial';
  at: number;
}

interface TimelineResult {
  deploys: Deploy[];
  total: number;
  byKind: Record<string, number>;
  byOutcome: Record<string, number>;
  failureRate: number;
  lastDeployAt: number | null;
}

interface Alert {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'critical';
  source: string;
  service: string;
  description: string;
  runbook: string;
  raisedAt: number;
  resolvedAt: number | null;
}

interface AlertResult {
  alerts: Alert[];
  openCount: number;
  tally: { critical: number; warning: number; info: number };
  worst: string;
}

interface MacroEntry {
  key: string;
  domain: string;
  name: string;
}

interface MacroExplorerResult {
  macros: MacroEntry[];
  total: number;
  totalAll: number;
  domains: { domain: string; count: number }[];
  available: boolean;
}

// ── Quality Lab types — shapes returned by meta.qualityMetrics /
// meta.actionAnalytics / meta.systemReflection (server/domains/meta.js) ──────

interface QualityField {
  name: string;
  value: string;
  required: boolean;
  expectedType: '' | 'string' | 'number' | 'boolean' | 'date' | 'email' | 'url' | 'array';
  updatedAt: string; // ISO date, optional
}

interface QualityMetricsResult {
  message?: string;
  totalFields?: number;
  completeness?: { requiredFilled: number; requiredTotal: number; scoreRequired: number; scoreAll: number };
  consistency?: { score: number; consistentFields: number; inconsistencies: { field: string; expected: string; actual: string; value: string }[] };
  freshness?: { avgScore: number; halfLifeDays: number; fields: { name: string; freshness: number; ageDays?: number; ageLabel: string }[]; staleCount: number };
  overall?: { score: number; grade: string; weights: Record<string, number> };
}

interface ActionRow {
  userId: string;
  action: string;
  timestamp: string; // ISO datetime
  durationMs: string;
}

interface ActionAnalyticsResult {
  message?: string;
  totalActions?: number;
  uniqueActions?: number;
  uniqueUsers?: number;
  totalSessions?: number;
  avgSessionLength?: number;
  frequencyDistribution?: { action: string; count: number; percentage: number }[];
  topCoOccurrences?: { pair: string; count: number }[];
  topTransitions?: { transition: string; count: number }[];
  topJourneys?: { journey: string; count: number }[];
  hourlyDistribution?: number[];
  peakHour?: number;
}

interface MetricRow {
  timestamp: string; // ISO datetime
  responseMs: string;
  success: boolean;
  endpoint: string;
  cpuPercent: string;
  memPercent: string;
}

interface SystemReflectionResult {
  message?: string;
  totalRequests?: number;
  overallErrorRate?: number;
  responseTime?: { mean: number; stdDev: number; p50: number; p90: number; p95: number; p99: number; min: number; max: number };
  errorTrend?: string;
  capacity?: {
    cpu: { avg: number; max: number; p95: number } | null;
    memory: { avg: number; max: number; p95: number } | null;
    cpuHealth: string;
    memHealth: string;
  };
  endpoints?: { name: string; requests: number; errorRate: number; avgResponseMs: number }[];
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<string, string> = {
  green: 'bg-emerald-400',
  yellow: 'bg-amber-400',
  red: 'bg-rose-500',
  unknown: 'bg-zinc-600',
};

const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'default'> = {
  green: 'good',
  yellow: 'warn',
  red: 'bad',
  unknown: 'default',
};

function StatusDot({ status }: { status: string }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[status] || STATUS_DOT.unknown}`} />;
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-xs text-zinc-400">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function ErrorLine({ msg }: { msg: string }) {
  return (
    <div className="rounded border border-rose-500/25 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">{msg}</div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-400">{msg}</div>
  );
}

// ===========================================================================
// Service Catalog
// ===========================================================================

function ServiceCatalogPanel() {
  const [data, setData] = useState<CatalogResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [form, setForm] = useState({
    name: '',
    kind: 'service',
    owner: '',
    tier: 3,
    status: 'green',
    description: '',
    dependsOn: '',
    tags: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params: Record<string, unknown> = {};
    if (q.trim()) params.q = q.trim();
    if (kindFilter) params.kind = kindFilter;
    const r = await lensRun<CatalogResult>('meta', 'serviceCatalog', params);
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load catalog.');
    setLoading(false);
  }, [q, kindFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const register = useCallback(async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    const r = await lensRun('meta', 'serviceRegister', {
      name: form.name.trim(),
      kind: form.kind,
      owner: form.owner.trim() || 'unassigned',
      tier: Number(form.tier),
      status: form.status,
      description: form.description.trim(),
      dependsOn: form.dependsOn.split(',').map((s) => s.trim()).filter(Boolean),
      tags: form.tags.split(',').map((s) => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.data.ok) {
      setForm({ name: '', kind: 'service', owner: '', tier: 3, status: 'green', description: '', dependsOn: '', tags: '' });
      await load();
    } else {
      setErr(r.data.error || 'Register failed.');
    }
  }, [form, load]);

  const cycleStatus = useCallback(
    async (svc: Service) => {
      const next = svc.status === 'green' ? 'yellow' : svc.status === 'yellow' ? 'red' : 'green';
      const r = await lensRun('meta', 'serviceUpdate', { id: svc.id, status: next });
      if (r.data.ok) await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      const r = await lensRun('meta', 'serviceRemove', { id });
      if (r.data.ok) await load();
    },
    [load],
  );

  const kinds = useMemo(() => Object.keys(data?.byKind || {}).sort(), [data]);

  return (
    <div className="space-y-4">
      {/* Register form */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Register a subsystem</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Name *"
            className="input-lattice text-sm"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="input-lattice text-sm"
          >
            {['service', 'lens', 'library', 'heartbeat', 'datastore'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <input
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
            placeholder="Owner"
            className="input-lattice text-sm"
          />
          <select
            value={form.tier}
            onChange={(e) => setForm({ ...form, tier: Number(e.target.value) })}
            className="input-lattice text-sm"
          >
            <option value={1}>Tier 1 — critical</option>
            <option value={2}>Tier 2 — important</option>
            <option value={3}>Tier 3 — standard</option>
          </select>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            className="input-lattice col-span-2 text-sm"
          />
          <input
            value={form.dependsOn}
            onChange={(e) => setForm({ ...form, dependsOn: e.target.value })}
            placeholder="Depends on (comma names)"
            className="input-lattice text-sm"
          />
          <input
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="Tags (comma)"
            className="input-lattice text-sm"
          />
        </div>
        <button
          onClick={register}
          disabled={busy || !form.name.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          Register service
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search catalog…"
          className="input-lattice flex-1 text-sm"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="input-lattice text-sm"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Loading catalog…" />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center">
              <p className="text-lg font-bold text-white">{data.total}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Services</p>
            </div>
            <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
              <p className="text-lg font-bold text-emerald-300">{data.byStatus.green || 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Green</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-center">
              <p className="text-lg font-bold text-amber-300">{data.byStatus.yellow || 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Yellow</p>
            </div>
            <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2 text-center">
              <p className="text-lg font-bold text-rose-300">{data.byStatus.red || 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Red</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center">
              <p className="text-lg font-bold text-white">{Object.keys(data.byKind).length}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Kinds</p>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center">
              <p className="text-lg font-bold text-white">{data.owners.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Owners</p>
            </div>
          </div>

          {data.services.length === 0 ? (
            <Empty msg="No services registered. Register your first subsystem above." />
          ) : (
            <div className="space-y-1">
              {data.services.map((svc) => (
                <div
                  key={svc.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <button onClick={() => cycleStatus(svc)} title="Cycle status">
                      <StatusDot status={svc.status} />
                    </button>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {svc.name}
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {svc.kind}
                        </span>
                        <span className="ml-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          T{svc.tier}
                        </span>
                      </p>
                      <p className="truncate text-xs text-zinc-400">
                        {svc.owner} · {svc.description || 'no description'}
                        {svc.dependsOn.length > 0 && ` · depends: ${svc.dependsOn.join(', ')}`}
                      </p>
                    </div>
                  </div>
                  <button aria-label="Delete"
                    onClick={() => remove(svc.id)}
                    className="shrink-0 rounded p-1.5 text-zinc-600 hover:bg-rose-500/10 hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Dependency Graph
// ===========================================================================

function DependencyGraphPanel() {
  const [data, setData] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun<GraphResult>('meta', 'dependencyGraph', {});
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load graph.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Build a TreeDiagram rooted at each root node, following edges.
  const tree = useMemo<TreeNode[]>(() => {
    if (!data) return [];
    const nodeById = new Map(data.nodes.map((n) => [n.id, n]));
    const childrenOf = new Map<string, string[]>();
    for (const e of data.edges) {
      if (!childrenOf.has(e.from)) childrenOf.set(e.from, []);
      childrenOf.get(e.from)!.push(e.to);
    }
    const build = (id: string, seen: Set<string>): TreeNode => {
      const n = nodeById.get(id);
      const node: TreeNode = {
        id,
        label: n?.name || id,
        detail: n ? `${n.kind} · T${n.tier} · ${n.status}` : '',
        tone: STATUS_TONE[n?.status || 'unknown'],
      };
      if (seen.has(id)) {
        node.detail = `${node.detail} · (cycle)`;
        node.tone = 'bad';
        return node;
      }
      const next = new Set(seen);
      next.add(id);
      const kids = (childrenOf.get(id) || []).map((c) => build(c, next));
      if (kids.length > 0) node.children = kids;
      return node;
    };
    const rootIds = data.nodes
      .filter((n) => !data.edges.some((e) => e.to === n.id))
      .map((n) => n.id);
    return rootIds.map((id) => build(id, new Set()));
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">Dependency network over the service catalog.</p>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Building graph…" />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {[
              ['Nodes', data.stats.nodeCount, 'text-white'],
              ['Edges', data.stats.edgeCount, 'text-neon-cyan'],
              ['Cycles', data.stats.cycleCount, data.stats.cycleCount > 0 ? 'text-rose-400' : 'text-emerald-300'],
              ['Roots', data.stats.rootCount, 'text-neon-blue'],
              ['Leaves', data.stats.leafCount, 'text-neon-purple'],
              ['Orphans', data.stats.orphanCount, data.stats.orphanCount > 0 ? 'text-amber-400' : 'text-emerald-300'],
            ].map(([label, val, cls]) => (
              <div key={String(label)} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center">
                <p className={`text-lg font-bold ${cls}`}>{val}</p>
                <p className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</p>
              </div>
            ))}
          </div>

          {data.stats.cycleCount > 0 && (
            <div className="rounded border border-rose-500/25 bg-rose-500/5 p-3">
              <p className="mb-1 text-xs font-semibold text-rose-300">Dependency cycles detected</p>
              {data.cycles.slice(0, 5).map((cycle, i) => {
                const names = cycle.map((id) => data.nodes.find((n) => n.id === id)?.name || id);
                return (
                  <p key={i} className="font-mono text-xs text-rose-200">{names.join(' → ')}</p>
                );
              })}
            </div>
          )}

          {data.mostDependedOn.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Most depended-on</p>
              <div className="flex flex-wrap gap-2">
                {data.mostDependedOn.map((m) => (
                  <span
                    key={m.id}
                    className="rounded bg-neon-purple/15 px-2 py-1 text-xs text-neon-purple"
                  >
                    {m.name} · {m.dependents} dependent{m.dependents !== 1 ? 's' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Dependency tree</p>
            {tree.length === 0 ? (
              <Empty msg="No services in the catalog yet — register services with dependencies to render the graph." />
            ) : (
              <TreeDiagram root={tree} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Live Metrics Dashboard
// ===========================================================================

function MetricsDashboardPanel() {
  const [data, setData] = useState<DashboardResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(3600000);
  const [form, setForm] = useState({ series: '', value: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun<DashboardResult>('meta', 'metricsDashboard', { windowMs, buckets: 24 });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load dashboards.');
    setLoading(false);
  }, [windowMs]);

  useEffect(() => {
    void load();
  }, [load]);

  const record = useCallback(async () => {
    const v = Number(form.value);
    if (!form.series.trim() || !Number.isFinite(v)) {
      setErr('Series name and a numeric value are required.');
      return;
    }
    setBusy(true);
    const r = await lensRun('meta', 'metricRecord', { series: form.series.trim(), value: v });
    setBusy(false);
    if (r.data.ok) {
      setForm({ ...form, value: '' });
      await load();
    } else {
      setErr(r.data.error || 'Record failed.');
    }
  }, [form, load]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Record a metric sample</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={form.series}
            onChange={(e) => setForm({ ...form, series: e.target.value })}
            placeholder="Series (e.g. macro_latency_ms)"
            className="input-lattice flex-1 text-sm"
            list="meta-series-suggest"
          />
          <datalist id="meta-series-suggest">
            {(data?.seriesNames || []).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <input
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder="Value"
            type="number"
            className="input-lattice w-32 text-sm"
          />
          <button
            onClick={record}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-neon-cyan/20 px-3 py-1.5 text-xs font-medium text-neon-cyan disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Record
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={windowMs}
          onChange={(e) => setWindowMs(Number(e.target.value))}
          className="input-lattice text-sm"
        >
          <option value={900000}>Last 15 min</option>
          <option value={3600000}>Last 1 hour</option>
          <option value={21600000}>Last 6 hours</option>
          <option value={86400000}>Last 24 hours</option>
        </select>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
        {data && <span className="text-xs text-zinc-400">{data.totalSamples} samples total</span>}
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Loading dashboards…" />}

      {!loading && data && data.dashboards.length === 0 && (
        <Empty msg="No metric series yet. Record a sample above to start a time-series." />
      )}

      {!loading &&
        data &&
        data.dashboards.map((dash) => (
          <div key={dash.series} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-sm text-white">{dash.series}</p>
              <div className="flex gap-3 text-xs text-zinc-400">
                <span>latest <b className="text-neon-cyan">{dash.summary.latest ?? '—'}</b></span>
                <span>avg <b className="text-white">{dash.summary.avg}</b></span>
                <span>min <b className="text-emerald-300">{dash.summary.min}</b></span>
                <span>max <b className="text-amber-300">{dash.summary.max}</b></span>
                <span>n=<b className="text-white">{dash.summary.sampleCount}</b></span>
              </div>
            </div>
            <ChartKit
              kind="area"
              data={dash.buckets}
              xKey="label"
              series={[
                { key: 'avg', label: 'avg', color: '#06b6d4' },
                { key: 'max', label: 'max', color: '#f59e0b' },
              ]}
              height={200}
            />
          </div>
        ))}
    </div>
  );
}

// ===========================================================================
// Health Roll-up
// ===========================================================================

const ROLLUP_CLR: Record<string, string> = {
  green: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/5',
  yellow: 'text-amber-300 border-amber-500/30 bg-amber-500/5',
  red: 'text-rose-300 border-rose-500/30 bg-rose-500/5',
  unknown: 'text-zinc-400 border-zinc-700 bg-zinc-900',
};

function HealthRollupPanel() {
  const [data, setData] = useState<HealthResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun<HealthResult>('meta', 'healthRollup', {});
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load health roll-up.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-400">Green / yellow / red roll-up per subsystem kind. Worst child wins.</p>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Aggregating health…" />}

      {!loading && data && (
        <>
          <div
            className={`rounded-lg border p-4 text-center ${ROLLUP_CLR[data.overall] || ROLLUP_CLR.unknown}`}
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-400">Overall platform health</p>
            <p className="mt-1 text-3xl font-bold uppercase">{data.overall}</p>
            <p className="mt-1 text-xs">
              {data.serviceCount} services · {data.subsystemCount} subsystems · {data.openAlertCount} open alert
              {data.openAlertCount !== 1 ? 's' : ''}
            </p>
          </div>

          {data.subsystems.length === 0 ? (
            <Empty msg="No subsystems registered. Register services in the Catalog tab to populate the roll-up." />
          ) : (
            <div className="space-y-2">
              {data.subsystems.map((sub) => (
                <div
                  key={sub.kind}
                  className={`rounded-lg border p-3 ${ROLLUP_CLR[sub.rollup] || ROLLUP_CLR.unknown}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold uppercase">{sub.kind}</p>
                    <div className="flex gap-2 text-xs">
                      <span className="text-emerald-300">{sub.green}●</span>
                      <span className="text-amber-300">{sub.yellow}●</span>
                      <span className="text-rose-300">{sub.red}●</span>
                      <span className="text-zinc-400">/ {sub.total}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {sub.services.map((svc) => (
                      <span
                        key={svc.id}
                        className="inline-flex items-center gap-1 rounded bg-zinc-900/70 px-1.5 py-0.5 text-xs text-zinc-300"
                      >
                        <StatusDot status={svc.status} />
                        {svc.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Deploy / Change Timeline
// ===========================================================================

const OUTCOME_TONE: Record<string, 'good' | 'bad' | 'warn'> = {
  success: 'good',
  failed: 'bad',
  partial: 'warn',
};

function DeployTimelinePanel() {
  const [data, setData] = useState<TimelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '',
    kind: 'deploy',
    service: '',
    version: '',
    outcome: 'success',
    notes: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun<TimelineResult>('meta', 'deployTimeline', { limit: 100 });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load timeline.');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const record = useCallback(async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    const r = await lensRun('meta', 'deployRecord', {
      title: form.title.trim(),
      kind: form.kind,
      service: form.service.trim(),
      version: form.version.trim(),
      outcome: form.outcome,
      notes: form.notes.trim(),
    });
    setBusy(false);
    if (r.data.ok) {
      setForm({ title: '', kind: 'deploy', service: '', version: '', outcome: 'success', notes: '' });
      await load();
    } else {
      setErr(r.data.error || 'Record failed.');
    }
  }, [form, load]);

  const events = useMemo<TimelineEvent[]>(
    () =>
      (data?.deploys || []).map((d) => ({
        id: d.id,
        label: `${d.title}${d.version ? ` (${d.version})` : ''}`,
        time: d.at,
        tone: OUTCOME_TONE[d.outcome] || 'default',
        detail: `${d.kind}${d.service ? ` · ${d.service}` : ''} · ${d.outcome} · ${d.author}`,
      })),
    [data],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Record a change event</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title *"
            className="input-lattice text-sm"
          />
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="input-lattice text-sm"
          >
            {['deploy', 'migration', 'config', 'rollback', 'incident', 'feature'].map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          <select
            value={form.outcome}
            onChange={(e) => setForm({ ...form, outcome: e.target.value })}
            className="input-lattice text-sm"
          >
            {['success', 'partial', 'failed'].map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <input
            value={form.service}
            onChange={(e) => setForm({ ...form, service: e.target.value })}
            placeholder="Service"
            className="input-lattice text-sm"
          />
          <input
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
            placeholder="Version"
            className="input-lattice text-sm"
          />
          <input
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Notes"
            className="input-lattice text-sm"
          />
        </div>
        <button
          onClick={record}
          disabled={busy || !form.title.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-neon-blue/20 px-3 py-1.5 text-xs font-medium text-neon-blue disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCommitHorizontal className="h-3 w-3" />}
          Record change
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Loading timeline…" />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-center">
              <p className="text-lg font-bold text-white">{data.total}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Changes</p>
            </div>
            <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-center">
              <p className="text-lg font-bold text-emerald-300">{data.byOutcome.success || 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Success</p>
            </div>
            <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2 text-center">
              <p className="text-lg font-bold text-rose-300">{data.byOutcome.failed || 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Failed</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-center">
              <p className="text-lg font-bold text-amber-300">{data.failureRate}%</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Failure rate</p>
            </div>
          </div>

          {events.length === 0 ? (
            <Empty msg="No change events recorded. Record a deploy, migration, or incident above." />
          ) : (
            <>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Change timeline</p>
                <TimelineView events={events} height={140} />
              </div>
              <div className="space-y-1">
                {data.deploys.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">
                        {d.title}
                        <span className="ml-2 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                          {d.kind}
                        </span>
                      </p>
                      <p className="truncate text-xs text-zinc-400">
                        {new Date(d.at).toLocaleString()}
                        {d.service && ` · ${d.service}`}
                        {d.version && ` · ${d.version}`}
                        {d.notes && ` · ${d.notes}`}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        d.outcome === 'success'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : d.outcome === 'failed'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-amber-500/15 text-amber-300'
                      }`}
                    >
                      {d.outcome}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Alert Surface
// ===========================================================================

const SEV_CLR: Record<string, string> = {
  critical: 'border-rose-500/30 bg-rose-500/5 text-rose-300',
  warning: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  info: 'border-sky-500/30 bg-sky-500/5 text-sky-300',
};

function AlertSurfacePanel() {
  const [data, setData] = useState<AlertResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [form, setForm] = useState({
    title: '',
    severity: 'warning',
    source: 'manual',
    service: '',
    description: '',
    runbook: '',
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const r = await lensRun<AlertResult>('meta', 'alertSurface', { includeResolved });
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load alerts.');
    setLoading(false);
  }, [includeResolved]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  const raise = useCallback(async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    const r = await lensRun('meta', 'alertRaise', {
      title: form.title.trim(),
      severity: form.severity,
      source: form.source.trim() || 'manual',
      service: form.service.trim(),
      description: form.description.trim(),
      runbook: form.runbook.trim(),
    });
    setBusy(false);
    if (r.data.ok) {
      setForm({ title: '', severity: 'warning', source: 'manual', service: '', description: '', runbook: '' });
      await load();
    } else {
      setErr(r.data.error || 'Raise failed.');
    }
  }, [form, load]);

  const resolve = useCallback(
    async (id: string) => {
      const r = await lensRun('meta', 'alertResolve', { id, note: 'resolved from meta lens' });
      if (r.data.ok) await load();
      else setErr(r.data.error || 'Resolve failed.');
    },
    [load],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Raise an alert</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title *"
            className="input-lattice text-sm"
          />
          <select
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            className="input-lattice text-sm"
          >
            {['info', 'warning', 'critical'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <input
            value={form.source}
            onChange={(e) => setForm({ ...form, source: e.target.value })}
            placeholder="Source (e.g. prometheus)"
            className="input-lattice text-sm"
          />
          <input
            value={form.service}
            onChange={(e) => setForm({ ...form, service: e.target.value })}
            placeholder="Service"
            className="input-lattice text-sm"
          />
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Description"
            className="input-lattice text-sm"
          />
          <input
            value={form.runbook}
            onChange={(e) => setForm({ ...form, runbook: e.target.value })}
            placeholder="Runbook URL"
            className="input-lattice text-sm"
          />
        </div>
        <button
          onClick={raise}
          disabled={busy || !form.title.trim()}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-rose-500/20 px-3 py-1.5 text-xs font-medium text-rose-300 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Siren className="h-3 w-3" />}
          Raise alert
        </button>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
          />
          Show resolved
        </label>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Loading alerts…" />}

      {!loading && data && (
        <>
          <div className="grid grid-cols-4 gap-2">
            <div
              className={`rounded border p-2 text-center ${
                data.worst === 'clear'
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : SEV_CLR[data.worst] || 'border-zinc-800 bg-zinc-950'
              }`}
            >
              <p className="text-sm font-bold uppercase">{data.worst}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Worst</p>
            </div>
            <div className="rounded border border-rose-500/20 bg-rose-500/5 p-2 text-center">
              <p className="text-lg font-bold text-rose-300">{data.tally.critical}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Critical</p>
            </div>
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-center">
              <p className="text-lg font-bold text-amber-300">{data.tally.warning}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Warning</p>
            </div>
            <div className="rounded border border-sky-500/20 bg-sky-500/5 p-2 text-center">
              <p className="text-lg font-bold text-sky-300">{data.tally.info}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Info</p>
            </div>
          </div>

          {data.alerts.length === 0 ? (
            <Empty msg={includeResolved ? 'No alerts on record.' : 'No open alerts. All clear.'} />
          ) : (
            <div className="space-y-1">
              {data.alerts.map((a) => (
                <div
                  key={a.id}
                  className={`flex items-center justify-between gap-3 rounded-lg border p-3 ${
                    a.resolvedAt ? 'border-zinc-800 bg-zinc-950/40 opacity-60' : SEV_CLR[a.severity]
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {a.title}
                      <span className="ml-2 rounded bg-zinc-900/60 px-1.5 py-0.5 text-[10px] uppercase text-zinc-400">
                        {a.severity}
                      </span>
                    </p>
                    <p className="truncate text-xs text-zinc-400">
                      {a.source}
                      {a.service && ` · ${a.service}`} · {new Date(a.raisedAt).toLocaleString()}
                      {a.description && ` · ${a.description}`}
                      {a.resolvedAt && ` · resolved ${new Date(a.resolvedAt).toLocaleString()}`}
                    </p>
                  </div>
                  {!a.resolvedAt && (
                    <button
                      onClick={() => resolve(a.id)}
                      className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300 hover:bg-emerald-500/25"
                    >
                      <CheckCircle2 className="h-3 w-3" /> Resolve
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Macro Explorer
// ===========================================================================

function MacroExplorerPanel() {
  const [data, setData] = useState<MacroExplorerResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [tryMacro, setTryMacro] = useState<MacroEntry | null>(null);
  const [tryInput, setTryInput] = useState('{}');
  const [tryResult, setTryResult] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const params: Record<string, unknown> = {};
    if (q.trim()) params.q = q.trim();
    if (domain) params.domain = domain;
    const r = await lensRun<MacroExplorerResult>('meta', 'macroExplorer', params);
    if (r.data.ok && r.data.result) setData(r.data.result);
    else setErr(r.data.error || 'Failed to load macro catalog.');
    setLoading(false);
  }, [q, domain]);

  useEffect(() => {
    void load();
  }, [load]);

  const runTry = useCallback(async () => {
    if (!tryMacro) return;
    setTrying(true);
    setTryResult(null);
    let parsed: Record<string, unknown> = {};
    try {
      parsed = tryInput.trim() ? JSON.parse(tryInput) : {};
    } catch {
      setTryResult('Invalid JSON input.');
      setTrying(false);
      return;
    }
    const r = await lensRun(tryMacro.domain, tryMacro.name, parsed);
    setTryResult(JSON.stringify(r.data, null, 2));
    setTrying(false);
  }, [tryMacro, tryInput]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search macros (domain.name)…"
          className="input-lattice flex-1 text-sm"
        />
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          className="input-lattice text-sm"
        >
          <option value="">All domains</option>
          {(data?.domains || []).map((d) => (
            <option key={d.domain} value={d.domain}>
              {d.domain} ({d.count})
            </option>
          ))}
        </select>
        <button aria-label="Refresh" onClick={load} className="rounded-md border border-zinc-700 p-2 text-zinc-400 hover:text-white">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {loading && <Spinner label="Loading macro catalog…" />}

      {!loading && data && !data.available && (
        <Empty msg="Macro registry not available in this runtime." />
      )}

      {!loading && data && data.available && (
        <>
          <p className="text-xs text-zinc-400">
            {data.total} of {data.totalAll} macros across {data.domains.length} domains
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
              {data.macros.map((m) => (
                <button
                  key={m.key}
                  onClick={() => {
                    setTryMacro(m);
                    setTryResult(null);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition-colors ${
                    tryMacro?.key === m.key
                      ? 'border-neon-purple/40 bg-neon-purple/10'
                      : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                  }`}
                >
                  <span className="font-mono text-xs text-white">{m.key}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{m.domain}</span>
                </button>
              ))}
              {data.macros.length === 0 && <Empty msg="No macros match the filter." />}
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Terminal className="h-3.5 w-3.5" /> Try it now
              </p>
              {!tryMacro ? (
                <p className="py-8 text-center text-xs text-zinc-400">Select a macro from the list to invoke it.</p>
              ) : (
                <div className="space-y-2">
                  <p className="font-mono text-sm text-neon-purple">{tryMacro.key}</p>
                  <textarea
                    value={tryInput}
                    onChange={(e) => setTryInput(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    placeholder='{ "param": "value" }'
                    className="input-lattice w-full font-mono text-xs"
                  />
                  <button
                    onClick={runTry}
                    disabled={trying}
                    className="inline-flex items-center gap-1.5 rounded-md bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple disabled:opacity-40"
                  >
                    {trying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                    Invoke {tryMacro.name}
                  </button>
                  {tryResult && (
                    <pre className="max-h-72 overflow-auto rounded border border-zinc-800 bg-black/60 p-2 font-mono text-[11px] text-zinc-300">
                      {tryResult}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// Quality Lab — structured-input runners for meta.qualityMetrics /
// meta.actionAnalytics / meta.systemReflection. These three macros are real
// deterministic analytics engines (percentile math, session segmentation,
// completeness/consistency/freshness scoring) that take a user-supplied
// dataset rather than reading live server state — so "bring your own rows"
// is the honest shape for this UI, but the *input* is a structured editable
// table (add/remove row), never a raw JSON textarea (Wave 3 audit fix,
// 2026-07-11 — these 3 macros previously had no purpose-built panel and were
// reachable only via the generic Macro Explorer "try it" box).
// ===========================================================================

function ScoreBar({ label, value, tone = 'purple' }: { label: string; value: number; tone?: 'purple' | 'green' | 'amber' }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const barColor = tone === 'green' ? 'bg-emerald-400' : tone === 'amber' ? 'bg-amber-400' : 'bg-neon-purple';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
        <span>{label}</span>
        <span className="font-mono text-zinc-200">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  B: 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30',
  C: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  D: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
  F: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

function QualityMetricsPanel() {
  const [rows, setRows] = useState<QualityField[]>([
    { name: '', value: '', required: true, expectedType: '', updatedAt: '' },
  ]);
  const [result, setResult] = useState<QualityMetricsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, patch: Partial<QualityField>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = () => setRows((r) => [...r, { name: '', value: '', required: true, expectedType: '', updatedAt: '' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const analyze = useCallback(async () => {
    const fields = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        value: r.value,
        required: r.required,
        expectedType: r.expectedType || undefined,
        updatedAt: r.updatedAt || undefined,
      }));
    if (fields.length === 0) {
      setErr('Add at least one named field.');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lensRun<QualityMetricsResult>('meta', 'qualityMetrics', { data: { fields } });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data.error || 'Analysis failed.');
  }, [rows]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Score a dataset&apos;s completeness, type consistency, and freshness. Add one row per field —
        this mirrors what `meta.qualityMetrics` grades on a real artifact.
      </p>

      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <input
              value={row.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="field name"
              className="input-lattice w-32 text-xs"
            />
            <input
              value={row.value}
              onChange={(e) => updateRow(i, { value: e.target.value })}
              placeholder="value"
              className="input-lattice w-28 text-xs"
            />
            <select
              value={row.expectedType}
              onChange={(e) => updateRow(i, { expectedType: e.target.value as QualityField['expectedType'] })}
              className="input-lattice text-xs"
            >
              <option value="">any type</option>
              {['string', 'number', 'boolean', 'date', 'email', 'url', 'array'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <input
              type="date"
              value={row.updatedAt}
              onChange={(e) => updateRow(i, { updatedAt: e.target.value })}
              className="input-lattice text-xs"
            />
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <input type="checkbox" checked={row.required} onChange={(e) => updateRow(i, { required: e.target.checked })} />
              required
            </label>
            <button onClick={() => removeRow(i)} className="ml-auto rounded p-1 text-zinc-500 hover:text-rose-400" aria-label={`Remove field${row.name.trim() ? ` "${row.name.trim()}"` : ` ${i + 1}`}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add field
        </button>
        <button
          onClick={analyze}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Analyze
        </button>
      </div>

      {err && <ErrorLine msg={err} />}

      {result && result.message && <Empty msg={result.message} />}

      {result && result.overall && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Quality score</p>
            <span className={`rounded border px-2 py-0.5 font-mono text-sm font-bold ${GRADE_COLOR[result.overall.grade] || GRADE_COLOR.C}`}>
              {result.overall.grade} &middot; {Math.round(result.overall.score * 100)}%
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <ScoreBar label="Completeness (required)" value={result.completeness?.scoreRequired ?? 0} tone="green" />
            <ScoreBar label="Consistency" value={result.consistency?.score ?? 0} tone="purple" />
            <ScoreBar label="Freshness" value={result.freshness?.avgScore ?? 0} tone="amber" />
          </div>
          {(result.consistency?.inconsistencies?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[11px] text-zinc-400">Type inconsistencies</p>
              <div className="space-y-1">
                {result.consistency!.inconsistencies.map((inc, i) => (
                  <div key={i} className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1 text-[11px] text-rose-300">
                    <span className="font-mono">{inc.field}</span>: expected {inc.expected}, got {inc.actual} (&quot;{inc.value}&quot;)
                  </div>
                ))}
              </div>
            </div>
          )}
          {(result.freshness?.staleCount ?? 0) > 0 && (
            <p className="text-[11px] text-amber-300">{result.freshness!.staleCount} field(s) stale (older than {result.freshness!.halfLifeDays}-day half-life).</p>
          )}
        </div>
      )}
    </div>
  );
}

function ActionAnalyticsPanel() {
  const [rows, setRows] = useState<ActionRow[]>([
    { userId: '', action: '', timestamp: '', durationMs: '' },
  ]);
  const [result, setResult] = useState<ActionAnalyticsResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, patch: Partial<ActionRow>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = () => setRows((r) => [...r, { userId: '', action: '', timestamp: '', durationMs: '' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const analyze = useCallback(async () => {
    const actionLog = rows
      .filter((r) => r.action.trim() && r.timestamp)
      .map((r) => ({
        userId: r.userId.trim() || undefined,
        action: r.action.trim(),
        timestamp: r.timestamp,
        durationMs: r.durationMs ? Number(r.durationMs) : undefined,
      }));
    if (actionLog.length === 0) {
      setErr('Add at least one row with an action and a timestamp.');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lensRun<ActionAnalyticsResult>('meta', 'actionAnalytics', { data: { actionLog } });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data.error || 'Analysis failed.');
  }, [rows]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Segment an action log into sessions and surface frequency, co-occurrence, and transition
        patterns — what `meta.actionAnalytics` computes over real usage telemetry.
      </p>

      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <input
              value={row.userId}
              onChange={(e) => updateRow(i, { userId: e.target.value })}
              placeholder="userId (optional)"
              className="input-lattice w-32 text-xs"
            />
            <input
              value={row.action}
              onChange={(e) => updateRow(i, { action: e.target.value })}
              placeholder="action name"
              className="input-lattice w-32 text-xs"
            />
            <input
              type="datetime-local"
              value={row.timestamp}
              onChange={(e) => updateRow(i, { timestamp: e.target.value })}
              className="input-lattice text-xs"
            />
            <input
              value={row.durationMs}
              onChange={(e) => updateRow(i, { durationMs: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="duration ms"
              className="input-lattice w-24 text-xs"
            />
            <button onClick={() => removeRow(i)} className="ml-auto rounded p-1 text-zinc-500 hover:text-rose-400" aria-label={`Remove event${row.action.trim() ? ` "${row.action.trim()}"` : ` ${i + 1}`}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add event
        </button>
        <button
          onClick={analyze}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Analyze
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {result && result.message && <Empty msg={result.message} />}

      {result && result.totalActions !== undefined && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              ['Actions', result.totalActions],
              ['Unique actions', result.uniqueActions],
              ['Users', result.uniqueUsers],
              ['Sessions', result.totalSessions],
              ['Peak hour', result.peakHour !== undefined ? `${result.peakHour}:00` : '—'],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-center">
                <div className="font-mono text-sm text-neon-cyan">{value as React.ReactNode}</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
              </div>
            ))}
          </div>

          {(result.frequencyDistribution?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Frequency distribution</p>
              <div className="space-y-1">
                {result.frequencyDistribution!.slice(0, 8).map((f) => (
                  <div key={f.action} className="flex items-center gap-2 text-[11px]">
                    <span className="w-24 truncate text-zinc-300">{f.action}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-neon-purple" style={{ width: `${f.percentage}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-zinc-500">{f.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(result.topTransitions?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Top transitions</p>
              <div className="flex flex-wrap gap-1">
                {result.topTransitions!.map((t) => (
                  <span key={t.transition} className="rounded bg-lattice-surface px-1.5 py-0.5 text-[11px] text-zinc-300">
                    {t.transition} <span className="text-zinc-500">&times;{t.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SystemReflectionPanel() {
  const [rows, setRows] = useState<MetricRow[]>([
    { timestamp: '', responseMs: '', success: true, endpoint: '', cpuPercent: '', memPercent: '' },
  ]);
  const [result, setResult] = useState<SystemReflectionResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const updateRow = (i: number, patch: Partial<MetricRow>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = () => setRows((r) => [...r, { timestamp: '', responseMs: '', success: true, endpoint: '', cpuPercent: '', memPercent: '' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));

  const analyze = useCallback(async () => {
    const metrics = rows
      .filter((r) => r.timestamp && r.responseMs)
      .map((r) => ({
        timestamp: r.timestamp,
        responseMs: Number(r.responseMs),
        success: r.success,
        endpoint: r.endpoint.trim() || undefined,
        cpuPercent: r.cpuPercent ? Number(r.cpuPercent) : undefined,
        memPercent: r.memPercent ? Number(r.memPercent) : undefined,
      }));
    if (metrics.length === 0) {
      setErr('Add at least one row with a timestamp and response time.');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lensRun<SystemReflectionResult>('meta', 'systemReflection', { data: { metrics } });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data.error || 'Analysis failed.');
  }, [rows]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Response-time percentiles, error-rate trend, and capacity health over a sample set — what
        `meta.systemReflection` computes over request telemetry.
      </p>

      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
            <input
              type="datetime-local"
              value={row.timestamp}
              onChange={(e) => updateRow(i, { timestamp: e.target.value })}
              className="input-lattice text-xs"
            />
            <input
              value={row.responseMs}
              onChange={(e) => updateRow(i, { responseMs: e.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="responseMs"
              className="input-lattice w-24 text-xs"
            />
            <input
              value={row.endpoint}
              onChange={(e) => updateRow(i, { endpoint: e.target.value })}
              placeholder="endpoint"
              className="input-lattice w-32 text-xs"
            />
            <input
              value={row.cpuPercent}
              onChange={(e) => updateRow(i, { cpuPercent: e.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="cpu%"
              className="input-lattice w-16 text-xs"
            />
            <input
              value={row.memPercent}
              onChange={(e) => updateRow(i, { memPercent: e.target.value.replace(/[^0-9.]/g, '') })}
              placeholder="mem%"
              className="input-lattice w-16 text-xs"
            />
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              <input type="checkbox" checked={row.success} onChange={(e) => updateRow(i, { success: e.target.checked })} />
              success
            </label>
            <button onClick={() => removeRow(i)} className="ml-auto rounded p-1 text-zinc-500 hover:text-rose-400" aria-label={`Remove sample${row.endpoint.trim() ? ` "${row.endpoint.trim()}"` : ` ${i + 1}`}`}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs text-zinc-300 hover:border-zinc-600">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add sample
        </button>
        <button
          onClick={analyze}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Analyze
        </button>
      </div>

      {err && <ErrorLine msg={err} />}
      {result && result.message && <Empty msg={result.message} />}

      {result && result.responseTime && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="grid grid-cols-4 gap-2 text-center">
            {(['p50', 'p90', 'p95', 'p99'] as const).map((k) => (
              <div key={k} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5">
                <div className="font-mono text-sm text-neon-cyan">{result.responseTime![k]}ms</div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">{k}</div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
            <span>Error rate: <span className="font-mono text-zinc-200">{Math.round((result.overallErrorRate ?? 0) * 100)}%</span></span>
            <span>Trend: <span className={`font-mono ${result.errorTrend === 'increasing' ? 'text-rose-300' : result.errorTrend === 'decreasing' ? 'text-emerald-300' : 'text-zinc-200'}`}>{result.errorTrend}</span></span>
            {result.capacity?.cpuHealth && (
              <span>CPU: <span className={`font-mono ${result.capacity.cpuHealth === 'critical' ? 'text-rose-300' : result.capacity.cpuHealth === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}>{result.capacity.cpuHealth}</span></span>
            )}
            {result.capacity?.memHealth && (
              <span>Mem: <span className={`font-mono ${result.capacity.memHealth === 'critical' ? 'text-rose-300' : result.capacity.memHealth === 'warning' ? 'text-amber-300' : 'text-emerald-300'}`}>{result.capacity.memHealth}</span></span>
            )}
          </div>
          {(result.endpoints?.length ?? 0) > 0 && (
            <div>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-zinc-400">Endpoint breakdown</p>
              <div className="space-y-1">
                {result.endpoints!.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-[11px] text-zinc-300">
                    <span className="font-mono">{e.name}</span>
                    <span className="text-zinc-500">{e.requests} req &middot; {Math.round(e.errorRate * 100)}% err &middot; {e.avgResponseMs}ms avg</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type QualityLabTab = 'quality' | 'actions' | 'reflection';
const QUALITY_LAB_TABS: { key: QualityLabTab; label: string; icon: typeof Gauge }[] = [
  { key: 'quality', label: 'Quality Metrics', icon: ListChecks },
  { key: 'actions', label: 'Action Analytics', icon: RouteIcon },
  { key: 'reflection', label: 'System Reflection', icon: Gauge },
];

function QualityLabPanel() {
  const [sub, setSub] = useState<QualityLabTab>('quality');
  return (
    <div className="space-y-3">
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/40 p-1">
        {QUALITY_LAB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
              sub === t.key ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'quality' && <QualityMetricsPanel />}
      {sub === 'actions' && <ActionAnalyticsPanel />}
      {sub === 'reflection' && <SystemReflectionPanel />}
    </div>
  );
}

// ===========================================================================
// Dev Portal — tabbed shell over the 8 observability surfaces
// ===========================================================================

type PortalTab = 'catalog' | 'graph' | 'metrics' | 'health' | 'timeline' | 'alerts' | 'macros' | 'quality-lab';

const PORTAL_TABS: { key: PortalTab; label: string; icon: typeof Server }[] = [
  { key: 'catalog', label: 'Service Catalog', icon: Server },
  { key: 'graph', label: 'Dependency Graph', icon: Network },
  { key: 'metrics', label: 'Live Metrics', icon: LineChart },
  { key: 'health', label: 'Health Roll-up', icon: ShieldCheck },
  { key: 'timeline', label: 'Change Timeline', icon: GitCommitHorizontal },
  { key: 'alerts', label: 'Alerts', icon: Siren },
  { key: 'macros', label: 'Macro Explorer', icon: Terminal },
  { key: 'quality-lab', label: 'Quality Lab', icon: Gauge },
];

export function DevPortal() {
  const [tab, setTab] = useState<PortalTab>('catalog');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Server className="h-4 w-4 text-neon-purple" />
          Developer Portal &amp; Observability
        </h2>
        <p className="text-xs text-zinc-400">
          Backstage-style service catalog, dependency graph, live metrics, health roll-up, change timeline,
          alert surface, macro explorer, and a quality lab for artifact/action/latency analysis.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-1">
        {PORTAL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              tab === t.key
                ? 'bg-neon-purple/20 text-neon-purple'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      <div>
        {tab === 'catalog' && <ServiceCatalogPanel />}
        {tab === 'graph' && <DependencyGraphPanel />}
        {tab === 'metrics' && <MetricsDashboardPanel />}
        {tab === 'health' && <HealthRollupPanel />}
        {tab === 'timeline' && <DeployTimelinePanel />}
        {tab === 'alerts' && <AlertSurfacePanel />}
        {tab === 'macros' && <MacroExplorerPanel />}
        {tab === 'quality-lab' && <QualityLabPanel />}
      </div>
    </div>
  );
}
