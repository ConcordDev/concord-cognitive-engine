'use client';

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { FileText, Download, Loader2, Activity } from 'lucide-react';

interface ExportResult {
  title: string;
  generatedAt: string;
  reportText: string;
  format: string;
  counts: { parcels: number; scenarios: number; comments: number };
}

interface ImpactProjections {
  population: number;
  jobs: number;
  housingUnits: number;
  emissionsTonnesPerYear: number;
  grossFloorAreaSqFt: number;
}

interface ImpactResult {
  projections: ImpactProjections;
  baselinePopulation: number;
  baselineJobs: number;
  populationGrowthPct: number | null;
  jobsGrowthPct: number | null;
  jobsHousingRatio: number | null;
  jobsHousingBalance: string;
  emissionsPerCapita: number | null;
}

const ZONES = ['residential', 'commercial', 'mixed', 'industrial'];

export function PlanExportPanel() {
  const [title, setTitle] = useState('Urban Plan Report');
  const [report, setReport] = useState<ExportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Impact-dashboard inputs.
  const [zoneType, setZoneType] = useState('mixed');
  const [lotSizeSqFt, setLotSizeSqFt] = useState('40000');
  const [baselinePopulation, setBaselinePopulation] = useState('1000');
  const [baselineJobs, setBaselineJobs] = useState('400');
  const [impact, setImpact] = useState<ImpactResult | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

  const runImpact = useCallback(async () => {
    setImpactBusy(true);
    setError(null);
    const r = await lensRun<ImpactResult>('urban-planning', 'impactDashboard', {
      zoneType,
      lotSizeSqFt: Number(lotSizeSqFt),
      useMix: zoneType,
      baselinePopulation: Number(baselinePopulation),
      baselineJobs: Number(baselineJobs),
    });
    setImpactBusy(false);
    if (r.data.ok && r.data.result) setImpact(r.data.result);
    else setError(r.data.error || 'impact projection failed');
  }, [zoneType, lotSizeSqFt, baselinePopulation, baselineJobs]);

  const runExport = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<ExportResult>('urban-planning', 'exportPlan', { title });
    setBusy(false);
    if (r.data.ok && r.data.result) setReport(r.data.result);
    else setError(r.data.error || 'export failed');
  }, [title]);

  const download = useCallback(() => {
    if (!report) return;
    const blob = new Blob([report.reportText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [report]);

  return (
    <div className="space-y-4">
      {/* Impact dashboard */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Activity className="h-4 w-4 text-emerald-400" /> Impact Projection Dashboard
        </h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <select
            value={zoneType}
            onChange={(e) => setZoneType(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          >
            {ZONES.map((z) => (
              <option key={z} value={z}>
                Zone: {z}
              </option>
            ))}
          </select>
          <input
            value={lotSizeSqFt}
            onChange={(e) => setLotSizeSqFt(e.target.value)}
            type="number"
            placeholder="Lot size (sqft)"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={baselinePopulation}
            onChange={(e) => setBaselinePopulation(e.target.value)}
            type="number"
            placeholder="Baseline population"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <input
            value={baselineJobs}
            onChange={(e) => setBaselineJobs(e.target.value)}
            type="number"
            placeholder="Baseline jobs"
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
        </div>
        <button
          onClick={runImpact}
          disabled={impactBusy}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {impactBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          Project Impacts
        </button>

        {impact && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {[
                ['Population', impact.projections.population],
                ['Jobs', impact.projections.jobs],
                ['Housing units', impact.projections.housingUnits],
                ['t CO2e/yr', impact.projections.emissionsTonnesPerYear],
                ['GFA sqft', impact.projections.grossFloorAreaSqFt],
              ].map(([label, val]) => (
                <div
                  key={label as string}
                  className="rounded border border-emerald-500/20 bg-zinc-950 px-2 py-1.5"
                >
                  <div className="text-[9px] uppercase tracking-wider text-zinc-400">
                    {label}
                  </div>
                  <div className="font-mono text-sm text-emerald-300">
                    {(val as number).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              {[
                [
                  'Pop growth',
                  impact.populationGrowthPct != null ? `${impact.populationGrowthPct}%` : 'n/a',
                ],
                [
                  'Jobs growth',
                  impact.jobsGrowthPct != null ? `${impact.jobsGrowthPct}%` : 'n/a',
                ],
                [
                  'Jobs/housing',
                  impact.jobsHousingRatio != null
                    ? `${impact.jobsHousingRatio} (${impact.jobsHousingBalance})`
                    : 'n/a',
                ],
                [
                  'Emissions/capita',
                  impact.emissionsPerCapita != null ? `${impact.emissionsPerCapita} t` : 'n/a',
                ],
              ].map(([label, val]) => (
                <div
                  key={label as string}
                  className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5"
                >
                  <div className="text-[9px] uppercase tracking-wider text-zinc-400">
                    {label}
                  </div>
                  <div className="font-mono text-xs text-zinc-200">{val}</div>
                </div>
              ))}
            </div>
            <ChartKit
              kind="bar"
              data={[
                { metric: 'Population', value: impact.projections.population },
                { metric: 'Jobs', value: impact.projections.jobs },
                { metric: 'Housing', value: impact.projections.housingUnits },
                { metric: 'Emissions', value: impact.projections.emissionsTonnesPerYear },
              ]}
              xKey="metric"
              series={[{ key: 'value', label: 'Projected' }]}
              height={200}
            />
          </div>
        )}
      </div>

      {/* Plan export */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <FileText className="h-4 w-4 text-emerald-400" /> Export Plan Report
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Report title"
            className="min-w-[220px] flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <button
            onClick={runExport}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            Generate Report
          </button>
          {report && (
            <button
              onClick={download}
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
            >
              <Download className="h-3.5 w-3.5" /> Download .md
            </button>
          )}
        </div>
        {error && (
          <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-xs text-red-300">
            {error}
          </div>
        )}
        {report && (
          <div className="mt-3">
            <p className="mb-2 text-[11px] text-zinc-400">
              Generated {new Date(report.generatedAt).toLocaleString()} ·{' '}
              {report.counts.parcels} parcels · {report.counts.scenarios} scenarios ·{' '}
              {report.counts.comments} comments
            </p>
            <pre className="max-h-96 overflow-auto rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-300">
              {report.reportText}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
