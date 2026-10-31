'use client';

/**
 * GoalsAnalyticsTools — real ad-hoc calculators over the goals domain's three
 * analytical macros: okrScoring, goalDecomposition, progressForecast.
 *
 * Replaces a dead panel: the previous UI ran these via `useRunArtifact`
 * against the first personal "goal" artifact's id, which reads
 * `artifact.data.objectives` / `.data.goals` / `.data.history` — fields the
 * personal goal-tracker artifact never has (it stores title/description/
 * category/subtasks/xp instead). Every click silently returned "No
 * objectives provided." / "No goals provided." / "Need at least 2 data
 * points" forever — a real macro, wired to a button, that could never
 * produce output.
 *
 * These three macros are genuinely ad-hoc calculators (POST /api/lens/run
 * builds a *virtual* artifact whose .data IS the input body — confirmed at
 * server.js:39566), so the honest fix is a real input form per tool rather
 * than trying to force-fit the personal goal-tracker's shape. Progress
 * Forecast additionally pulls its history from real, already-persisted
 * check-in data (the `checkin` macro backing the OKR Workspace's Check-ins
 * tab) instead of asking the user to retype numbers that already exist.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Target, GitBranch, TrendingUp, Loader2, Plus, Trash2, ChevronDown, ChevronUp,
} from 'lucide-react';

// §9 fix: the forecast keys on the objective's real id (obj_N), which
// is displayed nowhere in the lens — the free-text id field it used to
// show could never be filled in correctly, so the forecast read an
// empty series for every human entry. It now binds to the caller's
// own objective list, like the OKR workspace forms (same fix there).
interface ObjectiveOption { id: string; title: string; keyResults: string[]; progress: number | null; }

function useObjectiveOptions(): ObjectiveOption[] {
  const [objectives, setObjectives] = useState<ObjectiveOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('goals', 'alignmentTree', { op: 'list' });
      if (!cancelled && r.data?.ok && r.data.result) {
        setObjectives((r.data.result.flat || []).map((o) => ({
          id: o.id, title: o.title, keyResults: o.keyResults || [], progress: o.progress ?? null,
        })));
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return objectives;
}

const inputCls = 'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-white placeholder:text-zinc-600';
const btnCls = 'flex items-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-200 hover:border-cyan-500/40 hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40';

// --------------- Shared collapsible shell ---------------

function ToolCard({ icon: Icon, color, title, desc, children }: { icon: typeof Target; color: string; title: string; desc: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 p-3 text-left">
        <Icon className={`h-4 w-4 flex-shrink-0 text-${color}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">{title}</p>
          <p className="truncate text-[11px] text-zinc-500">{desc}</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-zinc-500" /> : <ChevronDown className="h-4 w-4 text-zinc-500" />}
      </button>
      {open && <div className="space-y-3 border-t border-zinc-800 p-3">{children}</div>}
    </div>
  );
}

// --------------- OKR Scorecard ---------------

interface KRForm { title: string; target: string; current: string; unit: string; confidence: number; weight: string; }
interface ObjForm { title: string; weight: string; krs: KRForm[]; }

function blankKR(): KRForm { return { title: '', target: '100', current: '0', unit: '', confidence: 1, weight: '1' }; }
function blankObj(): ObjForm { return { title: '', weight: '1', krs: [blankKR()] }; }

function ScorecardTool() {
  const [objectives, setObjectives] = useState<ObjForm[]>([blankObj()]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedNote, setLoadedNote] = useState<string | null>(null);

  // §9 fix: the scorecard used to open as a blank re-type calculator —
  // nothing populated it from the objectives and check-ins the user
  // already has. This fills the form from the stored objectives: each
  // stored key result becomes a row whose Current is the objective's
  // derived progress (its latest check-in, per the domain's one
  // progress rule). The form stays fully editable before scoring.
  const loadMine = async () => {
    setError(null);
    setLoadedNote(null);
    const r = await lensRun('goals', 'alignmentTree', { op: 'list' });
    if (r.data?.ok && r.data.result) {
      const flat = (r.data.result.flat || []) as { id: string; title: string; keyResults: string[]; progress: number | null }[];
      if (flat.length === 0) {
        setLoadedNote('No stored objectives yet — add some in the OKR workspace first.');
        return;
      }
      setObjectives(flat.map((o) => ({
        title: o.title,
        weight: '1',
        krs: (o.keyResults && o.keyResults.length > 0 ? o.keyResults : ['Overall progress']).map((kr) => ({
          title: kr, target: '100', current: String(Math.round(o.progress ?? 0)), unit: '%', confidence: 1, weight: '1',
        })),
      })));
      setLoadedNote(`Loaded ${flat.length} objective${flat.length === 1 ? '' : 's'} — each key result's Current is that objective's latest check-in progress. Adjust anything before scoring.`);
    } else {
      setError(r.data?.error || 'Could not load your objectives.');
    }
  };

  const run = async () => {
    setBusy(true); setError(null);
    const payload = objectives
      .filter((o) => o.title.trim())
      .map((o, i) => ({
        id: `obj_${i}`,
        title: o.title.trim(),
        weight: Number(o.weight) || 1,
        keyResults: o.krs.filter((k) => k.title.trim()).map((k, j) => ({
          id: `kr_${i}_${j}`, title: k.title.trim(), target: Number(k.target) || 0,
          current: Number(k.current) || 0, unit: k.unit, confidence: k.confidence, weight: Number(k.weight) || 1,
        })),
      }));
    const r = await lensRun('goals', 'okrScoring', { objectives: payload });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result as Record<string, unknown>);
    else setError(r.data?.error || 'Scoring failed.');
  };

  return (
    <div className="space-y-3">
      {objectives.map((obj, oi) => (
        <div key={oi} className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2">
          <div className="flex items-center gap-2">
            <input value={obj.title} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, title: e.target.value } : o))} placeholder={`Objective ${oi + 1} title`} className={`${inputCls} flex-1`} />
            <input value={obj.weight} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, weight: e.target.value } : o))} type="number" min={0} step={0.5} placeholder="Weight" className={`${inputCls} w-16`} />
            <button onClick={() => setObjectives((os) => os.filter((_, i) => i !== oi))} className="text-zinc-600 hover:text-red-400" aria-label={`Remove objective${obj.title.trim() ? ` "${obj.title.trim()}"` : ` ${oi + 1}`}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
          <div className="space-y-1.5 pl-3">
            {obj.krs.map((kr, ki) => (
              <div key={ki} className="grid grid-cols-7 gap-1.5">
                <input value={kr.title} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.map((k, j) => j === ki ? { ...k, title: e.target.value } : k) } : o))} placeholder="Key result" className={`${inputCls} col-span-2`} />
                <input value={kr.current} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.map((k, j) => j === ki ? { ...k, current: e.target.value } : k) } : o))} type="number" placeholder="Current" className={inputCls} />
                <input value={kr.target} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.map((k, j) => j === ki ? { ...k, target: e.target.value } : k) } : o))} type="number" placeholder="Target" className={inputCls} />
                <input value={kr.unit} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.map((k, j) => j === ki ? { ...k, unit: e.target.value } : k) } : o))} placeholder="Unit" className={inputCls} />
                <input value={Math.round(kr.confidence * 100)} onChange={(e) => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.map((k, j) => j === ki ? { ...k, confidence: Math.max(0, Math.min(100, Number(e.target.value) || 0)) / 100 } : k) } : o))} type="number" min={0} max={100} placeholder="Conf %" title="Confidence 0-100% — this KR's score is multiplied by it" className={inputCls} />
                <button onClick={() => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: o.krs.filter((_, j) => j !== ki) } : o))} className="flex items-center justify-center text-zinc-600 hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
            <button onClick={() => setObjectives((os) => os.map((o, i) => i === oi ? { ...o, krs: [...o.krs, blankKR()] } : o))} className="text-[10px] text-cyan-400 hover:text-cyan-300">+ key result</button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={() => setObjectives((os) => [...os, blankObj()])} className={btnCls}><Plus className="h-3 w-3" /> Objective</button>
        <button onClick={loadMine} className={btnCls}><Target className="h-3 w-3" /> Load my objectives</button>
        <button onClick={run} disabled={busy || !objectives.some((o) => o.title.trim())} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Target className="h-3.5 w-3.5" />} Score
        </button>
      </div>
      {loadedNote && <p className="text-[11px] text-zinc-400" role="status">{loadedNote}</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {result && (
        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-2.5 py-1 text-sm font-bold ${result.overallStatus === 'green' ? 'bg-emerald-500/20 text-emerald-300' : result.overallStatus === 'yellow' ? 'bg-amber-500/20 text-amber-300' : 'bg-red-500/20 text-red-300'}`}>
              {result.overallScore as number}% overall
            </span>
            <span className="text-xs uppercase text-zinc-400">{result.overallStatus as string}</span>
          </div>
          <p className="text-[10px] text-zinc-500">Scores are progress × confidence. On track = 70%+ of target · At risk = 40–70% · Off track = under 40%.</p>
          {((result.objectives as { id: string; title: string; score: number; status: string; krOnTrack: number; krCount: number }[]) || []).map((o) => (
            <div key={o.id} className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">{o.title}</span>
              <span className="font-mono text-zinc-400">{o.score}% ({o.krOnTrack}/{o.krCount} KRs on track)</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --------------- Decomposition planner ---------------

interface TaskForm { key: string; title: string; duration: string; effort: string; resources: string; deps: string[]; }

function blankTask(key: string): TaskForm { return { key, title: '', duration: '3', effort: '3', resources: '', deps: [] }; }

function DecompositionTool() {
  const [tasks, setTasks] = useState<TaskForm[]>([blankTask('g0')]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addTask = () => setTasks((ts) => [...ts, blankTask(`g${ts.length}`)]);

  const run = async () => {
    setBusy(true); setError(null);
    const payload = tasks.filter((t) => t.title.trim()).map((t) => ({
      id: t.key, title: t.title.trim(), duration: Number(t.duration) || 1, effort: Number(t.effort) || 1,
      resources: t.resources.split(',').map((r) => r.trim()).filter(Boolean),
      dependencies: t.deps,
    }));
    const r = await lensRun('goals', 'goalDecomposition', { goals: payload });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result as Record<string, unknown>);
    else setError(r.data?.error || 'Decomposition failed.');
  };

  return (
    <div className="space-y-3">
      {tasks.map((t, i) => (
        <div key={t.key} className="grid grid-cols-12 gap-1.5">
          <input value={t.title} onChange={(e) => setTasks((ts) => ts.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder={`Task ${t.key}`} className={`${inputCls} col-span-4`} />
          <input value={t.duration} onChange={(e) => setTasks((ts) => ts.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))} type="number" min={1} placeholder="Duration" className={`${inputCls} col-span-2`} />
          <input value={t.resources} onChange={(e) => setTasks((ts) => ts.map((x, j) => j === i ? { ...x, resources: e.target.value } : x))} placeholder="Resources (csv)" className={`${inputCls} col-span-3`} />
          <select multiple value={t.deps} onChange={(e) => setTasks((ts) => ts.map((x, j) => j === i ? { ...x, deps: Array.from(e.target.selectedOptions).map((o) => o.value) } : x))} className={`${inputCls} col-span-2`}>
            {tasks.filter((o) => o.key !== t.key).map((o) => <option key={o.key} value={o.key}>{o.title || o.key}</option>)}
          </select>
          <button onClick={() => setTasks((ts) => ts.filter((_, j) => j !== i))} className="flex items-center justify-center text-zinc-600 hover:text-red-400" aria-label={`Remove task${t.title.trim() ? ` "${t.title.trim()}"` : ` ${t.key}`}`}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <button onClick={addTask} className={btnCls}><Plus className="h-3 w-3" /> Task</button>
        <button onClick={run} disabled={busy || !tasks.some((t) => t.title.trim())} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />} Decompose
        </button>
      </div>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {result && (
        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div><p className="font-mono text-lg text-white">{result.totalTasks as number}</p><p className="text-[9px] text-zinc-500">Tasks</p></div>
            <div><p className="font-mono text-lg text-white">{result.projectDuration as number}</p><p className="text-[9px] text-zinc-500">Duration</p></div>
            <div><p className="font-mono text-lg text-white">{(result.criticalPath as { length: number })?.length ?? 0}</p><p className="text-[9px] text-zinc-500">Critical path</p></div>
            <div><p className="font-mono text-lg text-white">{(result.resourceConflicts as unknown[])?.length ?? 0}</p><p className="text-[9px] text-zinc-500">Conflicts</p></div>
          </div>
          {(result.hasCycle as boolean) && <p className="text-[11px] text-red-400">Dependency cycle: {(result.cyclicTasks as string[]).join(', ')}</p>}
          {((result.criticalPath as { tasks: string[] })?.tasks?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {(result.criticalPath as { tasks: string[] }).tasks.map((tid) => (
                <span key={tid} className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">{tasks.find((t) => t.key === tid)?.title || tid}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --------------- Forecast (from real check-in history) ---------------

function ForecastTool() {
  const objectives = useObjectiveOptions();
  const [goalId, setGoalId] = useState('');
  const [target, setTarget] = useState('100');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pointsUsed, setPointsUsed] = useState<number | null>(null);

  const run = async () => {
    if (!goalId.trim()) return;
    setBusy(true); setError(null); setResult(null);
    // S5: the domain reads the objective's real series itself — the
    // same points the chart draws — so the forecast can never be fed
    // a newest-first history whose "latest" is secretly the first.
    const r = await lensRun('goals', 'progressForecast', { goalId: goalId.trim(), target: Number(target) || 100 });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      const res = r.data.result as Record<string, unknown>;
      setPointsUsed(typeof res.dataPoints === 'number' ? res.dataPoints : null);
      if (typeof res.message === 'string') { setError(res.message); return; }
      setResult(res);
    } else setError(r.data?.error || 'Forecast failed.');
    };

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Pulls the real check-in history you&apos;ve logged for the objective you pick
        and fits a linear-regression forecast with confidence bands —
        no re-typed numbers.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)} className={`${inputCls} flex-1`} aria-label="Objective">
          <option value="">Select an objective…</option>
          {objectives.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <input value={target} onChange={(e) => setTarget(e.target.value)} type="number" placeholder="Target %" className={`${inputCls} w-24`} />
        <button onClick={run} disabled={busy || !goalId.trim()} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="h-3.5 w-3.5" />} Forecast
        </button>
      </div>
      {pointsUsed != null && !error && <p className="text-[10px] text-zinc-500">Using {pointsUsed} check-in data points.</p>}
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {result && (
        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2.5">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="font-mono text-lg text-cyan-300">{(result.currentState as Record<string, number>)?.progress}%</p><p className="text-[9px] text-zinc-500">Current</p></div>
            <div><p className="font-mono text-lg text-white">{(result.currentState as Record<string, number>)?.daysElapsed}d</p><p className="text-[9px] text-zinc-500">Elapsed</p></div>
            <div><p className={`font-mono text-lg ${(result.pace as string) === 'behind' ? 'text-red-300' : (result.pace as string) === 'on_track' ? 'text-amber-300' : 'text-emerald-300'}`}>{(result.pace as string) === 'ahead' ? 'Ahead' : (result.pace as string) === 'on_track' ? 'On track' : (result.pace as string) === 'behind' ? 'Behind' : '—'}</p><p className="text-[9px] text-zinc-500">Pace (same rule as Charts)</p></div>
          </div>
          {!!(result.forecast as Record<string, string>)?.estimatedCompletionDate && (
            <p className="text-xs text-zinc-300">
              At the pace of your {result.dataPoints as number} check-ins: {(result.currentState as Record<string, number>)?.target ?? 100}% by{' '}
              <span className="font-mono text-cyan-300">{(result.forecast as Record<string, string>).estimatedCompletionDate}</span>
              {(result.forecast as Record<string, number>)?.daysRemainingBest != null && (result.forecast as Record<string, number>)?.daysRemainingWorst != null && (
                <> (band: {(result.forecast as Record<string, number>).daysRemainingBest}–{(result.forecast as Record<string, number>).daysRemainingWorst} days remaining)</>
              )}
            </p>
          )}
          {typeof (result.forecast as Record<string, string>)?.reason === 'string' && (
            <p className="text-xs text-amber-300">{(result.forecast as Record<string, string>).reason}</p>
          )}
          <p className="text-[11px] text-zinc-400">Trend: <span className="text-zinc-200">{(result.velocity as Record<string, string>)?.trend}</span>{result.regression ? <> · Fit: <span className="text-zinc-200">{(result.regression as Record<string, string>)?.fit}</span> (R²={(result.regression as Record<string, number>)?.rSquared})</> : null}</p>
        </div>
      )}
    </div>
  );
}

// --------------- Root ---------------

export function GoalsAnalyticsTools() {
  return (
    <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
        <TrendingUp className="h-4 w-4 text-cyan-400" /> Analytics tools
      </h2>
      <p className="text-[11px] text-zinc-500">
        Ad-hoc calculators over the goals engine — build inputs here and run the real
        confidence-adjusted scoring, critical-path, and forecasting math (server/domains/goals.js).
      </p>
      <div className="space-y-2">
        <ToolCard icon={Target} color="cyan-400" title="OKR Scorecard" desc="Confidence-adjusted key-result scoring with red/yellow/green status">
          <ScorecardTool />
        </ToolCard>
        <ToolCard icon={GitBranch} color="purple-400" title="Decomposition Planner" desc="Critical path, dependency cycles, and resource-conflict detection">
          <DecompositionTool />
        </ToolCard>
        <ToolCard icon={TrendingUp} color="emerald-400" title="Progress Forecast" desc="Linear-regression completion forecast from real check-in history">
          <ForecastTool />
        </ToolCard>
      </div>
    </div>
  );
}
