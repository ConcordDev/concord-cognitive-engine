'use client';

/**
 * OrganizationESGPanel — bespoke UI for the real `eco.sustainabilityScore`
 * macro (server/domains/eco.js). That handler does a genuine 15-indicator,
 * three-pillar ESG assessment (board diversity, transparency, labor
 * practices, emissions reduction, etc.) — but it is a CORPORATE/organization
 * framework, not a personal metric: no individual has "board diversity" or
 * "regulatory compliance" data to enter. It was previously left entirely
 * unsurfaced in this lens for exactly that reason (see
 * docs/lens-specs/eco-capability-map.md).
 *
 * This panel gives the macro a genuine, honestly-scoped home: it is visually
 * and tonally distinct from the personal-ecology tools elsewhere in the
 * lens (slate/amber corporate palette vs. the lens's green), it is labeled
 * "Organization ESG (not personal)" everywhere it appears, and it renders
 * the `scope` / `scopeLabel` fields the macro now stamps onto its own
 * result so the framing is enforced by the backend, not just this
 * component's copy. Calls the macro directly via `/api/lens/run`
 * (lensRun), which the server turns into a virtual artifact whose `.data`
 * IS the input object — no pre-existing artifact needed.
 */

import { useCallback, useMemo, useState } from 'react';
import { Building2, Loader2, AlertTriangle, TrendingDown, TrendingUp, Info } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

// Mirrors server/domains/eco.js `pillarDefs` exactly (key + label + pillar).
interface IndicatorDef { key: string; label: string; pillar: 'environmental' | 'social' | 'governance' }

const INDICATORS: IndicatorDef[] = [
  { key: 'emissions', label: 'GHG Emissions Reduction', pillar: 'environmental' },
  { key: 'energyEfficiency', label: 'Energy Efficiency', pillar: 'environmental' },
  { key: 'wasteReduction', label: 'Waste Reduction', pillar: 'environmental' },
  { key: 'waterUsage', label: 'Water Management', pillar: 'environmental' },
  { key: 'biodiversity', label: 'Biodiversity Impact', pillar: 'environmental' },
  { key: 'laborPractices', label: 'Labor Practices', pillar: 'social' },
  { key: 'communityImpact', label: 'Community Impact', pillar: 'social' },
  { key: 'healthSafety', label: 'Health & Safety', pillar: 'social' },
  { key: 'diversity', label: 'Diversity & Inclusion', pillar: 'social' },
  { key: 'humanRights', label: 'Human Rights', pillar: 'social' },
  { key: 'boardDiversity', label: 'Board Diversity', pillar: 'governance' },
  { key: 'transparency', label: 'Transparency & Reporting', pillar: 'governance' },
  { key: 'ethics', label: 'Business Ethics', pillar: 'governance' },
  { key: 'riskManagement', label: 'Risk Management', pillar: 'governance' },
  { key: 'compliance', label: 'Regulatory Compliance', pillar: 'governance' },
];

const PILLARS: { id: 'environmental' | 'social' | 'governance'; label: string }[] = [
  { id: 'environmental', label: 'Environmental' },
  { id: 'social', label: 'Social' },
  { id: 'governance', label: 'Governance' },
];

interface SubScore { indicator: string; label: string; score: number | null; weight: number; rating: string }
interface PillarResult { score: number | null; weight: number; rating: string; dataCompleteness: number; subIndicators: SubScore[]; gaps: { indicator: string; label: string; score: number; improvementPotential: number }[] }
interface ESGResult {
  scope: string;
  scopeLabel: string;
  overallScore: number | null;
  maturityLevel: string;
  overallRating: string;
  pillars: Record<string, PillarResult>;
  strengths: SubScore[];
  weaknesses: SubScore[];
  recommendations: string[];
  dataCompleteness: number;
}

const RATING_TONE: Record<string, string> = {
  excellent: 'text-emerald-400',
  good: 'text-lime-400',
  fair: 'text-amber-400',
  poor: 'text-orange-400',
  critical: 'text-red-400',
  'insufficient data': 'text-gray-500',
  'not reported': 'text-gray-500',
};

