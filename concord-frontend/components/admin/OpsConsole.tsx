'use client';

// OpsConsole — Datadog/Grafana-parity ops surface for the admin lens.
// Wires the seven server/domains/admin.js backlog macros into purpose-built
// panels: time-series history charts, editable alert rules, tenant admin
// actions, log search/tail, distributed-trace waterfalls, feature flags, and
// the incident timeline + on-call acknowledgement workflow.
//
// Every value rendered comes from a real `lensRun('admin', ...)` call — no
// mock or seed data. Operators ingest observations via the macros themselves
// (recordMetric / logAppend / traceRecord) and the read macros surface them.

import { useCallback, useEffect, useState } from 'react';
import { lensRun as lensRunRaw } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  Activity,
  AlertTriangle,
  Bell,
  Flag,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  ScrollText,
  Trash2,
  Users,
  XCircle,
} from 'lucide-react';

/**
 * lensRun — thin wrapper that unwraps the `{ data: { ok, result, error } }`
 * envelope from the raw client helper and throws on error so panel callers
 * can use plain try/catch.
 */
async function lensRun<T>(
  domain: string,
  action: string,
  input: Record<string, unknown>
): Promise<T> {
  const { data } = await lensRunRaw<T>(domain, action, input);
  if (!data.ok || data.result == null) {
    throw new Error(data.error || `${domain}.${action} failed`);
  }
  return data.result;
}

// ── shared types ───────────────────────────────────────────────────────────

interface SeriesPoint {
  t: string;
  v: number;
}
interface MetricSummary {
  metric: string;
  points: number;
  latest: number | null;
  latestAt: string | null;
}
interface AlertRule {
  id: string;
  name: string;
  metric: string;
  comparator: string;
  threshold: number;
  severity: string;
  aggregation: string;
  windowMinutes: number;
  enabled: boolean;
  observed?: number | null;
  dataPoints?: number;
  state?: string;
}
interface TenantRecord {
  userId: string;
  suspended: boolean;
  role: string;
  quotaMb: number;
  notes: string;
  updatedAt: string;
  history: Array<{ at: string; actorId: string; change: string }>;
}
interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  source: string;
  message: string;
}
interface TraceSpan {
  id: string;
  name: string;
  service: string;
  startMs: number;
  durationMs: number;
  endMs: number;
}
interface TraceRecord {
  traceId: string;
  endpoint: string;
  timestamp: string;
  totalMs: number;
  spanCount: number;
  spans: TraceSpan[];
  bottleneck: { name: string; service: string; durationMs: number } | null;
}
interface FeatureFlag {
  id: string;
  key: string;
  enabled: boolean;
  description: string;
  rolloutPct: number;
  updatedAt: string;
}
interface IncidentRecord {
  id: string;
  title: string;
  severity: string;
  service: string;
  status: string;
  acknowledgedBy: string | null;
  openedAt: string;
  resolvedAt: string | null;
  durationMs: number | null;
  timeline: Array<{ at: string; actorId: string; kind: string; note: string }>;
}

// ── small ui helpers ───────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Icon className="w-4 h-4 text-neon-cyan" />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const FIELD =
  'px-2 py-1 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-neon-cyan/60';
const BTN =
  'inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25 disabled:opacity-40 transition-colors';

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-rose-400">
      <XCircle className="w-3.5 h-3.5" />
      {msg}
    </div>
  );
}

// ── Feature 1 — Historical time-series charts ──────────────────────────────

