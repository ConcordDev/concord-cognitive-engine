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
// Dev Portal — tabbed shell over the 7 observability surfaces
// ===========================================================================

type PortalTab = 'catalog' | 'graph' | 'metrics' | 'health' | 'timeline' | 'alerts' | 'macros';

const PORTAL_TABS: { key: PortalTab; label: string; icon: typeof Server }[] = [
  { key: 'catalog', label: 'Service Catalog', icon: Server },
  { key: 'graph', label: 'Dependency Graph', icon: Network },
  { key: 'metrics', label: 'Live Metrics', icon: LineChart },
  { key: 'health', label: 'Health Roll-up', icon: ShieldCheck },
  { key: 'timeline', label: 'Change Timeline', icon: GitCommitHorizontal },
  { key: 'alerts', label: 'Alerts', icon: Siren },
  { key: 'macros', label: 'Macro Explorer', icon: Terminal },
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
          alert surface, and macro explorer.
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
      </div>
    </div>
  );
}
