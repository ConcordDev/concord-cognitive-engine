'use client';

/**
 * InsuranceOverviewPanel — book-wide coverage mix + renewals-due surface.
 *
 * Wires two macros that had zero frontend caller before this pass:
 *   - insurance.coverage-summary — active-policy count, total/monthly
 *     premium, and a breakdown by policy kind.
 *   - insurance.renewals-due     — policies whose renewal is overdue or
 *     due within 30 days (dueState: 'overdue' | 'due_soon'), soonest first.
 * Both are real STATE-backed reads over the user's own policy-list — no
 * synthetic data.
 */

import { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, Loader2, AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CoverageSummary {
  policies: number;
  activePolicies: number;
  totalAnnualPremium: number;
  monthlyPremium: number;
  byKind: Record<string, number>;
}
interface RenewalDue {
  id: string;
  carrier: string;
  kind: string;
  renewalDate: string;
  status: 'overdue' | 'due_soon';
}

const KIND_COLOR: Record<string, string> = {
  auto: 'bg-blue-500', home: 'bg-green-500', health: 'bg-red-500', life: 'bg-purple-500',
  umbrella: 'bg-cyan-500', renters: 'bg-teal-500', pet: 'bg-orange-500', travel: 'bg-pink-500',
  business: 'bg-amber-500',
};

export function InsuranceOverviewPanel() {
  const [summary, setSummary] = useState<CoverageSummary | null>(null);
  const [due, setDue] = useState<RenewalDue[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, d] = await Promise.all([
        lensRun('insurance', 'coverage-summary', {}),
        lensRun('insurance', 'renewals-due', {}),
      ]);
      setSummary((s.data?.result as CoverageSummary | null) || null);
      setDue(((d.data?.result as { due?: RenewalDue[] } | null)?.due) || []);
    } catch (e) { console.error('[Overview] failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="p-6 flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading book overview…</div>;
  }

  const kindEntries = summary ? Object.entries(summary.byKind).sort((a, b) => b[1] - a[1]) : [];
  const maxKindCount = kindEntries.reduce((m, [, c]) => Math.max(m, c), 0) || 1;

  return (
    <div className="space-y-4">
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <LayoutDashboard className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Coverage summary</span>
        </header>
        {!summary || summary.policies === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No policies on file yet.</div>
        ) : (
          <>
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-white/[0.02] rounded text-center">
                <div className="text-2xl font-bold text-white tabular-nums">{summary.activePolicies}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Active / {summary.policies} total</div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded text-center">
                <div className="text-2xl font-bold text-green-300 tabular-nums">${summary.totalAnnualPremium.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Annual premium</div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded text-center">
                <div className="text-2xl font-bold text-cyan-300 tabular-nums">${summary.monthlyPremium.toLocaleString()}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Monthly equivalent</div>
              </div>
              <div className="p-3 bg-white/[0.02] rounded text-center">
                <div className="text-2xl font-bold text-white tabular-nums">{kindEntries.length}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Lines of coverage</div>
              </div>
            </div>
            {kindEntries.length > 0 && (
              <div className="px-4 pb-4 space-y-1.5">
                {kindEntries.map(([kind, count]) => (
                  <div key={kind} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-300 w-16 capitalize shrink-0">{kind}</span>
                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                      <div className={cn('h-full rounded-full', KIND_COLOR[kind] || 'bg-gray-500')} style={{ width: `${(count / maxKindCount) * 100}%` }} />
                    </div>
                    <span className="text-[11px] text-gray-400 w-4 text-right tabular-nums">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Clock className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Renewals due</span>
          <span className="ml-auto text-[10px] text-gray-400">{due.length} within 60 days</span>
        </header>
        {due.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-green-300 inline-flex items-center justify-center gap-2 w-full">
            <ShieldCheck className="w-4 h-4" /> Nothing due — you&rsquo;re current.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {due.map(r => (
              <li key={r.id} className="px-3 py-2 flex items-center gap-2">
                {r.status === 'overdue'
                  ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                  : <Clock className="w-3.5 h-3.5 text-yellow-400 shrink-0" />}
                <span className="text-sm text-white">{r.carrier}</span>
                <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/10 text-gray-300">{r.kind}</span>
                <span className={cn('ml-auto text-[10px] uppercase font-bold px-1.5 py-0.5 rounded',
                  r.status === 'overdue' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300')}>
                  {r.status === 'overdue' ? 'overdue' : 'due soon'}
                </span>
                <span className="text-[11px] text-gray-400 font-mono">{r.renewalDate}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default InsuranceOverviewPanel;
