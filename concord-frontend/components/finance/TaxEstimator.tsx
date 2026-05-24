'use client';

import { useEffect, useMemo, useState } from 'react';
import { Calculator, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface TaxResult {
  taxableIncome: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  brackets: Array<{ rate: number; from: number; to: number | null; amount: number; taxOnSlice: number }>;
  refund: number | null;
  owed: number | null;
  withholdingRecommendation: string;
}

type FilingStatus = 'single' | 'married_jointly' | 'married_separately' | 'head_of_household';

export function TaxEstimator() {
  const [wages, setWages] = useState<number>(85000);
  const [otherIncome, setOtherIncome] = useState<number>(0);
  const [longTermGains, setLongTermGains] = useState<number>(0);
  const [shortTermGains, setShortTermGains] = useState<number>(0);
  const [deductions, setDeductions] = useState<number>(0); // 0 → use standard
  const [filing, setFiling] = useState<FilingStatus>('single');
  const [withholding, setWithholding] = useState<number>(12000);
  const [result, setResult] = useState<TaxResult | null>(null);
  const [loading, setLoading] = useState(false);

  const compute = useMemo(() => async () => {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'finance', action: 'tax-estimate',
        input: { wages, otherIncome, longTermGains, shortTermGains, deductions, filing, withholding },
      });
      setResult(res.data?.result as TaxResult || null);
    } catch (e) { console.error('[Tax] estimate failed', e); }
    finally { setLoading(false); }
  }, [wages, otherIncome, longTermGains, shortTermGains, deductions, filing, withholding]);

  useEffect(() => { compute(); }, [compute]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calculator className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Tax estimator</span>
        <span className="ml-auto text-[10px] text-gray-400">IRS 2026 brackets</span>
      </header>
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <Field label="Wages (W-2)">
            <input type="number" value={wages} onChange={e => setWages(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Other income">
            <input type="number" value={otherIncome} onChange={e => setOtherIncome(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Long-term gains">
            <input type="number" value={longTermGains} onChange={e => setLongTermGains(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Short-term gains">
            <input type="number" value={shortTermGains} onChange={e => setShortTermGains(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Itemized deductions (0 = standard)">
            <input type="number" value={deductions} onChange={e => setDeductions(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
          <Field label="Filing status">
            <select value={filing} onChange={e => setFiling(e.target.value as FilingStatus)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="single">Single</option>
              <option value="married_jointly">Married, jointly</option>
              <option value="married_separately">Married, separately</option>
              <option value="head_of_household">Head of household</option>
            </select>
          </Field>
          <Field label="YTD federal withholding">
            <input type="number" value={withholding} onChange={e => setWithholding(Number(e.target.value) || 0)} className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </Field>
        </div>

        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Computing…
            </div>
          ) : !result ? (
            <div className="text-xs text-gray-400">Edit inputs to see your tax estimate.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Taxable income" value={`$${result.taxableIncome.toLocaleString()}`} />
                <Stat label="Total tax" value={`$${Math.round(result.totalTax).toLocaleString()}`} accent="text-yellow-300" />
                <Stat label="Effective rate" value={`${(result.effectiveRate * 100).toFixed(1)}%`} />
              </div>
              <div className="p-3 rounded bg-white/[0.02]">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Vs withholding</div>
                {result.refund != null ? (
                  <div className="text-2xl font-bold text-green-400">+${result.refund.toLocaleString()} refund</div>
                ) : result.owed != null ? (
                  <div className="text-2xl font-bold text-red-400">−${result.owed.toLocaleString()} owed</div>
                ) : (
                  <div className="text-lg text-gray-400">Even</div>
                )}
                <div className="text-[10px] text-gray-400 mt-1">{result.withholdingRecommendation}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Bracket walk-through</div>
                <ul className="space-y-1">
                  {result.brackets.map((b, i) => (
                    <li key={i} className="flex items-center text-[11px] gap-2">
                      <span className="font-mono text-cyan-300 w-12">{(b.rate * 100).toFixed(0)}%</span>
                      <span className="text-gray-400 font-mono tabular-nums w-32">
                        ${b.from.toLocaleString()}–{b.to != null ? `$${b.to.toLocaleString()}` : '+'}
                      </span>
                      <span className="font-mono tabular-nums text-gray-400 flex-1 text-right">${Math.round(b.amount).toLocaleString()}</span>
                      <span className="font-mono tabular-nums text-yellow-300 w-20 text-right">${Math.round(b.taxOnSlice).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="text-[10px] text-gray-400">
                Marginal rate: <span className="text-white">{(result.marginalRate * 100).toFixed(0)}%</span>. Federal only — state taxes not included.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-gray-400 block mb-0.5">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="p-2 bg-white/[0.02] rounded text-center">
      <div className={cn('text-sm font-bold tabular-nums', accent || 'text-white')}>{value}</div>
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}

export default TaxEstimator;
