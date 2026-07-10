'use client';

/**
 * InterventionPlanner — ROI / cost-benefit intervention design.
 *
 * Wires the ORIGINAL `suffering` domain macro `interventionDesign` — a
 * batch what-if planner distinct from (and complementary to) the ongoing
 * `intervention-track`/`intervention-update` status tracker. Where the
 * tracker follows an ALREADY-DECIDED intervention through
 * proposed→in_progress→completed, `interventionDesign` helps decide WHICH
 * interventions are worth doing in the first place: given a set of causes
 * and candidate interventions, it computes expected impact, cost-benefit
 * ratio, ROI, a priority score (impact / cost×effort×sqrt(time)), coverage,
 * and a greedy minimum-cover set — then flags any causes no candidate
 * addresses.
 *
 * The rebuild audit found this macro had ZERO frontend callers. This panel
 * surfaces it and bridges the two systems: any ranked recommendation can be
 * "Tracked" into the ongoing intervention tracker via a real
 * `intervention-track` call, carrying its ROI into the note history.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/EmptyState';
import { Plus, Trash2, Loader2, Calculator, ListChecks, ArrowUpRight } from 'lucide-react';

interface CauseDraft { key: string; description: string; severity: number; probability: number }
interface InterventionDraft {
  key: string; description: string; targetKeys: string[];
  cost: number; effort: number; effectiveness: number; timeToImplement: number;
}
interface RankedIntervention {
  id: string; description: string; targetCauseCount: number;
  cost: number; effort: number; effectiveness: number; timeToImplement: number;
  expectedImpact: number; riskReduction: number; costBenefitRatio: number;
  roi: number; priorityScore: number; coverage: number;
}
interface DesignResult {
  totalCauses: number;
  totalInterventions: number;
  rankedInterventions: RankedIntervention[];
  topRecommendations: { id: string; description: string; priorityScore: number; roi: number }[];
  topRecommendationsCost: number;
  topRecommendationsImpact: number;
  uncoveredCauses: { id: string; description: string; severity: number }[];
  minimumCoverSet: string[];
  coverageGap: number;
  overallCoverage: number;
}

let seq = 0;
function blankCause(): CauseDraft { seq += 1; return { key: `c_${seq}`, description: '', severity: 5, probability: 0.5 }; }
function blankIntv(): InterventionDraft {
  seq += 1;
  return { key: `i_${seq}`, description: '', targetKeys: [], cost: 50, effort: 5, effectiveness: 0.5, timeToImplement: 30 };
}

export function InterventionPlanner({ onTracked }: { onTracked: () => void }) {
  const [causes, setCauses] = useState<CauseDraft[]>([blankCause(), blankCause()]);
  const [interventions, setInterventions] = useState<InterventionDraft[]>([blankIntv()]);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<DesignResult | null>(null);

  const addCause = useCallback(() => setCauses((c) => [...c, blankCause()]), []);
  const updateCause = useCallback((key: string, patch: Partial<CauseDraft>) => {
    setCauses((c) => c.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }, []);
  const removeCause = useCallback((key: string) => {
    setCauses((c) => c.filter((x) => x.key !== key));
    setInterventions((iv) => iv.map((x) => ({ ...x, targetKeys: x.targetKeys.filter((k) => k !== key) })));
  }, []);

  const addIntv = useCallback(() => setInterventions((iv) => [...iv, blankIntv()]), []);
  const updateIntv = useCallback((key: string, patch: Partial<InterventionDraft>) => {
    setInterventions((iv) => iv.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  }, []);
  const removeIntv = useCallback((key: string) => setInterventions((iv) => iv.filter((x) => x.key !== key)), []);
  const toggleTarget = useCallback((intvKey: string, causeKey: string) => {
    setInterventions((iv) => iv.map((x) => (x.key === intvKey
      ? { ...x, targetKeys: x.targetKeys.includes(causeKey) ? x.targetKeys.filter((k) => k !== causeKey) : [...x.targetKeys, causeKey] }
      : x)));
  }, []);

  const design = useCallback(async () => {
    const validCauses = causes.filter((c) => c.description.trim());
    const validIntvs = interventions.filter((i) => i.description.trim());
    if (validCauses.length === 0) { setErr('Add at least one cause.'); return; }
    if (validIntvs.length === 0) { setErr('Add at least one candidate intervention.'); return; }
    setBusy(true);
    setErr(null);
    const res = await lensRun<DesignResult>('suffering', 'interventionDesign', {
      causes: validCauses.map((c) => ({ id: c.key, description: c.description, severity: c.severity, probability: c.probability })),
      interventions: validIntvs.map((i) => ({
        id: i.key, description: i.description, targetCauseIds: i.targetKeys,
        cost: i.cost, effort: i.effort, expectedEffectiveness: i.effectiveness, timeToImplement: i.timeToImplement,
      })),
    });
    setBusy(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Design failed'); return; }
    setResult(res.data.result);
  }, [causes, interventions]);

  const track = useCallback(async (r: RankedIntervention) => {
    setTracking(r.id);
    setErr(null);
    const res = await lensRun('suffering', 'intervention-track', {
      title: r.description,
      description: `From ROI planner — priority ${r.priorityScore}, ROI ${r.roi}%, cost-benefit ${r.costBenefitRatio}, coverage ${(r.coverage * 100).toFixed(0)}%.`,
    });
    setTracking(null);
    if (!res.data.ok) { setErr(res.data.error || 'Track failed'); return; }
    onTracked();
  }, [onTracked]);

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <Calculator className="w-4 h-4 text-neon-blue" /> Intervention ROI Planner
          {busy && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <p className="text-xs text-gray-400 mb-3">
          Compare candidate interventions before committing — cost-benefit ratio, ROI, priority
          score, and a greedy minimum-cover set. Wires the <code>interventionDesign</code> macro.
        </p>
        {err && <p className="text-xs text-red-400 mb-2" role="alert">{err}</p>}

        <p className="text-xs text-gray-400 mb-1.5">Causes</p>
        <div className="space-y-1.5 mb-3">
          {causes.map((c) => (
            <div key={c.key} className="flex items-center gap-1.5 text-xs">
              <input
                value={c.description}
                onChange={(e) => updateCause(c.key, { description: e.target.value })}
                placeholder="Cause description"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1"
              />
              <input
                type="number" min={1} max={10} value={c.severity}
                onChange={(e) => updateCause(c.key, { severity: Number(e.target.value) })}
                title="Severity 1-10" className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1"
              />
              <input
                type="number" min={0} max={1} step={0.1} value={c.probability}
                onChange={(e) => updateCause(c.key, { probability: Number(e.target.value) })}
                title="Probability 0-1" className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1"
              />
              <button onClick={() => removeCause(c.key)} className="text-gray-600 hover:text-red-400" aria-label="Remove cause">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={addCause} className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs hover:bg-white/10">
            <Plus className="w-3.5 h-3.5" /> Add cause
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-1.5">Candidate interventions</p>
        <div className="space-y-2 mb-3">
          {interventions.map((iv) => (
            <div key={iv.key} className="rounded-lg bg-white/[0.03] border border-white/10 p-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs">
                <input
                  value={iv.description}
                  onChange={(e) => updateIntv(iv.key, { description: e.target.value })}
                  placeholder="Intervention description"
                  className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1"
                />
                <input type="number" min={0} value={iv.cost} onChange={(e) => updateIntv(iv.key, { cost: Number(e.target.value) })} title="Cost" className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-1" />
                <input type="number" min={1} max={10} value={iv.effort} onChange={(e) => updateIntv(iv.key, { effort: Number(e.target.value) })} title="Effort 1-10" className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1" />
                <input type="number" min={0} max={1} step={0.1} value={iv.effectiveness} onChange={(e) => updateIntv(iv.key, { effectiveness: Number(e.target.value) })} title="Effectiveness 0-1" className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1" />
                <input type="number" min={1} value={iv.timeToImplement} onChange={(e) => updateIntv(iv.key, { timeToImplement: Number(e.target.value) })} title="Days to implement" className="w-16 bg-white/5 border border-white/10 rounded px-1.5 py-1" />
                <button onClick={() => removeIntv(iv.key)} className="text-gray-600 hover:text-red-400" aria-label="Remove intervention">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {causes.filter((c) => c.description.trim()).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {causes.filter((c) => c.description.trim()).map((c) => (
                    <label key={c.key} className="flex items-center gap-1 text-[10px] text-gray-400">
                      <input
                        type="checkbox"
                        checked={iv.targetKeys.includes(c.key)}
                        onChange={() => toggleTarget(iv.key, c.key)}
                      />
                      {c.description.slice(0, 24)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
          <button onClick={addIntv} className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs hover:bg-white/10">
            <Plus className="w-3.5 h-3.5" /> Add intervention
          </button>
        </div>

        <button
          onClick={design}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-blue/20 text-neon-blue rounded-lg text-sm hover:bg-neon-blue/30 disabled:opacity-50"
        >
          <ListChecks className="w-4 h-4" /> Design &amp; Rank
        </button>
      </div>

      {result && result.rankedInterventions.length === 0 && (
        <EmptyState compact title="No interventions ranked." description="Add causes and candidate interventions above." />
      )}

      {result && result.rankedInterventions.length > 0 && (
        <div className="panel p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10">
              Overall coverage {(result.overallCoverage * 100).toFixed(0)}%
            </span>
            {result.coverageGap > 0 && (
              <span className="px-2.5 py-1 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                {result.coverageGap} cause{result.coverageGap !== 1 ? 's' : ''} uncovered
              </span>
            )}
            <span className="px-2.5 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Min cover set: {result.minimumCoverSet.length} intervention{result.minimumCoverSet.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1.5">
            {result.rankedInterventions.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.03] border border-white/10">
                <span className="text-xs text-gray-500 w-5 shrink-0">#{i + 1}</span>
                <span className="text-sm flex-1 truncate">{r.description}</span>
                <span className="text-[11px] text-gray-400 shrink-0">cov {(r.coverage * 100).toFixed(0)}%</span>
                <span className="text-[11px] text-gray-400 shrink-0">ROI {r.roi.toFixed(0)}%</span>
                <span className="text-xs font-bold text-neon-purple shrink-0" title="Priority score">{r.priorityScore.toFixed(1)}</span>
                <button
                  onClick={() => track(r)}
                  disabled={tracking === r.id}
                  className="flex items-center gap-1 px-2 py-1 bg-neon-blue/20 text-neon-blue rounded text-[11px] hover:bg-neon-blue/30 disabled:opacity-50 shrink-0"
                  title="Track this intervention in the ongoing tracker"
                >
                  {tracking === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowUpRight className="w-3 h-3" />}
                  Track
                </button>
              </div>
            ))}
          </div>
          {result.uncoveredCauses.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Uncovered causes</p>
              <ul className="space-y-1">
                {result.uncoveredCauses.map((c) => (
                  <li key={c.id} className="text-xs flex justify-between bg-rose-500/[0.06] border border-rose-500/20 rounded px-2 py-1">
                    <span>{c.description}</span>
                    <span className="text-rose-300">sev {c.severity}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
