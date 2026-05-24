'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * StatsWorkbench — the real statistical-analysis surface for the hypothesis
 * lens. Modelled on JASP / GraphPad Prism: a full classical test battery
 * (t-test, ANOVA, chi-square, correlation, regression), CSV/dataset import to
 * run tests on real data, assumption diagnostics, multiple-comparison
 * correction, a hypothesis pre-registration registry, and APA report export.
 *
 * Every macro it calls is registered in server/domains/hypothesis.js.
 */

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Calculator, FlaskConical, Sigma, GitCompareArrows, Table2, ShieldCheck,
  Layers3, ClipboardCheck, FileText, Loader2, Trash2, Plus, Upload,
} from 'lucide-react';

type TabId = 'tests' | 'datasets' | 'assumptions' | 'correction' | 'registry';

const TABS: { id: TabId; label: string; icon: typeof Calculator }[] = [
  { id: 'tests', label: 'Test Battery', icon: Sigma },
  { id: 'datasets', label: 'Datasets', icon: Table2 },
  { id: 'assumptions', label: 'Assumption Checks', icon: ShieldCheck },
  { id: 'correction', label: 'Multiple Comparison', icon: Layers3 },
  { id: 'registry', label: 'Pre-Registration', icon: ClipboardCheck },
];

// ---- numeric-list parsing -----------------------------------------------------
function parseNums(raw: string): number[] {
  return raw
    .split(/[\s,;\n\t]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

interface Dataset {
  id: string;
  name: string;
  rowCount: number;
  columnCount: number;
  columns: { name: string; type: string; stats?: any }[];
  createdAt?: string;
}

interface PreReg {
  id: string;
  statement: string;
  predictedDirection: string;
  plannedTest: string | null;
  alpha: number;
  plannedSampleSize: number | null;
  status: string;
  outcome: any;
  registeredAt: string;
}

function StatRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-zinc-800/60 py-1 text-xs">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono text-zinc-100">{value}</span>
    </div>
  );
}

