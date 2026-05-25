'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface MaturedItem {
  stakeId: string;
  poolName: string;
  principalCc: number;
  accruedYieldCc: number;
  unlocksAt: number;
  autoCompound: boolean;
  state: string;
  message: string;
}

interface UpcomingItem {
  stakeId: string;
  poolName: string;
  principalCc: number;
  unlocksAt: number;
  daysUntilMaturity: number;
  autoCompound: boolean;
  state: string;
  message: string;
}

interface Reminders {
  matured: MaturedItem[];
  upcoming: UpcomingItem[];
  maturedCount: number;
  upcomingCount: number;
  windowDays: number;
}

/**
 * MaturityReminders — maturity notifications for matured + upcoming-within-
 * window staking positions. Wires staking.maturity_reminders.
 */
export function MaturityReminders({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<Reminders | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun<Reminders>('staking', 'maturity_reminders', { windowDays: 60 });
      if (!cancelled && r.data?.ok && r.data.result) setData(r.data.result);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!data) {
    return <div className="text-xs text-zinc-400 py-3">Loading reminders…</div>;
  }

  if (data.maturedCount === 0 && data.upcomingCount === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 px-3 py-4 text-center text-xs italic text-zinc-400">
        No maturity reminders. Open a stake and a reminder appears as it nears unlock.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.matured.map((m) => (
        <div
          key={m.stakeId}
          className="rounded-lg border border-emerald-700/50 bg-emerald-950/25 px-3 py-2 text-xs text-emerald-200"
        >
          <span className="mr-1.5 rounded bg-emerald-800/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
            matured
          </span>
          {m.message}
        </div>
      ))}
      {data.upcoming.map((u) => (
        <div
          key={u.stakeId}
          className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-200"
        >
          <span className="mr-1.5 rounded bg-amber-800/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
            {u.daysUntilMaturity}d
          </span>
          {u.message}
        </div>
      ))}
    </div>
  );
}
