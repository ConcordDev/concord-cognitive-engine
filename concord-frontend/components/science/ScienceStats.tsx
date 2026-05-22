'use client';

import { useState } from 'react';
import { Activity } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RunButton } from '@/components/science/ScienceWorkbench';

type StatTest =
  | 'descriptive' | 'ttest' | 'correlation'
  | 'anova' | 'regression' | 'nonparametric' | 'ci';

const TESTS: { id: StatTest; label: string }[] = [
  { id: 'descriptive', label: 'Descriptive' },
  { id: 'ttest', label: 't-test' },
  { id: 'correlation', label: 'Correlation' },
  { id: 'anova', label: 'ANOVA' },
  { id: 'regression', label: 'Regression' },
  { id: 'nonparametric', label: 'Mann–Whitney' },
  { id: 'ci', label: 'Conf. Interval' },
];

function parseNums(s: string): number[] {
  return s.split(/[,\s]+/).map(Number).filter(Number.isFinite);
}

export function ScienceStats() {
  const [test, setTest] = useState<StatTest>('descriptive');

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
        <Activity className="w-4 h-4 text-teal-400" /> Statistical Tests
      </h3>
      <div className="flex flex-wrap gap-1">
        {TESTS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTest(t.id)}
            className={cn(
              'px-2 py-0.5 text-[11px] rounded border transition',
              test === t.id
                ? 'bg-teal-500/15 text-teal-200 border-teal-500/40'
                : 'text-gray-400 border-transparent hover:text-gray-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {test === 'descriptive' && <SingleSampleTest macro="stats-descriptive" />}
      {test === 'ci' && <SingleSampleTest macro="stats-ci" withConfidence />}
      {test === 'ttest' && <TTestForm />}
      {test === 'correlation' && <PairedTest macro="stats-correlation" />}
      {test === 'regression' && <PairedTest macro="stats-regression" />}
      {test === 'anova' && <AnovaForm />}
      {test === 'nonparametric' && <NonParametricForm />}
    </div>
  );
}

const inputCls =
  'w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none';

function ResultBlock({ result }: { result: Record<string, unknown> }) {
  return (
    <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 grid grid-cols-2 gap-2 text-xs">
      {Object.entries(result).map(([k, v]) => (
        <div key={k}>
          <span className="text-gray-500 uppercase text-[10px]">{k}</span>
          <p className="font-mono text-gray-100 break-all">
            {Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'object' && v !== null
              ? JSON.stringify(v) : String(v)}
          </p>
        </div>
      ))}
    </div>
  );
}

function SingleSampleTest({ macro, withConfidence }: { macro: string; withConfidence?: boolean }) {
  const [data, setData] = useState('');
  const [confidence, setConfidence] = useState('0.95');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    const input: Record<string, unknown> = { data: parseNums(data) };
    if (withConfidence) input.confidence = Number(confidence);
    const r = await lensRun<Record<string, unknown>>('science', macro, input);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Computation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <textarea
        value={data}
        onChange={(e) => setData(e.target.value)}
        rows={3}
        placeholder="Numeric values — comma or space separated"
        className={inputCls}
      />
      {withConfidence && (
        <label className="text-[10px] text-gray-500 uppercase block">
          Confidence level (0–1)
          <input
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
            className="mt-1 w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
          />
        </label>
      )}
      <RunButton onClick={run} busy={busy}>Compute</RunButton>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultBlock result={result} />}
    </div>
  );
}

function TTestForm() {
  const [kind, setKind] = useState<'one-sample' | 'two-sample'>('two-sample');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [mu, setMu] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    const input: Record<string, unknown> = { kind, a: parseNums(a) };
    if (kind === 'two-sample') input.b = parseNums(b);
    else input.mu = Number(mu);
    const r = await lensRun<Record<string, unknown>>('science', 'stats-ttest', input);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Computation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as typeof kind)}
        className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
      >
        <option value="one-sample">One-sample (vs μ)</option>
        <option value="two-sample">Two-sample Welch&apos;s</option>
      </select>
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2}
        placeholder="Sample A" className={inputCls} />
      {kind === 'two-sample' ? (
        <textarea value={b} onChange={(e) => setB(e.target.value)} rows={2}
          placeholder="Sample B" className={inputCls} />
      ) : (
        <input
          type="number" value={mu} onChange={(e) => setMu(e.target.value)} placeholder="μ"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono"
        />
      )}
      <RunButton onClick={run} busy={busy}>Run t-test</RunButton>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultBlock result={result} />}
    </div>
  );
}

function PairedTest({ macro }: { macro: string }) {
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    const r = await lensRun<Record<string, unknown>>('science', macro, {
      x: parseNums(x), y: parseNums(y),
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Computation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <textarea value={x} onChange={(e) => setX(e.target.value)} rows={2}
        placeholder="X values" className={inputCls} />
      <textarea value={y} onChange={(e) => setY(e.target.value)} rows={2}
        placeholder="Y values" className={inputCls} />
      <RunButton onClick={run} busy={busy}>Compute</RunButton>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultBlock result={result} />}
    </div>
  );
}

function AnovaForm() {
  const [groups, setGroups] = useState<string[]>(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    const r = await lensRun<Record<string, unknown>>('science', 'stats-anova', {
      groups: groups.map(parseNums),
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Computation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500">One-way ANOVA across ≥ 2 groups.</p>
      {groups.map((g, i) => (
        <div key={i} className="flex gap-1">
          <textarea
            value={g}
            onChange={(e) => setGroups((gs) => gs.map((x, j) => (j === i ? e.target.value : x)))}
            rows={1}
            placeholder={`Group ${i + 1}`}
            className={inputCls}
          />
          {groups.length > 2 && (
            <button
              type="button"
              onClick={() => setGroups((gs) => gs.filter((_, j) => j !== i))}
              className="text-gray-600 hover:text-red-400 text-xs px-1"
              aria-label="Remove group"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setGroups((gs) => [...gs, ''])}
        className="text-[11px] text-teal-400 hover:text-teal-200"
      >
        + Add group
      </button>
      <div><RunButton onClick={run} busy={busy}>Run ANOVA</RunButton></div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultBlock result={result} />}
    </div>
  );
}

function NonParametricForm() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    const r = await lensRun<Record<string, unknown>>('science', 'stats-nonparametric', {
      test: 'mann-whitney', a: parseNums(a), b: parseNums(b),
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Computation failed');
    setBusy(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-gray-500">Mann–Whitney U — non-parametric two-sample test.</p>
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2}
        placeholder="Sample A" className={inputCls} />
      <textarea value={b} onChange={(e) => setB(e.target.value)} rows={2}
        placeholder="Sample B" className={inputCls} />
      <RunButton onClick={run} busy={busy}>Run test</RunButton>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && <ResultBlock result={result} />}
    </div>
  );
}

export default ScienceStats;
