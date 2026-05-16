'use client';

import { useQuery } from '@tanstack/react-query';
import { Coins, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Coin { id: string; symbol: string; name: string; current_price: number; market_cap: number; market_cap_rank: number; price_change_percentage_24h: number; }

export function StakingMarkets() {
  const coins = useQuery({
    queryKey: ['cg-staking'],
    queryFn: async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=proof-of-stake&order=market_cap_desc&per_page=20');
      if (!r.ok) throw new Error(`cg ${r.status}`);
      return (await r.json()) as Coin[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const list = coins.data || [];
  const totalMcap = list.reduce((a, c) => a + (c.market_cap || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Coins className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Real-world proof-of-stake markets</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">coingecko</span></div>
        {list.length > 0 && <SaveAsDtuButton compact apiSource="coingecko-staking" apiUrl="https://api.coingecko.com/api/v3/coins/markets?category=proof-of-stake" title={`PoS markets — top ${list.length}`} content={list.map((c, i) => `${i + 1}. ${c.symbol.toUpperCase()} ${c.name} — $${c.current_price.toLocaleString()} (${c.price_change_percentage_24h.toFixed(2)}% 24h)`).join('\n')} extraTags={['staking', 'coingecko', 'pos']} rawData={{ coins: list }} />}
      </header>
      {coins.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">CoinGecko unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">PoS coins</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Combined mcap</div><div className="mt-0.5 font-mono text-lg text-emerald-300">${(totalMcap / 1e9).toFixed(1)}B</div></div>
      </div>
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {list.map((c) => (
          <a key={c.id} href={`https://www.coingecko.com/en/coins/${c.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded border border-emerald-500/15 bg-emerald-500/5 p-2 text-[11px] hover:border-emerald-500/40">
            <span className="w-6 shrink-0 font-mono text-[10px] text-zinc-500">#{c.market_cap_rank}</span>
            <span className="w-12 shrink-0 font-mono font-bold text-emerald-200">{c.symbol.toUpperCase()}</span>
            <span className="flex-1 truncate text-zinc-100">{c.name}</span>
            <span className="font-mono text-zinc-100">${c.current_price.toLocaleString(undefined, { maximumFractionDigits: c.current_price > 1 ? 2 : 6 })}</span>
            <span className={`font-mono ${c.price_change_percentage_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{c.price_change_percentage_24h >= 0 ? '+' : ''}{c.price_change_percentage_24h?.toFixed(2)}%</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
          </a>
        ))}
      </div>
      {coins.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
