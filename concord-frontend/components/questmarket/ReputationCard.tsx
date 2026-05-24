/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Award, Flame, CheckCircle2, Upload } from 'lucide-react';

interface Rep {
  xp: number;
  rank: string;
  completed: number;
  posted: number;
  streak: number;
  nextRank: string | null;
  xpToNextRank: number;
  rankProgressPct: number;
  ranks: { name: string; min: number }[];
}

export function ReputationCard({ refreshKey }: { refreshKey?: number }) {
  const [rep, setRep] = useState<Rep | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'myReputation', {});
    if (r.data?.ok && r.data.result) { setRep(r.data.result); setErr(null); }
    else setErr(r.data?.error || 'failed to load reputation');
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading reputation…
      </div>
    );
  }
  if (err || !rep) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-300">
        {err || 'no reputation data'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-base font-bold text-white">{rep.rank}</p>
            <p className="text-[10px] text-zinc-400">{rep.xp.toLocaleString()} XP</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="flex items-center justify-center gap-0.5 text-sm font-bold text-emerald-300">
              <CheckCircle2 className="h-3 w-3" />{rep.completed}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400">done</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-0.5 text-sm font-bold text-sky-300">
              <Upload className="h-3 w-3" />{rep.posted}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400">posted</p>
          </div>
          <div>
            <p className="flex items-center justify-center gap-0.5 text-sm font-bold text-orange-300">
              <Flame className="h-3 w-3" />{rep.streak}
            </p>
            <p className="text-[9px] uppercase tracking-wider text-zinc-400">streak</p>
          </div>
        </div>
      </div>

      {rep.nextRank && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-zinc-400">
            <span>{rep.rank}</span>
            <span>{rep.xpToNextRank.toLocaleString()} XP to {rep.nextRank}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400"
              style={{ width: `${Math.max(2, Math.min(100, rep.rankProgressPct))}%` }} />
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1">
        {rep.ranks.map((r) => (
          <span key={r.name}
            className={`rounded px-1.5 py-0.5 text-[9px] ${
              r.name === rep.rank ? 'bg-amber-500/20 text-amber-300'
                : rep.xp >= r.min ? 'bg-zinc-800 text-zinc-400'
                  : 'bg-zinc-900 text-zinc-600'}`}>
            {r.name}
          </span>
        ))}
      </div>
    </div>
  );
}
