'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, AlertTriangle, CheckCircle2, Loader2, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface AllocationItem {
  assetClass: string;
  current: number;
  target: number;
  drift: number;
  rebalanceAction: 'buy' | 'sell' | 'hold';
  rebalanceAmount: number;
}

export interface FeeBenchmark {
  symbol: string;
  expenseRatio: number;
  category: string;
  benchmark: number;
  delta: number;
}

export interface InvestmentCheckupResult {
  allocation: AllocationItem[];
  drift: { worst: number; categories: number };
  concentrationRisk: { topHoldingPct: number; topThreePct: number; sectorMax: number };
  fees: FeeBenchmark[];
  totalAnnualFeeUsd: number;
  recommendations: string[];
  score: number;
}

export function InvestmentCheckup() {
  const [data, setData] = useState<InvestmentCheckupResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'finance', action: 'investment-checkup', input: {},
      });
      setData(res.data?.result as InvestmentCheckupResult || null);
    } catch (e) { console.error('[Checkup] failed', e); }
    finally { setLoading(false); }
  }

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Running checkup…</div>;
  }
  if (!data) {
    return <div className="p-6 text-xs text-gray-400">No investment data. Add holdings via the Portfolio tab.</div>;
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Investment checkup</span>
        <span className="ml-auto text-[10px] text-gray-400">Empower-style</span>
      </header>

      <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <ScoreCard score={data.score} />
        <Stat label="Worst drift" value={`${data.drift.worst.toFixed(1)}%`} accent={data.drift.worst > 5 ? 'text-red-300' : 'text-cyan-300'} />
        <Stat label="Top holding" value={`${data.concentrationRisk.topHoldingPct.toFixed(0)}%`} accent={data.concentrationRisk.topHoldingPct > 30 ? 'text-yellow-300' : 'text-green-300'} />
        <Stat label="Annual fees" value={`$${data.totalAnnualFeeUsd.toFixed(0)}`} accent={data.totalAnnualFeeUsd > 500 ? 'text-yellow-300' : 'text-green-300'} />
      </div>

      <div className="px-4 py-3 border-t border-white/10">
        <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Allocation drift</h3>
        <div className="space-y-2">
          {data.allocation.map(a => (
            <div key={a.assetClass}>
              <div className="flex items-center gap-2 text-xs mb-1">
                <span className="text-white w-24">{a.assetClass}</span>
                <span className="font-mono tabular-nums text-cyan-300">{a.current.toFixed(1)}%</span>
                <span className="text-gray-400">→</span>
                <span className="font-mono tabular-nums text-gray-400">{a.target.toFixed(1)}%</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px]">
                  <span className={cn('px-1.5 py-0.5 rounded font-bold uppercase',
                    a.rebalanceAction === 'buy' ? 'bg-green-500/20 text-green-300' :
                    a.rebalanceAction === 'sell' ? 'bg-red-500/20 text-red-300' :
                    'bg-gray-500/20 text-gray-300'
                  )}>{a.rebalanceAction}</span>
                  {a.rebalanceAmount !== 0 && (
                    <span className="text-gray-300 tabular-nums">${Math.abs(a.rebalanceAmount).toFixed(0)}</span>
                  )}
                </span>
              </div>
              <div className="relative h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="absolute h-full bg-gray-500/40" style={{ width: `${Math.min(100, a.target)}%` }} />
                <div className={cn('absolute h-full', Math.abs(a.drift) > 5 ? 'bg-red-400' : 'bg-cyan-400')}
                  style={{ width: `${Math.min(100, a.current)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.fees.length > 0 && (
        <div className="px-4 py-3 border-t border-white/10">
          <h3 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Fee benchmarks</h3>
          <ul className="space-y-1 text-xs">
            {data.fees.map(f => (
              <li key={f.symbol} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/[0.03]">
                <span className="font-mono w-12 text-white">{f.symbol}</span>
                <span className="text-gray-400 flex-1 truncate">{f.category}</span>
                <span className="font-mono tabular-nums text-white">{(f.expenseRatio * 100).toFixed(2)}%</span>
                <span className={cn('text-[10px] font-mono tabular-nums w-16 text-right',
                  f.delta > 0.005 ? 'text-red-300' : f.delta < -0.001 ? 'text-green-300' : 'text-gray-400'
                )}>
                  {f.delta > 0 ? '+' : ''}{(f.delta * 100).toFixed(2)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.recommendations.length > 0 && (
        <div className="px-4 py-3 border-t border-white/10">
          <h3 className="text-xs uppercase tracking-wider text-yellow-300 mb-2">Recommendations</h3>
          <ul className="space-y-1.5 text-xs text-gray-200">
            {data.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 mt-0.5 shrink-0" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ score }: { score: number }) {
  const color = score >= 80 ? 'text-green-300' : score >= 60 ? 'text-cyan-300' : score >= 40 ? 'text-yellow-300' : 'text-red-300';
  const Icon = score >= 80 ? CheckCircle2 : score >= 40 ? TrendingUp : AlertTriangle;
  return (
    <div className="p-3 bg-white/[0.02] rounded text-center">
      <Icon className={cn('w-6 h-6 mx-auto mb-1', color)} />
      <div className={cn('text-3xl font-bold tabular-nums', color)}>{Math.round(score)}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">Health score</div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="p-3 bg-white/[0.02] rounded text-center">
      <div className={cn('text-2xl font-bold tabular-nums', accent)}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}

export default InvestmentCheckup;