function Verdict({ reject, sig }: { reject?: boolean; sig?: boolean }) {
  const positive = reject ?? sig;
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${
        positive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
      }`}
    >
      {reject !== undefined
        ? reject ? 'H₀ Rejected' : 'Fail to Reject H₀'
        : positive ? 'Significant' : 'Not Significant'}
    </span>
  );
}

export function StatsWorkbench() {
  const [tab, setTab] = useState<TabId>('tests');

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/50">
      <div className="flex flex-wrap gap-1 border-b border-zinc-800 p-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === id
                ? 'bg-indigo-500/20 text-indigo-300'
                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'tests' && <TestBattery />}
        {tab === 'datasets' && <DatasetPanel />}
        {tab === 'assumptions' && <AssumptionsPanel />}
        {tab === 'correction' && <CorrectionPanel />}
        {tab === 'registry' && <RegistryPanel />}
      </div>
    </section>
  );
}

// ============================================================================
// Test battery — t-test / ANOVA / chi-square / correlation / regression
// ============================================================================

type TestKind = 'tTest' | 'anova' | 'chiSquare' | 'correlation' | 'regression';

function TestBattery() {
  const [kind, setKind] = useState<TestKind>('tTest');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  // shared inputs
  const [sampleA, setSampleA] = useState('5, 6, 7, 8, 9, 7, 8');
  const [sampleB, setSampleB] = useState('1, 2, 3, 4, 5, 3, 2');
  const [tKind, setTKind] = useState('welch');
  const [popMean, setPopMean] = useState('0');
  const [groups, setGroups] = useState('1,2,3,2,1\n4,5,6,5,4\n7,8,9,8,7');
  const [observed, setObserved] = useState('30, 20, 25, 25');
  const [contTable, setContTable] = useState('10, 20\n20, 10');
  const [chiMode, setChiMode] = useState<'gof' | 'independence'>('gof');
  const [alpha, setAlpha] = useState('0.05');

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    let input: Record<string, unknown> = { alpha: Number(alpha) || 0.05 };
    if (kind === 'tTest') {
      input = { ...input, sample1: parseNums(sampleA), sample2: parseNums(sampleB), kind: tKind, populationMean: Number(popMean) || 0 };
    } else if (kind === 'anova') {
      const g = groups.split('\n').map((line) => ({ values: parseNums(line) })).filter((x) => x.values.length > 0);
      input = { ...input, groups: g };
    } else if (kind === 'chiSquare') {
      if (chiMode === 'independence') {
        input = { ...input, table: contTable.split('\n').map((l) => parseNums(l)).filter((r) => r.length > 0) };
      } else {
        input = { ...input, observed: parseNums(observed) };
      }
    } else {
      // correlation / regression
      input = { ...input, x: parseNums(sampleA), y: parseNums(sampleB) };
    }
    const res = await lensRun('hypothesis', kind, input);
    if (res.data.ok) setResult(res.data.result);
    else setError(res.data.error || 'Computation failed');
    setBusy(false);
  }, [kind, sampleA, sampleB, tKind, popMean, groups, observed, contTable, chiMode, alpha]);

  const KIND_META: { id: TestKind; label: string; icon: typeof Calculator }[] = [
    { id: 'tTest', label: 't-Test', icon: GitCompareArrows },
    { id: 'anova', label: 'ANOVA', icon: Sigma },
    { id: 'chiSquare', label: 'Chi-Square', icon: Calculator },
    { id: 'correlation', label: 'Correlation', icon: FlaskConical },
    { id: 'regression', label: 'Regression', icon: Calculator },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {KIND_META.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setKind(id); setResult(null); setError(null); }}
            className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${
              kind === id
                ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {(kind === 'tTest' || kind === 'correlation' || kind === 'regression') && (
          <>
            <label className="space-y-1 text-xs text-zinc-400">
              {kind === 'tTest' ? 'Sample 1' : 'X values'}
              <textarea
                value={sampleA}
                onChange={(e) => setSampleA(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
              />
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              {kind === 'tTest' ? 'Sample 2 (blank = one-sample)' : 'Y values'}
              <textarea
                value={sampleB}
                onChange={(e) => setSampleB(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
              />
            </label>
          </>
        )}
        {kind === 'tTest' && (
          <>
            <label className="space-y-1 text-xs text-zinc-400">
              Test type
              <select
                value={tKind}
                onChange={(e) => setTKind(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
              >
                <option value="welch">Welch (unequal variance)</option>
                <option value="two-sample">Student (pooled variance)</option>
                <option value="paired">Paired</option>
                <option value="one-sample">One-sample</option>
              </select>
            </label>
            <label className="space-y-1 text-xs text-zinc-400">
              Population mean (one-sample H₀)
              <input
                value={popMean}
                onChange={(e) => setPopMean(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
              />
            </label>
          </>
        )}
        {kind === 'anova' && (
          <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
            Groups — one comma-separated row per group
            <textarea
              value={groups}
              onChange={(e) => setGroups(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
            />
          </label>
        )}
        {kind === 'chiSquare' && (
          <>
            <div className="flex gap-2 md:col-span-2">
              {(['gof', 'independence'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChiMode(m)}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    chiMode === m
                      ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                      : 'border-zinc-800 text-zinc-400'
                  }`}
                >
                  {m === 'gof' ? 'Goodness-of-Fit' : 'Independence'}
                </button>
              ))}
            </div>
            {chiMode === 'gof' ? (
              <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
                Observed counts
                <input
                  value={observed}
                  onChange={(e) => setObserved(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
                />
              </label>
            ) : (
              <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
                Contingency table — one comma-separated row per category
                <textarea
                  value={contTable}
                  onChange={(e) => setContTable(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
                />
              </label>
            )}
          </>
        )}
        <label className="space-y-1 text-xs text-zinc-400">
          Significance level α
          <input
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
          />
        </label>
      </div>

      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sigma className="h-4 w-4" />}
        Run Test
      </button>

      {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {result && <TestResult kind={kind} result={result} />}
    </div>
  );
}

