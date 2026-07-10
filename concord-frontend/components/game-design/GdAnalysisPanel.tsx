'use client';

/**
 * GdAnalysisPanel — design-analysis calculators that operate on REAL
 * project data, not a phantom parallel store. Three tools:
 *
 *  - Mechanics depth: pulls the game's actual mechanics roster (via
 *    game-get) and runs `mechanicsAnalysis` on it directly — no
 *    persisted "artifact" indirection, the live mechanics list IS the
 *    input.
 *  - Flow calculator: a scratchpad (intentionally NOT persisted — no
 *    "player state" entity exists in the engine) for sketching a
 *    challenge/skill pacing curve and running `playerFlow` on it.
 *  - Monetization calculator: a straight input->output calculator
 *    (model, DAU, conversion) for `monetizationModel` — no artifact
 *    needed since the macro is pure math over its params.
 *
 * `narrativeBranch` is deliberately NOT surfaced here — the Narrative
 * tab's "Story graph" panel already runs the strictly-better
 * `narrative-graph` analysis (real node/link reachability, not a
 * fabricated nodes[].choices[] shape nothing in the engine populates).
 *
 * All three calls go through the direct `/api/lens/run` dispatch
 * (lensRun helper) which builds a virtual artifact from the params we
 * pass — so `{ mechanics: [...] }` lands exactly as `artifact.data.mechanics`
 * server-side. No generic lensArtifact needs to exist first.
 */

import { useState } from 'react';
import { Loader2, Gamepad2, TrendingUp, DollarSign, Plus, Trash2, Play } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MechanicsResult {
  message?: string;
  totalMechanics?: number;
  depthScore?: number;
  loopCount?: number;
  emergentPotential?: string;
  categories?: { category: string; count: number }[];
}
interface FlowState { name: string; challenge: number; skillRequired: number; durationMinutes: number }
interface FlowResult {
  message?: string;
  totalStates?: number;
  inFlowZone?: number;
  flowPercent?: number;
  totalDuration?: number;
  pacing?: string;
}
interface MonetizationResult {
  model?: string;
  revenue?: string;
  avgLTV?: number;
  conversionRate?: string;
  projectedMonthlyRevenue?: number;
  projectedAnnualRevenue?: number;
  ethicalConsiderations?: string[];
}

const MONETIZATION_MODELS = ['premium', 'free-to-play', 'subscription', 'battle-pass'];

export function GdAnalysisPanel({ gameId }: { gameId: string; onChange: () => void }) {
  return (
    <div className="space-y-4">
      <MechanicsDepthCard gameId={gameId} />
      <FlowCalculatorCard />
      <MonetizationCalculatorCard />
    </div>
  );
}

