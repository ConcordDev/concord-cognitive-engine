'use client';

/**
 * CarpentryShop — Sawpipes-style woodworking calculator suite.
 * Four bespoke widgets:
 *
 *  1. BoardFootCalc       — editable lumber pieces (thickness × width
 *                          × length) → board-foot tally with material
 *                          cost summary, side-bar pieces inventory
 *  2. JointStrengthGuide  — joint-type picker + wood species →
 *                          strength rating with bar comparison
 *  3. WoodSelectionGuide  — application + budget + indoor toggle →
 *                          ranked wood-card list with grain swatches
 *  4. FinishRecommender   — species + use + indoor → ordered finish
 *                          options with cure-time and durability
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Hammer, Wrench, TreePine, Paintbrush, Plus, Trash2, Loader2,
  Trophy, Droplet,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

async function callCarp<T>(action: string, data: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await apiHelpers.lens.runDomain('carpentry', action, { input: { artifact: { data } } });
    const env = (r as { data?: { ok: boolean; result?: T } }).data;
    if (!env?.ok) return null;
    const raw = env.result as unknown as { ok?: boolean; result?: T } | T;
    if (raw && typeof raw === 'object' && 'result' in raw && (raw as { result?: T }).result) {
      return (raw as { result: T }).result;
    }
    return env.result as T;
  } catch { return null; }
}

interface Piece { thickness: string; width: string; length: string; pricePerBF: string; species: string }
interface BoardFootResult { pieces?: Array<{ thickness: number; width: number; length: number; boardFeet: number; species: string; cost: number }>; totalBoardFeet?: number; totalPieces?: number; totalCost?: number }
interface JointResult { jointType?: string; species?: string; baseStrength?: number; adjustedStrength?: number; speciesMultiplier?: number; classification?: string; recommendation?: string }
interface WoodOption { species: string; cost: string; hardness: string; rotResistant: boolean; workability: string; appearance: string; score: number; reason: string }
interface WoodSelectionResult { application?: string; budget?: string; indoor?: boolean; recommendations?: WoodOption[] }
interface FinishOption { name: string; type: string; cureTime: string; durability: string; appearance: string; difficulty: string; recommendation?: string }
interface FinishResult { species?: string; application?: string; recommendations?: FinishOption[] }

const SPECIES_LIST = ['pine', 'oak', 'maple', 'walnut', 'cherry', 'cedar', 'mahogany', 'birch', 'ash', 'poplar'];
const JOINT_TYPES = ['butt', 'pocket-hole', 'dowel', 'biscuit', 'mortise-tenon', 'dovetail', 'box-joint', 'dado', 'rabbet', 'half-lap', 'bridle', 'tongue-groove'];

function BoardFootCalc() {
  const [pieces, setPieces] = useState<Piece[]>([{ thickness: '', width: '', length: '', pricePerBF: '', species: 'pine' }]);
  const [result, setResult] = useState<BoardFootResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const cleanPieces = pieces.filter((p) => p.thickness && p.width && p.length).map((p) => ({
        thickness: parseFloat(p.thickness), width: parseFloat(p.width), length: parseFloat(p.length),
        pricePerBoardFoot: parseFloat(p.pricePerBF) || 0, species: p.species,
      }));
      const r = await callCarp<BoardFootResult>('boardFootCalc', { pieces: cleanPieces });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-amber-700/30 bg-gradient-to-br from-zinc-950 via-amber-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-amber-700/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Hammer className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Board-foot calculator</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">carpentry.boardFootCalc</span>
        </div>
        {result && result.totalBoardFeet != null && (
          <SaveAsDtuButton compact apiSource="concord-carpentry-bf"
            title={`Board feet — ${result.totalBoardFeet} BF across ${result.totalPieces} pieces ($${result.totalCost})`}
            content={`Total: ${result.totalBoardFeet} BF, $${result.totalCost}\nPieces: ${result.totalPieces}\n\n${(result.pieces || []).map((p, i) => `${i + 1}. ${p.thickness}" × ${p.width}" × ${p.length}" ${p.species} — ${p.boardFeet} BF ($${p.cost})`).join('\n')}`}
            extraTags={['carpentry', 'board-feet', 'lumber']} rawData={{ pieces, result }} />
        )}
      </header>

      <div className="p-4 space-y-2">
        <div className="grid grid-cols-[60px_60px_70px_70px_1fr_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
          <span>Thick</span><span>Width</span><span>Length</span><span>$/BF</span><span>Species</span><span></span>
        </div>
        {pieces.map((p, i) => (
          <div key={i} className="grid grid-cols-[60px_60px_70px_70px_1fr_30px] gap-1.5">
            <input type="number" step="0.25" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="1" value={p.thickness} onChange={(e) => setPieces((ps) => ps.map((x, idx) => idx === i ? { ...x, thickness: e.target.value } : x))} />
            <input type="number" step="0.25" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="6" value={p.width} onChange={(e) => setPieces((ps) => ps.map((x, idx) => idx === i ? { ...x, width: e.target.value } : x))} />
            <input type="number" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="96" value={p.length} onChange={(e) => setPieces((ps) => ps.map((x, idx) => idx === i ? { ...x, length: e.target.value } : x))} />
            <input type="number" step="0.01" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="0" value={p.pricePerBF} onChange={(e) => setPieces((ps) => ps.map((x, idx) => idx === i ? { ...x, pricePerBF: e.target.value } : x))} />
            <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={p.species} onChange={(e) => setPieces((ps) => ps.map((x, idx) => idx === i ? { ...x, species: e.target.value } : x))}>
              {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button aria-label="Delete" type="button" onClick={() => setPieces((ps) => ps.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-zinc-400 hover:text-rose-300"><Trash2 className="mx-auto h-3 w-3" /></button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => setPieces((ps) => [...ps, { thickness: '', width: '', length: '', pricePerBF: '', species: 'pine' }])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-amber-500/40"><Plus className="h-3 w-3" />Add piece</button>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending || pieces.filter((p) => p.thickness && p.width && p.length).length === 0} className="rounded bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Tally'}
          </button>
        </div>

        {result && result.totalBoardFeet != null && (
          <div className="grid grid-cols-3 gap-2 pt-2">
            <div className="rounded-lg border-2 border-amber-500/40 bg-amber-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-amber-300">Total BF</div><div className="font-mono text-2xl text-amber-100">{result.totalBoardFeet}</div></div>
            <div className="rounded border border-amber-700/30 bg-zinc-950/40 p-3"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Pieces</div><div className="font-mono text-2xl text-amber-200">{result.totalPieces}</div></div>
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-3"><div className="text-[10px] uppercase tracking-wider text-emerald-300">Total cost</div><div className="font-mono text-2xl text-emerald-100">${result.totalCost}</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function JointStrengthGuide() {
  const [jointType, setJointType] = useState('butt');
  const [species, setSpecies] = useState('pine');
  const [result, setResult] = useState<JointResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callCarp<JointResult>('jointStrength', { jointType, species });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-stone-500/30 bg-gradient-to-br from-zinc-950 via-stone-900/20 to-zinc-950">
      <header className="flex items-center justify-between border-b border-stone-500/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Wrench className="h-4 w-4 text-stone-400" />
          <span className="text-sm font-semibold text-white">Joint strength guide</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">carpentry.jointStrength</span>
        </div>
        {result && (
          <SaveAsDtuButton compact apiSource="concord-carpentry-joint"
            title={`${result.jointType} in ${result.species} — ${result.adjustedStrength} strength (${result.classification})`}
            content={`Joint: ${result.jointType}\nWood: ${result.species}\nBase strength: ${result.baseStrength}\nSpecies multiplier: ${result.speciesMultiplier}×\nAdjusted strength: ${result.adjustedStrength}\nClassification: ${result.classification}\n${result.recommendation || ''}`}
            extraTags={['carpentry', 'joinery', jointType, species]} rawData={{ jointType, species, result }} />
        )}
      </header>

      <div className="grid gap-3 p-4 md:grid-cols-[260px_1fr]">
        <div className="space-y-2">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Joint type</span>
            <select value={jointType} onChange={(e) => setJointType(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              {JOINT_TYPES.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400">Wood species</span>
            <select value={species} onChange={(e) => setSpecies(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
              {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="w-full rounded bg-stone-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-stone-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Evaluate joint'}
          </button>
        </div>

        <div className="space-y-2">
          {!result && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">Pick joint type and wood species, then evaluate.</div>}
          {result && (
            <>
              <div className="rounded-lg border-2 border-stone-500/40 bg-stone-500/10 p-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-[11px] text-stone-300">{result.jointType} in {result.species}</div>
                  <div className={`rounded px-2 py-0.5 text-[10px] font-semibold ${result.classification?.includes('strong') || result.classification?.includes('Excellent') ? 'bg-emerald-500/20 text-emerald-200' : result.classification?.includes('weak') ? 'bg-rose-500/20 text-rose-200' : 'bg-amber-500/20 text-amber-200'}`}>{result.classification}</div>
                </div>
                <div className="mt-2 font-mono text-3xl text-stone-100">{result.adjustedStrength}<span className="text-sm text-zinc-400"> / 100</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-800">
                  <div className={`h-full ${result.adjustedStrength && result.adjustedStrength > 70 ? 'bg-emerald-500' : result.adjustedStrength && result.adjustedStrength > 40 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${Math.min(100, result.adjustedStrength || 0)}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-zinc-400">Base {result.baseStrength} × {result.speciesMultiplier} species multiplier</div>
              </div>
              {result.recommendation && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-2 py-1.5 text-[11px] text-amber-200">{result.recommendation}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WoodSelectionGuide() {
  const [application, setApplication] = useState<'furniture' | 'flooring' | 'outdoor' | 'cabinetry' | 'structural' | 'turning'>('furniture');
  const [budget, setBudget] = useState<'low' | 'medium' | 'high'>('medium');
  const [indoor, setIndoor] = useState(true);
  const [result, setResult] = useState<WoodSelectionResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callCarp<WoodSelectionResult>('woodSelection', { application, budget, indoor });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-emerald-700/30 bg-gradient-to-br from-zinc-950 via-emerald-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-emerald-700/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <TreePine className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Wood selection</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">carpentry.woodSelection</span>
        </div>
        {result?.recommendations && (
          <SaveAsDtuButton compact apiSource="concord-carpentry-wood"
            title={`Wood selection — ${result.application} (${result.budget} budget, ${result.indoor ? 'indoor' : 'outdoor'})`}
            content={`Application: ${result.application}\nBudget: ${result.budget}\nIndoor: ${result.indoor}\n\nRecommendations:\n${result.recommendations.map((w, i) => `${i + 1}. ${w.species} (score ${w.score}) — ${w.reason}\n   cost: ${w.cost} / hardness: ${w.hardness} / rot: ${w.rotResistant ? 'resistant' : 'not'}`).join('\n')}`}
            extraTags={['carpentry', 'wood-selection', application]} rawData={{ application, budget, indoor, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_120px]">
          <select value={application} onChange={(e) => setApplication(e.target.value as typeof application)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="furniture">Furniture</option>
            <option value="flooring">Flooring</option>
            <option value="outdoor">Outdoor / deck</option>
            <option value="cabinetry">Cabinetry</option>
            <option value="structural">Structural</option>
            <option value="turning">Turning</option>
          </select>
          <select value={budget} onChange={(e) => setBudget(e.target.value as typeof budget)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="low">Low budget</option>
            <option value="medium">Medium budget</option>
            <option value="high">High budget</option>
          </select>
          <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
            <input type="checkbox" checked={indoor} onChange={(e) => setIndoor(e.target.checked)} />Indoor
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Recommend'}
          </button>
        </div>

        {result?.recommendations && (
          <div className="grid gap-2 md:grid-cols-2">
            {result.recommendations.map((w, i) => (
              <div key={i} className={`rounded-lg border p-3 ${i === 0 ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-emerald-700/20 bg-zinc-950/40'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {i === 0 && <Trophy className="h-3.5 w-3.5 text-amber-400" />}
                    <span className="font-mono text-sm font-semibold text-white capitalize">{w.species}</span>
                  </div>
                  <span className="font-mono text-xs text-emerald-300">{w.score}/100</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{w.cost}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">{w.hardness}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">workability: {w.workability}</span>
                  {w.rotResistant && <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">rot-resistant</span>}
                </div>
                <div className="mt-1 text-[11px] text-zinc-400">{w.appearance}</div>
                <div className="mt-1 text-[10px] text-amber-300">{w.reason}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FinishRecommender() {
  const [species, setSpecies] = useState('oak');
  const [application, setApplication] = useState<'furniture' | 'flooring' | 'outdoor' | 'cabinetry' | 'turning'>('furniture');
  const [indoor, setIndoor] = useState(true);
  const [result, setResult] = useState<FinishResult | null>(null);

  const compute = useMutation({
    mutationFn: async () => {
      const r = await callCarp<FinishResult>('finishRecommendation', { species, application, indoor });
      setResult(r);
      return r;
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-orange-700/30 bg-gradient-to-br from-zinc-950 via-orange-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-orange-700/30 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Paintbrush className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-white">Finish recommender</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">carpentry.finishRecommendation</span>
        </div>
        {result?.recommendations && (
          <SaveAsDtuButton compact apiSource="concord-carpentry-finish"
            title={`Finish for ${result.species} ${result.application}`}
            content={`Species: ${result.species}\nApplication: ${result.application}\n\nFinishes:\n${result.recommendations.map((f, i) => `${i + 1}. ${f.name} (${f.type}) — cure ${f.cureTime}, durability ${f.durability}, ${f.appearance}, difficulty ${f.difficulty}${f.recommendation ? `\n   ${f.recommendation}` : ''}`).join('\n')}`}
            extraTags={['carpentry', 'finish', species]} rawData={{ species, application, indoor, result }} />
        )}
      </header>

      <div className="p-4 space-y-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_120px_120px]">
          <select value={species} onChange={(e) => setSpecies(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={application} onChange={(e) => setApplication(e.target.value as typeof application)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white">
            <option value="furniture">Furniture</option>
            <option value="flooring">Flooring</option>
            <option value="outdoor">Outdoor</option>
            <option value="cabinetry">Cabinetry</option>
            <option value="turning">Turning</option>
          </select>
          <label className="flex items-center justify-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300">
            <input type="checkbox" checked={indoor} onChange={(e) => setIndoor(e.target.checked)} />Indoor
          </label>
          <button type="button" onClick={() => compute.mutate()} disabled={compute.isPending} className="rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-400 disabled:opacity-50">
            {compute.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Suggest finish'}
          </button>
        </div>

        {result?.recommendations && (
          <div className="space-y-2">
            {result.recommendations.map((f, i) => (
              <div key={i} className={`rounded-lg border p-3 ${i === 0 ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-700/20 bg-zinc-950/40'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Droplet className={`h-3.5 w-3.5 ${i === 0 ? 'text-orange-300' : 'text-zinc-400'}`} />
                    <span className="font-mono text-sm font-semibold text-white">{f.name}</span>
                    <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{f.type}</span>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-[10px] ${f.difficulty === 'easy' ? 'bg-emerald-500/20 text-emerald-200' : f.difficulty === 'medium' ? 'bg-amber-500/20 text-amber-200' : 'bg-rose-500/20 text-rose-200'}`}>{f.difficulty}</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">cure: <span className="font-mono text-orange-200">{f.cureTime}</span></span>
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">durability: <span className="font-mono text-orange-200">{f.durability}</span></span>
                  <span className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-zinc-300">{f.appearance}</span>
                </div>
                {f.recommendation && <div className="mt-1 text-[11px] text-amber-300">{f.recommendation}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function CarpentryShop() {
  return (
    <div className="space-y-4">
      <BoardFootCalc />
      <JointStrengthGuide />
      <WoodSelectionGuide />
      <FinishRecommender />
    </div>
  );
}
