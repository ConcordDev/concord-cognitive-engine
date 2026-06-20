'use client';
/* eslint-disable @typescript-eslint/no-explicit-any -- macro payloads are dynamic telemetry JSON */

/**
 * ObservePlatform — full Datadog-shape telemetry platform UI.
 *
 * Wires the 7 parity-backlog feature families exposed by
 * server/domains/observe.js:
 *   1. Live metrics ingestion + time-series charts
 *   2. Dashboards (composable widget grids, saved layouts)
 *   3. Log search / query language
 *   4. Distributed tracing / APM (span waterfall + service map)
 *   5. Alert rule editor (threshold / anomaly monitors)
 *   6. Synthetic monitoring (scheduled uptime / API checks)
 *   7. Incident on-call paging + notification routing
 *
 * Every macro called here is a registered observe.* action. No
 * placeholder panels — each tab is a real workbench.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity, LayoutDashboard, Search, GitBranch, BellRing, Globe2, Radio,
  Loader2, Plus, Trash2, Play, RefreshCw, Check, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';

const DOMAIN = 'observe';

async function run<T = any>(name: string, params: Record<string, unknown> = {}) {
  const r = await lensRun<T>(DOMAIN, name, params);
  return r.data;
}

type TabId = 'metrics' | 'dashboards' | 'logs' | 'traces' | 'monitors' | 'synthetics' | 'oncall';

const TABS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'metrics', label: 'Metrics', icon: Activity },
  { id: 'dashboards', label: 'Dashboards', icon: LayoutDashboard },
  { id: 'logs', label: 'Log Search', icon: Search },
  { id: 'traces', label: 'APM / Traces', icon: GitBranch },
  { id: 'monitors', label: 'Monitors', icon: BellRing },
  { id: 'synthetics', label: 'Synthetics', icon: Globe2 },
  { id: 'oncall', label: 'On-Call', icon: Radio },
];

// ---------------------------------------------------------------- shared bits
function Notice({ n }: { n: { kind: 'ok' | 'err'; text: string } | null }) {
  if (!n) return null;
  return (
    <div className={`mt-2 px-3 py-1.5 rounded text-[11px] flex items-center gap-2 border ${
      n.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
        : 'bg-rose-500/10 text-rose-300 border-rose-500/30'}`}>
      {n.kind === 'ok' ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
      {n.text}
    </div>
  );
}
const inputCls = 'bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 focus:outline-none focus:ring-1 focus:ring-cyan-400/50';
const btnCls = 'inline-flex items-center gap-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[12px] px-3 py-1.5 rounded';
const cardCls = 'rounded-lg border border-zinc-800 bg-zinc-950/60 p-3';

// ============================================================ 1. METRICS
function MetricsTab() {
  const [metrics, setMetrics] = useState<Array<{ name: string; points: number; latest: number | null }>>([]);
  const [name, setName] = useState('app.latency_ms');
  const [value, setValue] = useState('');
  const [sel, setSel] = useState('');
  const [agg, setAgg] = useState('avg');
  const [win, setWin] = useState(60);
  const [series, setSeries] = useState<Array<{ label: string; value: number | null }>>([]);
  const [stats, setStats] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const d = await run('metricList');
    if (d.ok) setMetrics(d.result?.metrics || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const query = useCallback(async (m: string) => {
    if (!m) return;
    setSel(m); setBusy(true);
    const d = await run('metricQuery', { metric: m, agg, windowMinutes: win, buckets: 40 });
    setBusy(false);
    if (d.ok) { setSeries(d.result?.series || []); setStats(d.result?.stats || null); }
  }, [agg, win]);

  const ingest = async () => {
    const v = parseFloat(value);
    if (!name || !Number.isFinite(v)) { setNotice({ kind: 'err', text: 'Metric name + numeric value required.' }); return; }
    setBusy(true);
    const d = await run('metricIngest', { metric: name, value: v });
    setBusy(false);
    if (d.ok) { setNotice({ kind: 'ok', text: `Ingested → ${d.result?.metrics} metrics.` }); setValue(''); refresh(); if (sel === name) query(name); }
    else setNotice({ kind: 'err', text: d.error || 'ingest failed' });
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-2">Ingest metric point</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="metric name" />
          <input className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
          <button className={btnCls} disabled={busy} onClick={ingest}><Plus className="w-3 h-3" /> Ingest</button>
        </div>
        <Notice n={notice} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={cardCls}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold">Metrics ({metrics.length})</span>
            <button aria-label="Refresh" onClick={refresh} className="text-zinc-400 hover:text-zinc-200"><RefreshCw className="w-3 h-3" /></button>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {metrics.length === 0 && <div className="text-[11px] text-zinc-400">No metrics yet.</div>}
            {metrics.map((m) => (
              <button key={m.name} onClick={() => query(m.name)}
                className={`w-full text-left px-2 py-1 rounded text-[11px] flex justify-between ${sel === m.name ? 'bg-cyan-500/15 text-cyan-200' : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'}`}>
                <span className="font-mono truncate">{m.name}</span>
                <span className="text-zinc-400">{m.points}pt</span>
              </button>
            ))}
          </div>
        </div>
        <div className={`${cardCls} md:col-span-2`}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-[12px] font-semibold text-zinc-200">{sel || 'Select a metric'}</span>
            <select className={inputCls} value={agg} onChange={(e) => { setAgg(e.target.value); }}>
              {['avg', 'sum', 'min', 'max', 'count', 'last'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className={inputCls} value={win} onChange={(e) => setWin(Number(e.target.value))}>
              {[15, 60, 360, 1440].map((w) => <option key={w} value={w}>{w}m</option>)}
            </select>
            <button className={btnCls} disabled={!sel || busy} onClick={() => query(sel)}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Query
            </button>
          </div>
          {sel ? (
            <>
              <ChartKit kind="area" data={series} xKey="label" series={[{ key: 'value', label: agg, color: '#06b6d4' }]} height={200} />
              {stats && (
                <div className="flex gap-3 mt-2 text-[10px] text-zinc-400">
                  <span>count {stats.count}</span><span>min {stats.min}</span>
                  <span>max {stats.max}</span><span>avg {stats.avg}</span><span>last {stats.last}</span>
                </div>
              )}
            </>
          ) : <div className="text-[11px] text-zinc-400 py-8 text-center">Pick a metric to chart its time-series.</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================ 2. DASHBOARDS
function DashboardsTab() {
  const [dashboards, setDashboards] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [active, setActive] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const d = await run('dashboardList');
    if (d.ok) setDashboards(d.result?.dashboards || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    if (!title.trim()) { setNotice({ kind: 'err', text: 'Title required.' }); return; }
    setBusy(true);
    const d = await run('dashboardSave', { title: title.trim(), widgets: [] });
    setBusy(false);
    if (d.ok) { setTitle(''); setActive(d.result?.dashboard); setNotice({ kind: 'ok', text: 'Dashboard created.' }); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'save failed' });
  };

  const addWidget = async (kind: string) => {
    if (!active) return;
    const widgets = [...(active.widgets || []), {
      id: `wg_${Date.now().toString(36)}`, kind,
      title: `${kind} widget`, metric: kind === 'timeseries' || kind === 'query_value' ? 'app.latency_ms' : '',
      agg: 'avg', x: 0, y: (active.widgets?.length || 0) * 4, w: 6, h: 4, text: '',
    }];
    setBusy(true);
    const d = await run('dashboardSave', { id: active.id, title: active.title, widgets });
    setBusy(false);
    if (d.ok) { setActive(d.result?.dashboard); refresh(); }
  };

  const removeWidget = async (wid: string) => {
    if (!active) return;
    const widgets = (active.widgets || []).filter((w: any) => w.id !== wid);
    const d = await run('dashboardSave', { id: active.id, title: active.title, widgets });
    if (d.ok) { setActive(d.result?.dashboard); refresh(); }
  };

  const del = async (id: string) => {
    const d = await run('dashboardDelete', { id });
    if (d.ok) { if (active?.id === id) setActive(null); refresh(); }
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New dashboard title" />
          <button className={btnCls} disabled={busy} onClick={create}><Plus className="w-3 h-3" /> Create</button>
        </div>
        <Notice n={notice} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className={cardCls}>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Saved ({dashboards.length})</div>
          <div className="space-y-1">
            {dashboards.length === 0 && <div className="text-[11px] text-zinc-400">No dashboards yet.</div>}
            {dashboards.map((d) => (
              <div key={d.id} className={`flex items-center gap-1 px-2 py-1 rounded ${active?.id === d.id ? 'bg-cyan-500/15' : 'bg-zinc-900'}`}>
                <button onClick={() => setActive(d)} className="flex-1 text-left text-[11px] text-zinc-200 truncate">{d.title}</button>
                <span className="text-[10px] text-zinc-400">{d.widgets?.length || 0}w</span>
                <button aria-label="Delete" onClick={() => del(d.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </div>
        <div className={`${cardCls} md:col-span-3`}>
          {active ? (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[13px] font-semibold text-zinc-100">{active.title}</span>
                {['timeseries', 'query_value', 'toplist', 'slo', 'alert_count', 'log_stream', 'trace_map', 'note'].map((k) => (
                  <button key={k} onClick={() => addWidget(k)} disabled={busy}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">+ {k}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(active.widgets || []).length === 0 && <div className="text-[11px] text-zinc-400 col-span-2 py-6 text-center">Empty layout — add widgets above.</div>}
                {(active.widgets || []).map((w: any) => (
                  <div key={w.id} className="rounded border border-zinc-800 bg-zinc-900/60 p-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-zinc-200">{w.title}</span>
                      <button aria-label="Delete" onClick={() => removeWidget(w.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{w.kind}{w.metric ? ` · ${w.metric} (${w.agg})` : ''}</div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="text-[11px] text-zinc-400 py-10 text-center">Create or select a dashboard to compose widgets.</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================ 3. LOG SEARCH
function LogsTab() {
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [facets, setFacets] = useState<any>(null);
  const [matched, setMatched] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const search = useCallback(async (q?: string) => {
    setBusy(true);
    const d = await run('logSearch', { query: q ?? query, windowMinutes: 1440, limit: 200 });
    setBusy(false);
    if (d.ok) { setResults(d.result?.results || []); setFacets(d.result?.facets || null); setMatched(d.result?.matched || 0); }
  }, [query]);
  useEffect(() => { search(''); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ingest = async () => {
    const entries = draft.split('\n').map((l) => {
      const m = l.match(/^(\w+)\s+(\S+)\s+(.+)$/);
      return m ? { level: m[1], service: m[2], message: m[3] } : (l.trim() ? { level: 'info', service: 'app', message: l.trim() } : null);
    }).filter(Boolean);
    if (!entries.length) { setNotice({ kind: 'err', text: 'Add log lines.' }); return; }
    setBusy(true);
    const d = await run('logIngest', { entries });
    setBusy(false);
    if (d.ok) { setNotice({ kind: 'ok', text: `Ingested ${d.result?.ingested} lines.` }); setDraft(''); search(); }
    else setNotice({ kind: 'err', text: d.error || 'ingest failed' });
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-1">Ingest logs (LEVEL service message)</div>
        <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
          className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] font-mono text-zinc-100 resize-none"
          placeholder="ERROR api request timeout after 30s" />
        <div className="mt-1.5"><button className={btnCls} disabled={busy} onClick={ingest}><Plus className="w-3 h-3" /> Ingest</button></div>
        <Notice n={notice} />
      </div>
      <div className={cardCls}>
        <div className="flex gap-2 items-center mb-2">
          <input className={`${inputCls} flex-1`} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="search — supports level:error service:api free text" />
          <button className={btnCls} disabled={busy} onClick={() => search()}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Facets · {matched} hits</div>
            {facets && ['level', 'service'].map((f) => (
              <div key={f} className="mb-2">
                <div className="text-[10px] text-zinc-400">{f}</div>
                {(facets[f] || []).slice(0, 6).map((x: any) => (
                  <button key={x.value} onClick={() => search(`${f}:${x.value}`)}
                    className="block w-full text-left text-[11px] text-zinc-300 hover:text-cyan-300">
                    {x.value} <span className="text-zinc-600">({x.count})</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="md:col-span-3 max-h-80 overflow-y-auto space-y-0.5">
            {results.length === 0 && <div className="text-[11px] text-zinc-400">No matching logs.</div>}
            {results.map((r) => (
              <div key={r.id} className="flex gap-2 text-[11px] font-mono px-2 py-1 rounded bg-zinc-900/60">
                <span className={`uppercase ${r.level === 'error' ? 'text-rose-400' : r.level === 'warn' ? 'text-amber-400' : 'text-zinc-400'}`}>{r.level}</span>
                <span className="text-cyan-400">{r.service}</span>
                <span className="text-zinc-300 truncate flex-1">{r.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================ 4. TRACES / APM
function TracesTab() {
  const [traces, setTraces] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>(null);
  const [map, setMap] = useState<{ nodes: any[]; edges: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const [t, m] = await Promise.all([run('traceList', { limit: 50 }), run('serviceMap')]);
    if (t.ok) setTraces(t.result?.traces || []);
    if (m.ok) setMap({ nodes: m.result?.nodes || [], edges: m.result?.edges || [] });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const openTrace = async (id: string) => {
    const d = await run('traceDetail', { traceId: id });
    if (d.ok) setDetail(d.result?.trace);
  };

  const seedSample = async () => {
    setBusy(true);
    const base = Date.now();
    const d = await run('traceIngest', {
      spans: [
        { id: 's1', service: 'gateway', name: 'GET /checkout', startMs: 0, durationMs: 240 },
        { id: 's2', parentId: 's1', service: 'orders', name: 'createOrder', startMs: 20, durationMs: 160 },
        { id: 's3', parentId: 's2', service: 'payments', name: 'charge', startMs: 40, durationMs: 90, error: true },
        { id: 's4', parentId: 's2', service: 'inventory', name: 'reserve', startMs: 140, durationMs: 30 },
      ],
      traceId: `trace_${base.toString(36)}`,
    });
    setBusy(false);
    if (d.ok) { setNotice({ kind: 'ok', text: `Trace recorded (${d.result?.spanCount} spans).` }); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'ingest failed' });
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="flex items-center gap-2">
          <button className={btnCls} disabled={busy} onClick={seedSample}><Plus className="w-3 h-3" /> Record sample trace</button>
          <button aria-label="Refresh" onClick={refresh} className="text-zinc-400 hover:text-zinc-200"><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        <Notice n={notice} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={cardCls}>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Traces ({traces.length})</div>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {traces.length === 0 && <div className="text-[11px] text-zinc-400">No traces yet.</div>}
            {traces.map((t) => (
              <button key={t.id} onClick={() => openTrace(t.id)}
                className={`w-full text-left px-2 py-1 rounded text-[11px] ${detail?.id === t.id ? 'bg-cyan-500/15' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
                <div className="flex justify-between">
                  <span className="text-zinc-200 truncate">{t.rootService} · {t.rootName}</span>
                  <span className={t.hasError ? 'text-rose-400' : 'text-emerald-400'}>{t.totalMs}ms</span>
                </div>
                <div className="text-[10px] text-zinc-400">{t.spanCount} spans</div>
              </button>
            ))}
          </div>
        </div>
        <div className={`${cardCls} md:col-span-2`}>
          {detail ? (
            <>
              <div className="text-[12px] font-semibold text-zinc-100 mb-2">Span waterfall · {detail.totalMs}ms</div>
              <div className="space-y-1">
                {(detail.waterfall || []).map((sp: any) => (
                  <div key={sp.id} className="text-[10px]">
                    <div className="flex justify-between text-zinc-400">
                      <span>{sp.service} · {sp.name}</span>
                      <span>{sp.durationMs}ms{sp.error ? ' ⚠' : ''}</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden mt-0.5">
                      <div className={`h-full ${sp.error ? 'bg-rose-500' : 'bg-cyan-500'}`}
                        style={{ marginLeft: `${sp.offsetPct}%`, width: `${Math.max(1, sp.widthPct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <div className="text-[11px] text-zinc-400 py-6 text-center">Select a trace to view its span waterfall.</div>}
          {map && map.nodes.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">Service map</div>
              <div className="flex flex-wrap gap-1.5">
                {map.nodes.map((n) => (
                  <span key={n.service} className={`text-[10px] px-1.5 py-0.5 rounded ${n.errors > 0 ? 'bg-rose-500/15 text-rose-300' : 'bg-zinc-800 text-zinc-300'}`}>
                    {n.service} · {n.calls}× · {n.avgMs}ms
                  </span>
                ))}
              </div>
              <div className="text-[10px] text-zinc-400 mt-1">
                {map.edges.map((e) => `${e.from}→${e.to} (${e.count})`).join('  ')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================ 5. MONITORS
function MonitorsTab() {
  const [monitors, setMonitors] = useState<any[]>([]);
  const [metric, setMetric] = useState('app.latency_ms');
  const [type, setType] = useState('threshold');
  const [op, setOp] = useState('>');
  const [threshold, setThreshold] = useState('200');
  const [agg, setAgg] = useState('avg');
  const [severity, setSeverity] = useState('sev3');
  const [evals, setEvals] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const d = await run('monitorList');
    if (d.ok) setMonitors(d.result?.monitors || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!metric.trim()) { setNotice({ kind: 'err', text: 'Metric required.' }); return; }
    setBusy(true);
    const d = await run('monitorSave', { metric: metric.trim(), type, op, agg, severity, threshold: parseFloat(threshold) || 0, windowMinutes: 15 });
    setBusy(false);
    if (d.ok) { setNotice({ kind: 'ok', text: 'Monitor saved.' }); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'save failed' });
  };

  const del = async (id: string) => { const d = await run('monitorDelete', { id }); if (d.ok) refresh(); };

  const evaluate = async () => {
    setBusy(true);
    const d = await run('monitorEvaluate');
    setBusy(false);
    if (d.ok) { setEvals(d.result?.evaluations || []); setNotice({ kind: 'ok', text: `${d.result?.alerting} alerting / ${d.result?.evaluated} evaluated.` }); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'evaluate failed' });
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-2">New monitor</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="metric" />
          <select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="threshold">threshold</option><option value="anomaly">anomaly</option>
          </select>
          <select className={inputCls} value={agg} onChange={(e) => setAgg(e.target.value)}>
            {['avg', 'sum', 'min', 'max', 'last'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {type === 'threshold' && (
            <>
              <select className={inputCls} value={op} onChange={(e) => setOp(e.target.value)}>
                {['>', '>=', '<', '<=', '=='].map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <input className={`${inputCls} w-20`} value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="threshold" />
            </>
          )}
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['sev1', 'sev2', 'sev3', 'sev4'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className={btnCls} disabled={busy} onClick={save}><Plus className="w-3 h-3" /> Save</button>
          <button className={btnCls} disabled={busy} onClick={evaluate}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Evaluate all
          </button>
        </div>
        <Notice n={notice} />
      </div>
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Monitors ({monitors.length})</div>
        <div className="space-y-1">
          {monitors.length === 0 && <div className="text-[11px] text-zinc-400">No monitors yet.</div>}
          {monitors.map((m) => {
            const ev = evals.find((e) => e.id === m.id);
            const state = ev?.state || m.state;
            return (
              <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-900/60">
                <span className={`w-2 h-2 rounded-full ${state === 'alert' ? 'bg-rose-500' : state === 'no_data' ? 'bg-zinc-600' : 'bg-emerald-500'}`} />
                <span className="text-[11px] text-zinc-200 flex-1 truncate">{m.name}</span>
                <span className="text-[10px] text-zinc-400">{m.type} · {m.severity}</span>
                {ev && <span className={`text-[10px] ${ev.breached ? 'text-rose-400' : 'text-emerald-400'}`}>{ev.reason}</span>}
                <button aria-label="Delete" onClick={() => del(m.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================ 6. SYNTHETICS
function SyntheticsTab() {
  const [checks, setChecks] = useState<any[]>([]);
  const [url, setUrl] = useState('https://');
  const [name, setName] = useState('');
  const [expectStatus, setExpectStatus] = useState('200');
  const [intervalMin, setIntervalMin] = useState('5');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const d = await run('syntheticList');
    if (d.ok) setChecks(d.result?.checks || []);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    if (!/^https?:\/\/.+/.test(url)) { setNotice({ kind: 'err', text: 'Valid URL required.' }); return; }
    setBusy('save');
    const d = await run('syntheticSave', { url: url.trim(), name: name.trim() || url.trim(), expectStatus: parseInt(expectStatus, 10) || 200, intervalMinutes: parseInt(intervalMin, 10) || 5 });
    setBusy(null);
    if (d.ok) { setNotice({ kind: 'ok', text: 'Check created.' }); setName(''); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'save failed' });
  };
  const runCheck = async (id: string) => {
    setBusy(id);
    const d = await run('syntheticRun', { id });
    setBusy(null);
    if (d.ok) { setNotice({ kind: 'ok', text: `${d.result?.check?.name}: ${d.result?.check?.status} (${d.result?.run?.latencyMs}ms)` }); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'run failed' });
  };
  const del = async (id: string) => { const d = await run('syntheticDelete', { id }); if (d.ok) refresh(); };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-2">New synthetic check</div>
        <div className="flex flex-wrap gap-2 items-center">
          <input className={`${inputCls} flex-1 min-w-[200px]`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/health" />
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="name (optional)" />
          <input className={`${inputCls} w-20`} value={expectStatus} onChange={(e) => setExpectStatus(e.target.value)} placeholder="status" />
          <input className={`${inputCls} w-24`} value={intervalMin} onChange={(e) => setIntervalMin(e.target.value)} placeholder="interval(m)" />
          <button className={btnCls} disabled={busy === 'save'} onClick={save}><Plus className="w-3 h-3" /> Create</button>
        </div>
        <Notice n={notice} />
      </div>
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Checks ({checks.length})</div>
        <div className="space-y-1">
          {checks.length === 0 && <div className="text-[11px] text-zinc-400">No synthetic checks yet.</div>}
          {checks.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded bg-zinc-900/60">
              <span className={`w-2 h-2 rounded-full ${c.status === 'up' ? 'bg-emerald-500' : c.status === 'down' ? 'bg-rose-500' : 'bg-zinc-600'}`} />
              <span className="text-[11px] text-zinc-200 truncate flex-1">{c.name}</span>
              <span className="text-[10px] text-zinc-400">{c.method} · every {c.intervalMinutes}m</span>
              {c.uptimePct != null && <span className="text-[10px] text-cyan-400">{c.uptimePct}% up</span>}
              <button onClick={() => runCheck(c.id)} disabled={busy === c.id} className="text-cyan-400 hover:text-cyan-300">
                {busy === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              </button>
              <button aria-label="Delete" onClick={() => del(c.id)} className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================ 7. ON-CALL
function OnCallTab() {
  const [status, setStatus] = useState<any>(null);
  const [person, setPerson] = useState('');
  const [routeName, setRouteName] = useState('');
  const [channel, setChannel] = useState('dm');
  const [target, setTarget] = useState('');
  const [minSeverity, setMinSeverity] = useState('sev3');
  const [pageSeverity, setPageSeverity] = useState('sev2');
  const [pageSummary, setPageSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const d = await run('oncallStatus');
    if (d.ok) setStatus(d.result);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const addPerson = async () => {
    if (!person.trim()) return;
    setBusy(true);
    const schedule = [...(status?.schedule || []), { person: person.trim(), startsAt: new Date().toISOString(), endsAt: '' }];
    const d = await run('oncallSetup', { schedule });
    setBusy(false);
    if (d.ok) { setPerson(''); setNotice({ kind: 'ok', text: 'On-call updated.' }); refresh(); }
  };
  const addRoute = async () => {
    if (!target.trim()) { setNotice({ kind: 'err', text: 'Route target required.' }); return; }
    setBusy(true);
    const routes = [...(status?.routes || []), { name: routeName.trim() || channel, channel, target: target.trim(), minSeverity }];
    const d = await run('oncallSetup', { routes });
    setBusy(false);
    if (d.ok) { setTarget(''); setRouteName(''); setNotice({ kind: 'ok', text: 'Route added.' }); refresh(); }
  };
  const page = async () => {
    setBusy(true);
    const d = await run('pageOnCall', { severity: pageSeverity, summary: pageSummary.trim() || 'Manual page' });
    setBusy(false);
    if (d.ok) { setNotice({ kind: 'ok', text: `Paged ${d.result?.page?.pagedPerson} · ${d.result?.routesNotified} routes notified.` }); setPageSummary(''); refresh(); }
    else setNotice({ kind: 'err', text: d.error || 'page failed' });
  };
  const ack = async (id: string) => { const d = await run('acknowledgePage', { id }); if (d.ok) refresh(); };

  const pageEvents = (status?.recentPages || []).map((p: any) => ({
    id: p.id, label: `${p.severity.toUpperCase()} · ${p.summary}`, time: p.at,
    tone: (p.ackedBy ? 'good' : 'bad') as 'good' | 'bad',
    detail: `${p.pagedPerson} · ${p.routesFired?.length || 0} routes${p.ackedBy ? ` · acked by ${p.ackedBy}` : ''}`,
  }));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={cardCls}>
          <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-semibold mb-2">On-call schedule</div>
          <div className="text-[11px] text-zinc-300 mb-2">Currently on-call: <span className="text-cyan-300 font-semibold">{status?.current?.person || 'unassigned'}</span></div>
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1`} value={person} onChange={(e) => setPerson(e.target.value)} placeholder="add person" />
            <button aria-label="Add" className={btnCls} disabled={busy} onClick={addPerson}><Plus className="w-3 h-3" /></button>
          </div>
          <div className="mt-2 space-y-0.5">
            {(status?.schedule || []).map((s: any, i: number) => (
              <div key={i} className="text-[11px] text-zinc-400">{s.person}</div>
            ))}
          </div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Notification routes</div>
          <div className="flex flex-wrap gap-2">
            <input className={`${inputCls} w-24`} value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="name" />
            <select className={inputCls} value={channel} onChange={(e) => setChannel(e.target.value)}>
              {['dm', 'email', 'webhook', 'sms'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input className={`${inputCls} flex-1 min-w-[120px]`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="target" />
            <select className={inputCls} value={minSeverity} onChange={(e) => setMinSeverity(e.target.value)}>
              {['sev1', 'sev2', 'sev3', 'sev4'].map((s) => <option key={s} value={s}>≥{s}</option>)}
            </select>
            <button aria-label="Add" className={btnCls} disabled={busy} onClick={addRoute}><Plus className="w-3 h-3" /></button>
          </div>
          <div className="mt-2 space-y-0.5">
            {(status?.routes || []).map((r: any) => (
              <div key={r.id} className="text-[11px] text-zinc-400">{r.name} · {r.channel} → {r.target} (≥{r.minSeverity})</div>
            ))}
          </div>
        </div>
        <div className={cardCls}>
          <div className="text-[10px] uppercase tracking-wider text-rose-300 font-semibold mb-2">Page on-call</div>
          <div className="space-y-2">
            <select className={`${inputCls} w-full`} value={pageSeverity} onChange={(e) => setPageSeverity(e.target.value)}>
              {['sev1', 'sev2', 'sev3', 'sev4'].map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
            <input className={`${inputCls} w-full`} value={pageSummary} onChange={(e) => setPageSummary(e.target.value)} placeholder="page summary" />
            <button className="w-full inline-flex items-center justify-center gap-1.5 bg-rose-700 hover:bg-rose-600 disabled:opacity-40 text-white text-[12px] px-3 py-1.5 rounded"
              disabled={busy} onClick={page}>
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radio className="w-3 h-3" />} Page now
            </button>
          </div>
        </div>
      </div>
      <Notice n={notice} />
      <div className={cardCls}>
        <div className="text-[10px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">Page timeline</div>
        {pageEvents.length > 0 ? <TimelineView events={pageEvents} height={90} /> : <div className="text-[11px] text-zinc-400">No pages yet.</div>}
        <div className="mt-2 space-y-1">
          {(status?.recentPages || []).filter((p: any) => !p.ackedBy).map((p: any) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded bg-rose-500/10">
              <span className="text-[11px] text-rose-300 flex-1 truncate">{p.severity.toUpperCase()} · {p.summary}</span>
              <button onClick={() => ack(p.id)} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700">Acknowledge</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================ shell
export function ObservePlatform() {
  const [tab, setTab] = useState<TabId>('metrics');
  return (
    <div className="rounded-xl border border-cyan-500/20 bg-zinc-950/60 p-3">
      <div className="flex items-center gap-2 border-b border-cyan-500/10 pb-2 mb-3 overflow-x-auto">
        <Activity className="h-4 w-4 text-cyan-400 shrink-0" />
        <h3 className="text-sm font-semibold text-white shrink-0">Telemetry platform</h3>
        <div className="flex gap-1 ml-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] whitespace-nowrap ${
                  tab === t.id ? 'bg-cyan-600 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
                <Icon className="w-3 h-3" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>
      {tab === 'metrics' && <MetricsTab />}
      {tab === 'dashboards' && <DashboardsTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'traces' && <TracesTab />}
      {tab === 'monitors' && <MonitorsTab />}
      {tab === 'synthetics' && <SyntheticsTab />}
      {tab === 'oncall' && <OnCallTab />}
    </div>
  );
}
