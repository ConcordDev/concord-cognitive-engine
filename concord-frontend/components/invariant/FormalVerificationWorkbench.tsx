'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * FormalVerificationWorkbench — full property-verification surface for the
 * invariant lens. Every panel is wired to a real `server/domains/invariant.js`
 * macro; no mock or seed data. Six tabs map 1:1 to the backlog:
 *   monitor     -> registerMonitor / listMonitors / checkMonitors / set / remove
 *   counter     -> counterexample
 *   templates   -> templates
 *   temporal    -> temporalCheck / recordSnapshot / clearHistory
 *   history     -> violationHistory / resolveViolation
 *   quantified  -> quantifiedCheck
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  Activity, Play, Plus, Pause, Trash2, Loader2, CheckCircle2, XCircle,
  AlertTriangle, Bug, Library, Clock, History, Sigma, Camera, Eraser,
  Wrench, Target,
} from 'lucide-react';

type TabId = 'monitor' | 'counter' | 'templates' | 'temporal' | 'history' | 'quantified';

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'monitor', label: 'Continuous Monitoring', icon: Activity },
  { id: 'counter', label: 'Counterexamples', icon: Bug },
  { id: 'templates', label: 'Library', icon: Library },
  { id: 'temporal', label: 'Temporal Logic', icon: Clock },
  { id: 'history', label: 'Violation History', icon: History },
  { id: 'quantified', label: 'Quantified ∀∃', icon: Sigma },
];

const SEV = ['critical', 'high', 'medium', 'low'];

function sevClass(s: string): string {
  return s === 'critical' ? 'bg-red-500/15 text-red-400'
    : s === 'high' ? 'bg-orange-500/15 text-orange-400'
    : s === 'medium' ? 'bg-yellow-500/15 text-yellow-400'
    : 'bg-blue-500/15 text-blue-400';
}

function parseJsonOr<T>(text: string, fallback: T): { value: T; error: string | null } {
  try { return { value: JSON.parse(text) as T, error: null }; }
  catch (e) { return { value: fallback, error: e instanceof Error ? e.message : 'invalid JSON' }; }
}

export function FormalVerificationWorkbench() {
  const [tab, setTab] = useState<TabId>('monitor');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 border-b border-white/10 pb-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? 'bg-neon-green/15 text-neon-green border border-neon-green/30'
                  : 'text-gray-400 hover:text-white border border-transparent hover:bg-white/5'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'monitor' && <MonitorPanel />}
      {tab === 'counter' && <CounterexamplePanel />}
      {tab === 'templates' && <TemplatesPanel />}
      {tab === 'temporal' && <TemporalPanel />}
      {tab === 'history' && <ViolationHistoryPanel />}
      {tab === 'quantified' && <QuantifiedPanel />}
    </div>
  );
}

/* ───────────────────────────── Monitoring ───────────────────────────── */

interface Monitor {
  id: string;
  name: string;
  expression: string;
  severity: string;
  active: boolean;
  checkCount: number;
  violationCount: number;
  consecutivePasses: number;
  lastResult: string | null;
  lastCheckedAt: string | null;
}

