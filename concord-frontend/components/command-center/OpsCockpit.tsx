'use client';

/**
 * OpsCockpit — Datadog/PagerDuty-shape operations cockpit for the
 * command-center lens. Surfaces the seven feature-parity backlog items:
 * time-series vital history, alerting rules + acknowledgement, saved
 * dashboards, incident timeline + postmortems, cross-vital correlation,
 * an at-a-glance health rollup, and one-click runbook remediation.
 *
 * Every record is real operator input or computed from it — no seed data.
 * Empty states say "no data yet".
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { TimelineView, type TimelineEvent } from '@/components/viz/TimelineView';
import {
  Activity, AlertTriangle, BarChart3, GitBranch, LayoutDashboard,
  Network, Play, Plus, ShieldCheck, Trash2, Check, BellOff, FileText,
} from 'lucide-react';

// ── Domain types ─────────────────────────────────────────────────────────────

interface VitalPoint { t: number; v: number }
interface VitalMetric { metric: string; pointCount: number; latest: number | null; latestAt: string | null }
interface AlertRule {
  id: string; name: string; metric: string; comparator: string; threshold: number;
  severity: string; onCall: string | null; muted: boolean; state: string;
  acknowledged: boolean; fireCount: number; lastValue: number | null; lastFiredAt: string | null;
}
interface Dashboard { id: string; name: string; widgets: unknown[]; updatedAt: string }
interface IncidentUpdate { id: string; status: string; message: string; at: string; by: string }
interface Postmortem { summary: string; rootCause: string | null; actionItems: string[]; writtenAt: string }
interface Incident {
  id: string; title: string; severity: string; status: string; openedAt: string;
  resolvedAt: string | null; updates: IncidentUpdate[]; postmortem: Postmortem | null;
}
interface CorrelationPair {
  metricA: string; metricB: string; coefficient: number; strength: string;
  direction: string; samples: number;
}
interface HealthBreach {
  ruleId: string; name: string; metric: string; value: number; threshold: number;
  severity: string; acknowledged: boolean; color: string;
}
interface MetricStatus { metric: string; value: number; color: string }
interface HealthRollup {
  score: number; verdict: string; label: string; breaches: HealthBreach[];
  breachCount: number; openIncidents: number; metricStatus: MetricStatus[];
  monitoredMetrics: number; activeRules: number;
}
interface RunbookStep { label: string; action: string }
interface RunbookExecution { id: string; finishedAt: string; stepCount: number; triggeredBy: string }
interface Runbook {
  id: string; name: string; trigger: string | null; steps: RunbookStep[];
  runCount: number; lastRunAt: string | null; executions: RunbookExecution[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<string, string> = {
  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  low: 'text-sky-400 bg-sky-500/10 border-sky-500/30',
};
const DOT: Record<string, string> = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400' };

async function run<T>(macro: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('command-center', macro, params);
  return r.data?.ok ? r.data.result : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-cyan-600/70">
      {label}
      {children}
    </label>
  );
}

const inputCls =
  'bg-[#0a0f18] border border-cyan-900/30 rounded-md px-2 py-1.5 text-sm text-cyan-50 ' +
  'placeholder-cyan-800/50 focus:outline-none focus:border-cyan-600/50';

// ── 6 — Health rollup banner ─────────────────────────────────────────────────

function HealthBanner({ health }: { health: HealthRollup | null }) {
  if (!health) return null;
  const tone =
    health.verdict === 'green' ? 'border-emerald-500/30 bg-emerald-500/5'
    : health.verdict === 'amber' ? 'border-amber-500/30 bg-amber-500/5'
    : 'border-red-500/30 bg-red-500/5';
  const ring =
    health.verdict === 'green' ? 'text-emerald-400'
    : health.verdict === 'amber' ? 'text-amber-400' : 'text-red-400';
  return (
    <div className={`rounded-xl border ${tone} p-4 flex items-center gap-4`}>
      <div className="flex flex-col items-center">
        <span className={`text-3xl font-mono font-bold ${ring}`}>{health.score}</span>
        <span className="text-[10px] uppercase tracking-wider text-cyan-600/60">health</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold capitalize ${ring}`}>{health.label}</p>
        <p className="text-xs text-cyan-600/60">
          {health.monitoredMetrics} metrics · {health.activeRules} active rules ·{' '}
          {health.breachCount} breaching · {health.openIncidents} open incidents
        </p>
        {health.metricStatus.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {health.metricStatus.map((m) => (
              <span
                key={m.metric}
                className="flex items-center gap-1 text-[10px] text-cyan-300/80 bg-[#0a0f18] border border-cyan-900/30 rounded-full px-2 py-0.5"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${DOT[m.color]}`} />
                {m.metric} {m.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 1 — Time-series vitals ───────────────────────────────────────────────────

function VitalsSection({ onChange }: { onChange: () => void }) {
  const [metrics, setMetrics] = useState<VitalMetric[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [points, setPoints] = useState<VitalPoint[]>([]);
  const [metric, setMetric] = useState('');
  const [value, setValue] = useState('');

  const loadMetrics = useCallback(async () => {
    const r = await run<{ metrics: VitalMetric[] }>('vitalMetrics');
    setMetrics(r?.metrics ?? []);
  }, []);

  const loadHistory = useCallback(async (m: string) => {
    if (!m) { setPoints([]); return; }
    const r = await run<{ points: VitalPoint[] }>('vitalHistory', { metric: m, windowMinutes: 1440 });
    setPoints(r?.points ?? []);
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  useEffect(() => { loadHistory(selected); }, [selected, loadHistory]);

  const record = useCallback(async () => {
    if (!metric.trim() || value.trim() === '') return;
    const r = await run('recordVital', { metric: metric.trim(), value: Number(value) });
    if (r) {
      setValue('');
      await loadMetrics();
      if (selected === metric.trim()) await loadHistory(selected);
      else setSelected(metric.trim());
      onChange();
    }
  }, [metric, value, selected, loadMetrics, loadHistory, onChange]);

  const chartData = points.map((p) => ({
    t: new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    v: p.v,
  }));

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <BarChart3 className="w-3.5 h-3.5" /> Vital Time-Series
      </h4>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Metric name">
          <input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. heap_mb" />
        </Field>
        <Field label="Value">
          <input className={`${inputCls} w-24`} type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0" />
        </Field>
        <button
          onClick={record}
          disabled={!metric.trim() || value.trim() === ''}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Record
        </button>
      </div>

      {metrics.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No vitals recorded yet — record a metric point above.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((m) => (
              <button
                key={m.metric}
                onClick={() => setSelected(m.metric)}
                className={`text-[11px] rounded-full px-2.5 py-1 border transition-colors ${
                  selected === m.metric
                    ? 'border-cyan-500/50 text-cyan-300 bg-cyan-500/10'
                    : 'border-cyan-900/30 text-cyan-600/70 hover:text-cyan-400'
                }`}
              >
                {m.metric} <span className="text-cyan-700/50">({m.pointCount})</span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-2">
              <ChartKit kind="area" data={chartData} xKey="t" series={[{ key: 'v', label: selected }]} height={200} showLegend={false} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── 2 — Alerting rules ───────────────────────────────────────────────────────

function AlertsSection({ onChange }: { onChange: () => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [name, setName] = useState('');
  const [metric, setMetric] = useState('');
  const [comparator, setComparator] = useState('gt');
  const [threshold, setThreshold] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [onCall, setOnCall] = useState('');

  const load = useCallback(async () => {
    const r = await run<{ rules: AlertRule[] }>('listAlertRules');
    setRules(r?.rules ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!name.trim() || !metric.trim() || threshold.trim() === '') return;
    const r = await run('createAlertRule', {
      name: name.trim(), metric: metric.trim(), comparator,
      threshold: Number(threshold), severity, onCall: onCall.trim(),
    });
    if (r) { setName(''); setMetric(''); setThreshold(''); setOnCall(''); await load(); onChange(); }
  }, [name, metric, comparator, threshold, severity, onCall, load, onChange]);

  const act = useCallback(async (macro: string, params: Record<string, unknown>) => {
    await run(macro, params); await load(); onChange();
  }, [load, onChange]);

  const CMP: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' };

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5" /> Alert Rules
      </h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
        <Field label="Rule name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Heap high" /></Field>
        <Field label="Metric"><input className={inputCls} value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="heap_mb" /></Field>
        <Field label="Condition">
          <div className="flex gap-1">
            <select className={`${inputCls} flex-shrink-0`} value={comparator} onChange={(e) => setComparator(e.target.value)}>
              {Object.entries(CMP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input className={`${inputCls} w-full`} type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="100" />
          </div>
        </Field>
        <Field label="Severity">
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="On-call (optional)"><input className={inputCls} value={onCall} onChange={(e) => setOnCall(e.target.value)} placeholder="team-sre" /></Field>
        <div className="flex items-end">
          <button
            onClick={create}
            disabled={!name.trim() || !metric.trim() || threshold.trim() === ''}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" /> Add Rule
          </button>
        </div>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No alert rules yet — define one to monitor a vital.</p>
      ) : (
        <div className="space-y-1.5">
          {rules.map((r) => (
            <div
              key={r.id}
              className={`rounded-lg border p-2.5 ${
                r.state === 'breaching' ? 'border-red-500/30 bg-red-500/5' : 'border-cyan-900/25 bg-[#0a0f18]'
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[r.severity]}`}>{r.severity}</span>
                <span className="text-sm text-cyan-50 font-medium">{r.name}</span>
                <span className="text-xs text-cyan-600/60 font-mono">
                  {r.metric} {CMP[r.comparator]} {r.threshold}
                </span>
                {r.muted && <span className="text-[10px] text-cyan-700/60">muted</span>}
                {r.state === 'breaching' && (
                  <span className="text-[10px] text-red-400 ml-auto">
                    BREACHING (val {r.lastValue}) · fired {r.fireCount}×
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                {r.onCall && <span className="text-[10px] text-cyan-600/60">page: {r.onCall}</span>}
                {r.state === 'breaching' && !r.acknowledged && (
                  <button
                    onClick={() => act('acknowledgeAlert', { ruleId: r.id })}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                  >
                    <Check className="w-3 h-3" /> Acknowledge
                  </button>
                )}
                {r.acknowledged && r.state === 'breaching' && (
                  <span className="text-[10px] text-emerald-400">acknowledged</span>
                )}
                <button
                  onClick={() => act('muteAlertRule', { ruleId: r.id, muted: !r.muted })}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-900/40 hover:bg-cyan-900/50"
                >
                  <BellOff className="w-3 h-3" /> {r.muted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  onClick={() => act('deleteAlertRule', { ruleId: r.id })}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 ml-auto"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 4 — Incident timeline ────────────────────────────────────────────────────

function IncidentsSection({ onChange }: { onChange: () => void }) {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [mttr, setMttr] = useState<number | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [updMsg, setUpdMsg] = useState('');
  const [updStatus, setUpdStatus] = useState('investigating');
  const [pmSummary, setPmSummary] = useState('');
  const [pmCause, setPmCause] = useState('');

  const load = useCallback(async () => {
    const r = await run<{ incidents: Incident[]; mttrMinutes: number | null; openCount: number }>('listIncidents');
    setIncidents(r?.incidents ?? []);
    setMttr(r?.mttrMinutes ?? null);
    setOpenCount(r?.openCount ?? 0);
  }, []);
  useEffect(() => { load(); }, [load]);

  const open = useCallback(async () => {
    if (!title.trim()) return;
    const r = await run('openIncident', { title: title.trim(), severity, description: description.trim() });
    if (r) { setTitle(''); setDescription(''); await load(); onChange(); }
  }, [title, severity, description, load, onChange]);

  const addUpdate = useCallback(async (id: string) => {
    if (!updMsg.trim()) return;
    const r = await run('updateIncident', { incidentId: id, message: updMsg.trim(), status: updStatus });
    if (r) { setUpdMsg(''); await load(); onChange(); }
  }, [updMsg, updStatus, load, onChange]);

  const savePm = useCallback(async (id: string) => {
    if (!pmSummary.trim()) return;
    const r = await run('writePostmortem', { incidentId: id, summary: pmSummary.trim(), rootCause: pmCause.trim() });
    if (r) { setPmSummary(''); setPmCause(''); await load(); onChange(); }
  }, [pmSummary, pmCause, load, onChange]);

  const STATUS_TONE: Record<string, TimelineEvent['tone']> = {
    investigating: 'warn', identified: 'info', monitoring: 'default', resolved: 'good',
  };

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <Activity className="w-3.5 h-3.5" /> Incidents
        <span className="text-cyan-700/50 normal-case font-normal">
          {openCount} open{mttr != null ? ` · MTTR ${mttr}m` : ''}
        </span>
      </h4>
      <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
        <Field label="Title"><input className={`${inputCls} w-48`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="DB latency spike" /></Field>
        <Field label="Severity">
          <select className={inputCls} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Description"><input className={`${inputCls} w-56`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="initial summary" /></Field>
        <button
          onClick={open}
          disabled={!title.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-red-500/15 text-red-300 border border-red-500/30 hover:bg-red-500/25 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Open Incident
        </button>
      </div>

      {incidents.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No incidents — open one above when something breaks.</p>
      ) : (
        <div className="space-y-1.5">
          {incidents.map((inc) => {
            const isOpen = active === inc.id;
            return (
              <div key={inc.id} className="rounded-lg border border-cyan-900/25 bg-[#0a0f18]">
                <button
                  onClick={() => setActive(isOpen ? null : inc.id)}
                  className="w-full flex items-center gap-2 p-2.5 text-left"
                >
                  <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${SEV_COLOR[inc.severity]}`}>{inc.severity}</span>
                  <span className="text-sm text-cyan-50 font-medium flex-1 truncate">{inc.title}</span>
                  <span className={`text-[10px] capitalize ${inc.status === 'resolved' ? 'text-emerald-400' : 'text-amber-400'}`}>{inc.status}</span>
                </button>
                {isOpen && (
                  <div className="px-2.5 pb-3 space-y-3 border-t border-cyan-900/20 pt-3">
                    <TimelineView
                      events={inc.updates.map((u) => ({
                        id: u.id, label: u.status, time: u.at, tone: STATUS_TONE[u.status], detail: u.message,
                      }))}
                      height={90}
                    />
                    <div className="space-y-1.5">
                      {inc.updates.map((u) => (
                        <div key={u.id} className="text-[11px] bg-[#070b10] rounded p-2 border border-cyan-900/20">
                          <span className="text-cyan-400 capitalize">{u.status}</span>
                          <span className="text-cyan-700/50 ml-2">{new Date(u.at).toLocaleString()}</span>
                          <p className="text-cyan-300/80 mt-0.5">{u.message}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <Field label="Status update">
                        <select className={inputCls} value={updStatus} onChange={(e) => setUpdStatus(e.target.value)}>
                          {['investigating', 'identified', 'monitoring', 'resolved'].map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </Field>
                      <input className={`${inputCls} flex-1 min-w-[12rem]`} value={updMsg} onChange={(e) => setUpdMsg(e.target.value)} placeholder="what changed…" />
                      <button
                        onClick={() => addUpdate(inc.id)}
                        disabled={!updMsg.trim()}
                        className="px-3 py-1.5 rounded-md text-xs bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
                      >
                        Post Update
                      </button>
                    </div>
                    {inc.postmortem ? (
                      <div className="bg-[#070b10] rounded-lg p-2.5 border border-purple-500/20">
                        <p className="text-[10px] uppercase tracking-wider text-purple-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" /> Postmortem
                        </p>
                        <p className="text-xs text-cyan-200/90 mt-1">{inc.postmortem.summary}</p>
                        {inc.postmortem.rootCause && (
                          <p className="text-[11px] text-cyan-500/70 mt-1">Root cause: {inc.postmortem.rootCause}</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-purple-400">Write Postmortem</p>
                        <textarea className={`${inputCls} w-full h-16 resize-none`} value={pmSummary} onChange={(e) => setPmSummary(e.target.value)} placeholder="summary of the incident…" />
                        <input className={`${inputCls} w-full`} value={pmCause} onChange={(e) => setPmCause(e.target.value)} placeholder="root cause (optional)" />
                        <button
                          onClick={() => savePm(inc.id)}
                          disabled={!pmSummary.trim()}
                          className="px-3 py-1.5 rounded-md text-xs bg-purple-500/15 text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 disabled:opacity-40"
                        >
                          Save Postmortem
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ── 5 — Cross-vital correlation ──────────────────────────────────────────────

function CorrelationSection() {
  const [pairs, setPairs] = useState<CorrelationPair[]>([]);
  const [analyzed, setAnalyzed] = useState<number | null>(null);

  const analyze = useCallback(async () => {
    const r = await run<{ pairs: CorrelationPair[]; metricsAnalyzed: number }>('correlateVitals', { windowMinutes: 1440 });
    setPairs(r?.pairs ?? []);
    setAnalyzed(r?.metricsAnalyzed ?? 0);
  }, []);

  const STRENGTH: Record<string, string> = {
    strong: 'text-cyan-300', moderate: 'text-cyan-500/80', weak: 'text-cyan-700/60',
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
          <Network className="w-3.5 h-3.5" /> Cross-Vital Correlation
        </h4>
        <button
          onClick={analyze}
          className="text-xs px-2.5 py-1 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25"
        >
          Analyze
        </button>
      </div>
      {analyzed == null ? (
        <p className="text-xs text-cyan-700/50 py-3">Run analyze to find vitals that move together.</p>
      ) : pairs.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">
          No correlations found across {analyzed} metric{analyzed !== 1 ? 's' : ''} — needs at least 3 overlapping points per pair.
        </p>
      ) : (
        <div className="space-y-1.5">
          {pairs.map((p) => (
            <div key={`${p.metricA}-${p.metricB}`} className="flex items-center gap-2 text-xs bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
              <span className="text-cyan-100 font-mono">{p.metricA}</span>
              <span className="text-cyan-700/50">{p.direction === 'positive' ? '↗' : '↘'}</span>
              <span className="text-cyan-100 font-mono">{p.metricB}</span>
              <span className={`ml-auto font-mono ${STRENGTH[p.strength]}`}>r = {p.coefficient}</span>
              <span className={`text-[10px] uppercase ${STRENGTH[p.strength]}`}>{p.strength}</span>
              <span className="text-[10px] text-cyan-700/50">{p.samples} pts</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 3 — Saved dashboards ─────────────────────────────────────────────────────

function DashboardsSection() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [name, setName] = useState('');
  const [widgetText, setWidgetText] = useState('');

  const load = useCallback(async () => {
    const r = await run<{ dashboards: Dashboard[] }>('listDashboards');
    setDashboards(r?.dashboards ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    if (!name.trim()) return;
    const widgets = widgetText
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean)
      .map((w) => ({ type: 'panel', id: w }));
    const r = await run('saveDashboard', { name: name.trim(), widgets });
    if (r) { setName(''); setWidgetText(''); await load(); }
  }, [name, widgetText, load]);

  const remove = useCallback(async (id: string) => {
    await run('deleteDashboard', { dashboardId: id }); await load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <LayoutDashboard className="w-3.5 h-3.5" /> Saved Dashboards
      </h4>
      <div className="flex flex-wrap items-end gap-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
        <Field label="Dashboard name"><input className={`${inputCls} w-44`} value={name} onChange={(e) => setName(e.target.value)} placeholder="SRE morning view" /></Field>
        <Field label="Panels (comma-separated)"><input className={`${inputCls} w-64`} value={widgetText} onChange={(e) => setWidgetText(e.target.value)} placeholder="vitals, alerts, incidents" /></Field>
        <button
          onClick={save}
          disabled={!name.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Save Layout
        </button>
      </div>
      {dashboards.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No saved dashboards yet — capture a layout above.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {dashboards.map((d) => (
            <div key={d.id} className="bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-cyan-50 font-medium flex-1 truncate">{d.name}</span>
                <button
                  onClick={() => remove(d.id)}
                  className="text-cyan-700/60 hover:text-red-400"
                  aria-label="Delete dashboard"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-cyan-600/60 mt-1">{d.widgets.length} panel{d.widgets.length !== 1 ? 's' : ''}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 7 — Runbooks ─────────────────────────────────────────────────────────────

function RunbooksSection() {
  const [runbooks, setRunbooks] = useState<Runbook[]>([]);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [lastRun, setLastRun] = useState<{ id: string; count: number } | null>(null);

  const load = useCallback(async () => {
    const r = await run<{ runbooks: Runbook[] }>('listRunbooks');
    setRunbooks(r?.runbooks ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    const steps = stepsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => ({ label: l, action: 'noop' }));
    if (!name.trim() || steps.length === 0) return;
    const r = await run('saveRunbook', { name: name.trim(), trigger: trigger.trim(), steps });
    if (r) { setName(''); setTrigger(''); setStepsText(''); await load(); }
  }, [name, trigger, stepsText, load]);

  const exec = useCallback(async (id: string) => {
    const r = await run<{ runbook: { runCount: number } }>('runRunbook', { runbookId: id });
    if (r) { setLastRun({ id, count: r.runbook.runCount }); await load(); }
  }, [load]);

  const remove = useCallback(async (id: string) => {
    await run('deleteRunbook', { runbookId: id }); await load();
  }, [load]);

  return (
    <section className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-500/70 flex items-center gap-2">
        <GitBranch className="w-3.5 h-3.5" /> Remediation Runbooks
      </h4>
      <div className="space-y-2 bg-[#0a0f18] rounded-lg border border-cyan-900/20 p-3">
        <div className="flex flex-wrap gap-2">
          <Field label="Runbook name"><input className={`${inputCls} w-44`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Restart stuck worker" /></Field>
          <Field label="Trigger (optional)"><input className={`${inputCls} w-48`} value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="queue depth > 1000" /></Field>
        </div>
        <Field label="Steps (one per line)">
          <textarea className={`${inputCls} w-full h-20 resize-none`} value={stepsText} onChange={(e) => setStepsText(e.target.value)} placeholder={'drain queue\nrestart worker\nverify health'} />
        </Field>
        <button
          onClick={save}
          disabled={!name.trim() || !stepsText.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/25 disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" /> Save Runbook
        </button>
      </div>
      {runbooks.length === 0 ? (
        <p className="text-xs text-cyan-700/50 py-3">No runbooks yet — author one for one-click remediation.</p>
      ) : (
        <div className="space-y-1.5">
          {runbooks.map((rb) => (
            <div key={rb.id} className="bg-[#0a0f18] rounded-lg border border-cyan-900/25 p-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-sm text-cyan-50 font-medium">{rb.name}</span>
                {rb.trigger && <span className="text-[10px] text-cyan-600/60 font-mono">{rb.trigger}</span>}
                <span className="text-[10px] text-cyan-700/50 ml-auto">
                  {rb.steps.length} steps · run {rb.runCount}×
                </span>
                <button
                  onClick={() => exec(rb.id)}
                  className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                >
                  <Play className="w-3 h-3" /> Run
                </button>
                <button
                  onClick={() => remove(rb.id)}
                  className="text-cyan-700/60 hover:text-red-400"
                  aria-label="Delete runbook"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <ol className="mt-1.5 ml-5 list-decimal text-[11px] text-cyan-400/70 space-y-0.5">
                {rb.steps.map((s, i) => <li key={i}>{s.label}</li>)}
              </ol>
              {lastRun?.id === rb.id && (
                <p className="text-[10px] text-emerald-400 mt-1">Executed — {lastRun.count} total runs.</p>
              )}
              {rb.executions.length > 0 && (
                <p className="text-[10px] text-cyan-700/50 mt-1">
                  Last run {rb.lastRunAt ? new Date(rb.lastRunAt).toLocaleString() : '—'}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Cockpit shell ────────────────────────────────────────────────────────────

export function OpsCockpit() {
  const [health, setHealth] = useState<HealthRollup | null>(null);

  const refreshHealth = useCallback(async () => {
    const r = await run<HealthRollup>('healthRollup');
    setHealth(r);
  }, []);
  useEffect(() => { refreshHealth(); }, [refreshHealth]);

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Ops Cockpit</h3>
      <HealthBanner health={health} />
      <VitalsSection onChange={refreshHealth} />
      <AlertsSection onChange={refreshHealth} />
      <IncidentsSection onChange={refreshHealth} />
      <CorrelationSection />
      <DashboardsSection />
      <RunbooksSection />
    </div>
  );
}
