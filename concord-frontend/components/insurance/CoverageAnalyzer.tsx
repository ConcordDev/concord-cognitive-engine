'use client';

import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, CheckCircle, Loader2, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface CoverageGap {
  area: string;
  current: string;
  recommended: string;
  riskLevel: 'critical' | 'moderate' | 'low';
  monthlyCostToFix: number;
  rationale: string;
}

export function CoverageAnalyzer() {
  const [gaps, setGaps] = useState<CoverageGap[]>([]);
  const [score, setScore] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'insurance', action: 'coverage-analyze', input: {} });
        setGaps((res.data?.result?.gaps || []) as CoverageGap[]);
        setScore(Number(res.data?.result?.score) || 0);
      } catch (e) { console.error('[Coverage] failed', e); }
      finally { setLoading(false); }
    })();
  }, []);

  const totalCostToFix = gaps.reduce((s, g) => s + g.monthlyCostToFix, 0);
  const criticalCount = gaps.filter(g => g.riskLevel === 'critical').length;

  if (loading) return <div className="p-6 flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Analyzing…</div>;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Shield className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Coverage gap analysis</span>
      </header>
      <div className="p-4 grid grid-cols-3 gap-3 text-center">
        <div className="p-3 bg-white/[0.02] rounded">
          <div className={cn('text-3xl font-bold tabular-nums',
            score >= 80 ? 'text-green-300' : score >= 60 ? 'text-cyan-300' : score >= 40 ? 'text-yellow-300' : 'text-red-300'
          )}>{Math.round(score)}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Coverage score</div>
        </div>
        <div className="p-3 bg-white/[0.02] rounded">
          <div className={cn('text-3xl font-bold tabular-nums', criticalCount > 0 ? 'text-red-300' : 'text-green-300')}>{criticalCount}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Critical gaps</div>
        </div>
        <div className="p-3 bg-white/[0.02] rounded">
          <div className="text-3xl font-bold tabular-nums text-yellow-300">${totalCostToFix.toFixed(0)}</div>
          <div className="text-[10px] uppercase tracking-wider text-gray-500">Cost to close all gaps/mo</div>
        </div>
      </div>
      <ul className="divide-y divide-white/5 max-h-96 overflow-y-auto">
        {gaps.length === 0 ? (
          <li className="px-3 py-10 text-center text-xs text-green-300 inline-flex items-center justify-center gap-2">
            <CheckCircle className="w-5 h-5" /> No coverage gaps detected!
          </li>
        ) : (
          gaps.map((g, i) => (
            <li key={i} className="px-3 py-3 hover:bg-white/[0.03]">
              <div className="flex items-start gap-2">
                {g.riskLevel === 'critical' ? <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" /> :
                 g.riskLevel === 'moderate' ? <AlertTriangle className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" /> :
                 <TrendingDown className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{g.area}</span>
                    <span className={cn('text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                      g.riskLevel === 'critical' ? 'bg-red-500/20 text-red-300' :
                      g.riskLevel === 'moderate' ? 'bg-yellow-500/20 text-yellow-300' :
                      'bg-blue-500/20 text-blue-300'
                    )}>{g.riskLevel}</span>
                    <span className="ml-auto text-xs text-cyan-300 tabular-nums">+${g.monthlyCostToFix.toFixed(0)}/mo</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    <span className="text-red-300">Current:</span> {g.current} → <span className="text-green-300">Recommended:</span> {g.recommended}
                  </div>
                  <p className="text-[11px] text-gray-300 mt-1">{g.rationale}</p>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default CoverageAnalyzer;
