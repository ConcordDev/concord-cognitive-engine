'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, BarChart3, Sigma, Activity, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'descriptive' | 'ttest' | 'correlation';

export function ScienceWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('descriptive');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[620px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-teal-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-teal-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Sigma className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-gray-200">Science Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'descriptive', label: 'Descriptive', icon: BarChart3 },
          { id: 'ttest',       label: 't-test',      icon: Activity },
          { id: 'correlation', label: 'Correlation', icon: TrendingUp },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-teal-500/15 text-teal-200 border border-teal-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'descriptive' && <DescriptiveTab />}
        {tab === 'ttest' && <TTestTab />}
        {tab === 'correlation' && <CorrelationTab />}
      </div>
    </div>
  );
}

function parseDataInput(s: string): number[] {
  return s.split(/[,\s]+/).map(Number).filter(Number.isFinite);
}

function DescriptiveTab() {
  const [data, setData] = useState('1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
  const [result, setResult] = useState<{
    n: number; mean: number; median: number; sd: number; variance: number;
    min: number; max: number; q1: number; q3: number; iqr: number; sum: number;
  } | null>(null);

  const calc = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'science', action: 'stats-descriptive',
        input: { data: parseDataInput(data) },
      });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <textarea value={data} onChange={(e) => setData(e.target.value)} rows={3}
        placeholder="comma or space separated numbers"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100">Compute</button>

      {result && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 grid grid-cols-3 gap-3 text-xs">
          {Object.entries(result).map(([k, v]) => (
            <div key={k}>
              <span className="text-gray-500 uppercase text-[10px]">{k}</span>
              <p className="font-mono text-gray-100">{v}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TTestTab() {
  const [kind, setKind] = useState<'one-sample' | 'two-sample'>('two-sample');
  const [a, setA] = useState('5, 7, 8, 4, 6, 9, 5, 7');
  const [b, setB] = useState('10, 12, 11, 14, 13, 11, 12, 13');
  const [mu, setMu] = useState('5');
  const [result, setResult] = useState<{
    kind: string; t: number; df: number; pValue: number;
    significantAt05?: boolean; meanA?: number; meanB?: number;
  } | null>(null);

  const calc = async () => {
    try {
      const input: Record<string, unknown> = { kind, a: parseDataInput(a) };
      if (kind === 'two-sample') input.b = parseDataInput(b);
      else input.mu = Number(mu);
      const r = await api.post('/api/lens/run', { domain: 'science', action: 'stats-ttest', input });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}
        className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
        <option value="one-sample">One-sample (vs μ)</option>
        <option value="two-sample">Two-sample Welch&apos;s</option>
      </select>

      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2}
        placeholder="Sample A (comma/space separated)"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />

      {kind === 'two-sample' ? (
        <textarea value={b} onChange={(e) => setB(e.target.value)} rows={2}
          placeholder="Sample B"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
      ) : (
        <input type="number" value={mu} onChange={(e) => setMu(e.target.value)} placeholder="μ"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
      )}

      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100">Run t-test</button>

      {result && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 space-y-1 text-sm">
          <p>t = <span className="font-mono text-gray-100">{result.t}</span></p>
          <p>df = <span className="font-mono text-gray-100">{result.df}</span></p>
          <p>p-value = <span className={cn('font-mono', result.pValue < 0.05 ? 'text-emerald-300' : 'text-gray-400')}>{result.pValue}</span></p>
          {result.meanA !== undefined && <p className="text-[11px] text-gray-500">means: A={result.meanA}, B={result.meanB}</p>}
          {result.significantAt05 !== undefined && (
            <p className={cn('text-[11px] uppercase font-bold', result.significantAt05 ? 'text-emerald-300' : 'text-gray-500')}>
              {result.significantAt05 ? '✓ Significant @ α=0.05' : 'Not significant @ α=0.05'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CorrelationTab() {
  const [x, setX] = useState('1, 2, 3, 4, 5, 6, 7, 8, 9, 10');
  const [y, setY] = useState('2.1, 3.9, 6.2, 8.0, 10.1, 11.8, 14.0, 16.2, 18.1, 20.0');
  const [result, setResult] = useState<{
    n: number; pearsonR: number; rSquared: number; pValue: number;
    slope: number; intercept: number; equation: string; significantAt05: boolean;
  } | null>(null);

  const calc = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'science', action: 'stats-correlation',
        input: { x: parseDataInput(x), y: parseDataInput(y) },
      });
      setResult(((r.data as { result?: typeof result }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { calc(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <textarea value={x} onChange={(e) => setX(e.target.value)} rows={2}
        placeholder="X values"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
      <textarea value={y} onChange={(e) => setY(e.target.value)} rows={2}
        placeholder="Y values"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none" />
      <button type="button" onClick={calc}
        className="px-3 py-1 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100">Compute</button>

      {result && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 space-y-1 text-sm">
          <p>Pearson r = <span className="font-mono text-2xl text-teal-300">{result.pearsonR}</span></p>
          <p>R² = <span className="font-mono text-gray-100">{result.rSquared}</span></p>
          <p>p-value = <span className={cn('font-mono', result.pValue < 0.05 ? 'text-emerald-300' : 'text-gray-400')}>{result.pValue}</span></p>
          <p className="text-[11px] text-gray-500">{result.equation}</p>
          <p className={cn('text-[11px] uppercase font-bold', result.significantAt05 ? 'text-emerald-300' : 'text-gray-500')}>
            {result.significantAt05 ? '✓ Significant @ α=0.05' : 'Not significant @ α=0.05'}
          </p>
        </div>
      )}
    </div>
  );
}

export default ScienceWorkbench;