export function OrganizationESGPanel() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ESGResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);

  const setValue = useCallback((key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
  }, []);

  const reportedCount = useMemo(
    () => INDICATORS.filter((i) => values[i.key] !== undefined && values[i.key] !== '').length,
    [values],
  );

  const compute = useCallback(async () => {
    if (reportedCount === 0) {
      setError('Enter at least one indicator score (0-100) to compute an assessment.');
      return;
    }
    const indicators: Record<string, Record<string, number>> = { environmental: {}, social: {}, governance: {} };
    for (const def of INDICATORS) {
      const raw = values[def.key];
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (Number.isFinite(n)) indicators[def.pillar][def.key] = n;
    }
    setComputing(true);
    setError(null);
    const r = await lensRun<ESGResult>('eco', 'sustainabilityScore', { indicators });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
    } else {
      setError(r.data?.error || 'Could not compute ESG assessment.');
      setResult(null);
    }
    setComputing(false);
  }, [values, reportedCount]);

  const reset = useCallback(() => {
    setValues({});
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="bg-[#0d1117] border border-amber-500/25 rounded-lg overflow-hidden">
      {/* Deliberately amber/slate, not the lens's personal-ecology green — a
          visual signal this is a different kind of tool. */}
      <header className="px-4 py-2.5 border-b border-amber-500/15 bg-amber-500/[0.04] flex items-start gap-2.5">
        <Building2 className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase font-semibold text-amber-300 tracking-wider">
              Organization ESG
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
              NOT PERSONAL
            </span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
            A corporate ESG (Environmental / Social / Governance) scoring model — board
            diversity, regulatory compliance, labor practices, and 12 more indicators
            an organization reports on, not an individual. If you're tracking your own
            footprint, use Carbon footprint or Life list instead.
          </p>
        </div>
      </header>

      <div className="p-4 space-y-4">
        <div className="flex items-start gap-2 p-2.5 rounded bg-white/[0.02] border border-white/5 text-[11px] text-gray-400">
          <Info className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
          <span>
            Enter a 0-100 score for whichever indicators you have data for — leave the
            rest blank. The assessment weights only the indicators you report and marks
            the rest &ldquo;not reported&rdquo;, so a partial submission still produces an
            honest (if incomplete) score.
          </span>
        </div>

        {PILLARS.map((pillar) => (
          <div key={pillar.id} className="space-y-2">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">{pillar.label}</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {INDICATORS.filter((i) => i.pillar === pillar.id).map((def) => (
                <div key={def.key} className="flex items-center gap-2">
                  <label htmlFor={`esg-${def.key}`} className="flex-1 text-xs text-gray-300 truncate" title={def.label}>
                    {def.label}
                  </label>
                  <input
                    id={`esg-${def.key}`}
                    value={values[def.key] ?? ''}
                    onChange={(e) => setValue(def.key, e.target.value)}
                    inputMode="numeric"
                    placeholder="0-100"
                    className="w-16 px-2 py-1 bg-white/[0.03] border border-white/10 rounded text-xs text-right focus:outline-none focus:border-amber-500/50"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={compute}
            disabled={computing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 disabled:opacity-50"
          >
            {computing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Building2 className="w-4 h-4" />}
            Compute Organization ESG score
          </button>
          <button
            onClick={reset}
            className="px-3 py-1.5 rounded border border-white/10 text-gray-400 text-xs hover:text-white hover:border-white/20"
          >
            Reset
          </button>
          <span className="text-[10px] text-gray-500">{reportedCount}/15 indicators reported</span>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-1.5 text-xs text-red-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3 pt-3 border-t border-amber-500/10">
            <div className="flex items-center gap-2 text-[10px] text-amber-300/80">
              <Building2 className="w-3 h-3" />
              {result.scopeLabel}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className={`text-lg font-bold ${RATING_TONE[result.overallRating] || 'text-gray-300'}`}>
                  {result.overallScore ?? '—'}
                </p>
                <p className="text-[10px] text-gray-400">Overall ESG score</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-sm font-bold text-amber-300">{result.maturityLevel}</p>
                <p className="text-[10px] text-gray-400">Maturity level</p>
              </div>
              <div className="p-2 bg-white/[0.03] rounded text-center">
                <p className="text-sm font-bold text-cyan-300">{result.dataCompleteness}%</p>
                <p className="text-[10px] text-gray-400">Data completeness</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {PILLARS.map((pillar) => {
                const p = result.pillars[pillar.id];
                if (!p) return null;
                return (
                  <div key={pillar.id} className="p-2.5 bg-white/[0.02] border border-white/5 rounded space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-400 uppercase">{pillar.label}</span>
                      <span className={`text-sm font-bold ${RATING_TONE[p.rating] || 'text-gray-300'}`}>
                        {p.score ?? '—'}
                      </span>
                    </div>
                    <p className={`text-[10px] capitalize ${RATING_TONE[p.rating] || 'text-gray-400'}`}>{p.rating}</p>
                    <p className="text-[9px] text-gray-500">{p.dataCompleteness}% reported</p>
                  </div>
                );
              })}
            </div>

            {result.strengths.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Strengths
                </p>
                {result.strengths.map((s) => (
                  <div key={s.indicator} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">{s.label}</span>
                    <span className="text-emerald-400 font-semibold">{s.score}</span>
                  </div>
                ))}
              </div>
            )}

            {result.weaknesses.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-red-400 uppercase tracking-wider flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Weaknesses
                </p>
                {result.weaknesses.map((w) => (
                  <div key={w.indicator} className="flex items-center justify-between text-xs">
                    <span className="text-gray-300">{w.label}</span>
                    <span className="text-red-400 font-semibold">{w.score}</span>
                  </div>
                ))}
              </div>
            )}

            {result.recommendations.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Recommendations</p>
                <ul className="text-xs text-gray-300 list-disc list-inside space-y-0.5">
                  {result.recommendations.map((r, idx) => (
                    <li key={idx}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!result && !error && reportedCount === 0 && (
          <p className="text-[10px] text-gray-500 italic">
            No indicators entered yet. This tool has no default/sample data — enter real
            organization figures above to get a real assessment.
          </p>
        )}
      </div>
    </div>
  );
}

export default OrganizationESGPanel;
