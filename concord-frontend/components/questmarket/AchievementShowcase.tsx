/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Trophy, Lock } from 'lucide-react';

interface Ach { id: string; name: string; rarity: string; unlockedAt?: string }
interface Showcase {
  unlocked: Ach[];
  locked: Ach[];
  unlockedCount: number;
  totalCount: number;
  completionPct: number;
  rarityCount: Record<string, number>;
  rank: string;
  xp: number;
}

const RARITY: Record<string, string> = {
  Common: 'border-zinc-600 text-zinc-300 bg-zinc-700/20',
  Uncommon: 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10',
  Rare: 'border-sky-500/40 text-sky-300 bg-sky-500/10',
  Epic: 'border-fuchsia-500/40 text-fuchsia-300 bg-fuchsia-500/10',
  Legendary: 'border-amber-500/40 text-amber-300 bg-amber-500/10',
  Mythic: 'border-rose-500/40 text-rose-300 bg-rose-500/10',
};

export function AchievementShowcase({ refreshKey }: { refreshKey?: number }) {
  const [sc, setSc] = useState<Showcase | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'achievementShowcase', {});
    if (r.data?.ok && r.data.result) { setSc(r.data.result); setErr(null); }
    else setErr(r.data?.error || 'failed to load showcase');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading achievements…
      </div>
    );
  }
  if (err || !sc) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {err || 'no achievement data'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Achievement Showcase</h3>
        </div>
        <span className="text-xs text-zinc-400">
          {sc.unlockedCount}/{sc.totalCount} · {sc.completionPct}%
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
          style={{ width: `${Math.max(2, sc.completionPct)}%` }} />
      </div>

      {Object.keys(sc.rarityCount).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(sc.rarityCount).map(([r, n]) => (
            <span key={r} className={`rounded-full border px-2 py-0.5 text-[10px] ${RARITY[r] || RARITY.Common}`}>
              {r} ×{n}
            </span>
          ))}
        </div>
      )}

      {sc.unlocked.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Unlocked</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sc.unlocked.map((a) => (
              <div key={a.id}
                className={`rounded-lg border p-2.5 ${RARITY[a.rarity] || RARITY.Common}`}>
                <div className="flex items-center gap-1.5">
                  <Trophy className="h-3.5 w-3.5" />
                  <span className="truncate text-xs font-semibold">{a.name}</span>
                </div>
                <p className="mt-0.5 text-[9px] opacity-70">{a.rarity}</p>
                {a.unlockedAt && (
                  <p className="text-[9px] opacity-60">
                    {new Date(a.unlockedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sc.locked.length > 0 && (
        <div>
          <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">Locked</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sc.locked.map((a) => (
              <div key={a.id}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2.5 opacity-60">
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-zinc-500" />
                  <span className="truncate text-xs font-medium text-zinc-400">{a.name}</span>
                </div>
                <p className="mt-0.5 text-[9px] text-zinc-600">{a.rarity}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
