'use client';

/**
 * ScenarioModeler — reduction-scenario modeling. Projects business-as-usual
 * emissions against a with-projects pathway over a horizon, using the
 * user's real reduction projects (environment.projects-list) plus ad-hoc
 * reductions. Calls environment.scenario-model; nothing is precomputed.
 */

import { useCallback, useEffect, useState } from 'react';
import { LineChart as LineIcon, Loader2, Plus, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';

interface Project {
  id: string;
  name: string;
  expectedReductionTonnesPerYear: number;
  status: string;
}

interface AdHoc {
  name: string;
  annualReductionTonnes: number;
  startYear: number;
}

interface ProjectionRow {
  year: string;
  businessAsUsual: number;
  withProjects: number;
  reductionTonnes: number;
}

interface ScenarioResult {
  baselineTonnes: number;
  baseYear: number;
  horizonYears: number;
  annualGrowthPct: number;
  scenarioProjects: Array<{ name: string; annualReductionTonnes: number; startYear: number }>;
  projection: ProjectionRow[];
  finalYearBusinessAsUsual: number;
  finalYearWithProjects: number;
  totalAvoidedTonnes: number;
  finalYearReductionPct: number;
}

export function ScenarioModeler() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [adHoc, setAdHoc] = useState<AdHoc[]>([]);
  const [baseYear, setBaseYear] = useState(new Date().getFullYear());
  const [horizonYears, setHorizonYears] = useState(10);
  const [annualGrowthPct, setAnnualGrowthPct] = useState(2);
  const [baselineTonnes, setBaselineTonnes] = useState('');
  const [result, setResult] = useState<ScenarioResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun('environment', 'projects-list', {});
        if (r.data?.ok) setProjects((r.data.result as { projects: Project[] }).projects || []);
      } catch (e) {
        console.error('[Scenario] projects', e);
      }
    })();
  }, []);

  const runModel = useCallback(async () => {
    setLoading(true);
    try {
      const input: Record<string, unknown> = {
        baseYear,
        horizonYears,
        annualGrowthPct,
        projectIds: selectedIds,
        reductions: adHoc,
      };
      const bl = Number(baselineTonnes);
      if (Number.isFinite(bl) && bl > 0) input.baselineTonnes = bl;
      const r = await lensRun('environment', 'scenario-model', input);
      if (r.data?.ok) setResult(r.data.result as ScenarioResult);
    } catch (e) {
      console.error('[Scenario] model', e);
    } finally {
      setLoading(false);
    }
  }, [baseYear, horizonYears, annualGrowthPct, selectedIds, adHoc, baselineTonnes]);

  function toggleProject(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function addAdHoc() {
    setAdHoc((prev) => [
      ...prev,
      { name: '', annualReductionTonnes: 0, startYear: baseYear },
    ]);
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LineIcon className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Reduction-scenario modeling
        </span>
      </header>

      <div className="p-3 space-y-3">
        {/* Scenario parameters */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Field label="Base year">
            <input
              type="number"
              value={baseYear}
              onChange={(e) => setBaseYear(Number(e.target.value) || baseYear)}
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </Field>
          <Field label="Horizon (years)">
            <input
              type="number"
              min={1}
              max={40}
              value={horizonYears}
              onChange={(e) => setHorizonYears(Number(e.target.value) || 10)}
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </Field>
          <Field label="Annual growth %">
            <input
              type="number"
              step="0.5"
              value={annualGrowthPct}
              onChange={(e) => setAnnualGrowthPct(Number(e.target.value) || 0)}
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </Field>
          <Field label="Baseline tCO₂e (blank = use logged)">
            <input
              type="number"
              value={baselineTonnes}
              onChange={(e) => setBaselineTonnes(e.target.value)}
              placeholder="auto"
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </Field>
        </div>

        {/* Project picker */}
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
          <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-1.5">
            Reduction projects to apply
          </div>
          {projects.length === 0 ? (
            <div className="text-[10px] text-gray-400">
              No reduction projects yet — add ad-hoc reductions below, or create projects
              in the Projects tab.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggleProject(p.id)}
                  className={cn(
                    'px-2 py-1 text-[11px] rounded border transition',
                    selectedIds.includes(p.id)
                      ? 'bg-violet-500/20 text-violet-200 border-violet-500/30'
                      : 'bg-white/5 text-gray-400 border-transparent hover:bg-white/10',
                  )}
                >
                  {p.name} ·{' '}
                  <span className="font-mono">
                    {p.expectedReductionTonnesPerYear} t/yr
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Ad-hoc reductions */}
        <div className="rounded-md border border-white/10 bg-white/[0.02] p-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-violet-300">
              Ad-hoc reductions
            </span>
            <button
              onClick={addAdHoc}
              className="ml-auto text-[10px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-0.5"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          {adHoc.length === 0 ? (
            <div className="text-[10px] text-gray-400">None added.</div>
          ) : (
            <ul className="space-y-1.5">
              {adHoc.map((r, i) => (
                <li key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
                  <input
                    value={r.name}
                    onChange={(e) =>
                      setAdHoc((prev) =>
                        prev.map((x, j) =>
                          j === i ? { ...x, name: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="Reduction name"
                    className="px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <input
                    type="number"
                    value={r.annualReductionTonnes || ''}
                    onChange={(e) =>
                      setAdHoc((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? {
                                ...x,
                                annualReductionTonnes: Number(e.target.value) || 0,
                              }
                            : x,
                        ),
                      )
                    }
                    placeholder="t/yr"
                    className="w-20 px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <input
                    type="number"
                    value={r.startYear}
                    onChange={(e) =>
                      setAdHoc((prev) =>
                        prev.map((x, j) =>
                          j === i
                            ? { ...x, startYear: Number(e.target.value) || baseYear }
                            : x,
                        ),
                      )
                    }
                    placeholder="start"
                    className="w-20 px-2 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <button aria-label="Remove"
                    onClick={() => setAdHoc((prev) => prev.filter((_, j) => j !== i))}
                    className="p-1 text-rose-400 hover:text-rose-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          onClick={runModel}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <LineIcon className="w-3 h-3" />
          )}
          Run scenario
        </button>

        {/* Results */}
        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <ResTile
                label="Baseline"
                value={`${result.baselineTonnes.toFixed(0)} t`}
              />
              <ResTile
                label={`${result.baseYear + result.horizonYears} BAU`}
                value={`${result.finalYearBusinessAsUsual.toFixed(0)} t`}
                tone="rose"
              />
              <ResTile
                label={`${result.baseYear + result.horizonYears} with projects`}
                value={`${result.finalYearWithProjects.toFixed(0)} t`}
                tone="emerald"
              />
              <ResTile
                label="Total avoided"
                value={`${result.totalAvoidedTonnes.toFixed(0)} t`}
                tone="violet"
              />
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-2">
                Projection · business-as-usual vs with projects (tCO₂e) ·{' '}
                {result.finalYearReductionPct.toFixed(1)}% cut by final year
              </div>
              <ChartKit
                kind="line"
                data={result.projection.map((r) => ({ ...r }))}
                xKey="year"
                height={220}
                series={[
                  {
                    key: 'businessAsUsual',
                    label: 'Business as usual',
                    color: '#fb7185',
                  },
                  { key: 'withProjects', label: 'With projects', color: '#22c55e' },
                ]}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[9px] uppercase tracking-wider text-gray-400">{label}</span>
      {children}
    </label>
  );
}

function ResTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'rose' | 'emerald' | 'violet';
}) {
  const colour =
    tone === 'rose'
      ? 'text-rose-300'
      : tone === 'emerald'
        ? 'text-emerald-300'
        : tone === 'violet'
          ? 'text-violet-300'
          : 'text-gray-200';
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-sm font-mono font-bold tabular-nums', colour)}>{value}</div>
    </div>
  );
}

export default ScenarioModeler;