function TimeSeriesPanel() {
  const [metrics, setMetrics] = useState<MetricSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [stats, setStats] = useState<Record<string, number | null> | null>(null);
  const [range, setRange] = useState(1440);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // ingest form
  const [iMetric, setIMetric] = useState('');
  const [iValue, setIValue] = useState('');

  const loadMetrics = useCallback(async () => {
    try {
      const r = await lensRun<{ metrics: MetricSummary[] }>('admin', 'metricHistory', {});
      const list = r?.metrics || [];
      setMetrics(list);
      if (!selected && list.length) setSelected(list[0].metric);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list metrics');
    }
  }, [selected]);

  const loadSeries = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{ series: SeriesPoint[]; stats: Record<string, number | null> }>(
        'admin',
        'metricHistory',
        { metric: selected, rangeMinutes: range, buckets: 120 }
      );
      setSeries(r?.series || []);
      setStats(r?.stats || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load series');
    } finally {
      setLoading(false);
    }
  }, [selected, range]);

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  const ingest = useCallback(async () => {
    const metric = iMetric.trim();
    const value = Number(iValue);
    if (!metric || !Number.isFinite(value)) {
      setErr('metric name and numeric value required');
      return;
    }
    setErr(null);
    try {
      await lensRun('admin', 'recordMetric', { metric, value });
      setIValue('');
      await loadMetrics();
      if (metric === selected) await loadSeries();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to record metric');
    }
  }, [iMetric, iValue, selected, loadMetrics, loadSeries]);

  return (
    <Section
      icon={Activity}
      title="Time-Series History"
      action={
        <button onClick={loadSeries} className={BTN}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      {/* ingest */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className={FIELD}
          placeholder="metric name"
          value={iMetric}
          onChange={(e) => setIMetric(e.target.value)}
        />
        <input
          className={`${FIELD} w-24`}
          placeholder="value"
          type="number"
          value={iValue}
          onChange={(e) => setIValue(e.target.value)}
        />
        <button onClick={ingest} className={BTN}>
          <Plus className="w-3 h-3" />
          Record point
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={FIELD} value={selected} onChange={(e) => setSelected(e.target.value)}>
          {metrics.length === 0 && <option value="">no metrics yet</option>}
          {metrics.map((m) => (
            <option key={m.metric} value={m.metric}>
              {m.metric} ({m.points})
            </option>
          ))}
        </select>
        <select
          className={FIELD}
          value={range}
          onChange={(e) => setRange(Number(e.target.value))}
        >
          <option value={60}>Last 1h</option>
          <option value={360}>Last 6h</option>
          <option value={1440}>Last 24h</option>
          <option value={2880}>Last 48h</option>
        </select>
      </div>

      <ErrLine msg={err} />

      {series.length > 0 ? (
        <ChartKit
          kind="area"
          data={series as unknown as Array<Record<string, unknown>>}
          xKey="t"
          series={[{ key: 'v', label: selected }]}
          height={220}
        />
      ) : (
        <p className="text-xs text-zinc-400 py-6 text-center">
          No points in range — record an observation to populate the chart.
        </p>
      )}

      {stats && stats.count ? (
        <div className="grid grid-cols-5 gap-2 text-center">
          {(['count', 'min', 'avg', 'p95', 'max'] as const).map((k) => (
            <div key={k} className="rounded bg-zinc-900 border border-zinc-800 p-2">
              <p className="text-sm font-bold text-zinc-100">{stats[k] ?? '--'}</p>
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">{k}</p>
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}

// ── Feature 2 — Alert rules + thresholds ───────────────────────────────────

function AlertRulesPanel() {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: '',
    metric: '',
    comparator: '>',
    threshold: '',
    severity: 'warning',
    aggregation: 'avg',
    windowMinutes: '15',
  });

  const evaluate = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{ rules: AlertRule[]; summary: Record<string, number> }>(
        'admin',
        'alertEvaluate',
        {}
      );
      setRules(r?.rules || []);
      setSummary(r?.summary || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to evaluate alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  const upsert = useCallback(async () => {
    const threshold = Number(form.threshold);
    if (!form.name.trim() || !form.metric.trim() || !Number.isFinite(threshold)) {
      setErr('name, metric and numeric threshold are required');
      return;
    }
    setErr(null);
    try {
      const r = await lensRun<{ rule: AlertRule }>('admin', 'alertRuleUpsert', {
        rule: {
          name: form.name.trim(),
          metric: form.metric.trim(),
          comparator: form.comparator,
          threshold,
          severity: form.severity,
          aggregation: form.aggregation,
          windowMinutes: Number(form.windowMinutes) || 15,
        },
      });
      if (!r?.rule) throw new Error('upsert returned no rule');
      setForm({ ...form, name: '', metric: '', threshold: '' });
      await evaluate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save rule');
    }
  }, [form, evaluate]);

  const remove = useCallback(
    async (ruleId: string) => {
      try {
        await lensRun('admin', 'alertRuleDelete', { ruleId });
        await evaluate();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to delete rule');
      }
    },
    [evaluate]
  );

  const stateColor = (s?: string) =>
    s === 'firing'
      ? 'text-rose-400 bg-rose-500/10 border-rose-500/30'
      : s === 'ok'
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
        : s === 'no-data'
          ? 'text-zinc-400 bg-zinc-500/10 border-zinc-500/30'
          : 'text-amber-400 bg-amber-500/10 border-amber-500/30';

  return (
    <Section
      icon={Bell}
      title="Alert Rules"
      action={
        <button onClick={evaluate} className={BTN}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Evaluate
        </button>
      }
    >
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-400">{summary.total} rules</span>
          <span className="text-rose-400">{summary.firing} firing</span>
          <span className="text-emerald-400">{summary.ok} ok</span>
          <span className="text-zinc-400">{summary.noData} no-data</span>
          {summary.criticalFiring > 0 && (
            <span className="text-rose-300 font-semibold">
              {summary.criticalFiring} critical firing
            </span>
          )}
        </div>
      )}

      {/* create form */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 p-2">
        <input
          className={`${FIELD} w-32`}
          placeholder="rule name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className={`${FIELD} w-32`}
          placeholder="metric"
          value={form.metric}
          onChange={(e) => setForm({ ...form, metric: e.target.value })}
        />
        <select
          className={FIELD}
          value={form.comparator}
          onChange={(e) => setForm({ ...form, comparator: e.target.value })}
        >
          {['>', '>=', '<', '<=', '=='].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input
          className={`${FIELD} w-20`}
          type="number"
          placeholder="threshold"
          value={form.threshold}
          onChange={(e) => setForm({ ...form, threshold: e.target.value })}
        />
        <select
          className={FIELD}
          value={form.aggregation}
          onChange={(e) => setForm({ ...form, aggregation: e.target.value })}
        >
          {['avg', 'max', 'min', 'last'].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className={FIELD}
          value={form.severity}
          onChange={(e) => setForm({ ...form, severity: e.target.value })}
        >
          {['info', 'warning', 'critical'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className={`${FIELD} w-16`}
          type="number"
          placeholder="win min"
          value={form.windowMinutes}
          onChange={(e) => setForm({ ...form, windowMinutes: e.target.value })}
        />
        <button onClick={upsert} className={BTN}>
          <Plus className="w-3 h-3" />
          Add rule
        </button>
      </div>

      <ErrLine msg={err} />

      {rules.length === 0 ? (
        <p className="text-xs text-zinc-400 py-3 text-center">No alert rules defined.</p>
      ) : (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900 border border-zinc-800 p-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-zinc-100 truncate">
                  {r.name}{' '}
                  <span className="text-zinc-400 font-mono">
                    {r.metric} {r.comparator} {r.threshold}
                  </span>
                </p>
                <p className="text-[10px] text-zinc-400">
                  {r.aggregation} over {r.windowMinutes}m · {r.severity}
                  {r.observed !== null && r.observed !== undefined
                    ? ` · observed ${r.observed} (${r.dataPoints} pts)`
                    : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border uppercase ${stateColor(r.state)}`}
                >
                  {r.state}
                </span>
                <button
                  onClick={() => remove(r.id)}
                  className="text-rose-400 hover:text-rose-300"
                  aria-label="Delete rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Feature 3 — Per-tenant admin actions ───────────────────────────────────

function TenantPanel() {
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [filter, setFilter] = useState<'all' | 'suspended'>('all');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{ tenants: TenantRecord[]; summary: Record<string, number> }>(
        'admin',
        'tenantList',
        { filter }
      );
      setTenants(r?.tenants || []);
      setSummary(r?.summary || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list tenants');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (id: string, action: string, extra: Record<string, unknown> = {}) => {
      const target = id.trim();
      if (!target) {
        setErr('userId is required');
        return;
      }
      setErr(null);
      try {
        const r = await lensRun<{ change: string }>('admin', 'tenantAction', {
          userId: target,
          action,
          ...extra,
        });
        if (!r?.change) throw new Error('tenant action returned no change');
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Tenant action failed');
      }
    },
    [load]
  );

  return (
    <Section
      icon={Users}
      title="Tenant Administration"
      action={
        <div className="flex items-center gap-2">
          <select
            className={FIELD}
            value={filter}
            onChange={(e) => setFilter(e.target.value as 'all' | 'suspended')}
          >
            <option value="all">All</option>
            <option value="suspended">Suspended</option>
          </select>
          <button aria-label="Refresh" onClick={load} className={BTN}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-400">{summary.total} tenants</span>
          <span className="text-rose-400">{summary.suspended} suspended</span>
          <span className="text-neon-purple">{summary.admins} admins</span>
        </div>
      )}

      {/* lookup / create */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 p-2">
        <input
          className={`${FIELD} w-44`}
          placeholder="userId to manage"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <button onClick={() => act(userId, 'suspend')} className={BTN}>
          Suspend
        </button>
        <button onClick={() => act(userId, 'unsuspend')} className={BTN}>
          Reinstate
        </button>
        <select
          className={FIELD}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) act(userId, 'role', { role: e.target.value });
            e.target.value = '';
          }}
        >
          <option value="">Set role…</option>
          {['member', 'moderator', 'admin', 'owner'].map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <ErrLine msg={err} />

      {tenants.length === 0 ? (
        <p className="text-xs text-zinc-400 py-3 text-center">No managed tenants.</p>
      ) : (
        <div className="space-y-1.5">
          {tenants.map((t) => (
            <div
              key={t.userId}
              className="rounded-lg bg-zinc-900 border border-zinc-800 p-2 space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono text-zinc-100 truncate">{t.userId}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/15 text-neon-purple">
                    {t.role}
                  </span>
                  {t.suspended && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400">
                      suspended
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className={`${FIELD} w-20`}
                    defaultValue={t.quotaMb}
                    onBlur={(e) => {
                      const q = Number(e.target.value);
                      if (Number.isFinite(q) && q !== t.quotaMb) {
                        act(t.userId, 'quota', { quotaMb: q });
                      }
                    }}
                    aria-label="Quota MB"
                  />
                  <span className="text-[10px] text-zinc-400">MB</span>
                </div>
              </div>
              {t.history.length > 0 && (
                <p className="text-[10px] text-zinc-400 truncate">
                  latest: {t.history[0].change} — {new Date(t.history[0].at).toLocaleString()}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Feature 4 — Log search / tail ──────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  debug: 'text-zinc-400',
  info: 'text-sky-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
  fatal: 'text-rose-300',
};

function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [byLevel, setByLevel] = useState<Record<string, number>>({});
  const [matched, setMatched] = useState(0);
  const [minLevel, setMinLevel] = useState('debug');
  const [query, setQuery] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // append form
  const [aLevel, setALevel] = useState('info');
  const [aMessage, setAMessage] = useState('');
  const [aSource, setASource] = useState('');

  const search = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{
        entries: LogEntry[];
        byLevel: Record<string, number>;
        matched: number;
      }>('admin', 'logSearch', { minLevel, query: query.trim(), limit: 100 });
      setEntries(r?.entries || []);
      setByLevel(r?.byLevel || {});
      setMatched(r?.matched || 0);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Log search failed');
    } finally {
      setLoading(false);
    }
  }, [minLevel, query]);

  useEffect(() => {
    search();
  }, [search]);

  const append = useCallback(async () => {
    if (!aMessage.trim()) {
      setErr('log message required');
      return;
    }
    setErr(null);
    try {
      await lensRun('admin', 'logAppend', {
        level: aLevel,
        message: aMessage.trim(),
        source: aSource.trim() || undefined,
      });
      setAMessage('');
      await search();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to append log');
    }
  }, [aLevel, aMessage, aSource, search]);

  return (
    <Section
      icon={ScrollText}
      title="Log Search & Tail"
      action={
        <button onClick={search} className={BTN}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Tail
        </button>
      }
    >
      {/* append */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 p-2">
        <select className={FIELD} value={aLevel} onChange={(e) => setALevel(e.target.value)}>
          {['debug', 'info', 'warn', 'error', 'fatal'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input
          className={`${FIELD} w-28`}
          placeholder="source"
          value={aSource}
          onChange={(e) => setASource(e.target.value)}
        />
        <input
          className={`${FIELD} flex-1 min-w-[10rem]`}
          placeholder="log message"
          value={aMessage}
          onChange={(e) => setAMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && append()}
        />
        <button onClick={append} className={BTN}>
          <Plus className="w-3 h-3" />
          Append
        </button>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select className={FIELD} value={minLevel} onChange={(e) => setMinLevel(e.target.value)}>
          {['debug', 'info', 'warn', 'error', 'fatal'].map((l) => (
            <option key={l} value={l}>
              ≥ {l}
            </option>
          ))}
        </select>
        <input
          className={`${FIELD} flex-1 min-w-[8rem]`}
          placeholder="search text…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="text-[10px] text-zinc-400">{matched} matched</span>
        {Object.entries(byLevel).map(([lvl, n]) =>
          n > 0 ? (
            <span key={lvl} className={`text-[10px] ${LEVEL_COLOR[lvl] || 'text-zinc-400'}`}>
              {lvl}:{n}
            </span>
          ) : null
        )}
      </div>

      <ErrLine msg={err} />

      <div className="max-h-64 overflow-y-auto rounded-lg bg-black/40 border border-zinc-800 font-mono text-[11px]">
        {entries.length === 0 ? (
          <p className="text-xs text-zinc-400 py-4 text-center">No log entries match.</p>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex gap-2 px-2 py-1 border-b border-zinc-900 last:border-0">
              <span className="text-zinc-600 flex-shrink-0">
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
              <span className={`flex-shrink-0 uppercase ${LEVEL_COLOR[e.level] || 'text-zinc-400'}`}>
                {e.level}
              </span>
              <span className="text-zinc-400 flex-shrink-0">[{e.source}]</span>
              <span className="text-zinc-200 break-all">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}

// ── Feature 5 — Distributed-trace waterfall ────────────────────────────────

function TracePanel() {
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [stats, setStats] = useState<Record<string, number | null> | null>(null);
  const [minMs, setMinMs] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{ traces: TraceRecord[]; stats: Record<string, number | null> }>(
        'admin',
        'traceList',
        { minMs, limit: 50 }
      );
      setTraces(r?.traces || []);
      setStats(r?.stats || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list traces');
    } finally {
      setLoading(false);
    }
  }, [minMs]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Section
      icon={GitBranch}
      title="Request Traces"
      action={
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={`${FIELD} w-24`}
            placeholder="min ms"
            value={minMs}
            onChange={(e) => setMinMs(Number(e.target.value) || 0)}
            aria-label="Minimum trace duration ms"
          />
          <button aria-label="Refresh" onClick={load} className={BTN}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {stats && stats.total ? (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-400">{stats.total} traces</span>
          <span className="text-rose-400">slowest {stats.slowest}ms</span>
          <span className="text-amber-400">p95 {stats.p95}ms</span>
          <span className="text-emerald-400">avg {stats.avg}ms</span>
        </div>
      ) : null}

      <ErrLine msg={err} />

      {traces.length === 0 ? (
        <p className="text-xs text-zinc-400 py-3 text-center">
          No traces recorded — ingest via the traceRecord macro.
        </p>
      ) : (
        <div className="space-y-1.5">
          {traces.map((tr) => (
            <div key={tr.traceId} className="rounded-lg bg-zinc-900 border border-zinc-800">
              <button
                onClick={() => setExpanded(expanded === tr.traceId ? null : tr.traceId)}
                className="w-full flex items-center justify-between gap-2 p-2 text-left"
              >
                <div className="min-w-0">
                  <p className="text-xs font-mono text-zinc-100 truncate">{tr.endpoint}</p>
                  <p className="text-[10px] text-zinc-400">
                    {tr.spanCount} spans
                    {tr.bottleneck
                      ? ` · bottleneck: ${tr.bottleneck.name} (${tr.bottleneck.durationMs}ms)`
                      : ''}
                  </p>
                </div>
                <span className="text-xs font-bold text-amber-400 flex-shrink-0">
                  {tr.totalMs}ms
                </span>
              </button>
              {expanded === tr.traceId && tr.spans.length > 0 && (
                <div className="px-2 pb-2 space-y-1">
                  {tr.spans.map((s) => {
                    const span = Math.max(1, tr.totalMs);
                    const left = (s.startMs / span) * 100;
                    const width = Math.max(1, (s.durationMs / span) * 100);
                    return (
                      <div key={s.id} className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-400 w-28 truncate flex-shrink-0">
                          {s.name}
                        </span>
                        <div className="relative flex-1 h-3 rounded bg-black/40">
                          <div
                            className="absolute h-3 rounded bg-neon-cyan/60"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`${s.service}: ${s.durationMs}ms @ ${s.startMs}ms`}
                          />
                        </div>
                        <span className="text-[10px] text-zinc-400 w-12 text-right flex-shrink-0">
                          {s.durationMs}ms
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Feature 6 — Feature flags ──────────────────────────────────────────────

function FeatureFlagPanel() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');
  const [desc, setDesc] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{ flags: FeatureFlag[]; summary: Record<string, number> }>(
        'admin',
        'featureFlagList',
        {}
      );
      setFlags(r?.flags || []);
      setSummary(r?.summary || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const create = useCallback(async () => {
    if (!key.trim()) {
      setErr('flag key required');
      return;
    }
    setErr(null);
    try {
      await lensRun('admin', 'featureFlagSet', {
        flag: { key: key.trim(), description: desc.trim(), enabled: false },
      });
      setKey('');
      setDesc('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create flag');
    }
  }, [key, desc, load]);

  const toggle = useCallback(
    async (id: string) => {
      try {
        await lensRun('admin', 'featureFlagSet', { toggle: id });
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to toggle flag');
      }
    },
    [load]
  );

  const setRollout = useCallback(
    async (flag: FeatureFlag, pct: number) => {
      try {
        await lensRun('admin', 'featureFlagSet', {
          flag: { id: flag.id, key: flag.key, rolloutPct: pct },
        });
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Failed to set rollout');
      }
    },
    [load]
  );

  return (
    <Section
      icon={Flag}
      title="Feature Flags"
      action={
        <button aria-label="Refresh" onClick={load} className={BTN}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      }
    >
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-400">{summary.total} flags</span>
          <span className="text-emerald-400">{summary.enabled} enabled</span>
          <span className="text-amber-400">{summary.partialRollout} partial rollout</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 p-2">
        <input
          className={`${FIELD} w-36`}
          placeholder="flag key"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          className={`${FIELD} flex-1 min-w-[8rem]`}
          placeholder="description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
        <button onClick={create} className={BTN}>
          <Plus className="w-3 h-3" />
          Add flag
        </button>
      </div>

      <ErrLine msg={err} />

      {flags.length === 0 ? (
        <p className="text-xs text-zinc-400 py-3 text-center">No feature flags defined.</p>
      ) : (
        <div className="space-y-1.5">
          {flags.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900 border border-zinc-800 p-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-mono text-zinc-100 truncate">{f.key}</p>
                {f.description && (
                  <p className="text-[10px] text-zinc-400 truncate">{f.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  className={FIELD}
                  value={f.rolloutPct}
                  onChange={(e) => setRollout(f, Number(e.target.value))}
                  aria-label="Rollout percentage"
                >
                  {[0, 10, 25, 50, 75, 100].map((p) => (
                    <option key={p} value={p}>
                      {p}%
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => toggle(f.id)}
                  className={`text-[10px] px-2 py-1 rounded border ${
                    f.enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-zinc-700/30 text-zinc-400 border-zinc-700'
                  }`}
                >
                  {f.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── Feature 7 — Incident timeline + on-call ack ────────────────────────────

function IncidentPanel() {
  const [incidents, setIncidents] = useState<IncidentRecord[]>([]);
  const [summary, setSummary] = useState<Record<string, number | null> | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'active' | 'resolved'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('sev3');
  const [service, setService] = useState('');
  const [noteText, setNoteText] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await lensRun<{
        incidents: IncidentRecord[];
        summary: Record<string, number | null>;
      }>('admin', 'incidentList', { status: statusFilter });
      setIncidents(r?.incidents || []);
      setSummary(r?.summary || null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to list incidents');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const open = useCallback(async () => {
    if (!title.trim()) {
      setErr('incident title required');
      return;
    }
    setErr(null);
    try {
      await lensRun('admin', 'incidentOpen', {
        title: title.trim(),
        severity,
        service: service.trim() || undefined,
      });
      setTitle('');
      setService('');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to open incident');
    }
  }, [title, severity, service, load]);

  const update = useCallback(
    async (incidentId: string, action: string, note?: string) => {
      setErr(null);
      try {
        await lensRun('admin', 'incidentUpdate', { incidentId, action, note });
        setNoteText('');
        await load();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Incident update failed');
      }
    },
    [load]
  );

  const sevColor = (s: string) =>
    s === 'sev1'
      ? 'bg-rose-500/15 text-rose-400'
      : s === 'sev2'
        ? 'bg-orange-500/15 text-orange-400'
        : s === 'sev3'
          ? 'bg-amber-500/15 text-amber-400'
          : 'bg-zinc-500/15 text-zinc-400';

  const statusColor = (s: string) =>
    s === 'open'
      ? 'text-rose-400'
      : s === 'acknowledged'
        ? 'text-amber-400'
        : 'text-emerald-400';

  const sel = incidents.find((i) => i.id === selected);
  const timelineEvents: TimelineEvent[] = sel
    ? sel.timeline.map((tl, i) => ({
        id: `${sel.id}_${i}`,
        label: tl.kind,
        time: tl.at,
        detail: `${tl.note} — ${tl.actorId}`,
        tone:
          tl.kind === 'opened'
            ? 'bad'
            : tl.kind === 'resolved'
              ? 'good'
              : tl.kind === 'acknowledged'
                ? 'warn'
                : 'info',
      }))
    : [];

  return (
    <Section
      icon={AlertTriangle}
      title="Incidents & On-Call"
      action={
        <div className="flex items-center gap-2">
          <select
            className={FIELD}
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'all' | 'open' | 'active' | 'resolved')
            }
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="active">Active</option>
            <option value="resolved">Resolved</option>
          </select>
          <button aria-label="Refresh" onClick={load} className={BTN}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      }
    >
      {summary && (
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="text-zinc-400">{summary.total} total</span>
          <span className="text-rose-400">{summary.open} open</span>
          <span className="text-amber-400">{summary.acknowledged} acked</span>
          <span className="text-emerald-400">{summary.resolved} resolved</span>
          {summary.mttrMs != null && (
            <span className="text-zinc-400">
              MTTR {Math.round((summary.mttrMs as number) / 60000)}m
            </span>
          )}
        </div>
      )}

      {/* declare */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-900/60 border border-zinc-800 p-2">
        <input
          className={`${FIELD} flex-1 min-w-[10rem]`}
          placeholder="incident title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <select className={FIELD} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          {['sev1', 'sev2', 'sev3', 'sev4'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          className={`${FIELD} w-28`}
          placeholder="service"
          value={service}
          onChange={(e) => setService(e.target.value)}
        />
        <button onClick={open} className={BTN}>
          <Plus className="w-3 h-3" />
          Declare
        </button>
      </div>

      <ErrLine msg={err} />

      {incidents.length === 0 ? (
        <p className="text-xs text-zinc-400 py-3 text-center">No incidents.</p>
      ) : (
        <div className="space-y-1.5">
          {incidents.map((inc) => (
            <div key={inc.id} className="rounded-lg bg-zinc-900 border border-zinc-800">
              <button
                onClick={() => setSelected(selected === inc.id ? null : inc.id)}
                className="w-full flex items-center justify-between gap-2 p-2 text-left"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${sevColor(inc.severity)}`}>
                    {inc.severity}
                  </span>
                  <span className="text-xs font-medium text-zinc-100 truncate">{inc.title}</span>
                </div>
                <span className={`text-[10px] uppercase font-medium ${statusColor(inc.status)}`}>
                  {inc.status}
                </span>
              </button>
              {selected === inc.id && (
                <div className="px-2 pb-2 space-y-2">
                  <p className="text-[10px] text-zinc-400">
                    {inc.service} · opened {new Date(inc.openedAt).toLocaleString()}
                    {inc.acknowledgedBy ? ` · acked by ${inc.acknowledgedBy}` : ''}
                    {inc.durationMs != null
                      ? ` · resolved in ${Math.round(inc.durationMs / 60000)}m`
                      : ''}
                  </p>
                  <TimelineView events={timelineEvents} height={90} />
                  {inc.status !== 'resolved' && (
                    <div className="flex flex-wrap items-center gap-2">
                      {inc.status === 'open' && (
                        <button
                          onClick={() => update(inc.id, 'acknowledge')}
                          className={BTN}
                        >
                          Acknowledge
                        </button>
                      )}
                      <input
                        className={`${FIELD} flex-1 min-w-[8rem]`}
                        placeholder="timeline note"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                      />
                      <button
                        onClick={() => update(inc.id, 'note', noteText.trim())}
                        disabled={!noteText.trim()}
                        className={BTN}
                      >
                        Add note
                      </button>
                      <button
                        onClick={() => update(inc.id, 'resolve', noteText.trim() || undefined)}
                        className={BTN}
                      >
                        Resolve
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ── exported console ───────────────────────────────────────────────────────

export function OpsConsole() {
  const [ready, setReady] = useState(false);

  // Defer mounting heavy panels until first paint so the admin page stays snappy.
  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading ops console…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Datadog/Grafana-parity ops surface — time-series history, editable alerting, tenant
        administration, log search, request-trace waterfalls, feature flags, and the incident
        on-call workflow. Every panel is backed by a live admin-domain macro.
      </p>
      <div className="grid lg:grid-cols-2 gap-4">
        <TimeSeriesPanel />
        <AlertRulesPanel />
        <TenantPanel />
        <LogPanel />
        <TracePanel />
        <FeatureFlagPanel />
        <div className="lg:col-span-2">
          <IncidentPanel />
        </div>
      </div>
    </div>
  );
}
