'use client';

/**
 * FieldMonitoringPanel — species population trend + trail condition
 * prioritization surface for the environment lens. Wires
 * environment.populationTrend + environment.trailCondition.
 *
 * These two macros predate the Watershed/Persefoni carbon-accounting
 * "full-app parity" build (see server/domains/environment.js header
 * comment: "Pure-compute environmental helpers") and were only ever
 * reachable through a legacy quick-actions panel whose action ids
 * (`population_trend`, `trail_report`) never matched the registered
 * macro names (`populationTrend`, `trailCondition`) — every click
 * silently fell through to an LLM guess instead of running the real,
 * cited computation. That legacy panel has been removed; this is the
 * real, designed home for both macros, following the same CalcPanel
 * pattern as `ComplianceDiversionPanel` (which already correctly
 * wires `complianceCheck` + `diversionRate`).
 */

import { useState } from 'react';
import { Bug, Footprints, Plus, Trash2 } from 'lucide-react';
import { CalcPanel } from '@/components/lens-primitives/CalcPanel';

interface SurveyRow { date: string; count: string }
interface TrailRow { name: string; condition: '5' | '3' | '1' | '0'; usage: 'high' | 'medium' | 'low'; maintenanceNeeded: string }

interface PopulationResult {
  species?: string;
  trend?: 'insufficient_data' | 'increasing' | 'stable' | 'declining';
  changePercent?: number;
  firstCount?: number;
  lastCount?: number;
  dataPoints?: number;
}
interface TrailResult {
  prioritized?: Array<{ name: string; condition: number; usage: string; priorityScore: number; maintenanceNeeded: string }>;
  total?: number;
}

const TREND_LABEL: Record<string, string> = {
  increasing: 'Increasing',
  stable: 'Stable',
  declining: 'Declining',
  insufficient_data: 'Insufficient data',
};
const CONDITION_LABEL: Record<string, string> = { '5': 'Good', '3': 'Fair', '1': 'Poor', '0': 'Closed' };

