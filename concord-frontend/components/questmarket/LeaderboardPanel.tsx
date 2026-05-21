/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, Crown, TrendingUp, Flame, Trophy } from 'lucide-react';

interface Row {
  userId: string;
  xp: number;
  rank: string;
  completed: number;
  posted: number;
  streak: number;
  achievements: number;
  position: number;
}

export function LeaderboardPanel({ refreshKey }: { refreshKey?: number }) {
  const [board, setBoard] = useState<Row[]>([]);
  const [myPos, setMyPos] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'reputationBoard', { limit: 25 });
    if (r.data?.ok && r.data.result) {
      setBoard(r.data.result.board || []);
      setMyPos(r.data.result.myPosition ?? null);
      setTotal(r.data.result.total || 0);
      setErr(null);
    } else {
      setErr(r.data?.error || 'failed to load leaderboard');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading leaderboard…
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {err}
      </div>
    );
  }
  if (board.length === 0) {
    return (
      <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
        No adventurers ranked yet. Complete a verified quest to enter the leaderboard.
      </div>
    );
  }

  const chartData = board.slice(0, 10).map((r) => ({ name: r.userId, xp: r.xp }));

  const medal = (pos: number) =>
    pos === 1 ? 'text-amber-400' : pos === 2 ? 'text-zinc-300' : pos === 3 ? 'text-orange-400' : 'text-zinc-600';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-white">Reputation Leaderboard</h3>
        </div>
        <span className="text-xs text-zinc-400">
          {total} adventurers{myPos ? ` · you: #${myPos}` : ''}
        </span>
      </div>

      <div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Top 10 by XP</p>
        <ChartKit
          kind="bar"
          data={chartData}
          xKey="name"
          series={[{ key: 'xp', label: 'XP', color: '#fbbf24' }]}
          height={160}
          showLegend={false}
        />
      </div>

      <div className="space-y-1.5">
        {board.map((r) => (
          <div key={r.userId}
            className={`flex items-center justify-between rounded-lg border p-2.5 ${
              r.position === myPos
                ? 'border-amber-500/40 bg-amber-500/10'
                : 'border-zinc-800 bg-zinc-950/60'}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-6 w-6 items-center justify-center text-sm font-bold ${medal(r.position)}`}>
                {r.position <= 3 ? <Crown className="h-4 w-4" /> : r.position}
              </span>
              <div>
                <p className="text-xs font-medium text-white">{r.userId}</p>
                <p className="text-[10px] text-zinc-500">{r.rank}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-400">
              <span className="font-bold text-amber-300">{r.xp.toLocaleString()} XP</span>
              <span className="flex items-center gap-0.5">
                <Trophy className="h-3 w-3 text-emerald-400" />{r.completed}
              </span>
              <span className="flex items-center gap-0.5">
                <Flame className="h-3 w-3 text-orange-400" />{r.streak}
              </span>
              <span className="hidden sm:inline">{r.achievements} ach</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