function MechanicsDepthCard({ gameId }: { gameId: string }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MechanicsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const g = await lensRun('game-design', 'game-get', { id: gameId });
      const mechanics = (g.data?.result as { mechanics?: unknown[] } | null)?.mechanics || [];
      const r = await lensRun('game-design', 'mechanicsAnalysis', { mechanics });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setResult(null); }
      else setResult(r.data?.result as MechanicsResult);
    } catch {
      setError('Analysis failed.');
    }
    setRunning(false);
  };

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <Gamepad2 className="w-3.5 h-3.5 text-lime-400" /> Mechanics depth
        </h3>
        <button type="button" onClick={run} disabled={running}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 disabled:opacity-50 text-white rounded-lg">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Analyze
        </button>
      </div>
      <p className="text-[10px] text-zinc-400">Scores the current mechanics roster on breadth (pillar coverage) and depth (count) — live from the Mechanics tab, not a snapshot.</p>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      {result?.message && <p className="text-[11px] text-zinc-400 italic">{result.message}</p>}
      {result && !result.message && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label="Mechanics" value={result.totalMechanics ?? 0} />
            <Metric label="Depth score" value={result.depthScore ?? 0} color="text-lime-400" />
            <Metric label="Loop-flagged" value={result.loopCount ?? 0} />
            <Metric label="Emergent" value={result.emergentPotential ?? '—'} color={result.emergentPotential === 'high' ? 'text-emerald-400' : 'text-amber-400'} />
          </div>
          {Array.isArray(result.categories) && result.categories.some((c) => c.count > 0) && (
            <div className="flex flex-wrap gap-1.5">
              {result.categories.filter((c) => c.count > 0).map((c) => (
                <span key={c.category} className="text-[10px] px-1.5 py-0.5 rounded bg-lime-950/40 border border-lime-900/50 text-lime-300 capitalize">{c.category}: {c.count}</span>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FlowCalculatorCard() {
  const [states, setStates] = useState<FlowState[]>([]);
  const [draft, setDraft] = useState<FlowState>({ name: '', challenge: 50, skillRequired: 50, durationMinutes: 10 });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<FlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const addState = () => {
    if (!draft.name.trim()) return;
    setStates((prev) => [...prev, { ...draft, name: draft.name.trim() }]);
    setDraft({ name: '', challenge: 50, skillRequired: 50, durationMinutes: 10 });
    setResult(null);
  };
  const delState = (idx: number) => { setStates((prev) => prev.filter((_, i) => i !== idx)); setResult(null); };

  const run = async () => {
    if (states.length === 0) return;
    setRunning(true);
    setError(null);
    try {
      const r = await lensRun('game-design', 'playerFlow', { states });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setResult(null); }
      else setResult(r.data?.result as FlowResult);
    } catch {
      setError('Analysis failed.');
    }
    setRunning(false);
  };

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
          <TrendingUp className="w-3.5 h-3.5 text-neon-cyan" /> Flow calculator
        </h3>
        <button type="button" onClick={run} disabled={running || states.length === 0}
          className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 disabled:opacity-40 text-white rounded-lg">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Analyze
        </button>
      </div>
      <p className="text-[10px] text-zinc-400">Scratchpad — sketch player-experience beats (Csikszentmihalyi challenge-vs-skill flow), not saved to the project. Add a few beats, then analyze the pacing curve.</p>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
        <input placeholder="Beat name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
        <label className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-[10px] text-zinc-400">
          Challenge
          <input type="number" min={0} max={100} value={draft.challenge}
            onChange={(e) => setDraft({ ...draft, challenge: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            className="w-full bg-transparent py-1 text-[11px] text-zinc-100" />
        </label>
        <label className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-[10px] text-zinc-400">
          Skill
          <input type="number" min={0} max={100} value={draft.skillRequired}
            onChange={(e) => setDraft({ ...draft, skillRequired: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
            className="w-full bg-transparent py-1 text-[11px] text-zinc-100" />
        </label>
        <label className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-[10px] text-zinc-400">
          Min
          <input type="number" min={1} max={240} value={draft.durationMinutes}
            onChange={(e) => setDraft({ ...draft, durationMinutes: Math.max(1, Number(e.target.value) || 1) })}
            className="w-full bg-transparent py-1 text-[11px] text-zinc-100" />
        </label>
        <button type="button" onClick={addState}
          className="flex items-center justify-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Beat
        </button>
      </div>

      {states.length > 0 && (
        <ul className="space-y-1">
          {states.map((s, i) => (
            <li key={i} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1 text-[11px] text-zinc-300">
              <span className="flex-1">{s.name}</span>
              <span className="text-zinc-500">chal {s.challenge} · skill {s.skillRequired} · {s.durationMinutes}m</span>
              <button aria-label="Delete" type="button" onClick={() => delState(i)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      {result?.message && <p className="text-[11px] text-zinc-400 italic">{result.message}</p>}
      {result && !result.message && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Metric label="Beats" value={result.totalStates ?? 0} />
            <Metric label="In flow" value={result.inFlowZone ?? 0} color="text-emerald-400" />
            <Metric label="Flow %" value={`${result.flowPercent ?? 0}%`} color="text-neon-cyan" />
            <Metric label="Duration" value={`${result.totalDuration ?? 0}min`} />
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', (result.flowPercent ?? 0) > 60 ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${result.flowPercent ?? 0}%` }} />
          </div>
          <p className="text-[10px] text-zinc-400">Pacing: <span className="text-zinc-200 capitalize">{(result.pacing || '').replace(/-/g, ' ')}</span></p>
        </>
      )}
    </section>
  );
}

function MonetizationCalculatorCard() {
  const [model, setModel] = useState('premium');
  const [dau, setDau] = useState('10000');
  const [conversion, setConversion] = useState('5');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MonetizationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      const r = await lensRun('game-design', 'monetizationModel', {
        model, expectedDAU: Number(dau) || 0,
        conversionRate: model === 'premium' ? undefined : (Number(conversion) || 0) / 100,
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setResult(null); }
      else setResult(r.data?.result as MonetizationResult);
    } catch {
      setError('Calculation failed.');
    }
    setRunning(false);
  };

  return (
    <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
        <DollarSign className="w-3.5 h-3.5 text-neon-green" /> Monetization calculator
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        <select value={model} onChange={(e) => setModel(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-100 capitalize">
          {MONETIZATION_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <label className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-[10px] text-zinc-400">
          DAU
          <input type="number" min={0} value={dau} onChange={(e) => setDau(e.target.value)}
            className="w-full bg-transparent py-1.5 text-[11px] text-zinc-100" />
        </label>
        {model !== 'premium' && (
          <label className="flex items-center gap-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-[10px] text-zinc-400">
            Conv %
            <input type="number" min={0} max={100} step={0.1} value={conversion} onChange={(e) => setConversion(e.target.value)}
              className="w-full bg-transparent py-1.5 text-[11px] text-zinc-100" />
          </label>
        )}
        <button type="button" onClick={run} disabled={running}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 disabled:opacity-50 text-white text-[11px] rounded-lg">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Project
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-400">{error}</p>}
      {result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Metric label="Model" value={result.model ?? '—'} />
            <Metric label="Revenue type" value={result.revenue ?? '—'} />
            <Metric label="Avg LTV" value={`$${result.avgLTV ?? 0}`} />
            <Metric label="Conversion" value={result.conversionRate ?? '—'} />
            <Metric label="Monthly" value={`$${(result.projectedMonthlyRevenue ?? 0).toLocaleString()}`} color="text-emerald-400" />
            <Metric label="Annual" value={`$${(result.projectedAnnualRevenue ?? 0).toLocaleString()}`} color="text-emerald-400" />
          </div>
          {Array.isArray(result.ethicalConsiderations) && (
            <div className="space-y-1">
              {result.ethicalConsiderations.map((e, i) => (
                <p key={i} className="text-[10px] text-zinc-400 bg-zinc-950/60 border border-zinc-800 rounded px-2 py-1">{e}</p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Metric({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="text-center bg-zinc-950/60 border border-zinc-800 rounded-lg py-1.5">
      <p className={cn('text-sm font-bold capitalize', color || 'text-zinc-100')}>{value}</p>
      <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