export function FieldMonitoringPanel() {
  const [speciesName, setSpeciesName] = useState('');
  const [surveys, setSurveys] = useState<SurveyRow[]>([{ date: '', count: '' }]);
  const [trails, setTrails] = useState<TrailRow[]>([{ name: '', condition: '3', usage: 'medium', maintenanceNeeded: '' }]);

  const addSurvey = () => setSurveys((rows) => [...rows, { date: '', count: '' }]);
  const updateSurvey = (i: number, key: keyof SurveyRow, value: string) =>
    setSurveys((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const removeSurvey = (i: number) => setSurveys((rows) => rows.filter((_, idx) => idx !== i));

  const addTrail = () => setTrails((rows) => [...rows, { name: '', condition: '3', usage: 'medium', maintenanceNeeded: '' }]);
  const updateTrail = <K extends keyof TrailRow>(i: number, key: K, value: TrailRow[K]) =>
    setTrails((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));
  const removeTrail = (i: number) => setTrails((rows) => rows.filter((_, idx) => idx !== i));

  return (
    <CalcPanel<PopulationResult, TrailResult>
      title="Population trend + trail condition"
      domain="environment"
      icon={<Bug className="h-5 w-5 text-emerald-400" />}
      macroBadge="environment.populationTrend + trailCondition"
      accent="emerald"
      left={{
        macro: 'populationTrend',
        buildArtifact: () => ({
          data: {
            surveyData: surveys
              .filter((s) => s.date.trim() && s.count.trim())
              .map((s) => ({ date: s.date.trim(), count: parseInt(s.count, 10) || 0 })),
          },
        }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Species survey history (≥2 dated counts)</div>
            <input
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
              placeholder="Species name (e.g. Red-tailed Hawk)"
              value={speciesName}
              onChange={(e) => setSpeciesName(e.target.value)}
            />
            <div className="grid grid-cols-[1fr_100px_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
              <span>Date</span><span>Count</span><span></span>
            </div>
            {surveys.map((s, i) => (
              <div key={i} className="grid grid-cols-[1fr_100px_30px] gap-1.5">
                <input type="date" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={s.date} onChange={(e) => updateSurvey(i, 'date', e.target.value)} />
                <input type="number" min={0} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white font-mono" value={s.count} onChange={(e) => updateSurvey(i, 'count', e.target.value)} />
                <button type="button" onClick={() => removeSurvey(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addSurvey} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"><Plus className="h-3 w-3" />Add survey point</button>
          </div>
        ),
      }}
      right={{
        macro: 'trailCondition',
        buildArtifact: () => ({
          data: {
            trails: trails
              .filter((t) => t.name.trim())
              .map((t) => ({ name: t.name.trim(), condition: Number(t.condition), usage: t.usage, maintenanceNeeded: t.maintenanceNeeded.trim() })),
          },
        }),
        render: (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400">Trail assets to prioritize</div>
            <div className="grid grid-cols-[1fr_90px_90px_1fr_30px] gap-1.5 text-[9px] uppercase tracking-wider text-zinc-400">
              <span>Name</span><span>Condition</span><span>Usage</span><span>Maintenance needed</span><span></span>
            </div>
            {trails.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_90px_90px_1fr_30px] gap-1.5">
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Ridge Loop" value={t.name} onChange={(e) => updateTrail(i, 'name', e.target.value)} />
                <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={t.condition} onChange={(e) => updateTrail(i, 'condition', e.target.value as TrailRow['condition'])}>
                  <option value="5">Good</option><option value="3">Fair</option><option value="1">Poor</option><option value="0">Closed</option>
                </select>
                <select className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" value={t.usage} onChange={(e) => updateTrail(i, 'usage', e.target.value as TrailRow['usage'])}>
                  <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
                <input className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" placeholder="Re-blaze, repair bridge…" value={t.maintenanceNeeded} onChange={(e) => updateTrail(i, 'maintenanceNeeded', e.target.value)} />
                <button type="button" onClick={() => removeTrail(i)} className="rounded border border-zinc-800 text-xs text-zinc-400 hover:text-rose-300" aria-label="Remove"><Trash2 className="mx-auto h-3 w-3" /></button>
              </div>
            ))}
            <button type="button" onClick={addTrail} className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-200"><Plus className="h-3 w-3" />Add trail</button>
          </div>
        ),
      }}
      renderResults={(population, trail) => (
        <>
          <div className={`rounded-lg border p-3 ${population?.trend === 'declining' ? 'border-rose-500/30 bg-rose-500/5' : population?.trend === 'increasing' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Bug className="h-3 w-3" />Population trend{speciesName ? ` — ${speciesName}` : ''}</div>
            {!population && <div className="text-[11px] text-zinc-400">Run to analyze.</div>}
            {population && (
              <div className="space-y-1.5 text-[11px]">
                <div className="text-xl font-mono text-zinc-100">{TREND_LABEL[population.trend || 'insufficient_data']}</div>
                {population.trend !== 'insufficient_data' ? (
                  <>
                    <div className="text-zinc-300">{population.changePercent && population.changePercent > 0 ? '+' : ''}{population.changePercent}% change</div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">First count</div><div className="font-mono text-zinc-200">{population.firstCount}</div></div>
                      <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1"><div className="text-[9px] text-zinc-400">Last count</div><div className="font-mono text-zinc-200">{population.lastCount}</div></div>
                    </div>
                  </>
                ) : (
                  <div className="text-zinc-400">Add at least 2 dated survey points to compute a trend.</div>
                )}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
            <div className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-400"><Footprints className="h-3 w-3" />Trail maintenance priority</div>
            {!trail && <div className="text-[11px] text-zinc-400">Run to prioritize.</div>}
            {trail && trail.prioritized && (
              <ul className="space-y-1">
                {trail.prioritized.map((t, i) => (
                  <li key={i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[11px]">
                    <span className="text-zinc-100">{i + 1}. {t.name}</span>
                    <span className="text-zinc-400">{CONDITION_LABEL[String(t.condition)] || t.condition} · {t.usage} use · score {t.priorityScore}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
      dtu={{
        apiSource: 'concord-env-field-monitoring',
        title: (p, t) => `Field monitoring — ${TREND_LABEL[p.trend || 'insufficient_data']}${speciesName ? ` (${speciesName})` : ''} · ${t.total ?? 0} trails prioritized`,
        content: (p, t) =>
          `Population trend${speciesName ? ` (${speciesName})` : ''}: ${TREND_LABEL[p.trend || 'insufficient_data']}${p.trend !== 'insufficient_data' ? ` (${p.changePercent}% change, ${p.firstCount} → ${p.lastCount})` : ''}\n\nTrail priority:\n${(t.prioritized || []).map((r, i) => `  ${i + 1}. ${r.name} — ${CONDITION_LABEL[String(r.condition)] || r.condition}, ${r.usage} use, score ${r.priorityScore}${r.maintenanceNeeded ? ` (${r.maintenanceNeeded})` : ''}`).join('\n')}`,
        tags: () => ['environment', 'population-trend', 'trail-condition'],
        rawData: (p, t) => ({ speciesName, surveys, trails, population: p, trail: t }),
      }}
    />
  );
}

export default FieldMonitoringPanel;
