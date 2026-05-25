'use client';

/**
 * AllowanceTracker — Sweepy-shape reward-points / allowance system. Computes
 * per-person points and dollar allowance from the real chore-completion log
 * via household.allowance-summary. The dollars-per-point rate is user input.
 */

import { useCallback, useEffect, useState } from 'react';
import { PiggyBank, Loader2, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Member { person: string; points: number; choresDone: number; allowance: number }
interface Summary { members: Member[]; dollarsPerPoint: number; totalPoints: number; totalAllowance: number }

export function AllowanceTracker() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [rate, setRate] = useState(0.05);

  const refresh = useCallback(async (perPoint: number) => {
    const r = await lensRun<Summary>('household', 'allowance-summary', { dollarsPerPoint: perPoint });
    if (r.data?.ok) setSummary(r.data.result);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(rate); }, [refresh, rate]);

  const maxPoints = Math.max(1, ...(summary?.members.map(m => m.points) || [1]));

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <PiggyBank className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Allowance &amp; Rewards</h3>
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-400">
          $/point
          <input type="number" min={0} step={0.01} value={rate}
            onChange={e => setRate(Math.max(0, Number(e.target.value) || 0))}
            className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </label>
      </div>

      {!summary || summary.members.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No data yet — complete chores on the Chore Board to earn reward points and allowance.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-center">
              <p className="text-base font-bold text-amber-400">{summary.totalPoints}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Total Points</p>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2 text-center">
              <p className="text-base font-bold text-emerald-400">${summary.totalAllowance.toFixed(2)}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">Total Allowance</p>
            </div>
          </div>
          <ul className="space-y-2">
            {summary.members.map((m, i) => (
              <li key={m.person} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={cn('text-xs font-bold w-5 text-center rounded',
                    i === 0 ? 'text-amber-400' : 'text-zinc-400')}>{i + 1}</span>
                  <span className="text-xs font-semibold text-zinc-100 flex-1 truncate">{m.person}</span>
                  <span className="text-[11px] text-amber-400 inline-flex items-center gap-0.5"><Star className="w-3 h-3" />{m.points}</span>
                  <span className="text-[11px] text-zinc-400">{m.choresDone} chores</span>
                  <span className="text-xs font-bold text-emerald-400">${m.allowance.toFixed(2)}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(m.points / maxPoints) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
