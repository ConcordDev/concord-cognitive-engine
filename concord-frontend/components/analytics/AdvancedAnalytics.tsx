'use client';

/**
 * AdvancedAnalytics — Mixpanel / Amplitude parity surface for the
 * analytics lens. Mounts the seven feature-parity backlog items:
 *   1. Custom report builder (saved dashboards + widget layout)
 *   2. User-path / flow analysis (Sankey-style journey graph)
 *   3. Multi-dimensional property breakdowns
 *   4. Live event stream / debugger view
 *   5. Alerts on metric thresholds or anomalies
 *   6. Behavioral cohort builder (did X but not Y)
 *   7. Date-range comparison across reports
 * Every value here is real user input or computed from the user's own
 * tracked event log — no seed / mock data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard, GitBranch, Layers3, Radio, Bell, UsersRound,
  CalendarRange, Plus, Trash2, RefreshCw, Loader2, Play, Pause, Save,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { cn } from '@/lib/utils';

// ── Shared types ──────────────────────────────────────────────────────────────

type Tab = 'reports' | 'paths' | 'breakdown' | 'stream' | 'alerts' | 'cohorts' | 'compare';

interface TopEvent { name: string; count: number }

const TABS: { id: Tab; label: string; icon: typeof Radio }[] = [
  { id: 'reports', label: 'Reports', icon: LayoutDashboard },
  { id: 'paths', label: 'Paths', icon: GitBranch },
  { id: 'breakdown', label: 'Breakdown', icon: Layers3 },
  { id: 'stream', label: 'Live stream', icon: Radio },
  { id: 'alerts', label: 'Alerts', icon: Bell },
  { id: 'cohorts', label: 'Cohorts', icon: UsersRound },
  { id: 'compare', label: 'Compare', icon: CalendarRange },
];

const INPUT =
  'bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 ' +
  'placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/60';
const BTN =
  'px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white ' +
  'font-semibold disabled:opacity-40 inline-flex items-center gap-1';
const BTN_GHOST =
  'px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 ' +
  'inline-flex items-center gap-1';

function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-zinc-400 italic py-3 text-center">{text}</p>;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdvancedAnalytics() {
  const [tab, setTab] = useState<Tab>('reports');
  const [topEvents, setTopEvents] = useState<TopEvent[]>([]);

  // Pull the user's distinct event names once so every sub-panel can
  // suggest real events instead of forcing the user to type from memory.
  useEffect(() => {
    void (async () => {
      const r = await lensRun('analytics', 'event-stats', {});
      if (r.data?.ok) setTopEvents((r.data.result?.topEvents as TopEvent[]) || []);
    })();
  }, []);
  const eventNames = topEvents.map((e) => e.name);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <LayoutDashboard className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Advanced Analytics</h3>
        <span className="text-[11px] text-zinc-400">reports · paths · alerts · cohorts</span>
      </div>

      <div className="flex flex-wrap gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded font-medium transition-colors',
              tab === t.id
                ? 'bg-amber-600/20 text-amber-300 border border-amber-600/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-transparent'
            )}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'reports' && <ReportBuilder eventNames={eventNames} />}
      {tab === 'paths' && <PathAnalysis eventNames={eventNames} />}
      {tab === 'breakdown' && <BreakdownPanel eventNames={eventNames} />}
      {tab === 'stream' && <LiveStream eventNames={eventNames} />}
      {tab === 'alerts' && <AlertsPanel eventNames={eventNames} />}
      {tab === 'cohorts' && <CohortBuilder eventNames={eventNames} />}
      {tab === 'compare' && <RangeCompare eventNames={eventNames} />}
    </div>
  );
}

// ── Event-name datalist helper ────────────────────────────────────────────────

function EventList({ id, names }: { id: string; names: string[] }) {
  return (
    <datalist id={id}>
      {names.map((n) => (
        <option key={n} value={n} />
      ))}
    </datalist>
  );
}

// ── 1. Custom report builder ──────────────────────────────────────────────────

type WidgetKind = 'metric' | 'trend' | 'topEvents' | 'segment' | 'funnel';

interface WidgetConfig {
  eventName?: string;
  metric?: string;
  propertyKey?: string;
  steps?: string[];
}
interface Widget {
  id?: string;
  kind: WidgetKind;
  title: string;
  config: WidgetConfig;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface DashboardSummary { id: string; name: string; widgetCount: number; updatedAt: string }
interface WidgetData {
  value?: number;
  series?: { date: string; count: number }[];
  rows?: { name: string; count: number }[];
  segments?: { value: string; count: number }[];
  steps?: { event: string; count: number; conversionFromStart: number }[];
  message?: string;
}
interface LoadedWidget extends Widget { data?: WidgetData }

function ReportBuilder({ eventNames }: { eventNames: string[] }) {
  const [dashboards, setDashboards] = useState<DashboardSummary[]>([]);
  const [name, setName] = useState('');
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedWidget[] | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('analytics', 'dashboard-list', {});
    if (r.data?.ok) setDashboards((r.data.result?.dashboards as DashboardSummary[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  function addWidget(kind: WidgetKind) {
    setWidgets((w) => [
      ...w,
      { kind, title: `${kind} widget`, config: {}, x: 0, y: w.length, w: 6, h: 3 },
    ]);
  }
  function updateWidget(i: number, patch: Partial<Widget>) {
    setWidgets((w) => w.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }
  function updateConfig(i: number, patch: Partial<WidgetConfig>) {
    setWidgets((w) => w.map((x, idx) => (idx === i ? { ...x, config: { ...x.config, ...patch } } : x)));
  }

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun('analytics', 'dashboard-save', {
      id: editingId || undefined,
      name: name.trim(),
      widgets,
    });
    setBusy(false);
    if (r.data?.ok) {
      setName('');
      setWidgets([]);
      setEditingId(null);
      await refresh();
    }
  }
  async function open(id: string) {
    setBusy(true);
    const r = await lensRun('analytics', 'dashboard-get', { id });
    setBusy(false);
    if (r.data?.ok) {
      const d = r.data.result?.dashboard as { name: string; widgets: LoadedWidget[] };
      setLoaded(d.widgets);
      setEditingId(id);
      setName(d.name);
      setWidgets(d.widgets.map(({ data: _data, ...w }) => w));
    }
  }
  async function remove(id: string) {
    await lensRun('analytics', 'dashboard-delete', { id });
    if (editingId === id) { setEditingId(null); setName(''); setWidgets([]); setLoaded(null); }
    await refresh();
  }

  return (
    <div className="space-y-3">
      <EventList id="rb-events" names={eventNames} />

      {/* Saved dashboards */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">Saved dashboards</p>
        {dashboards.length === 0 && <Empty text="No saved dashboards yet." />}
        <div className="space-y-1">
          {dashboards.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs">
              <button onClick={() => open(d.id)} className="flex-1 text-left text-zinc-200 hover:text-amber-300 truncate">
                {d.name}
              </button>
              <span className="text-[10px] text-zinc-400">{d.widgetCount} widgets</span>
              <button onClick={() => remove(d.id)} aria-label={`Delete ${d.name}`} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Builder */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="dashboard name"
            className={cn(INPUT, 'flex-1')} />
          <button onClick={save} disabled={!name.trim() || busy} className={BTN}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {editingId ? 'Update' : 'Save'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {(['metric', 'trend', 'topEvents', 'segment', 'funnel'] as WidgetKind[]).map((k) => (
            <button key={k} onClick={() => addWidget(k)} className={BTN_GHOST}>
              <Plus className="w-3 h-3" />{k}
            </button>
          ))}
        </div>
        {widgets.length === 0 && <Empty text="Add widgets to build a dashboard." />}
        <div className="space-y-2">
          {widgets.map((w, i) => (
            <div key={i} className="bg-zinc-950 border border-zinc-800 rounded p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-600/20 text-amber-300">{w.kind}</span>
                <input value={w.title} onChange={(e) => updateWidget(i, { title: e.target.value })}
                  placeholder="widget title" className={cn(INPUT, 'flex-1')} />
                <button onClick={() => setWidgets((arr) => arr.filter((_, idx) => idx !== i))}
                  aria-label="Remove widget" className="text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(w.kind === 'metric' || w.kind === 'trend' || w.kind === 'segment') && (
                  <input list="rb-events" value={w.config.eventName || ''}
                    onChange={(e) => updateConfig(i, { eventName: e.target.value })}
                    placeholder="event name" className={cn(INPUT, 'w-32')} />
                )}
                {w.kind === 'metric' && (
                  <select value={w.config.metric || 'count'} onChange={(e) => updateConfig(i, { metric: e.target.value })}
                    className={cn(INPUT, 'w-24')}>
                    <option value="count">count</option>
                    <option value="unique">unique users</option>
                  </select>
                )}
                {w.kind === 'segment' && (
                  <input value={w.config.propertyKey || ''} onChange={(e) => updateConfig(i, { propertyKey: e.target.value })}
                    placeholder="property key" className={cn(INPUT, 'w-28')} />
                )}
                {w.kind === 'funnel' && (
                  <input value={(w.config.steps || []).join(', ')}
                    onChange={(e) => updateConfig(i, { steps: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                    placeholder="steps, comma-separated" className={cn(INPUT, 'flex-1 min-w-[160px]')} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Live rendered dashboard */}
      {loaded && loaded.length > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-2">Live dashboard preview</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {loaded.map((w) => (
              <WidgetCard key={w.id} widget={w} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetCard({ widget }: { widget: LoadedWidget }) {
  const d = widget.data;
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded p-2">
      <p className="text-[11px] font-semibold text-zinc-200 mb-1.5">{widget.title}</p>
      {!d && <Empty text="no data yet" />}
      {d?.message && <Empty text={d.message} />}
      {widget.kind === 'metric' && d?.value !== undefined && (
        <p className="text-2xl font-bold text-amber-300">{d.value.toLocaleString()}</p>
      )}
      {widget.kind === 'trend' && (
        d?.series && d.series.length > 0 ? (
          <ChartKit kind="area" data={d.series} xKey="date"
            series={[{ key: 'count', label: 'events', color: '#f59e0b' }]}
            height={140} showLegend={false} />
        ) : <Empty text="no data yet" />
      )}
      {widget.kind === 'topEvents' && (
        d?.rows && d.rows.length > 0 ? (
          <ChartKit kind="bar" data={d.rows} xKey="name"
            series={[{ key: 'count', label: 'events', color: '#22c55e' }]}
            height={150} showLegend={false} />
        ) : <Empty text="no data yet" />
      )}
      {widget.kind === 'segment' && (
        d?.segments && d.segments.length > 0 ? (
          <ChartKit kind="bar" data={d.segments} xKey="value"
            series={[{ key: 'count', label: 'count', color: '#a855f7' }]}
            height={150} showLegend={false} />
        ) : <Empty text="no data yet" />
      )}
      {widget.kind === 'funnel' && (
        d?.steps && d.steps.length > 0 ? (
          <div className="space-y-1">
            {d.steps.map((s, i) => (
              <div key={i} className="text-[11px]">
                <div className="flex justify-between text-zinc-300">
                  <span>{i + 1}. {s.event}</span>
                  <span>{s.count} · {s.conversionFromStart}%</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                  <div className="h-full bg-amber-500" style={{ width: `${s.conversionFromStart}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : <Empty text="no data yet" />
      )}
    </div>
  );
}

// ── 2. User-path / flow analysis ──────────────────────────────────────────────

interface PathNode { id: string; depth: number; event: string }
interface PathLink { source: string; target: string; value: number }
interface PathResult { nodes: PathNode[]; links: PathLink[]; journeys: number; anchorEvent: string | null }

function PathAnalysis({ eventNames }: { eventNames: string[] }) {
  const [anchor, setAnchor] = useState('');
  const [maxSteps, setMaxSteps] = useState(5);
  const [result, setResult] = useState<PathResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const r = await lensRun('analytics', 'path-analysis', {
      anchorEvent: anchor.trim() || undefined,
      maxSteps,
    });
    setBusy(false);
    setResult(r.data?.ok ? (r.data.result as PathResult) : null);
  }

  // Group nodes into columns by depth for a Sankey-style layout.
  const columns: PathNode[][] = [];
  if (result) {
    for (const n of result.nodes) {
      (columns[n.depth] = columns[n.depth] || []).push(n);
    }
  }
  const maxLink = result ? Math.max(1, ...result.links.map((l) => l.value)) : 1;

  return (
    <div className="space-y-3">
      <EventList id="pa-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">Journey flow analysis</p>
        <div className="flex flex-wrap gap-1.5 items-center">
          <input list="pa-events" value={anchor} onChange={(e) => setAnchor(e.target.value)}
            placeholder="anchor event (optional)" className={cn(INPUT, 'flex-1 min-w-[140px]')} />
          <label className="text-[11px] text-zinc-400 flex items-center gap-1">
            depth
            <input type="number" min={2} max={8} value={maxSteps}
              onChange={(e) => setMaxSteps(Math.min(8, Math.max(2, Number(e.target.value) || 5)))}
              className={cn(INPUT, 'w-14')} />
          </label>
          <button onClick={run} disabled={busy} className={BTN}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
            Analyse
          </button>
        </div>
      </div>

      {result && result.journeys === 0 && <Empty text="No journeys yet — track 2+ events per user." />}
      {result && result.journeys > 0 && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[11px] text-zinc-400 mb-2">
            {result.journeys} journeys · {result.links.length} transitions
            {result.anchorEvent ? ` · anchored at "${result.anchorEvent}"` : ''}
          </p>
          <div className="overflow-x-auto">
            <div className="flex gap-6 min-w-max pb-2">
              {columns.map((col, depth) => (
                <div key={depth} className="space-y-2">
                  <p className="text-[9px] uppercase text-zinc-400 tracking-wide">Step {depth + 1}</p>
                  {col.sort((a, b) => a.event.localeCompare(b.event)).map((n) => (
                    <div key={n.id}
                      className="px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-[11px] text-zinc-200 whitespace-nowrap">
                      {n.event}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Top transitions</p>
            {result.links.slice(0, 12).map((l) => {
              const src = l.source.slice(l.source.indexOf(':') + 1);
              const dst = l.target.slice(l.target.indexOf(':') + 1);
              return (
                <div key={`${l.source}>${l.target}`} className="text-[11px]">
                  <div className="flex justify-between text-zinc-300">
                    <span className="truncate">{src} → {dst}</span>
                    <span>{l.value}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-cyan-500" style={{ width: `${(l.value / maxLink) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 3. Multi-dimensional breakdown ────────────────────────────────────────────

interface BreakdownRow { dimensions: string[]; count: number; uniqueUsers: number; value: number }
interface BreakdownResult { eventName: string; dimensions: string[]; metric: string; total: number; rows: BreakdownRow[] }

interface DateFilter { from: string; to: string }

function BreakdownPanel({ eventNames }: { eventNames: string[] }) {
  const [eventName, setEventName] = useState('');
  const [dim1, setDim1] = useState('');
  const [dim2, setDim2] = useState('');
  const [metric, setMetric] = useState('count');
  const [range, setRange] = useState<DateFilter>({ from: '', to: '' });
  const [result, setResult] = useState<BreakdownResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    const dimensions = [dim1.trim(), dim2.trim()].filter(Boolean);
    if (!eventName.trim() || dimensions.length === 0) return;
    setBusy(true);
    const r = await lensRun('analytics', 'breakdown', {
      eventName: eventName.trim(),
      dimensions,
      metric,
      from: range.from || undefined,
      to: range.to || undefined,
    });
    setBusy(false);
    setResult(r.data?.ok ? (r.data.result as BreakdownResult) : null);
  }

  const chartData = result?.rows.slice(0, 15).map((r) => ({
    label: r.dimensions.join(' · '),
    value: r.value,
  }));

  return (
    <div className="space-y-3">
      <EventList id="bd-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Multi-dimensional breakdown</p>
        <div className="flex flex-wrap gap-1.5">
          <input list="bd-events" value={eventName} onChange={(e) => setEventName(e.target.value)}
            placeholder="event name" className={cn(INPUT, 'flex-1 min-w-[120px]')} />
          <input value={dim1} onChange={(e) => setDim1(e.target.value)}
            placeholder="dimension 1" className={cn(INPUT, 'w-28')} />
          <input value={dim2} onChange={(e) => setDim2(e.target.value)}
            placeholder="dimension 2 (opt)" className={cn(INPUT, 'w-32')} />
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className={cn(INPUT, 'w-28')}>
            <option value="count">count</option>
            <option value="unique">unique users</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <DateRangeInputs range={range} onChange={setRange} />
          <button onClick={run} disabled={busy || !eventName.trim() || (!dim1.trim() && !dim2.trim())} className={BTN}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers3 className="w-3 h-3" />}
            Break down
          </button>
        </div>
      </div>

      {result && result.rows.length === 0 && <Empty text="No matching events yet." />}
      {result && result.rows.length > 0 && chartData && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[11px] text-zinc-400 mb-2">
            {result.eventName} · {result.metric} total {result.total.toLocaleString()}
          </p>
          <ChartKit kind="bar" data={chartData} xKey="label"
            series={[{ key: 'value', label: result.metric, color: '#06b6d4' }]}
            height={200} showLegend={false} />
          <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
            {result.rows.map((r, i) => (
              <div key={i} className="flex justify-between text-[11px] text-zinc-300 px-1 py-0.5">
                <span className="truncate">{r.dimensions.join(' · ')}</span>
                <span className="text-zinc-400">
                  {r.count} events · {r.uniqueUsers} users
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Date-range pair used by breakdown + cohort + compare.
function DateRangeInputs({ range, onChange }: { range: DateFilter; onChange: (r: DateFilter) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <input type="date" value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })}
        className={cn(INPUT, 'w-32')} aria-label="from date" />
      <span className="text-zinc-600 text-xs">→</span>
      <input type="date" value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })}
        className={cn(INPUT, 'w-32')} aria-label="to date" />
    </span>
  );
}

// ── 4. Live event stream / debugger ───────────────────────────────────────────

interface StreamEvent {
  id: string;
  name: string;
  distinctId: string;
  properties: Record<string, unknown>;
  at: string;
}

function LiveStream({ eventNames }: { eventNames: string[] }) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [nameFilter, setNameFilter] = useState('');
  const [live, setLive] = useState(false);
  const [matched, setMatched] = useState(0);
  const cursorRef = useRef<string | null>(null);
  const filterRef = useRef('');
  filterRef.current = nameFilter;

  const poll = useCallback(async (reset: boolean) => {
    const r = await lensRun('analytics', 'event-stream', {
      name: filterRef.current.trim() || undefined,
      since: reset ? undefined : cursorRef.current || undefined,
      limit: 100,
    });
    if (!r.data?.ok) return;
    const res = r.data.result as { events: StreamEvent[]; matched: number; cursor: string };
    if (reset) {
      setEvents(res.events);
      setMatched(res.matched);
    } else if (res.events.length > 0) {
      setEvents((prev) => [...res.events, ...prev].slice(0, 200));
      setMatched((m) => m + res.events.length);
    }
    cursorRef.current = res.cursor;
  }, []);

  useEffect(() => { cursorRef.current = null; void poll(true); }, [poll, nameFilter]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void poll(false); }, 4000);
    return () => clearInterval(t);
  }, [live, poll]);

  return (
    <div className="space-y-3">
      <EventList id="ls-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <div className="flex flex-wrap gap-1.5 items-center">
          <input list="ls-events" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)}
            placeholder="filter by event name" className={cn(INPUT, 'flex-1 min-w-[140px]')} />
          <button onClick={() => { cursorRef.current = null; void poll(true); }} className={BTN_GHOST}>
            <RefreshCw className="w-3 h-3" />Refresh
          </button>
          <button onClick={() => setLive((l) => !l)}
            className={cn(live ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : BTN_GHOST,
              'px-2.5 py-1 text-xs rounded font-semibold inline-flex items-center gap-1')}>
            {live ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            {live ? 'Live' : 'Go live'}
          </button>
          <span className="text-[10px] text-zinc-400">{matched} matched</span>
        </div>
      </div>

      {events.length === 0 && <Empty text="No events yet — track events to populate the stream." />}
      {events.length > 0 && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg max-h-72 overflow-y-auto divide-y divide-zinc-900">
          {events.map((e) => (
            <div key={e.id} className="px-2.5 py-1.5 text-[11px] font-mono">
              <div className="flex items-center gap-2">
                <span className="text-amber-300 font-semibold">{e.name}</span>
                <span className="text-zinc-400">{e.distinctId}</span>
                <span className="text-zinc-600 ml-auto">{new Date(e.at).toLocaleTimeString()}</span>
              </div>
              {Object.keys(e.properties || {}).length > 0 && (
                <div className="text-zinc-400 mt-0.5 truncate">
                  {Object.entries(e.properties).map(([k, v]) => `${k}=${String(v)}`).join('  ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 5. Alerts ─────────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  name: string;
  eventName: string;
  metric: string;
  kind: string;
  op: string;
  threshold: number;
  window: number;
  value?: number;
  firing?: boolean;
  detail?: string;
}

function AlertsPanel({ eventNames }: { eventNames: string[] }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [firing, setFiring] = useState(0);
  const [form, setForm] = useState({
    name: '', eventName: '', metric: 'count', kind: 'threshold', op: 'gt', threshold: '', window: '7',
  });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun('analytics', 'alert-list', {});
    if (r.data?.ok) {
      setAlerts((r.data.result?.alerts as Alert[]) || []);
      setFiring((r.data.result?.firing as number) || 0);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function save() {
    if (!form.name.trim()) return;
    if (form.kind === 'threshold' && form.threshold === '') return;
    setBusy(true);
    const r = await lensRun('analytics', 'alert-save', {
      name: form.name.trim(),
      eventName: form.eventName.trim(),
      metric: form.metric,
      kind: form.kind,
      op: form.op,
      threshold: Number(form.threshold) || 0,
      window: Number(form.window) || 7,
    });
    setBusy(false);
    if (r.data?.ok) {
      setForm({ ...form, name: '', threshold: '' });
      await refresh();
    }
  }
  async function remove(id: string) {
    await lensRun('analytics', 'alert-delete', { id });
    await refresh();
  }

  return (
    <div className="space-y-3">
      <EventList id="al-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">New metric alert</p>
        <div className="flex flex-wrap gap-1.5">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="alert name" className={cn(INPUT, 'flex-1 min-w-[120px]')} />
          <input list="al-events" value={form.eventName} onChange={(e) => setForm({ ...form, eventName: e.target.value })}
            placeholder="event (blank = all)" className={cn(INPUT, 'w-36')} />
          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className={cn(INPUT, 'w-24')}>
            <option value="count">count</option>
            <option value="unique">unique</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={cn(INPUT, 'w-28')}>
            <option value="threshold">threshold</option>
            <option value="anomaly">anomaly</option>
          </select>
          {form.kind === 'threshold' && (
            <>
              <select value={form.op} onChange={(e) => setForm({ ...form, op: e.target.value })} className={cn(INPUT, 'w-16')}>
                <option value="gt">&gt;</option>
                <option value="lt">&lt;</option>
              </select>
              <input type="number" value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                placeholder="value" className={cn(INPUT, 'w-20')} />
            </>
          )}
          <label className="text-[11px] text-zinc-400 flex items-center gap-1">
            window
            <input type="number" min={1} max={90} value={form.window}
              onChange={(e) => setForm({ ...form, window: e.target.value })} className={cn(INPUT, 'w-14')} />
            d
          </label>
          <button onClick={save} disabled={busy || !form.name.trim()} className={BTN}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
            Save alert
          </button>
        </div>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">
          Alerts {alerts.length > 0 && <span className="text-amber-300">· {firing} firing</span>}
        </p>
        {alerts.length === 0 && <Empty text="No alerts configured yet." />}
        <div className="space-y-1.5">
          {alerts.map((a) => (
            <div key={a.id}
              className={cn('rounded border p-2 text-[11px]',
                a.firing ? 'border-red-600/50 bg-red-950/30' : 'border-zinc-800 bg-zinc-950')}>
              <div className="flex items-center gap-2">
                <span className={cn('w-2 h-2 rounded-full flex-shrink-0', a.firing ? 'bg-red-500' : 'bg-zinc-600')} />
                <span className="font-semibold text-zinc-200">{a.name}</span>
                <span className="text-zinc-400">
                  {a.eventName || 'all events'} · {a.metric} · {a.kind}
                </span>
                <button onClick={() => remove(a.id)} aria-label={`Delete ${a.name}`}
                  className="ml-auto text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-zinc-400 mt-1 pl-4">
                value <span className="text-zinc-300">{a.value ?? 0}</span> · {a.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 6. Behavioral cohort builder ──────────────────────────────────────────────

interface CohortResult { includes: string[]; excludes: string[]; size: number; totalUsers: number; pct: number; members: string[] }
interface SavedCohort { id: string; name: string; includes: string[]; excludes: string[]; result: CohortResult }

function CohortBuilder({ eventNames }: { eventNames: string[] }) {
  const [name, setName] = useState('');
  const [includes, setIncludes] = useState('');
  const [excludes, setExcludes] = useState('');
  const [range, setRange] = useState<DateFilter>({ from: '', to: '' });
  const [preview, setPreview] = useState<CohortResult | null>(null);
  const [saved, setSaved] = useState<SavedCohort[]>([]);
  const [busy, setBusy] = useState(false);

  const parse = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  const refresh = useCallback(async () => {
    const r = await lensRun('analytics', 'cohort-list', {});
    if (r.data?.ok) setSaved((r.data.result?.cohorts as SavedCohort[]) || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function buildPreview() {
    const inc = parse(includes), exc = parse(excludes);
    if (inc.length === 0 && exc.length === 0) return;
    setBusy(true);
    const r = await lensRun('analytics', 'cohort-build', {
      includes: inc, excludes: exc,
      from: range.from || undefined, to: range.to || undefined,
    });
    setBusy(false);
    setPreview(r.data?.ok ? (r.data.result as CohortResult) : null);
  }
  async function save() {
    const inc = parse(includes), exc = parse(excludes);
    if (!name.trim() || (inc.length === 0 && exc.length === 0)) return;
    setBusy(true);
    const r = await lensRun('analytics', 'cohort-save', { name: name.trim(), includes: inc, excludes: exc });
    setBusy(false);
    if (r.data?.ok) { setName(''); await refresh(); }
  }
  async function remove(id: string) {
    await lensRun('analytics', 'cohort-delete', { id });
    await refresh();
  }

  return (
    <div className="space-y-3">
      <EventList id="co-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Behavioral cohort — did X but not Y</p>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="cohort name" className={cn(INPUT, 'w-full')} />
        <div className="flex flex-wrap gap-1.5">
          <input list="co-events" value={includes} onChange={(e) => setIncludes(e.target.value)}
            placeholder="did these (comma-separated)" className={cn(INPUT, 'flex-1 min-w-[160px]')} />
          <input list="co-events" value={excludes} onChange={(e) => setExcludes(e.target.value)}
            placeholder="but NOT these" className={cn(INPUT, 'flex-1 min-w-[140px]')} />
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <DateRangeInputs range={range} onChange={setRange} />
          <button onClick={buildPreview} disabled={busy} className={BTN_GHOST}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UsersRound className="w-3 h-3" />}
            Preview
          </button>
          <button onClick={save} disabled={busy || !name.trim()} className={BTN}>
            <Save className="w-3 h-3" />Save cohort
          </button>
        </div>
      </div>

      {preview && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <p className="text-[11px] text-zinc-300">
            <span className="text-amber-300 font-bold text-lg">{preview.size}</span> users
            <span className="text-zinc-400"> of {preview.totalUsers} ({preview.pct}%)</span>
          </p>
          {preview.members.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {preview.members.slice(0, 40).map((m) => (
                <span key={m} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{m}</span>
              ))}
            </div>
          )}
          {preview.size === 0 && <Empty text="No users match this cohort yet." />}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1.5">Saved cohorts</p>
        {saved.length === 0 && <Empty text="No saved cohorts yet." />}
        <div className="space-y-1.5">
          {saved.map((c) => (
            <div key={c.id} className="text-[11px] bg-zinc-950 border border-zinc-800 rounded p-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-zinc-200">{c.name}</span>
                <span className="text-amber-300">{c.result.size} users</span>
                <span className="text-zinc-600">{c.result.pct}%</span>
                <button onClick={() => remove(c.id)} aria-label={`Delete ${c.name}`}
                  className="ml-auto text-zinc-600 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-zinc-400 mt-0.5">
                did {c.includes.join(', ') || '—'}
                {c.excludes.length > 0 && <> · not {c.excludes.join(', ')}</>}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 7. Date-range comparison ──────────────────────────────────────────────────

interface CompareResult {
  eventName: string;
  metric: string;
  current: { from: string; to: string; value: number };
  previous: { from: string; to: string; value: number };
  delta: number;
  pctChange: number;
  direction: string;
}

function RangeCompare({ eventNames }: { eventNames: string[] }) {
  const [eventName, setEventName] = useState('');
  const [metric, setMetric] = useState('count');
  const [current, setCurrent] = useState<DateFilter>({ from: '', to: '' });
  const [previous, setPrevious] = useState<DateFilter>({ from: '', to: '' });
  const [result, setResult] = useState<CompareResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!current.from || !current.to || !previous.from || !previous.to) return;
    setBusy(true);
    const r = await lensRun('analytics', 'range-compare', {
      eventName: eventName.trim() || undefined,
      metric,
      current, previous,
    });
    setBusy(false);
    setResult(r.data?.ok ? (r.data.result as CompareResult) : null);
  }

  return (
    <div className="space-y-3">
      <EventList id="rc-events" names={eventNames} />
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Date-range comparison</p>
        <div className="flex flex-wrap gap-1.5">
          <input list="rc-events" value={eventName} onChange={(e) => setEventName(e.target.value)}
            placeholder="event (blank = all)" className={cn(INPUT, 'flex-1 min-w-[140px]')} />
          <select value={metric} onChange={(e) => setMetric(e.target.value)} className={cn(INPUT, 'w-28')}>
            <option value="count">count</option>
            <option value="unique">unique users</option>
          </select>
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-400">Current period</p>
          <DateRangeInputs range={current} onChange={setCurrent} />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-400">Previous period</p>
          <DateRangeInputs range={previous} onChange={setPrevious} />
        </div>
        <button onClick={run}
          disabled={busy || !current.from || !current.to || !previous.from || !previous.to}
          className={BTN}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CalendarRange className="w-3 h-3" />}
          Compare
        </button>
      </div>

      {result && (
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-center">
              <p className="text-lg font-bold text-zinc-100">{result.previous.value.toLocaleString()}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Previous</p>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-center">
              <p className="text-lg font-bold text-amber-300">{result.current.value.toLocaleString()}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Current</p>
            </div>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-center">
              <p className={cn('text-lg font-bold',
                result.direction === 'up' ? 'text-emerald-400'
                  : result.direction === 'down' ? 'text-red-400' : 'text-zinc-400')}>
                {result.delta >= 0 ? '+' : ''}{result.pctChange}%
              </p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">
                {result.delta >= 0 ? '+' : ''}{result.delta} delta
              </p>
            </div>
          </div>
          <ChartKit kind="bar"
            data={[
              { label: 'Previous', value: result.previous.value },
              { label: 'Current', value: result.current.value },
            ]}
            xKey="label"
            series={[{ key: 'value', label: result.metric, color: '#f59e0b' }]}
            height={150} showLegend={false} />
        </div>
      )}
    </div>
  );
}
