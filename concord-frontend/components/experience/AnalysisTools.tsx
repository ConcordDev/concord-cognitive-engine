'use client';

/**
 * AnalysisTools — real UI for the experience domain's 4 artifact-bound
 * analytical macros (journeyMap / usabilityScore / heuristicEval /
 * personaBuilder). These handlers read straight from `artifact.data`
 * (server/domains/experience.js:20-47), and `/api/lens/run` builds a
 * *virtual* artifact whose `.data` IS the request body (server.js:39560:
 * `const virtualArtifact = { id: null, domain, type: "domain_action",
 * data: rest, meta: {} }`), so calling `lensRun('experience', <action>,
 * <form data>)` directly exercises the real math with no pre-existing
 * artifact needed — the pattern already validated for `eco.carbonFootprint`
 * in the eco-lens rebuild.
 *
 * Previously these 4 macros were only reachable through a generic
 * artifact-store action runner (`useRunArtifact` against a
 * `useLensData('experience', 'experience', { seed: [] })` list) with no
 * creation UI anywhere on the page — `expArtifacts` was permanently `[]`,
 * so every action button was permanently `disabled`. The 4 result
 * renderers below were real and well-built; they just never received data.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Map, Gauge, ClipboardCheck, UserCircle, Loader2, Plus, Trash2,
  CheckCircle2, XCircle, Clock, Star, Target, Frown, Activity,
} from 'lucide-react';

type ToolTab = 'journey' | 'usability' | 'heuristic' | 'persona';

const TOOL_TABS: { id: ToolTab; label: string; icon: typeof Map }[] = [
  { id: 'journey', label: 'Journey Map', icon: Map },
  { id: 'usability', label: 'Usability Score', icon: Gauge },
  { id: 'heuristic', label: 'Heuristic Eval', icon: ClipboardCheck },
  { id: 'persona', label: 'Persona', icon: UserCircle },
];

const inputCls = 'w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:border-neon-cyan focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-gray-400">{label}</span>
      {children}
    </label>
  );
}

async function run(action: string, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const r = await lensRun('experience', action, params);
  if (r.data?.ok && r.data.result && !(r.data.result as Record<string, unknown>).message) return r.data.result as Record<string, unknown>;
  return (r.data?.result as Record<string, unknown>) || null;
}

// ════════════════════════════════════════════════════════════════════════
// 1. Journey Map Builder
// ════════════════════════════════════════════════════════════════════════

interface StageDraft {
  name: string;
  emotion: string;
  touchpoints: string;
  painPoints: string;
  opportunities: string;
  satisfaction: string;
}

const EMPTY_STAGE: StageDraft = { name: '', emotion: 'neutral', touchpoints: '', painPoints: '', opportunities: '', satisfaction: '50' };
const EMOTIONS = ['delighted', 'happy', 'excited', 'neutral', 'frustrated', 'angry', 'sad'];

function JourneyMapTool() {
  const [stages, setStages] = useState<StageDraft[]>([{ ...EMPTY_STAGE, name: 'Discover' }, { ...EMPTY_STAGE, name: 'Onboard' }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const update = (i: number, patch: Partial<StageDraft>) => setStages(stages.map((s, si) => (si === i ? { ...s, ...patch } : s)));
  const addStage = () => setStages([...stages, { ...EMPTY_STAGE }]);
  const removeStage = (i: number) => setStages(stages.filter((_, si) => si !== i));

  const submit = async () => {
    const payload = stages.filter(s => s.name.trim()).map(s => ({
      name: s.name.trim(),
      emotion: s.emotion,
      touchpoints: s.touchpoints.split(',').map(t => t.trim()).filter(Boolean),
      painPoints: s.painPoints.split('\n').map(t => t.trim()).filter(Boolean),
      opportunities: s.opportunities.split('\n').map(t => t.trim()).filter(Boolean),
      satisfaction: Number(s.satisfaction) || 0,
    }));
    if (!payload.length) return;
    setBusy(true);
    const r = await run('journeyMap', { stages: payload });
    setResult(r);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">Map the stages a user moves through, with touchpoints, emotion, pain points and opportunities per stage — the same shape as a Smaply/Miro journey map, computed server-side.</p>
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input className={`${inputCls} flex-1`} value={s.name} onChange={e => update(i, { name: e.target.value })} placeholder={`Stage ${i + 1} name`} />
              <select className={`${inputCls} max-w-[130px]`} value={s.emotion} onChange={e => update(i, { emotion: e.target.value })}>
                {EMOTIONS.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <button onClick={() => removeStage(i)} className="text-gray-500 hover:text-red-400" aria-label="remove stage"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Field label="Touchpoints (comma-separated)"><input className={inputCls} value={s.touchpoints} onChange={e => update(i, { touchpoints: e.target.value })} placeholder="app, email, support chat" /></Field>
              <Field label="Satisfaction (0-100)"><input type="number" min={0} max={100} className={inputCls} value={s.satisfaction} onChange={e => update(i, { satisfaction: e.target.value })} /></Field>
              <Field label="Pain points (one per line)"><textarea className={inputCls} rows={2} value={s.painPoints} onChange={e => update(i, { painPoints: e.target.value })} /></Field>
              <Field label="Opportunities (one per line)"><textarea className={inputCls} rows={2} value={s.opportunities} onChange={e => update(i, { opportunities: e.target.value })} /></Field>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={addStage} className="btn-neon text-xs flex items-center gap-1"><Plus className="w-3 h-3" /> Add stage</button>
        <button onClick={submit} disabled={busy || stages.every(s => !s.name.trim())} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Map className="w-3 h-3" />} Compute journey map
        </button>
      </div>
      {result && <JourneyMapResult result={result} />}
    </div>
  );
}

function JourneyMapResult({ result }: { result: Record<string, unknown> }) {
  const stages = result.stages as Array<{ stage: string; touchpoints: string[]; emotion: string; painPoints: string[]; opportunities: string[]; satisfactionScore: number }> | undefined;
  if (!stages) return null;
  const totalStages = result.totalStages as number;
  const avgSatisfaction = result.avgSatisfaction as number;
  const lowestPoint = result.lowestPoint as string;
  const totalPainPoints = result.totalPainPoints as number;
  const totalOpportunities = result.totalOpportunities as number;

  const emotionTone = (e: string) => ['delighted', 'happy', 'excited'].includes(e) ? 'text-neon-green' : ['frustrated', 'angry', 'sad'].includes(e) ? 'text-red-400' : 'text-yellow-400';
  const satisfactionColor = (score: number) => score >= 75 ? 'bg-neon-green' : score >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Stages', value: totalStages },
          { label: 'Avg Satisfaction', value: `${avgSatisfaction}%` },
          { label: 'Pain Points', value: totalPainPoints },
          { label: 'Opportunities', value: totalOpportunities },
          { label: 'Lowest Point', value: lowestPoint || '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-center">
            <p className="text-sm font-bold text-white truncate">{value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {stages.map((s, i) => (
          <div key={i} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-white">{i + 1}. {s.stage} <span className={`text-[10px] ml-1 ${emotionTone(s.emotion)}`}>{s.emotion}</span></span>
              <span className="text-sm font-bold text-neon-cyan">{s.satisfactionScore}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full rounded-full ${satisfactionColor(s.satisfactionScore)}`} style={{ width: `${s.satisfactionScore}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 2. Usability Score
// ════════════════════════════════════════════════════════════════════════

function UsabilityScoreTool() {
  const [taskSuccessRate, setTaskSuccessRate] = useState('80');
  const [avgTimeSeconds, setAvgTimeSeconds] = useState('45');
  const [errorCount, setErrorCount] = useState('1');
  const [satisfactionScore, setSatisfactionScore] = useState('75');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const submit = async () => {
    setBusy(true);
    const r = await run('usabilityScore', {
      taskSuccessRate: Number(taskSuccessRate) || 0,
      avgTimeSeconds: Number(avgTimeSeconds) || 0,
      errorCount: Number(errorCount) || 0,
      satisfactionScore: Number(satisfactionScore) || 0,
    });
    setResult(r);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">Computes a System Usability Scale (SUS) score from real session metrics — the same formula analysts use to benchmark against the 68 industry-average baseline.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Field label="Task success rate (%)"><input type="number" min={0} max={100} className={inputCls} value={taskSuccessRate} onChange={e => setTaskSuccessRate(e.target.value)} /></Field>
        <Field label="Avg time on task (s)"><input type="number" min={0} className={inputCls} value={avgTimeSeconds} onChange={e => setAvgTimeSeconds(e.target.value)} /></Field>
        <Field label="Error count"><input type="number" min={0} className={inputCls} value={errorCount} onChange={e => setErrorCount(e.target.value)} /></Field>
        <Field label="Satisfaction (0-100)"><input type="number" min={0} max={100} className={inputCls} value={satisfactionScore} onChange={e => setSatisfactionScore(e.target.value)} /></Field>
      </div>
      <button onClick={submit} disabled={busy} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Gauge className="w-3 h-3" />} Compute SUS score
      </button>
      {result && <UsabilityScoreResult result={result} />}
    </div>
  );
}

function UsabilityScoreResult({ result }: { result: Record<string, unknown> }) {
  const susScore = result.susScore as number | undefined;
  if (susScore === undefined) return null;
  const grade = result.grade as string;
  const taskSuccessRate = result.taskSuccessRate as number;
  const avgTimeSeconds = result.avgTimeSeconds as number;
  const errorCount = result.errorCount as number;
  const satisfactionScore = result.satisfactionScore as number;
  const benchmark = result.benchmark as string;

  const gradeColor = grade === 'A' ? 'text-neon-green' : grade === 'B' ? 'text-cyan-400' : grade === 'C' ? 'text-yellow-400' : 'text-red-400';
  const gradeBg = grade === 'A' ? 'bg-neon-green/10 border-neon-green/20' : grade === 'B' ? 'bg-cyan-400/10 border-cyan-400/20' : grade === 'C' ? 'bg-yellow-400/10 border-yellow-400/20' : 'bg-red-400/10 border-red-400/20';
  const scoreBarColor = susScore >= 80 ? 'bg-neon-green' : susScore >= 68 ? 'bg-cyan-400' : susScore >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
      <div className={`rounded-xl p-4 border ${gradeBg} flex items-center justify-between`}>
        <div>
          <p className="text-[10px] text-gray-400 mb-1">SUS Score</p>
          <p className={`text-3xl font-bold ${gradeColor}`}>{susScore}</p>
          <p className="text-[10px] text-gray-400 mt-1">{benchmark}</p>
        </div>
        <p className={`text-5xl font-bold ${gradeColor}`}>{grade}</p>
      </div>
      <div className="relative h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className="absolute top-0 bottom-0 w-0.5 bg-gray-500/50" style={{ left: '68%' }} />
        <div className={`h-full rounded-full ${scoreBarColor}`} style={{ width: `${susScore}%` }} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Task Success', value: `${taskSuccessRate}%`, icon: CheckCircle2 },
          { label: 'Avg Time (s)', value: avgTimeSeconds, icon: Clock },
          { label: 'Errors', value: errorCount, icon: XCircle },
          { label: 'Satisfaction', value: `${satisfactionScore}%`, icon: Star },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 flex items-center gap-2">
            <Icon className="w-3.5 h-3.5 shrink-0 text-gray-400" />
            <div><p className="text-sm font-bold text-white">{value}</p><p className="text-[10px] text-gray-400">{label}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 3. Heuristic Evaluation (10 Nielsen heuristics)
// ════════════════════════════════════════════════════════════════════════

// Must match server/domains/experience.js's `heuristics` array by index —
// the handler zips `evaluations[i]` against `heuristics[i]` positionally.
const NIELSEN_HEURISTICS = [
  'Visibility of system status', 'Match between system and real world', 'User control and freedom',
  'Consistency and standards', 'Error prevention', 'Recognition rather than recall',
  'Flexibility and efficiency', 'Aesthetic and minimalist design', 'Help users recognize errors', 'Help and documentation',
];

interface EvalDraft { score: string; severity: string; notes: string; finding: string }
const EMPTY_EVAL: EvalDraft = { score: '7', severity: '0', notes: '', finding: '' };

function HeuristicEvalTool() {
  const [evals, setEvals] = useState<EvalDraft[]>(NIELSEN_HEURISTICS.map(() => ({ ...EMPTY_EVAL })));
  const [open, setOpen] = useState<number | null>(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const update = (i: number, patch: Partial<EvalDraft>) => setEvals(evals.map((e, ei) => (ei === i ? { ...e, ...patch } : e)));

  const submit = async () => {
    setBusy(true);
    const r = await run('heuristicEval', { evaluations: evals.map(e => ({ score: Number(e.score) || 0, severity: Number(e.severity) || 0, notes: e.notes, finding: e.finding })) });
    setResult(r);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">Score against Nielsen&apos;s 10 usability heuristics, the standard UX-audit rubric. Severity ≥4 flags a critical issue.</p>
      <div className="space-y-1.5">
        {NIELSEN_HEURISTICS.map((h, i) => (
          <div key={h} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
            <button onClick={() => setOpen(open === i ? null : i)} className="w-full flex items-center justify-between text-left">
              <span className="text-xs text-white flex items-center gap-2"><span className="text-gray-500 font-mono w-4">{i + 1}</span>{h}</span>
              <span className="flex items-center gap-2 text-[11px] text-gray-400">
                score {evals[i].score}/10{Number(evals[i].severity) > 0 && <span className="text-red-400">sev {evals[i].severity}</span>}
              </span>
            </button>
            {open === i && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-zinc-800 pt-2">
                <Field label="Score (0-10)"><input type="number" min={0} max={10} className={inputCls} value={evals[i].score} onChange={e => update(i, { score: e.target.value })} /></Field>
                <Field label="Severity (0=none, 4=critical)">
                  <select className={inputCls} value={evals[i].severity} onChange={e => update(i, { severity: e.target.value })}>
                    {[0, 1, 2, 3, 4].map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </Field>
                <Field label="Finding"><input className={inputCls} value={evals[i].finding} onChange={e => update(i, { finding: e.target.value })} placeholder="What's broken" /></Field>
                <Field label="Notes"><input className={inputCls} value={evals[i].notes} onChange={e => update(i, { notes: e.target.value })} placeholder="optional" /></Field>
              </div>
            )}
          </div>
        ))}
      </div>
      <button onClick={submit} disabled={busy} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ClipboardCheck className="w-3 h-3" />} Compute evaluation
      </button>
      {result && <HeuristicEvalResult result={result} />}
    </div>
  );
}

function HeuristicEvalResult({ result }: { result: Record<string, unknown> }) {
  const heuristics = result.heuristics as Array<{ heuristic: string; score: number; severity: number; notes: string; finding: string }> | undefined;
  if (!heuristics) return null;
  const avgScore = result.avgScore as number;
  const criticalIssues = result.criticalIssues as number;
  const evaluated = result.evaluated as number;
  const total = result.total as number;

  const scoreColor = (s: number) => s >= 7 ? 'text-neon-green' : s >= 4 ? 'text-yellow-400' : 'text-red-400';
  const severityBadge = (sev: number) => sev >= 4 ? 'bg-red-500/20 text-red-400' : sev >= 3 ? 'bg-orange-500/20 text-orange-400' : sev >= 2 ? 'bg-yellow-500/20 text-yellow-400' : sev >= 1 ? 'bg-blue-500/20 text-blue-400' : 'bg-zinc-700 text-gray-400';
  const severityLabel = (sev: number) => sev >= 4 ? 'Critical' : sev >= 3 ? 'Major' : sev >= 2 ? 'Minor' : sev >= 1 ? 'Cosmetic' : 'None';

  return (
    <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-center"><p className={`text-xl font-bold ${scoreColor(avgScore)}`}>{avgScore}</p><p className="text-[10px] text-gray-400">Avg / 10</p></div>
        <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-center"><p className={`text-xl font-bold ${criticalIssues === 0 ? 'text-neon-green' : 'text-red-400'}`}>{criticalIssues}</p><p className="text-[10px] text-gray-400">Critical</p></div>
        <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800 text-center"><p className="text-xl font-bold text-neon-cyan">{evaluated}/{total}</p><p className="text-[10px] text-gray-400">Evaluated</p></div>
      </div>
      <div className="space-y-1.5">
        {heuristics.map((h, i) => (
          <div key={i} className={`bg-zinc-900 rounded-lg p-2 border ${h.severity >= 4 ? 'border-red-500/30' : 'border-zinc-800'}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-white truncate">{i + 1}. {h.heuristic}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {h.severity > 0 && <span className={`text-[9px] px-1.5 py-0.5 rounded ${severityBadge(h.severity)}`}>{severityLabel(h.severity)}</span>}
                <span className={`text-xs font-bold ${scoreColor(h.score)}`}>{h.score}/10</span>
              </div>
            </div>
            {h.finding && <p className="text-[10px] text-gray-400 mt-1">{h.finding}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// 4. Persona Builder
// ════════════════════════════════════════════════════════════════════════

function PersonaBuilderTool() {
  const [name, setName] = useState('');
  const [age, setAge] = useState('30-40');
  const [occupation, setOccupation] = useState('');
  const [techSavvy, setTechSavvy] = useState('moderate');
  const [quote, setQuote] = useState('');
  const [goals, setGoals] = useState('');
  const [frustrations, setFrustrations] = useState('');
  const [behaviors, setBehaviors] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const submit = async () => {
    setBusy(true);
    const r = await run('personaBuilder', {
      name, age, occupation, techSavvy, quote,
      goals: goals.split('\n').map(s => s.trim()).filter(Boolean),
      frustrations: frustrations.split('\n').map(s => s.trim()).filter(Boolean),
      behaviors: behaviors.split('\n').map(s => s.trim()).filter(Boolean),
    });
    setResult(r);
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-gray-400">Build a research-backed user persona — goals, frustrations, and behaviors, the way UXPin/Xtensio personas are structured.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Name"><input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="Jordan Rivera" /></Field>
        <Field label="Age range"><input className={inputCls} value={age} onChange={e => setAge(e.target.value)} placeholder="30-40" /></Field>
        <Field label="Occupation"><input className={inputCls} value={occupation} onChange={e => setOccupation(e.target.value)} placeholder="Product manager" /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label="Tech savviness">
          <select className={inputCls} value={techSavvy} onChange={e => setTechSavvy(e.target.value)}>
            {['low', 'moderate', 'high'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
        <Field label="Quote"><input className={inputCls} value={quote} onChange={e => setQuote(e.target.value)} placeholder="I just want it to work." /></Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Field label="Goals (one per line)"><textarea className={inputCls} rows={3} value={goals} onChange={e => setGoals(e.target.value)} /></Field>
        <Field label="Frustrations (one per line)"><textarea className={inputCls} rows={3} value={frustrations} onChange={e => setFrustrations(e.target.value)} /></Field>
        <Field label="Behaviors (one per line)"><textarea className={inputCls} rows={3} value={behaviors} onChange={e => setBehaviors(e.target.value)} /></Field>
      </div>
      <button onClick={submit} disabled={busy || !name.trim()} className="btn-neon cyan text-xs flex items-center gap-1 disabled:opacity-40">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCircle className="w-3 h-3" />} Build persona
      </button>
      {result && <PersonaBuilderResult result={result} />}
    </div>
  );
}

function PersonaBuilderResult({ result }: { result: Record<string, unknown> }) {
  const persona = result.persona as { name: string; age: string; occupation: string; goals: string[]; frustrations: string[]; behaviors: string[]; techSavvy: string; quote: string } | undefined;
  if (!persona) return null;
  const completeness = result.completeness as number;
  const techSavvyColor = (level: string) => ['high', 'expert', 'advanced'].includes(level?.toLowerCase()) ? 'text-neon-green' : ['moderate', 'medium'].includes(level?.toLowerCase()) ? 'text-yellow-400' : 'text-red-400';
  const completenessBar = completeness >= 80 ? 'bg-neon-green' : completeness >= 50 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="mt-2 space-y-3 border-t border-zinc-800 pt-3">
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <span>Completeness</span>
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full rounded-full ${completenessBar}`} style={{ width: `${completeness}%` }} /></div>
        <span className="font-bold text-white">{completeness}%</span>
      </div>
      <div className="bg-zinc-900 rounded-xl p-3 border border-pink-500/20 space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pink-500 to-purple-500 flex items-center justify-center text-white font-bold">{persona.name ? persona.name[0].toUpperCase() : '?'}</div>
          <div>
            <p className="text-sm font-bold text-white">{persona.name || 'Unnamed Persona'}</p>
            <p className="text-xs text-gray-400">{persona.occupation} · Age {persona.age}</p>
          </div>
          <div className="ml-auto text-right">
            <p className={`text-xs font-bold ${techSavvyColor(persona.techSavvy)}`}>{persona.techSavvy}</p>
            <p className="text-[9px] text-gray-400">Tech Savvy</p>
          </div>
        </div>
        {persona.quote && <blockquote className="text-xs text-gray-300 italic border-l-2 border-pink-500/40 pl-2">&ldquo;{persona.quote}&rdquo;</blockquote>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {persona.goals?.length > 0 && (
          <div className="bg-zinc-900 rounded-lg p-2 border border-neon-green/20">
            <p className="text-[11px] font-semibold text-neon-green flex items-center gap-1 mb-1"><Target className="w-3 h-3" /> Goals</p>
            <ul className="space-y-0.5">{persona.goals.map((g, i) => <li key={i} className="text-[10px] text-gray-300">• {g}</li>)}</ul>
          </div>
        )}
        {persona.frustrations?.length > 0 && (
          <div className="bg-zinc-900 rounded-lg p-2 border border-red-400/20">
            <p className="text-[11px] font-semibold text-red-400 flex items-center gap-1 mb-1"><Frown className="w-3 h-3" /> Frustrations</p>
            <ul className="space-y-0.5">{persona.frustrations.map((f, i) => <li key={i} className="text-[10px] text-gray-300">• {f}</li>)}</ul>
          </div>
        )}
        {persona.behaviors?.length > 0 && (
          <div className="bg-zinc-900 rounded-lg p-2 border border-neon-cyan/20">
            <p className="text-[11px] font-semibold text-neon-cyan flex items-center gap-1 mb-1"><Activity className="w-3 h-3" /> Behaviors</p>
            <ul className="space-y-0.5">{persona.behaviors.map((b, i) => <li key={i} className="text-[10px] text-gray-300">• {b}</li>)}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Shell
// ════════════════════════════════════════════════════════════════════════

export function AnalysisTools() {
  const [tab, setTab] = useState<ToolTab>('journey');
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-white">Research Analysis Tools</h2>
        <p className="text-xs text-gray-400">Journey mapping, SUS scoring, heuristic evaluation and persona building — each computed server-side from what you enter, not templated copy.</p>
      </div>
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 pb-1">
        {TOOL_TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className={`text-xs px-3 py-1.5 rounded-t flex items-center gap-1.5 transition-colors ${tab === t.id ? 'bg-zinc-800 text-white' : 'text-gray-400 hover:text-gray-300'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'journey' && <JourneyMapTool />}
      {tab === 'usability' && <UsabilityScoreTool />}
      {tab === 'heuristic' && <HeuristicEvalTool />}
      {tab === 'persona' && <PersonaBuilderTool />}
    </div>
  );
}
