'use client';

/**
 * HunterLeaderboard — ranks across all players who have confronted
 * hauntings. Mounts ghost-hunt.leaderboard. Highlights the calling
 * user's row.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface RankRow {
  userId: string;
  rank: number;
  wins: number;
  losses: number;
  confronts: number;
  xp: number;
  essence: number;
  winRate: number;
}

interface LeaderboardResult {
  ok: boolean;
  leaderboard?: RankRow[];
  you?: RankRow | null;
  totalHunters?: number;
}

export function HunterLeaderboard({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [you, setYou] = useState<RankRow | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<LeaderboardResult>('ghost-hunt', 'leaderboard', { limit: 25 });
    setRows(r.data.result?.leaderboard ?? []);
    setYou(r.data.result?.you ?? null);
    setTotal(r.data.result?.totalHunters ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-wide text-violet-400">Hunter ranks</h3>
        <span className="text-[10px] text-gray-400">{total} hunters</span>
      </div>
      {loading && <p className="text-xs text-gray-400">Loading ranks…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-xs text-gray-400">No confronted hauntings yet. Be the first.</p>
      )}
      {!loading && rows.length > 0 && (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400">
              <th className="px-1 py-1 text-left">#</th>
              <th className="px-1 py-1 text-left">Hunter</th>
              <th className="px-1 py-1 text-right">W/L</th>
              <th className="px-1 py-1 text-right">Win%</th>
              <th className="px-1 py-1 text-right">XP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const mine = you?.userId === row.userId;
              return (
                <tr
                  key={row.userId}
                  className={mine ? 'bg-violet-600/20 text-violet-100' : 'text-gray-300'}
                >
                  <td className="px-1 py-1">{row.rank}</td>
                  <td className="px-1 py-1 font-mono">{mine ? 'You' : row.userId.slice(0, 10)}</td>
                  <td className="px-1 py-1 text-right">{row.wins}/{row.losses}</td>
                  <td className="px-1 py-1 text-right">{Math.round(row.winRate * 100)}%</td>
                  <td className="px-1 py-1 text-right font-mono text-amber-300">{row.xp}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!loading && you && !rows.some((r) => r.userId === you.userId) && (
        <div className="mt-2 rounded border border-violet-600/30 bg-violet-600/10 px-2 py-1 text-xs text-violet-200">
          Your rank: #{you.rank} · {you.wins}W/{you.losses}L · {you.xp} XP
        </div>
      )}
    </div>
  );
}