function MonitorPanel() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [stateJson, setStateJson] = useState('{ "balance": 100, "stock": 5 }');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<any>(null);

  const refresh = useCallback(async () => {
    const { data } = await lensRun<any>('invariant', 'listMonitors', {});
    if (data.ok && data.result) setMonitors(data.result.monitors || []);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  const addMonitor = useCallback(async () => {
    if (!name.trim() || !expression.trim()) return;
    setBusy(true); setErr(null);
    const { data } = await lensRun<any>('invariant', 'registerMonitor', { name, expression, severity });
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Failed to register monitor'); return; }
    setName(''); setExpression('');
    await refresh();
  }, [name, expression, severity, refresh]);

  const runTick = useCallback(async () => {
    setBusy(true); setErr(null);
    const { value, error } = parseJsonOr<Record<string, unknown>>(stateJson, {});
    if (error) { setErr(`State must be valid JSON: ${error}`); setBusy(false); return; }
    const { data } = await lensRun<any>('invariant', 'checkMonitors', { state: value });
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Tick failed'); return; }
    setLastTick(data.result);
    await refresh();
  }, [stateJson, refresh]);

  const toggle = useCallback(async (m: Monitor) => {
    await lensRun('invariant', 'setMonitorActive', { monitorId: m.id, active: !m.active });
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (m: Monitor) => {
    await lensRun('invariant', 'removeMonitor', { monitorId: m.id });
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Register an invariant once, then feed substrate-state snapshots to evaluate it across ticks.
        Every violation is captured into the violation history.
      </p>

      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Monitor name"
            className="input-lattice text-sm" />
          <input value={expression} onChange={(e) => setExpression(e.target.value)}
            placeholder="Expression e.g. balance >= 0"
            className="input-lattice text-sm font-mono md:col-span-2" />
        </div>
        <div className="flex items-center gap-2">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className="input-lattice text-sm">
            {SEV.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={addMonitor} disabled={busy || !name.trim() || !expression.trim()}
            className="btn-neon green text-sm flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
            Register Monitor
          </button>
        </div>
      </div>

      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Substrate state snapshot (JSON)</span>
          <button onClick={runTick} disabled={busy || monitors.length === 0}
            className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Run Tick
          </button>
        </div>
        <textarea value={stateJson} onChange={(e) => setStateJson(e.target.value)} rows={3}
          className="input-lattice text-xs font-mono w-full" />
        {lastTick && (
          <div className="flex items-center gap-3 text-xs">
            <span className="text-neon-green">{lastTick.summary.passed} passed</span>
            <span className="text-neon-pink">{lastTick.summary.violations} violations</span>
            <span className="text-yellow-400">{lastTick.summary.errors} errors</span>
            <span className="text-gray-500">@ {new Date(lastTick.checkedAt).toLocaleTimeString()}</span>
          </div>
        )}
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      <div className="space-y-2">
        {monitors.length === 0 && <p className="text-xs text-gray-500">No monitors registered yet.</p>}
        {monitors.map((m) => (
          <div key={m.id} className="bg-lattice-surface rounded-lg p-3 flex items-start gap-3 border border-white/5">
            <span className="mt-0.5">
              {m.lastResult === 'pass' ? <CheckCircle2 className="w-4 h-4 text-neon-green" />
                : m.lastResult === 'violation' ? <XCircle className="w-4 h-4 text-neon-pink" />
                : m.lastResult === 'error' ? <AlertTriangle className="w-4 h-4 text-yellow-400" />
                : <Activity className="w-4 h-4 text-gray-500" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{m.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${sevClass(m.severity)}`}>{m.severity}</span>
                {!m.active && <span className="text-[10px] text-gray-500">paused</span>}
              </div>
              <p className="font-mono text-xs text-gray-400 mt-0.5 truncate">{m.expression}</p>
              <div className="flex items-center gap-3 text-[10px] text-gray-500 mt-1">
                <span>{m.checkCount} checks</span>
                <span className="text-neon-pink">{m.violationCount} violations</span>
                <span className="text-neon-green">{m.consecutivePasses} streak</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => toggle(m)} title={m.active ? 'Pause' : 'Resume'}
                className="p-1 rounded hover:bg-white/10">
                {m.active ? <Pause className="w-3.5 h-3.5 text-gray-400" /> : <Play className="w-3.5 h-3.5 text-neon-green" />}
              </button>
              <button onClick={() => remove(m)} title="Remove" className="p-1 rounded hover:bg-white/10">
                <Trash2 className="w-3.5 h-3.5 text-neon-pink" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Counterexamples ─────────────────────────── */

function CounterexamplePanel() {
  const [expression, setExpression] = useState('age >= 18');
  const [recordsJson, setRecordsJson] = useState(
    '[\n  { "id": "a", "age": 25 },\n  { "id": "b", "age": 12 },\n  { "id": "c", "age": 9 }\n]');
  const [recordKey, setRecordKey] = useState('id');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const { value, error } = parseJsonOr<any[]>(recordsJson, []);
    if (error) { setErr(`Records must be valid JSON array: ${error}`); setBusy(false); return; }
    const { data } = await lensRun<any>('invariant', 'counterexample', {
      expression, records: value, recordKey: recordKey.trim() || undefined,
    });
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Counterexample search failed'); return; }
    setResult(data.result);
  }, [expression, recordsJson, recordKey]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Run a failing invariant against a record set to surface exactly which records — and which
        fields — break it.
      </p>
      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input value={expression} onChange={(e) => setExpression(e.target.value)}
            placeholder="Invariant expression" className="input-lattice text-sm font-mono md:col-span-2" />
          <input value={recordKey} onChange={(e) => setRecordKey(e.target.value)}
            placeholder="Record id field (optional)" className="input-lattice text-sm" />
        </div>
        <textarea value={recordsJson} onChange={(e) => setRecordsJson(e.target.value)} rows={6}
          className="input-lattice text-xs font-mono w-full" placeholder="JSON array of records" />
        <button onClick={run} disabled={busy || !expression.trim()}
          className="btn-neon purple text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bug className="w-3 h-3" />}
          Find Counterexamples
        </button>
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      {result && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-3 border border-white/5">
          <div className="flex items-center gap-3 text-sm">
            <span className={`font-semibold ${result.holds ? 'text-neon-green' : 'text-neon-pink'}`}>
              {result.holds ? 'Invariant holds for all records' : `${result.counterexampleCount} counterexample(s)`}
            </span>
            <span className="text-gray-500 text-xs">{result.recordsChecked} records checked</span>
          </div>
          {result.mostLikelyCause && (
            <div className="flex items-center gap-2 text-xs">
              <Target className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-gray-400">Most likely cause:</span>
              <span className="font-mono text-yellow-400">{result.mostLikelyCause}</span>
            </div>
          )}
          {Array.isArray(result.blameRanking) && result.blameRanking.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {result.blameRanking.map((b: any) => (
                <span key={b.field} className="text-[10px] font-mono bg-lattice-surface rounded px-1.5 py-0.5 text-gray-300">
                  {b.field}: {b.failureCount} fail{b.failureCount !== 1 ? 's' : ''}
                </span>
              ))}
            </div>
          )}
          {Array.isArray(result.counterexamples) && result.counterexamples.length > 0 && (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {result.counterexamples.map((c: any) => (
                <div key={c.index} className="bg-lattice-surface rounded p-2 border border-neon-pink/15">
                  <div className="flex items-center gap-2 text-xs">
                    <XCircle className="w-3.5 h-3.5 text-neon-pink" />
                    <span className="font-mono text-neon-pink">{c.recordId}</span>
                    {c.error && <span className="text-yellow-400 text-[10px]">err: {c.error}</span>}
                  </div>
                  {Array.isArray(c.offendingFields) && c.offendingFields.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-mono text-gray-400">
                      {c.offendingFields.map((f: any) => (
                        <span key={f.field} className="bg-lattice-deep rounded px-1 py-0.5">
                          {f.field}={JSON.stringify(f.value)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────── Templates ──────────────────────────────── */

interface Template {
  id: string;
  category: string;
  name: string;
  description: string;
  kind: string;
  expressionTemplate: string;
  params: string[];
}

function TemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (category?: string) => {
    setBusy(true); setErr(null);
    const { data } = await lensRun<any>('invariant', 'templates', category ? { category } : {});
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Failed to load templates'); return; }
    setTemplates(data.result.templates || []);
    if (data.result.categories) setCategories(data.result.categories);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const pickFilter = useCallback((c: string) => {
    const next = filter === c ? '' : c;
    setFilter(next);
    load(next || undefined);
  }, [filter, load]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        A library of ready-made invariant templates — uniqueness, referential integrity, range
        bounds, presence, conservation laws, and temporal safety/liveness.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {categories.map((c) => (
          <button key={c} onClick={() => pickFilter(c)}
            className={`text-xs rounded px-2 py-1 border capitalize transition-colors ${
              filter === c
                ? 'border-neon-cyan/40 bg-neon-cyan/15 text-neon-cyan'
                : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'}`}>
            {c}
          </button>
        ))}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {templates.map((t) => (
          <div key={t.id} className="bg-lattice-deep rounded-lg p-3 border border-white/5 space-y-1.5">
            <div className="flex items-center gap-2">
              <Library className="w-3.5 h-3.5 text-neon-cyan" />
              <span className="text-sm font-semibold">{t.name}</span>
              <span className="text-[10px] rounded bg-white/5 px-1.5 py-0.5 text-gray-400 capitalize">{t.category}</span>
              <span className="text-[10px] rounded bg-white/5 px-1.5 py-0.5 text-gray-500">{t.kind}</span>
            </div>
            <p className="text-xs text-gray-400">{t.description}</p>
            <code className="block text-[11px] font-mono text-neon-green bg-lattice-surface rounded px-2 py-1">
              {t.expressionTemplate}
            </code>
            <div className="flex flex-wrap gap-1">
              {t.params.map((p) => (
                <span key={p} className="text-[10px] font-mono text-gray-500 bg-lattice-surface rounded px-1 py-0.5">
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Temporal Logic ──────────────────────────── */

interface TraceRow {
  step: number;
  conditionHolds: boolean;
  conditionError: string | null;
  untilHolds?: boolean;
}

function TemporalPanel() {
  const [operator, setOperator] = useState<'always' | 'eventually' | 'until'>('always');
  const [condition, setCondition] = useState('level >= 0');
  const [untilExpr, setUntilExpr] = useState('done == true');
  const [snapshotJson, setSnapshotJson] = useState('{ "level": 5 }');
  const [snapLabel, setSnapLabel] = useState('');
  const [historyLen, setHistoryLen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const record = useCallback(async () => {
    setBusy(true); setErr(null);
    const { value, error } = parseJsonOr<Record<string, unknown>>(snapshotJson, {});
    if (error) { setErr(`Snapshot must be valid JSON: ${error}`); setBusy(false); return; }
    const { data } = await lensRun<any>('invariant', 'recordSnapshot', { state: value, label: snapLabel });
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Failed to record snapshot'); return; }
    setHistoryLen(data.result.historyLength);
    setSnapLabel('');
  }, [snapshotJson, snapLabel]);

  const clear = useCallback(async () => {
    setBusy(true); setErr(null);
    const { data } = await lensRun<any>('invariant', 'clearHistory', {});
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Failed to clear history'); return; }
    setHistoryLen(0);
    setResult(null);
  }, []);

  const check = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const params: Record<string, unknown> = { operator, condition };
    if (operator === 'until') params.until = untilExpr;
    const { data } = await lensRun<any>('invariant', 'temporalCheck', params);
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Temporal check failed'); return; }
    setResult(data.result);
    setHistoryLen(data.result.historyLength);
  }, [operator, condition, untilExpr]);

  const timelineEvents: TimelineEvent[] = useMemo(() => {
    if (!result?.trace) return [];
    return (result.trace as TraceRow[]).map((r) => ({
      id: `step-${r.step}`,
      label: `Step ${r.step}`,
      time: r.step,
      tone: r.conditionError ? 'warn' : r.conditionHolds ? 'good' : 'bad',
      detail: `condition ${r.conditionHolds ? 'holds' : 'fails'}${
        r.untilHolds !== undefined ? ` · until ${r.untilHolds ? 'holds' : 'fails'}` : ''}`,
    }));
  }, [result]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Verify temporal-logic invariants — □ always, ◇ eventually, U until — over a recorded
        history of substrate states.
      </p>

      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="text-xs text-gray-400">Record a state snapshot into the history</div>
        <textarea value={snapshotJson} onChange={(e) => setSnapshotJson(e.target.value)} rows={2}
          className="input-lattice text-xs font-mono w-full" />
        <div className="flex items-center gap-2">
          <input value={snapLabel} onChange={(e) => setSnapLabel(e.target.value)}
            placeholder="Label (optional)" className="input-lattice text-sm flex-1" />
          <button onClick={record} disabled={busy}
            className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
            Record
          </button>
          <button onClick={clear} disabled={busy}
            className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">
            <Eraser className="w-3 h-3" /> Clear
          </button>
        </div>
        {historyLen !== null && (
          <div className="text-[10px] text-gray-500">History length: {historyLen} snapshot(s)</div>
        )}
      </div>

      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="flex items-center gap-2">
          <select value={operator} onChange={(e) => setOperator(e.target.value as any)}
            className="input-lattice text-sm">
            <option value="always">□ always</option>
            <option value="eventually">◇ eventually</option>
            <option value="until">U until</option>
          </select>
          <input value={condition} onChange={(e) => setCondition(e.target.value)}
            placeholder="condition expression" className="input-lattice text-sm font-mono flex-1" />
        </div>
        {operator === 'until' && (
          <input value={untilExpr} onChange={(e) => setUntilExpr(e.target.value)}
            placeholder="until expression" className="input-lattice text-sm font-mono w-full" />
        )}
        <button onClick={check} disabled={busy || !condition.trim()}
          className="btn-neon green text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
          Verify Temporal Invariant
        </button>
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      {result && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-3 border border-white/5">
          <div className="flex items-center gap-3">
            <code className="text-sm font-mono text-neon-cyan">{result.formula}</code>
            <span className={`text-sm font-semibold ${result.holds ? 'text-neon-green' : 'text-neon-pink'}`}>
              {result.holds ? 'HOLDS' : 'VIOLATED'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>{result.historyLength} states</span>
            {result.witnessStep !== null && result.witnessStep !== undefined && (
              <span className="text-neon-green">witness @ step {result.witnessStep}</span>
            )}
            {result.violationStep !== null && result.violationStep !== undefined && (
              <span className="text-neon-pink">violation @ step {result.violationStep}</span>
            )}
          </div>
          {timelineEvents.length > 0 && (
            <div className="bg-lattice-surface rounded p-2">
              <TimelineView events={timelineEvents} height={100} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Violation History ─────────────────────────── */

interface Violation {
  id: string;
  name: string;
  expression: string;
  severity: string;
  status: string;
  detectedAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  resolution?: string;
}

function ViolationHistoryPanel() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setBusy(true); setErr(null);
    const params: Record<string, unknown> = {};
    if (statusFilter === 'open') params.resolved = false;
    if (statusFilter === 'resolved') params.resolved = true;
    const { data } = await lensRun<any>('invariant', 'violationHistory', params);
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Failed to load history'); return; }
    setViolations(data.result.violations || []);
    setSummary(data.result.summary || null);
  }, [statusFilter]);

  useEffect(() => { refresh(); }, [refresh]);

  const resolve = useCallback(async (v: Violation) => {
    const note = window.prompt(`Resolution note for "${v.name}":`, '');
    if (note === null) return;
    setResolving(v.id);
    const { data } = await lensRun('invariant', 'resolveViolation', { violationId: v.id, resolution: note });
    setResolving(null);
    if (!data.ok) { setErr(data.error || 'Failed to resolve'); return; }
    await refresh();
  }, [refresh]);

  const timelineEvents: TimelineEvent[] = useMemo(() =>
    violations.map((v) => ({
      id: v.id,
      label: v.name,
      time: v.detectedAt,
      tone: v.resolved ? 'good' : v.severity === 'critical' || v.severity === 'high' ? 'bad' : 'warn',
      detail: `${v.severity} · ${v.resolved ? 'resolved' : 'open'}`,
    })), [violations]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Every violation detected by a continuous monitor lands here with severity and resolution
        status. Resolve a violation to close it out.
      </p>

      {summary && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-xs">
          {[
            { k: 'total', v: summary.total, c: 'text-gray-300' },
            { k: 'open', v: summary.open, c: 'text-neon-pink' },
            { k: 'resolved', v: summary.resolved, c: 'text-neon-green' },
            { k: 'critical', v: summary.critical, c: 'text-red-400' },
            { k: 'high', v: summary.high, c: 'text-orange-400' },
            { k: 'medium', v: summary.medium, c: 'text-yellow-400' },
          ].map((s) => (
            <div key={s.k} className="bg-lattice-deep rounded p-2 border border-white/5">
              <div className={`text-base font-bold ${s.c}`}>{s.v}</div>
              <div className="text-gray-500 capitalize">{s.k}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        {(['all', 'open', 'resolved'] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`text-xs rounded px-2 py-1 border capitalize transition-colors ${
              statusFilter === s
                ? 'border-neon-cyan/40 bg-neon-cyan/15 text-neon-cyan'
                : 'border-white/10 bg-white/5 text-gray-400 hover:text-white'}`}>
            {s}
          </button>
        ))}
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />}
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      {timelineEvents.length > 0 && (
        <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
          <TimelineView events={timelineEvents} height={100} />
        </div>
      )}

      <div className="space-y-2">
        {violations.length === 0 && !busy && (
          <p className="text-xs text-gray-500">No violations recorded.</p>
        )}
        {violations.map((v) => (
          <div key={v.id} className="bg-lattice-deep rounded-lg p-3 flex items-start gap-3 border border-white/5">
            <span className="mt-0.5">
              {v.resolved ? <CheckCircle2 className="w-4 h-4 text-neon-green" />
                : <AlertTriangle className="w-4 h-4 text-neon-pink" />}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold">{v.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${sevClass(v.severity)}`}>{v.severity}</span>
                <span className="text-[10px] text-gray-500">{v.status}</span>
              </div>
              <p className="font-mono text-xs text-gray-400 mt-0.5 truncate">{v.expression}</p>
              <div className="text-[10px] text-gray-500 mt-1">
                detected {new Date(v.detectedAt).toLocaleString()}
                {v.resolved && v.resolvedAt && ` · resolved ${new Date(v.resolvedAt).toLocaleString()}`}
              </div>
              {v.resolved && v.resolution && (
                <p className="text-[10px] text-neon-green mt-0.5">↳ {v.resolution}</p>
              )}
            </div>
            {!v.resolved && (
              <button onClick={() => resolve(v)} disabled={resolving === v.id}
                className="btn-secondary text-xs flex items-center gap-1 disabled:opacity-50">
                {resolving === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3" />}
                Resolve
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── Quantified Invariants ─────────────────────── */

function QuantifiedPanel() {
  const [quantifier, setQuantifier] = useState<'forall' | 'exists'>('forall');
  const [predicate, setPredicate] = useState('price > 0');
  const [collectionJson, setCollectionJson] = useState(
    '[\n  { "price": 10 },\n  { "price": 0 },\n  { "price": 5 }\n]');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const { value, error } = parseJsonOr<any[]>(collectionJson, []);
    if (error) { setErr(`Collection must be valid JSON array: ${error}`); setBusy(false); return; }
    const { data } = await lensRun<any>('invariant', 'quantifiedCheck', {
      quantifier, predicate, collection: value,
    });
    setBusy(false);
    if (!data.ok) { setErr(data.error || 'Quantified check failed'); return; }
    setResult(data.result);
  }, [quantifier, predicate, collectionJson]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Check ∀ (forall) / ∃ (exists) quantified invariants over a collection. Returns the
        counterexample for ∀ or the witness for ∃.
      </p>

      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-white/5">
        <div className="flex items-center gap-2">
          <select value={quantifier} onChange={(e) => setQuantifier(e.target.value as any)}
            className="input-lattice text-sm">
            <option value="forall">∀ forall</option>
            <option value="exists">∃ exists</option>
          </select>
          <input value={predicate} onChange={(e) => setPredicate(e.target.value)}
            placeholder="predicate expression" className="input-lattice text-sm font-mono flex-1" />
        </div>
        <textarea value={collectionJson} onChange={(e) => setCollectionJson(e.target.value)} rows={6}
          className="input-lattice text-xs font-mono w-full" placeholder="JSON array collection" />
        <button onClick={run} disabled={busy || !predicate.trim()}
          className="btn-neon purple text-sm flex items-center gap-1 disabled:opacity-50">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sigma className="w-3 h-3" />}
          Check Quantified Invariant
        </button>
      </div>

      {err && <div className="text-xs text-neon-pink bg-neon-pink/10 rounded px-2 py-1">{err}</div>}

      {result && (
        <div className="bg-lattice-deep rounded-lg p-3 space-y-3 border border-white/5">
          <div className="flex items-center gap-3">
            <code className="text-sm font-mono text-neon-cyan">{result.formula}</code>
            <span className={`text-sm font-semibold ${result.holds ? 'text-neon-green' : 'text-neon-pink'}`}>
              {result.holds ? 'HOLDS' : 'FAILS'}
            </span>
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-400">
            <span>{result.collectionSize} items</span>
            <span className="text-neon-green">{result.satisfyingCount} satisfying</span>
            <span className="text-neon-pink">{result.failingCount} failing</span>
          </div>
          {result.witness && (
            <div className="bg-lattice-surface rounded p-2 border border-neon-green/15">
              <div className="flex items-center gap-2 text-xs text-neon-green">
                <CheckCircle2 className="w-3.5 h-3.5" /> Witness @ index {result.witness.index}
              </div>
              <pre className="mt-1 text-[10px] font-mono text-gray-400 overflow-x-auto">
                {JSON.stringify(result.witness.item, null, 2)}
              </pre>
            </div>
          )}
          {result.counterexample && (
            <div className="bg-lattice-surface rounded p-2 border border-neon-pink/15">
              <div className="flex items-center gap-2 text-xs text-neon-pink">
                <XCircle className="w-3.5 h-3.5" /> Counterexample @ index {result.counterexample.index}
                {result.counterexample.error && (
                  <span className="text-yellow-400">err: {result.counterexample.error}</span>
                )}
              </div>
              <pre className="mt-1 text-[10px] font-mono text-gray-400 overflow-x-auto">
                {JSON.stringify(result.counterexample.item, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