function TestResult({ kind, result }: { kind: TestKind; result: any }) {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center gap-3">
        <h4 className="text-sm font-semibold text-indigo-300">Result</h4>
        <Verdict reject={result.reject} sig={result.significant} />
      </div>

      {kind === 'tTest' && (
        <div className="grid gap-x-6 sm:grid-cols-2">
          <StatRow label="t-statistic" value={result.tStatistic} />
          <StatRow label="degrees of freedom" value={result.degreesOfFreedom} />
          <StatRow label="p-value" value={result.pValue} />
          <StatRow label="mean difference" value={result.meanDifference} />
          <StatRow label="effect size (d)" value={`${result.effectSize} (${result.effectMagnitude})`} />
          <StatRow
            label={`${Math.round((result.confidenceInterval?.level || 0.95) * 100)}% CI`}
            value={`[${result.confidenceInterval?.lower}, ${result.confidenceInterval?.upper}]`}
          />
        </div>
      )}

      {kind === 'anova' && (
        <>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <StatRow label="F-statistic" value={result.fStatistic} />
            <StatRow label="p-value" value={result.pValue} />
            <StatRow
              label="df (between, within)"
              value={`${result.degreesOfFreedom?.between}, ${result.degreesOfFreedom?.within}`}
            />
            <StatRow label="η² (eta-squared)" value={`${result.etaSquared} (${result.effectMagnitude})`} />
          </div>
          <ChartKit
            kind="bar"
            data={(result.groups || []).map((g: any) => ({ label: g.label, mean: g.mean }))}
            xKey="label"
            series={[{ key: 'mean', label: 'Group mean' }]}
            height={200}
          />
        </>
      )}

      {kind === 'chiSquare' && (
        <div className="grid gap-x-6 sm:grid-cols-2">
          <StatRow label="χ²-statistic" value={result.chiSquare} />
          <StatRow label="degrees of freedom" value={result.degreesOfFreedom} />
          <StatRow label="p-value" value={result.pValue} />
          {result.cramersV != null && (
            <StatRow label="Cramér's V" value={`${result.cramersV} (${result.effectMagnitude})`} />
          )}
          {result.expectedCellWarning && (
            <p className="sm:col-span-2 text-xs text-amber-300">{result.expectedCellWarning}</p>
          )}
        </div>
      )}

      {kind === 'correlation' && (
        <>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <StatRow label="Pearson r" value={result.pearson} />
            <StatRow label="Spearman ρ" value={result.spearman} />
            <StatRow label="R²" value={result.rSquared} />
            <StatRow label="p-value" value={result.pValue} />
            <StatRow label="strength / direction" value={`${result.strength} ${result.direction}`} />
            {result.confidenceInterval && (
              <StatRow
                label="95% CI for r"
                value={`[${result.confidenceInterval.lower}, ${result.confidenceInterval.upper}]`}
              />
            )}
          </div>
          {Array.isArray(result.scatter) && (
            <ChartKit
              kind="scatter"
              data={result.scatter}
              xKey="x"
              series={[{ key: 'y', label: 'observations' }]}
              height={220}
            />
          )}
        </>
      )}

      {kind === 'regression' && (
        <>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <StatRow label="equation" value={result.equation} />
            <StatRow label="slope (B)" value={`${result.slope} ± ${result.slopeStdError}`} />
            <StatRow label="intercept" value={result.intercept} />
            <StatRow label="R² / adj R²" value={`${result.rSquared} / ${result.adjustedRSquared}`} />
            <StatRow label="slope p-value" value={result.slopePValue} />
            <StatRow label="F-statistic" value={`${result.fStatistic} (p=${result.fPValue})`} />
            <StatRow label="residual SE" value={result.residualStandardError} />
          </div>
          {Array.isArray(result.points) && (
            <ChartKit
              kind="scatter"
              data={result.points}
              xKey="x"
              series={[
                { key: 'y', label: 'observed' },
                { key: 'fitted', label: 'fitted' },
              ]}
              height={220}
            />
          )}
        </>
      )}

      {result.conclusion && <p className="text-xs italic text-zinc-300">{result.conclusion}</p>}

      <ApaExport kind={kind} result={result} />
    </div>
  );
}

