'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crown, Loader2, TrendingUp, Award } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Creator { userId?: string; displayName?: string; royalty?: number; citations?: number; dtus?: number; rank?: number; tier?: string }
interface Citation { dtuId?: string; title?: string; citationCount?: number; creator?: string }

export function CreatorLeaderboard() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const lb = useQuery({
    queryKey: ['creator-leaderboard'],
    queryFn: async () => {
      const r = await api.get('/api/creator/leaderboard');
      const data = r.data as { creators?: Creator[]; leaderboard?: Creator[] } | Creator[];
      return (Array.isArray(data) ? data : data.creators || data.leaderboard || []) as Creator[];
    },
    refetchInterval: 60000,
  });
  const trending = useQuery({
    queryKey: ['creator-trending'],
    queryFn: async () => {
      const r = await api.get('/api/creator/trending-citations');
      const data = r.data as { citations?: Citation[] } | Citation[];
      return (Array.isArray(data) ? data : data.citations || []) as Citation[];
    },
    refetchInterval: 60000,
  });

  const top = lb.data || [];
  const tr = trending.data || [];

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Creator economy</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/creator/leaderboard + trending-citations · live</span>
        </div>
        {(top.length > 0 || tr.length > 0) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-creator"
            title={`Creator leaderboard — ${top.length} ranked · ${tr.length} trending DTUs`}
            content={`Top creators:\n${top.slice(0, 20).map((c) => `  #${c.rank ?? '-'} ${c.displayName || c.userId} · royalty ${c.royalty ?? '-'} CC · ${c.citations ?? '-'} citations · ${c.dtus ?? '-'} DTUs${c.tier ? ` (${c.tier})` : ''}`).join('\n')}\n\nTrending citations:\n${tr.slice(0, 15).map((d) => `  ${d.dtuId?.slice(0, 8) || '?'} · ${d.title || ''} · ${d.citationCount ?? 0} cites${d.creator ? ` by ${d.creator}` : ''}`).join('\n')}`}
            extraTags={['creator', 'leaderboard', 'royalties']}
            rawData={{ leaderboard: top, trending: tr }}
          />
        )}
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Award className="h-3.5 w-3.5 text-amber-400" /> Leaderboard ({top.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {top.map((c, i) => (
              <div key={c.userId || i} className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`font-mono text-[10px] ${(c.rank ?? i + 1) === 1 ? 'text-amber-300' : (c.rank ?? i + 1) <= 3 ? 'text-cyan-300' : 'text-zinc-400'}`}>#{c.rank ?? i + 1}</span>
                  <span className="line-clamp-1 text-white">{c.displayName || c.userId?.slice(0, 8) || '?'}</span>
                  {c.tier && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{c.tier}</span>}
                </div>
                <div className="flex flex-col items-end font-mono text-[10px] text-zinc-400">
                  {c.royalty != null && <span className="text-emerald-300">{c.royalty.toLocaleString()} CC</span>}
                  {(c.citations != null || c.dtus != null) && <span>{c.citations ?? 0} cites · {c.dtus ?? 0} dtus</span>}
                </div>
              </div>
            ))}
            {top.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No leaderboard data.</div>}
          </div>
        </div>
        <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
          <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><TrendingUp className="h-3.5 w-3.5 text-cyan-400" /> Trending citations ({tr.length})</div>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {tr.map((d, i) => (
              <div key={d.dtuId || i} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="line-clamp-1 text-white">{d.title || `DTU ${d.dtuId?.slice(0, 8)}`}</span>
                  <span className="font-mono text-cyan-300">{d.citationCount ?? 0}↗</span>
                </div>
                {d.creator && <div className="text-[10px] text-zinc-500">by {d.creator}</div>}
              </div>
            ))}
            {tr.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-3 text-center text-[10px] text-zinc-500">No trending citations.</div>}
          </div>
        </div>
      </div>
      {(lb.isPending || trending.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
