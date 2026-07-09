'use client';

/**
 * PeriodCauseEffectTools — historical-period comparison + cause/effect chain
 * mapper. Wires `history.comparePeriods` + `history.causeEffect`, which had
 * ZERO frontend callers before this rebuild (confirmed by grep across
 * concord-frontend — see docs/lens-specs/history-capability-map.md).
 *
 * Same `CalcPanel` shell as `TimelineSourceTools` (paired-macro analyze +
 * two-column results + Save-as-DTU) — two unrelated-but-shape-compatible
 * macros sharing one ad-hoc analysis surface, matching the existing
 * convention this lens already established for timelineBuild+sourceEvaluate.
 */

import { useState } from 'react';
import { GitCompareArrows, Link2, Plus, Trash2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface PeriodRow { name: string; startYear: string; endYear: string; features: string; population: string; technology: string; governance: string }
interface ChainRow { cause: string; effect: string; type: 'direct' | 'indirect'; strength: 'weak' | 'moderate' | 'strong'; timelag: string }

interface ComparePeriodsResult {
  periods?: Array<{ name: string; startYear: string; endYear: string; duration: number; keyFeatures: string[]; population: string; technology: string; governance: string }>;
  longestPeriod?: string;
  shortestPeriod?: string;
  sharedFeatures?: string[];
}
interface CauseEffectResult {
  chains?: Array<{ cause: string; effect: string; type: string; strength: string; timelag: string }>;
  totalLinks?: number;
  directCauses?: number;
  indirectCauses?: number;
  strongLinks?: number;
  rootCauses?: string[];
}

const emptyPeriod = (): PeriodRow => ({ name: '', startYear: '', endYear: '', features: '', population: '', technology: '', governance: '' });
const emptyChain = (): ChainRow => ({ cause: '', effect: '', type: 'direct', strength: 'moderate', timelag: '' });

export function PeriodCauseEffectTools() {
  const [periods, setPeriods] = useState<PeriodRow[]>([emptyPeriod(), emptyPeriod()]);
  const [chains, setChains] = useState<ChainRow[]>([emptyChain()]);

  const updatePeriod = <K extends keyof PeriodRow>(i: number, key: K, value: PeriodRow[K]) =>
    setPeriods((ps) => ps.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  const updateChain = <K extends keyof ChainRow>(i: number, key: K, value: ChainRow[K]) =>
    setChains((cs) => cs.map((c, idx) => (idx === i ? { ...c, [key]: value } : c)));

  return (
    <CalcPanel<ComparePeriodsResult, CauseEffectResult>
      title="Period comparison + cause &amp; effect chains"
      domain="history"
      icon={<GitCompareArrows className="h-5 w-5 text-indigo-400" />}
      macroBadge="history.comparePeriods + causeEffect"
      accent="indigo"
      disabled={periods.filter((p) => p.name.trim() && p.startYear.trim()).length < 2}
      disabledHint="Add at least 2 named periods to compare"
      left={{
        macro: 'comparePeriods',
        buildArtifact: () => ({
          data: {
            periods: periods
              .filter((p) => p.name.trim())
              .map((p) => ({
                name: p.name, startYear: p.startYear, endYear: p.endYear,
                features: p.features.split(',').map((f) => f.trim()).filter(Boolean),
                population: p.population || undefined, technology: p.technology || undefined, governance: p.governance || undefined,
              })),
          },
        }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Periods to compare</div>
            {periods.map((p, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_70px_70px_1fr_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Period name" value={p.name} onChange={(e) => updatePeriod(i, 'name', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="start" value={p.startYear} onChange={(e) => updatePeriod(i, 'startYear', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" placeholder="end" value={p.endYear} onChange={(e) => updatePeriod(i, 'endYear', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="features, comma-separated" value={p.features} onChange={(e) => updatePeriod(i, 'features', e.target.value)} />
                <button type="button" onClick={() => setPeriods((ps) => ps.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label={`Remove period ${p.name || i + 1}`}><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setPeriods((ps) => [...ps, emptyPeriod()])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-indigo-500/40 hover:text-indigo-200"><Plus className="h-3 w-3" />Add period</button>
          </div>
        ),
      }}
      right={{
        macro: 'causeEffect',
        buildArtifact: () => ({
          data: {
            chains: chains
              .filter((c) => c.cause.trim() && c.effect.trim())
              .map((c) => ({ cause: c.cause, effect: c.effect, type: c.type, strength: c.strength, timelag: c.timelag || undefined })),
          },
        }),
        render: (
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Cause → effect chains</div>
            {chains.map((c, i) => (
              <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_90px_90px_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Cause" value={c.cause} onChange={(e) => updateChain(i, 'cause', e.target.value)} />
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Effect" value={c.effect} onChange={(e) => updateChain(i, 'effect', e.target.value)} />
                <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={c.type} onChange={(e) => updateChain(i, 'type', e.target.value as ChainRow['type'])}>
                  <option value="direct">direct</option><option value="indirect">indirect</option>
                </select>
                <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={c.strength} onChange={(e) => updateChain(i, 'strength', e.target.value as ChainRow['strength'])}>
                  <option value="weak">weak</option><option value="moderate">moderate</option><option value="strong">strong</option>
                </select>
                <button type="button" onClick={() => setChains((cs) => cs.filter((_, idx) => idx !== i))} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label={`Remove chain ${i + 1}`}><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setChains((cs) => [...cs, emptyChain()])} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-indigo-500/40 hover:text-indigo-200"><Plus className="h-3 w-3" />Add link</button>
          </div>
        ),
      }}
      renderResults={(cmp, ce) => (
        <>
          <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><GitCompareArrows className="h-3 w-3" />Period comparison</div>
            {!cmp && <div className="text-[11px] text-zinc-400">Analyze to compare.</div>}
            {cmp?.periods && (
              <div className="space-y-1.5 text-[11px]">
                <div className="text-zinc-400">Longest: <span className="text-zinc-100">{cmp.longestPeriod || '—'}</span> · Shortest: <span className="text-zinc-100">{cmp.shortestPeriod || '—'}</span></div>
                {cmp.periods.map((p, i) => (
                  <div key={i} className="rounded border border-indigo-500/15 bg-zinc-950/40 px-2 py-1">
                    <div className="flex items-center justify-between"><span className="text-zinc-100 font-medium">{p.name}</span><span className="font-mono text-[10px] text-indigo-300">{p.duration} yrs</span></div>
                    <div className="text-[9px] text-zinc-400">{p.startYear}–{p.endYear} · pop {p.population} · tech {p.technology} · gov {p.governance}</div>
                    {p.keyFeatures.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{p.keyFeatures.map((f, fi) => <span key={fi} className="rounded bg-zinc-800 px-1 text-[9px] text-zinc-300">{f}</span>)}</div>}
                  </div>
                ))}
                {cmp.sharedFeatures && cmp.sharedFeatures.length > 0 && (
                  <div className="text-[10px] text-emerald-300">Shared features: {cmp.sharedFeatures.join(', ')}</div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Link2 className="h-3 w-3" />Causation chains</div>
            {!ce && <div className="text-[11px] text-zinc-400">Analyze to map.</div>}
            {ce?.chains && (
              <div className="space-y-1.5 text-[11px]">
                <div className="text-zinc-400">{ce.totalLinks} links · {ce.directCauses} direct · {ce.indirectCauses} indirect · {ce.strongLinks} strong</div>
                {ce.chains.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded border border-amber-500/15 bg-zinc-950/40 px-2 py-1">
                    <span className="flex-1 text-zinc-100 truncate">{c.cause}</span>
                    <span className="text-amber-400">→</span>
                    <span className="flex-1 text-zinc-100 truncate">{c.effect}</span>
                    <span className={`rounded px-1 text-[9px] ${c.strength === 'strong' ? 'bg-rose-500/20 text-rose-200' : 'bg-zinc-800 text-zinc-400'}`}>{c.strength}</span>
                  </div>
                ))}
                {ce.rootCauses && ce.rootCauses.length > 0 && (
                  <div className="text-[10px] text-zinc-400">Root causes: {ce.rootCauses.join(', ')}</div>
                )}
              </div>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-history-period-causation',
        title: (cmp, ce) => `History analysis — ${cmp.periods?.length ?? 0} periods · ${ce.totalLinks ?? 0} causal links`,
        content: (cmp, ce) =>
          `Period comparison:\n${(cmp.periods || []).map((p) => `  ${p.name} (${p.startYear}-${p.endYear}, ${p.duration}y)`).join('\n')}\n\nCause & effect:\n${(ce.chains || []).map((c) => `  ${c.cause} -> ${c.effect} [${c.type}, ${c.strength}]`).join('\n')}`,
        tags: () => ['history', 'periods', 'causation'],
        rawData: (cmp, ce) => ({ periods, chains, comparison: cmp, causeEffect: ce }),
      }}
    />
  );
}