// ---- APA report export -------------------------------------------------------
function ApaExport({ kind, result }: { kind: string; result: any }) {
  const [apa, setApa] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generate = useCallback(async () => {
    setBusy(true);
    const res = await lensRun('hypothesis', 'apaReport', { kind, result });
    if (res.data.ok) setApa(res.data.result.apa);
    else setApa(`Error: ${res.data.error}`);
    setBusy(false);
  }, [kind, result]);

  return (
    <div className="space-y-2 border-t border-zinc-800 pt-2">
      <button
        onClick={generate}
        disabled={busy}
        className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
        APA-formatted report
      </button>
      {apa && (
        <pre className="whitespace-pre-wrap rounded-md bg-zinc-950 p-3 font-serif text-xs leading-relaxed text-zinc-200">
          {apa}
        </pre>
      )}
    </div>
  );
}

// ============================================================================
// Dataset import + run-test-on-dataset
// ============================================================================

function DatasetPanel() {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [name, setName] = useState('');
  const [csv, setCsv] = useState('group,score\nA,12\nA,15\nA,11\nB,20\nB,22\nB,19\nC,30\nC,28\nC,33');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Dataset | null>(null);
  const [test, setTest] = useState('correlation');
  const [colX, setColX] = useState('');
  const [colY, setColY] = useState('');
  const [groupCol, setGroupCol] = useState('');
  const [valueCol, setValueCol] = useState('');
  const [runResult, setRunResult] = useState<any>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await lensRun('hypothesis', 'datasetList', {});
    if (res.data.ok) setDatasets(res.data.result.datasets || []);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importCsv = useCallback(async () => {
    setBusy(true);
    setError(null);
    const res = await lensRun('hypothesis', 'datasetImport', { name: name || 'Untitled dataset', csv });
    if (res.data.ok) {
      setName('');
      await refresh();
    } else {
      setError(res.data.error || 'Import failed');
    }
    setBusy(false);
  }, [name, csv, refresh]);

  const onFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result || ''));
      if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsText(file);
  }, [name]);

  const remove = useCallback(async (id: string) => {
    await lensRun('hypothesis', 'datasetDelete', { id });
    if (selected?.id === id) setSelected(null);
    await refresh();
  }, [selected, refresh]);

  const openDataset = useCallback(async (d: Dataset) => {
    const res = await lensRun('hypothesis', 'datasetGet', { id: d.id });
    if (res.data.ok) {
      const full = res.data.result as Dataset;
      setSelected(full);
      setRunResult(null);
      setRunError(null);
      const numeric = full.columns.filter((c) => c.type === 'numeric');
      const categorical = full.columns.filter((c) => c.type === 'categorical');
      setColX(numeric[0]?.name || '');
      setColY(numeric[1]?.name || '');
      setGroupCol(categorical[0]?.name || '');
      setValueCol(numeric[0]?.name || '');
    }
  }, []);

  const runOnDataset = useCallback(async () => {
    if (!selected) return;
    setRunResult(null);
    setRunError(null);
    const input: Record<string, unknown> = { datasetId: selected.id, test };
    if (test === 'anova') {
      input.groupColumn = groupCol;
      input.valueColumn = valueCol;
    } else if (test === 'tTest') {
      input.columns = [colX, colY].filter(Boolean);
    } else {
      input.columns = [colX, colY];
    }
    const res = await lensRun('hypothesis', 'runTestOnDataset', input);
    if (res.data.ok) {
      // runTestOnDataset returns the wrapped { ok, result } of the inner test.
      const r: any = res.data.result;
      setRunResult(r?.result ?? r);
    } else {
      setRunError(res.data.error || 'Run failed');
    }
  }, [selected, test, colX, colY, groupCol, valueCol]);

  const numericCols = selected?.columns.filter((c) => c.type === 'numeric') || [];
  const categoricalCols = selected?.columns.filter((c) => c.type === 'categorical') || [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <label className="space-y-1 text-xs text-zinc-400">
            Dataset name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Trial 3 measurements"
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
            />
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            CSV / TSV text (header row auto-detected)
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={importCsv}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-indigo-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Import dataset
            </button>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/5">
              <Upload className="h-3.5 w-3.5" />
              Load file
              <input
                type="file"
                accept=".csv,.tsv,.txt"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>
          </div>
          {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
        </div>

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-zinc-300">Imported datasets</h4>
          {datasets.length === 0 && (
            <p className="text-xs text-zinc-400">No datasets yet — import CSV text or a file.</p>
          )}
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {datasets.map((d) => (
              <div
                key={d.id}
                className={`flex items-center justify-between rounded-md border p-2 ${
                  selected?.id === d.id ? 'border-indigo-500/50 bg-indigo-500/10' : 'border-zinc-800'
                }`}
              >
                <button onClick={() => openDataset(d)} className="text-left">
                  <p className="text-xs font-medium text-zinc-100">{d.name}</p>
                  <p className="text-[11px] text-zinc-400">
                    {d.rowCount} rows × {d.columnCount} cols
                  </p>
                </button>
                <button
                  onClick={() => remove(d.id)}
                  className="rounded p-1 text-zinc-400 hover:bg-rose-500/15 hover:text-rose-300"
                  aria-label="Delete dataset"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
          <h4 className="text-sm font-semibold text-indigo-300">
            Run a test on “{selected.name}”
          </h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {selected.columns.map((c) => (
              <span
                key={c.name}
                className={`rounded px-2 py-0.5 ${
                  c.type === 'numeric'
                    ? 'bg-sky-500/15 text-sky-300'
                    : 'bg-amber-500/15 text-amber-300'
                }`}
              >
                {c.name} · {c.type}
              </span>
            ))}
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <label className="space-y-1 text-xs text-zinc-400">
              Test
              <select
                value={test}
                onChange={(e) => setTest(e.target.value)}
                className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
              >
                <option value="correlation">Correlation</option>
                <option value="regression">Regression</option>
                <option value="tTest">t-Test</option>
                <option value="anova">ANOVA (by group)</option>
              </select>
            </label>
            {test === 'anova' ? (
              <>
                <ColSelect label="Group column" value={groupCol} onChange={setGroupCol} cols={categoricalCols} />
                <ColSelect label="Value column" value={valueCol} onChange={setValueCol} cols={numericCols} />
              </>
            ) : (
              <>
                <ColSelect label={test === 'tTest' ? 'Sample 1 column' : 'X column'} value={colX} onChange={setColX} cols={numericCols} />
                <ColSelect label={test === 'tTest' ? 'Sample 2 column' : 'Y column'} value={colY} onChange={setColY} cols={numericCols} />
              </>
            )}
            <div className="flex items-end">
              <button
                onClick={runOnDataset}
                className="w-full rounded-md bg-indigo-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500"
              >
                Run on data
              </button>
            </div>
          </div>
          {runError && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{runError}</p>}
          {runResult && (
            <TestResult kind={test as TestKind} result={runResult} />
          )}
        </div>
      )}
    </div>
  );
}

function ColSelect({
  label, value, onChange, cols,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  cols: { name: string }[];
}) {
  return (
    <label className="space-y-1 text-xs text-zinc-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
      >
        <option value="">—</option>
        {cols.map((c) => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
    </label>
  );
}

// ============================================================================
// Assumption checks
// ============================================================================

function AssumptionsPanel() {
  const [sample, setSample] = useState('4.1, 5.2, 4.8, 6.0, 5.5, 4.9, 5.1, 5.8, 4.4, 5.6, 6.2, 4.7');
  const [groups, setGroups] = useState('4,5,6,5,4,5\n8,9,7,8,9,8\n2,3,1,2,3,2');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const g = groups.split('\n').map((l) => ({ values: parseNums(l) })).filter((x) => x.values.length > 0);
    const res = await lensRun('hypothesis', 'assumptionCheck', {
      sample: parseNums(sample),
      groups: g,
    });
    if (res.data.ok) setResult(res.data.result);
    else setError(res.data.error || 'Check failed');
    setBusy(false);
  }, [sample, groups]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Run normality (D&apos;Agostino omnibus K²) and homoscedasticity (Levene / Brown-Forsythe)
        diagnostics before choosing a parametric test.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-zinc-400">
          Single sample (normality)
          <textarea
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Groups — one row per group (variance homogeneity)
          <textarea
            value={groups}
            onChange={(e) => setGroups(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
          />
        </label>
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        Run diagnostics
      </button>
      {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {result && (
        <div className="space-y-2">
          <div
            className={`rounded-md px-3 py-2 text-xs font-medium ${
              result.allPassed ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {result.recommendation}
          </div>
          {result.checks.map((c: any, i: number) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">
                  {c.test === 'normality' ? `Normality — ${c.label}` : `Homoscedasticity (${c.method})`}
                </span>
                {c.ok !== null && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] ${
                      c.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                    }`}
                  >
                    {c.ok ? 'pass' : 'violated'}
                  </span>
                )}
              </div>
              <div className="mt-1 grid gap-x-6 sm:grid-cols-2">
                {c.skewness != null && <StatRow label="skewness" value={c.skewness} />}
                {c.excessKurtosis != null && <StatRow label="excess kurtosis" value={c.excessKurtosis} />}
                {c.omnibusK2 != null && <StatRow label="omnibus K²" value={c.omnibusK2} />}
                {c.statistic != null && <StatRow label="Levene W" value={c.statistic} />}
                {c.pValue != null && <StatRow label="p-value" value={c.pValue} />}
              </div>
              {(c.conclusion || c.note) && (
                <p className="mt-1 text-[11px] italic text-zinc-400">{c.conclusion || c.note}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Multiple-comparison correction
// ============================================================================

function CorrectionPanel() {
  const [pVals, setPVals] = useState('0.001, 0.013, 0.021, 0.048, 0.06, 0.21, 0.4');
  const [labels, setLabels] = useState('');
  const [alpha, setAlpha] = useState('0.05');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    const pv = parseNums(pVals);
    const lab = labels.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const res = await lensRun('hypothesis', 'multipleComparison', {
      pValues: pv,
      labels: lab.length === pv.length ? lab : undefined,
      alpha: Number(alpha) || 0.05,
    });
    if (res.data.ok) setResult(res.data.result);
    else setError(res.data.error || 'Correction failed');
    setBusy(false);
  }, [pVals, labels, alpha]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Control the family-wise error rate across a battery of tests with Bonferroni,
        Holm step-down, and Benjamini-Hochberg FDR adjustment.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
          Raw p-values (comma / space separated)
          <textarea
            value={pVals}
            onChange={(e) => setPVals(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          α
          <input
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-3">
          Test labels (optional, one per p-value, comma separated)
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
          />
        </label>
      </div>
      <button
        onClick={run}
        disabled={busy}
        className="flex items-center gap-2 rounded-md bg-indigo-500/90 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Layers3 className="h-4 w-4" />}
        Apply correction
      </button>
      {error && <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}
      {result && (
        <div className="space-y-2">
          <p className="rounded-md bg-zinc-800/60 px-3 py-2 text-xs text-zinc-300">{result.recommendation}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-400">
                  <th className="py-1.5 pr-3">Test</th>
                  <th className="py-1.5 pr-3">Raw p</th>
                  <th className="py-1.5 pr-3">Bonferroni</th>
                  <th className="py-1.5 pr-3">Holm</th>
                  <th className="py-1.5 pr-3">FDR (BH)</th>
                </tr>
              </thead>
              <tbody>
                {result.tests.map((t: any, i: number) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="py-1.5 pr-3 text-zinc-300">{t.label}</td>
                    <td className="py-1.5 pr-3 font-mono text-zinc-200">{t.rawP}</td>
                    <Cell p={t.bonferroniP} reject={t.bonferroniReject} />
                    <Cell p={t.holmP} reject={t.holmReject} />
                    <Cell p={t.fdrP} reject={t.fdrReject} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ p, reject }: { p: number; reject: boolean }) {
  return (
    <td className={`py-1.5 pr-3 font-mono ${reject ? 'text-emerald-300' : 'text-zinc-400'}`}>
      {p}
      {reject && <span className="ml-1 text-[10px]">★</span>}
    </td>
  );
}

// ============================================================================
// Hypothesis pre-registration registry
// ============================================================================

function RegistryPanel() {
  const [items, setItems] = useState<PreReg[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [statement, setStatement] = useState('');
  const [direction, setDirection] = useState('two-sided');
  const [test, setTest] = useState('tTest');
  const [alpha, setAlpha] = useState('0.05');
  const [plannedN, setPlannedN] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await lensRun('hypothesis', 'registryList', {});
    if (res.data.ok) {
      setItems(res.data.result.items || []);
      setCounts(res.data.result.counts || {});
    }
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = useCallback(async () => {
    if (!statement.trim()) return;
    setBusy(true);
    setError(null);
    const res = await lensRun('hypothesis', 'preregister', {
      statement,
      predictedDirection: direction,
      test,
      alpha: Number(alpha) || 0.05,
      plannedSampleSize: plannedN ? Number(plannedN) : undefined,
      notes,
    });
    if (res.data.ok) {
      setStatement('');
      setNotes('');
      setPlannedN('');
      await refresh();
    } else {
      setError(res.data.error || 'Pre-registration failed');
    }
    setBusy(false);
  }, [statement, direction, test, alpha, plannedN, notes, refresh]);

  const remove = useCallback(async (id: string) => {
    await lensRun('hypothesis', 'registryDelete', { id });
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-400">
        Pre-register a hypothesis and its planned analysis before collecting data, then
        record the verified outcome — the registry flags whether the prediction was confirmed.
      </p>

      <div className="flex flex-wrap gap-3 text-xs">
        {(['registered', 'confirmed', 'refuted', 'inconclusive'] as const).map((k) => (
          <span key={k} className="rounded-md bg-zinc-800/60 px-2.5 py-1 text-zinc-300">
            {k}: <span className="font-semibold text-zinc-100">{counts[k] || 0}</span>
          </span>
        ))}
      </div>

      <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 md:grid-cols-2">
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
          Hypothesis statement
          <input
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="e.g. Treatment group will show higher recovery rate than control"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Predicted direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
          >
            <option value="two-sided">Two-sided</option>
            <option value="greater">Greater</option>
            <option value="less">Less</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Planned test
          <select
            value={test}
            onChange={(e) => setTest(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 text-xs text-zinc-100"
          >
            <option value="tTest">t-Test</option>
            <option value="anova">ANOVA</option>
            <option value="chiSquare">Chi-Square</option>
            <option value="correlation">Correlation</option>
            <option value="regression">Regression</option>
            <option value="zTest">Z-Test</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Significance level α
          <input
            value={alpha}
            onChange={(e) => setAlpha(e.target.value)}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          Planned sample size
          <input
            value={plannedN}
            onChange={(e) => setPlannedN(e.target.value)}
            placeholder="optional"
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1.5 font-mono text-xs text-zinc-100"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400 md:col-span-2">
          Notes / design rationale
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-100"
          />
        </label>
        <button
          onClick={register}
          disabled={busy || !statement.trim()}
          className="flex w-fit items-center gap-1.5 rounded-md bg-indigo-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
          Pre-register
        </button>
        {error && <p className="text-xs text-rose-300 md:col-span-2">{error}</p>}
      </div>

      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-xs text-zinc-400">No pre-registered hypotheses yet.</p>
        )}
        {items.map((p) => (
          <PreRegCard key={p.id} prereg={p} onChanged={refresh} onDelete={() => remove(p.id)} />
        ))}
      </div>
    </div>
  );
}

function PreRegCard({
  prereg, onChanged, onDelete,
}: {
  prereg: PreReg;
  onChanged: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pValue, setPValue] = useState('');
  const [reject, setReject] = useState(true);
  const [effect, setEffect] = useState('');
  const [obsDir, setObsDir] = useState('two-sided');
  const [busy, setBusy] = useState(false);

  const resolved = prereg.status === 'resolved';
  const verdict = prereg.outcome?.verdict;

  const record = useCallback(async () => {
    setBusy(true);
    await lensRun('hypothesis', 'recordOutcome', {
      id: prereg.id,
      pValue: pValue ? Number(pValue) : undefined,
      reject,
      effectSize: effect ? Number(effect) : undefined,
      observedDirection: obsDir,
    });
    setBusy(false);
    setOpen(false);
    onChanged();
  }, [prereg.id, pValue, reject, effect, obsDir, onChanged]);

  const verdictColor =
    verdict === 'confirmed' ? 'bg-emerald-500/20 text-emerald-300'
      : verdict === 'refuted' ? 'bg-rose-500/20 text-rose-300'
      : verdict === 'inconclusive' ? 'bg-amber-500/20 text-amber-300'
      : 'bg-sky-500/20 text-sky-300';

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-zinc-100">{prereg.statement}</p>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-400">
            <span>{prereg.plannedTest || 'no test'}</span>
            <span>α={prereg.alpha}</span>
            <span>{prereg.predictedDirection}</span>
            {prereg.plannedSampleSize && <span>n={prereg.plannedSampleSize} planned</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${verdictColor}`}>
            {resolved ? verdict : 'registered'}
          </span>
          <button
            onClick={onDelete}
            className="rounded p-1 text-zinc-400 hover:bg-rose-500/15 hover:text-rose-300"
            aria-label="Delete pre-registration"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {resolved && prereg.outcome && (
        <div className="mt-2 grid gap-x-6 border-t border-zinc-800 pt-2 sm:grid-cols-2">
          <StatRow label="p-value" value={prereg.outcome.pValue ?? 'n/a'} />
          <StatRow label="effect size" value={prereg.outcome.effectSize ?? 'n/a'} />
          <StatRow label="H₀ rejected" value={prereg.outcome.reject ? 'yes' : 'no'} />
          <StatRow label="prediction confirmed" value={prereg.outcome.predictionConfirmed ? 'yes' : 'no'} />
        </div>
      )}

      {!resolved && (
        <div className="mt-2 border-t border-zinc-800 pt-2">
          {!open ? (
            <button
              onClick={() => setOpen(true)}
              className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5"
            >
              Record outcome
            </button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-4">
              <label className="space-y-1 text-[11px] text-zinc-400">
                p-value
                <input
                  value={pValue}
                  onChange={(e) => setPValue(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1 font-mono text-xs text-zinc-100"
                />
              </label>
              <label className="space-y-1 text-[11px] text-zinc-400">
                effect size
                <input
                  value={effect}
                  onChange={(e) => setEffect(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1 font-mono text-xs text-zinc-100"
                />
              </label>
              <label className="space-y-1 text-[11px] text-zinc-400">
                observed direction
                <select
                  value={obsDir}
                  onChange={(e) => setObsDir(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 p-1 text-xs text-zinc-100"
                >
                  <option value="two-sided">two-sided</option>
                  <option value="greater">greater</option>
                  <option value="less">less</option>
                </select>
              </label>
              <label className="flex items-end gap-1.5 text-[11px] text-zinc-400">
                <input
                  type="checkbox"
                  checked={reject}
                  onChange={(e) => setReject(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                H₀ rejected
              </label>
              <div className="sm:col-span-4">
                <button
                  onClick={record}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-md bg-indigo-500/90 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardCheck className="h-3.5 w-3.5" />}
                  Save outcome
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
