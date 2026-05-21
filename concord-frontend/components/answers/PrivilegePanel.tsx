'use client';

/**
 * PrivilegePanel — Stack Overflow-style reputation privilege tiers.
 * Shows each action gate, whether it is unlocked, and reputation needed
 * for the next unlock. Wires the answers.privileges macro.
 */

import { useEffect, useState } from 'react';
import { Lock, Unlock, Loader2, ShieldCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Tier {
  id: string;
  label: string;
  threshold: number;
  unlocked: boolean;
  remaining: number;
}
interface PrivResult {
  reputation: number;
  tiers: Tier[];
  nextUnlock: Tier | null;
  unlockedCount: number;
}

export function PrivilegePanel({ refreshKey }: { refreshKey?: number }) {
  const [data, setData] = useState<PrivResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const r = await lensRun('answers', 'privileges', {});
      if (!cancelled) {
        if (r.data?.ok) setData(r.data.result as PrivResult);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
    );
  }
  if (!data) return <p className="text-xs text-zinc-500 italic py-4 text-center">No data yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-orange-400" />
        <h4 className="text-sm font-semibold text-zinc-200">Privileges</h4>
        <span className="text-[11px] text-zinc-500">
          {data.unlockedCount}/{data.tiers.length} unlocked · {data.reputation} rep
        </span>
      </div>

      {data.nextUnlock && (
        <div className="rounded border border-orange-900/40 bg-orange-950/20 px-3 py-2 text-[12px] text-orange-300">
          Next: <span className="font-semibold">{data.nextUnlock.label}</span> — {data.nextUnlock.remaining} more rep
        </div>
      )}

      <ul className="space-y-1.5">
        {data.tiers.map((t) => (
          <li
            key={t.id}
            className={`flex items-center gap-2 rounded border px-3 py-1.5 text-[12px] ${
              t.unlocked
                ? 'border-emerald-900/40 bg-emerald-950/15 text-emerald-200'
                : 'border-zinc-800 bg-zinc-900/40 text-zinc-500'
            }`}
          >
            {t.unlocked ? <Unlock className="w-3.5 h-3.5 shrink-0" /> : <Lock className="w-3.5 h-3.5 shrink-0" />}
            <span className="flex-1">{t.label}</span>
            <span className="text-[11px] tabular-nums">{t.threshold} rep</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
