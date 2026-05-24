'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Workflows tab: lists saved Zaps, runs them with trace output, schedules
// polling/interval triggers, and shows per-workflow run history with replay.

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Plus, Play, Trash2, ToggleLeft, ToggleRight, Loader2, Clock,
  History, RotateCcw, CheckCircle, Filter, AlertCircle, CalendarClock,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { WorkflowBuilder, type Zap as ZapType } from './WorkflowBuilder';
import { StepTester } from './StepTester';

interface ZapRecord extends ZapType {
  id: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  lastRunAt: string | null;
  enabled: boolean;
}

interface RunRecord {
  id: string;
  zapId: string;
  zapName: string;
  status: 'success' | 'filtered' | 'error';
  startedAt: string;
  durationMs: number;
  attempt: number;
  trace: Array<Record<string, any>>;
}

const STATUS_TONE: Record<string, { cls: string; icon: React.ReactNode }> = {
  success: { cls: 'text-neon-green', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  filtered: { cls: 'text-yellow-400', icon: <Filter className="w-3.5 h-3.5" /> },
  error: { cls: 'text-red-400', icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

export function WorkflowsPanel() {
  const [zaps, setZaps] = useState<ZapRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editing, setEditing] = useState<ZapType | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<{ zapId: string; run: RunRecord } | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [scheduleFor, setScheduleFor] = useState<string | null>(null);
  const [showTester, setShowTester] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ zaps: ZapRecord[] }>('integrations', 'zapList', {});
    if (r.data.ok && r.data.result) setZaps(r.data.result.zaps || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadHistory = useCallback(async (zapId: string) => {
    const r = await lensRun<{ runs: RunRecord[] }>('integrations', 'runHistory', { zapId, limit: 50 });
    if (r.data.ok && r.data.result) setHistory(r.data.result.runs || []);
  }, []);

  const run = async (zap: ZapRecord) => {
    setBusy(zap.id);
    try {
      const r = await lensRun<{ run: RunRecord }>('integrations', 'zapRun', {
        zapId: zap.id,
        triggerData: { priority: 3, tag: 'urgent', message: 'manual test run' },
      });
      if (r.data.ok && r.data.result?.run) setRunResult({ zapId: zap.id, run: r.data.result.run });
      await load();
      if (historyFor === zap.id) await loadHistory(zap.id);
    } finally { setBusy(null); }
  };

  const retry = async (runId: string, zapId: string) => {
    setBusy(runId);
    try {
      const r = await lensRun<{ run: RunRecord }>('integrations', 'retryRun', { runId });
      if (r.data.ok && r.data.result?.run) setRunResult({ zapId, run: r.data.result.run });
      await load();
      await loadHistory(zapId);
    } finally { setBusy(null); }
  };

  const toggle = async (zap: ZapRecord) => {
    setBusy(zap.id);
    try {
      await lensRun('integrations', 'zapToggle', { zapId: zap.id, enabled: !zap.enabled });
      await load();
    } finally { setBusy(null); }
  };

  const remove = async (zapId: string) => {
    setBusy(zapId);
    try {
      await lensRun('integrations', 'zapDelete', { zapId });
      await load();
    } finally { setBusy(null); }
  };

  const openHistory = async (zapId: string) => {
    if (historyFor === zapId) { setHistoryFor(null); return; }
    setHistoryFor(zapId);
    await loadHistory(zapId);
  };

  if (showBuilder) {
    return (
      <WorkflowBuilder
        initial={editing}
        onSaved={async () => { setShowBuilder(false); setEditing(null); await load(); }}
        onCancel={() => { setShowBuilder(false); setEditing(null); }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Multi-step trigger {'→'} action workflows with branching, filters, and transforms.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTester((v) => !v)}
            className="btn-secondary text-sm"
          >
            {showTester ? 'Hide tester' : 'Step tester'}
          </button>
          <button
            onClick={() => { setEditing(null); setShowBuilder(true); }}
            className="btn-primary text-sm flex items-center gap-1"
          >
            <Plus className="w-4 h-4" /> New Workflow
          </button>
        </div>
      </div>

      {showTester && <StepTester />}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 p-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading workflows...
        </div>
      ) : zaps.length === 0 ? (
        <div className="panel p-8 text-center text-gray-400">
          <Zap className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>No workflows yet. Build your first trigger {'→'} action automation.</p>
        </div>
      ) : (
        zaps.map((zap, i) => (
          <motion.div
            key={zap.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="panel p-4 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-neon-purple" /> {zap.name}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  On <span className="text-neon-cyan">{zap.trigger.event}</span> {'→'} {zap.steps.length} step{zap.steps.length !== 1 ? 's' : ''}
                  {zap.schedule && (
                    <span className="ml-2 text-yellow-400">
                      <CalendarClock className="w-3 h-3 inline" /> {zap.schedule.kind}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {zap.runCount} runs · {zap.successCount} ok · {zap.failureCount} failed
                  {zap.lastRunAt && ` · last ${new Date(zap.lastRunAt).toLocaleString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => run(zap)} disabled={busy === zap.id}
                  className="btn-secondary text-xs flex items-center gap-1 px-2 py-1">
                  {busy === zap.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Run
                </button>
                <button onClick={() => setScheduleFor(scheduleFor === zap.id ? null : zap.id)}
                  className="text-gray-400 hover:text-yellow-400 text-xs flex items-center gap-1"
                  title="Schedule">
                  <Clock className="w-3.5 h-3.5" /> Schedule
                </button>
                <button onClick={() => openHistory(zap.id)}
                  className="text-gray-400 hover:text-neon-cyan text-xs flex items-center gap-1"
                  title="Run history">
                  <History className="w-3.5 h-3.5" /> History
                </button>
                <button onClick={() => { setEditing(zap); setShowBuilder(true); }}
                  className="text-gray-400 hover:text-white text-xs">Edit</button>
                <button onClick={() => toggle(zap)} disabled={busy === zap.id} aria-label="Toggle workflow"
                  className="text-gray-400 hover:text-white disabled:opacity-40">
                  {zap.enabled ? <ToggleRight className="w-6 h-6 text-green-500" /> : <ToggleLeft className="w-6 h-6" />}
                </button>
                <button onClick={() => remove(zap.id)} disabled={busy === zap.id} aria-label="Delete workflow"
                  className="text-gray-400 hover:text-red-400 disabled:opacity-40">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>

            {scheduleFor === zap.id && (
              <SchedulePanel
                zapId={zap.id}
                current={zap.schedule}
                onDone={async () => { setScheduleFor(null); await load(); }}
              />
            )}

            {runResult?.zapId === zap.id && (
              <RunTrace run={runResult.run} />
            )}

            {historyFor === zap.id && (
              <div className="border-t border-lattice-border pt-2 space-y-1">
                <div className="text-xs font-semibold text-gray-300 flex items-center gap-1">
                  <History className="w-3 h-3" /> Run history
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-gray-400">No runs recorded yet.</p>
                ) : (
                  history.map((rec) => {
                    const tone = STATUS_TONE[rec.status];
                    return (
                      <div key={rec.id} className="flex items-center justify-between bg-lattice-surface rounded px-2 py-1.5 text-xs">
                        <span className={`flex items-center gap-1 ${tone.cls}`}>{tone.icon} {rec.status}</span>
                        <span className="text-gray-400">attempt {rec.attempt}</span>
                        <span className="text-gray-400">{rec.durationMs}ms</span>
                        <span className="text-gray-400">{new Date(rec.startedAt).toLocaleString()}</span>
                        <button onClick={() => retry(rec.id, zap.id)} disabled={busy === rec.id}
                          className="text-neon-cyan hover:underline flex items-center gap-0.5 disabled:opacity-40">
                          {busy === rec.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Replay
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </motion.div>
        ))
      )}
    </div>
  );
}

function RunTrace({ run }: { run: RunRecord }) {
  const tone = STATUS_TONE[run.status];
  const events: TimelineEvent[] = run.trace.map((t, i) => ({
    id: `t${i}`,
    label: String(t.kind),
    time: i,
    tone: t.kind === 'error' ? 'bad' : t.kind === 'filter' && t.passed === false ? 'warn' : 'good',
    detail: JSON.stringify(t),
  }));
  return (
    <div className="border-t border-lattice-border pt-2 space-y-2">
      <div className={`text-xs font-semibold flex items-center gap-1 ${tone.cls}`}>
        {tone.icon} Run {run.status} · {run.durationMs}ms · attempt {run.attempt}
      </div>
      <TimelineView events={events} height={70} />
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {run.trace.map((t, i) => (
          <div key={i} className="bg-lattice-deep rounded px-2 py-1 text-[11px] font-mono text-gray-300">
            <span className="text-neon-cyan">{String(t.kind)}</span>
            {t.condition && <span className="text-yellow-400"> · {String(t.condition)} = {String(t.passed)}</span>}
            {t.branchLabel && <span className="text-neon-purple"> {'→'} {String(t.branchLabel)}</span>}
            {t.op && <span className="text-gray-400"> · {String(t.op)} = {JSON.stringify(t.output)}</span>}
            {t.actionId && <span className="text-neon-green"> · {String(t.actionId)}</span>}
            {t.expression && <span className="text-blue-400"> · {String(t.expression)} = {JSON.stringify(t.output)}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SchedulePanel({
  zapId, current, onDone,
}: {
  zapId: string;
  current?: ZapType['schedule'];
  onDone: () => void;
}) {
  const [kind, setKind] = useState(current?.kind ?? 'interval');
  const [intervalSeconds, setIntervalSeconds] = useState(current?.intervalSeconds ?? 3600);
  const [timeOfDay, setTimeOfDay] = useState(current?.timeOfDay ?? '09:00');
  const [dayOfWeek, setDayOfWeek] = useState(current?.dayOfWeek ?? 1);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await lensRun('integrations', 'scheduleSet', { zapId, kind, intervalSeconds, timeOfDay, dayOfWeek });
      onDone();
    } finally { setSaving(false); }
  };
  const clear = async () => {
    setSaving(true);
    try {
      await lensRun('integrations', 'scheduleClear', { zapId });
      onDone();
    } finally { setSaving(false); }
  };

  return (
    <div className="border-t border-lattice-border pt-2 space-y-2">
      <div className="text-xs font-semibold text-yellow-400 flex items-center gap-1">
        <CalendarClock className="w-3.5 h-3.5" /> Scheduled / polling trigger
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)}
          className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs">
          <option value="interval">Interval</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="poll">Poll URL</option>
        </select>
        {(kind === 'interval' || kind === 'poll') && (
          <label className="text-xs text-gray-400 flex items-center gap-1">
            every
            <input type="number" min={60} value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(Number(e.target.value))}
              className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" />
            s
          </label>
        )}
        {(kind === 'daily' || kind === 'weekly') && (
          <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}
            className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" />
        )}
        {kind === 'weekly' && (
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}
            className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-xs">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, idx) => (
              <option key={d} value={idx}>{d}</option>
            ))}
          </select>
        )}
      </div>
      {current?.nextFireAt && (
        <p className="text-[11px] text-gray-400">Next fire: {new Date(current.nextFireAt).toLocaleString()}</p>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="btn-primary text-xs flex items-center gap-1">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />} Save schedule
        </button>
        {current && (
          <button onClick={clear} disabled={saving} className="btn-secondary text-xs">Clear</button>
        )}
      </div>
    </div>
  );
}
