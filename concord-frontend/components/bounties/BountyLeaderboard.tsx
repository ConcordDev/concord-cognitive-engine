'use client';

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Trophy, Coins, CheckCircle2, Loader2, Crown } from 'lucide-react';
import type { LeaderRow } from './types';

const MEDAL = ['text-amber-300', 'text-zinc-300', 'text-orange-400'];

export function BountyLeaderboard({ refreshKey }: { refreshKey: number }) {
  const [earners, setEarners] = useState<LeaderRow[]>([]);
  const [resolvers, setResolvers] = useState<LeaderRow[]>([]);
  const [tab, setTab] = useState<'earners' | 'resolvers'>('earners');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ topEarners: LeaderRow[]; topResolvers: LeaderRow[] }>(
      'bounties', 'leaderboard', { limit: 10 },
    );
    if (r.data?.ok && r.data.result) {
      setEarners(r.data.result.topEarners || []);
      setResolvers(r.data.result.topResolvers || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const rows = tab === 'earners' ? earners : resolvers;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
          <Crown className="w-4 h-4 text-amber-400" /> Leaderboard
        </h3>
        <div className="flex rounded-lg bg-zinc-900 p-0.5">
          <button
            onClick={() => setTab('earners')}
            className={`text-[11px] px-2 py-1 rounded-md ${tab === 'earners' ? 'bg-amber-600 text-zinc-950 font-semibold' : 'text-zinc-400'}`}
          >
            Top earners
          </button>
          <button
            onClick={() => setTab('resolvers')}
            className={`text-[11px] px-2 py-1 rounded-md ${tab === 'resolvers' ? 'bg-amber-600 text-zinc-950 font-semibold' : 'text-zinc-400'}`}
          >
            Top resolvers
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-6 text-center text-zinc-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-zinc-400 text-xs">
          <Trophy className="w-6 h-6 mx-auto mb-1 opacity-40" />
          No {tab} yet — resolve a bounty to appear here.
        </div>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.userId} className="flex items-center gap-2 rounded-lg bg-zinc-900/70 px-2.5 py-1.5">
              <span className={`text-sm font-bold w-5 text-center ${MEDAL[r.rank - 1] || 'text-zinc-400'}`}>
                {r.rank}
              </span>
              <span className="text-xs text-zinc-200 truncate flex-1">{r.userId}</span>
              {tab === 'earners' ? (
                <span className="text-xs text-amber-300 font-semibold flex items-center gap-1">
                  <Coins className="w-3 h-3" /> {r.earnedCc} CC
                </span>
              ) : (
                <span className="text-xs text-emerald-300 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> {r.resolved} resolved
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
