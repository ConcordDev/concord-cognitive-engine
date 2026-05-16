'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, TrendingUp, AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface MonteCarloResult {
  successProbability: number;
  medianFinalBalance: number;
  p10Final: number;
  p25Final: number;
  p75Final: number;
  p90Final: number;
  shortfallYear: number | null;
  trajectories: number[][];  // 100 sampled paths × yearly
  years: number;
}

export function RetirementSimulator() {
  const [currentAge, setCurrentAge] = useState(35);
  const [retireAge, setRetireAge] = useState(67);
  const [currentSavings, setCurrentSavings] = useState(150000);
  const [annualContribution, setAnnualContribution] = useState(20000);
  const [expectedReturn, setExpectedReturn] = useState(7);
  const [volatility, setVolatility] = useState(15);
  const [annualSpendInRetirement, setAnnualSpendInRetirement] = useState(60000);
  const [paths, setPaths] = useState(1000);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useMemo(() => async () => {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'finance', action: 'retirement-monte-carlo',
        input: {
          currentAge, retireAge,
          currentSavings, annualContribution,
          expectedReturn: expectedReturn / 100,
          volatility: volatility / 100,
          annualSpendInRetirement,
          paths,
        },
      });
      setResult(res.data?.result as MonteCarloResult || null);
    } catch (e) { console.error('[Retirement] sim failed', e); }
    finally { setLoading(false); }
  }, [currentAge, retireAge, currentSavings, annualContribution, expectedReturn, volatility, annualSpendInRetirement, paths]);

  useEffect(() => { run(); }, [run]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Retirement simulator</span>
        <span className="ml-auto text-[10px] text-gray-500">{paths.toLocaleString()}-path Monte Carlo</span>
      </header>

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3 text-xs">
          <Row label="Current age" value={currentAge} setValue={setCurrentAge} min={18} max={90} />
          <Row label="Retire at" value={retireAge} setValue={setRetireAge} min={50} max={90} />
          <Row label="Current savings $" value={currentSavings} setValue={setCurrentSavings} min={0} max={5000000} step={1000} />
          <Row label="Annual contribution $" value={annualContribution} setValue={setAnnualContribution} min={0} max={70000} step={500} />
          <Row label="Expected return %" value={expectedReturn} setValue={setExpectedReturn} min={0} max={15} step={0.5} />
          <Row label="Volatility (σ) %" value={volatility} setValue={setVolatility} min={2} max={30} step={1} />
          <Row label="Annual spend in retirement $" value={annualSpendInRetirement} setValue={setAnnualSpendInRetirement} min={10000} max={500000} step={1000} />
          <Row label="Paths" value={paths} setValue={setPaths} min={100} max={5000} step={100} />
        </div>

        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Running…
            </div>
          ) : !result ? (
            <div className="text-xs text-gray-500">Edit inputs to run the simulation.</div>
          ) : (
            <div className="space-y-3">
              <div className="p-3 rounded bg-white/[0.02] text-center">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Success probability</div>
                <div className={cn('text-4xl font-bold tabular-nums',
                  result.successProbability >= 0.85 ? 'text-green-300' :
                  result.successProbability >= 0.6 ? 'text-cyan-300' :
                  result.successProbability >= 0.4 ? 'text-yellow-300' :
                  'text-red-300'
                )}>{(result.successProbability * 100).toFixed(0)}%</div>
                <div className="text-[10px] text-gray-400">
                  Chance you don&apos;t run out of money by age {retireAge + (result.years - (retireAge - currentAge))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Stat label="Median final balance" value={`$${(result.medianFinalBalance / 1000).toFixed(0)}k`} />
                <Stat label="10th percentile" value={`$${(result.p10Final / 1000).toFixed(0)}k`} accent="text-red-300" />
                <Stat label="90th percentile" value={`$${(result.p90Final / 1000).toFixed(0)}k`} accent="text-green-300" />
                <Stat label="Median shortfall year" value={result.shortfallYear ? String(result.shortfallYear) : 'none'} accent={result.shortfallYear ? 'text-yellow-300' : 'text-green-300'} />
              </div>

              <FanChart trajectories={result.trajectories} years={result.years} />

              {result.successProbability < 0.7 && (
                <div className="px-3 py-2 rounded bg-yellow-500/10 border border-yellow-500/30 text-xs text-yellow-300 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Consider raising contributions, lowering retirement spend, or retiring later to bring success above 85%.</span>
                </div>
              )}
              {result.successProbability >= 0.85 && (
                <div className="px-3 py-2 rounded bg-green-500/10 border border-green-500/30 text-xs text-green-300 flex items-start gap-2">
                  <TrendingUp className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>You&apos;re on a healthy trajectory. Consider increasing contributions for buffer.</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, setValue, min, max, step = 1 }: { label: string; value: number; setValue: (v: number) => void; min: number; max: number; step?: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 w-44">{label}</span>
      <input
        type="number" value={value} min={min} max={max} step={step}
        onChange={e => setValue(Number(e.target.value) || 0)}
        className="w-28 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white tabular-nums"
      />
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => setValue(Number(e.target.value))}
        className="flex-1 accent-cyan-400"
      />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="p-2 bg-white/[0.02] rounded text-center">
      <div className={cn('text-sm font-bold tabular-nums', accent || 'text-white')}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  );
}

function FanChart({ trajectories, years }: { trajectories: number[][]; years: number }) {
  if (trajectories.length === 0) return null;
  const width = 360;
  const height = 140;
  const maxVal = Math.max(...trajectories.flat());
  const xStep = width / Math.max(1, years - 1);
  const yScale = (v: number) => height - (v / maxVal) * height;
  const paths = trajectories.slice(0, 30).map((traj, i) => {
    const d = traj.map((v, t) => `${t === 0 ? 'M' : 'L'} ${(t * xStep).toFixed(1)} ${yScale(v).toFixed(1)}`).join(' ');
    return <path key={i} d={d} stroke="#22d3ee" strokeWidth={0.4} fill="none" opacity={0.15} />;
  });
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Sampled paths (first 30 of {trajectories.length})</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 bg-[#0a0e17] border border-white/10 rounded">
        {paths}
      </svg>
    </div>
  );
}

export default RetirementSimulator;
