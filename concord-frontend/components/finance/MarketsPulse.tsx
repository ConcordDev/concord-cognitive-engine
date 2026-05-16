'use client';

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Loader2, ExternalLink, DollarSign, Activity, Bitcoin } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface GlobalData {
  data?: {
    active_cryptocurrencies?: number;
    upcoming_icos?: number;
    ongoing_icos?: number;
    markets?: number;
    total_market_cap?: Record<string, number>;
    total_volume?: Record<string, number>;
    market_cap_percentage?: Record<string, number>;
    market_cap_change_percentage_24h_usd?: number;
    updated_at?: number;
  };
}

interface Coin { id: string; symbol: string; name: string; current_price: number; market_cap: number; market_cap_rank: number; price_change_percentage_24h: number; }

export function MarketsPulse() {
  const global = useQuery({
    queryKey: ['cg-global'],
    queryFn: async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/global');
      if (!r.ok) throw new Error(`cg ${r.status}`);
      return (await r.json()) as GlobalData;
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const top = useQuery({
    queryKey: ['cg-top'],
    queryFn: async () => {
      const r = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=15&page=1');
      if (!r.ok) throw new Error(`cg ${r.status}`);
      return (await r.json()) as Coin[];
    },
    refetchInterval: 5 * 60 * 1000,
  });

  const g = global.data?.data;
  const list = top.data || [];
  const totalMcap = g?.total_market_cap?.usd || 0;
  const totalVol = g?.total_volume?.usd || 0;
  const change24 = g?.market_cap_change_percentage_24h_usd ?? 0;
  const btcDom = g?.market_cap_percentage?.btc ?? 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-semibold text-white">Real-world markets pulse</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">coingecko · global + top 15</span>
        </div>
        {g && list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="coingecko-markets"
            apiUrl="https://api.coingecko.com/api/v3/global"
            title={`Markets snapshot — $${(totalMcap / 1e12).toFixed(2)}T mcap · BTC dom ${btcDom.toFixed(1)}%`}
            content={`Total market cap: $${(totalMcap / 1e12).toFixed(2)}T (${change24 >= 0 ? '+' : ''}${change24.toFixed(2)}% 24h)\nTotal volume 24h: $${(totalVol / 1e9).toFixed(2)}B\nBTC dominance: ${btcDom.toFixed(2)}%\nActive cryptos: ${g.active_cryptocurrencies}\nMarkets: ${g.markets}\n\nTop 15 by mcap:\n${list.map((c, i) => `${i + 1}. ${c.symbol.toUpperCase()} ${c.name} — $${c.current_price.toLocaleString()} (${c.price_change_percentage_24h >= 0 ? '+' : ''}${c.price_change_percentage_24h.toFixed(2)}% 24h)`).join('\n')}`}
            extraTags={['finance', 'markets', 'coingecko', 'crypto']}
            rawData={{ global: g, top: list }}
          />
        )}
      </header>
      {(global.isError || top.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">CoinGecko unreachable.</div>}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><DollarSign className="h-2.5 w-2.5" />Total mcap</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-300">{totalMcap > 0 ? `$${(totalMcap / 1e12).toFixed(2)}T` : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">24h change</div>
          <div className={`mt-0.5 font-mono text-lg ${change24 >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{change24 >= 0 ? '+' : ''}{change24.toFixed(2)}%</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Activity className="h-2.5 w-2.5" />Volume 24h</div>
          <div className="mt-0.5 font-mono text-lg text-emerald-300">{totalVol > 0 ? `$${(totalVol / 1e9).toFixed(1)}B` : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500"><Bitcoin className="h-2.5 w-2.5" />BTC dom</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{btcDom.toFixed(1)}%</div>
        </div>
      </div>
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {list.map((c) => (
          <a key={c.id} href={`https://www.coingecko.com/en/coins/${c.id}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded border border-emerald-500/15 bg-emerald-500/5 p-2 text-[11px] hover:border-emerald-500/40">
            <span className="w-6 shrink-0 font-mono text-[10px] text-zinc-500">#{c.market_cap_rank}</span>
            <span className="w-12 shrink-0 font-mono font-bold text-emerald-200">{c.symbol.toUpperCase()}</span>
            <span className="flex-1 truncate text-zinc-100">{c.name}</span>
            <span className="font-mono text-zinc-100">${c.current_price.toLocaleString(undefined, { maximumFractionDigits: c.current_price > 1 ? 2 : 6 })}</span>
            <span className={`font-mono ${c.price_change_percentage_24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{c.price_change_percentage_24h >= 0 ? '+' : ''}{c.price_change_percentage_24h.toFixed(2)}%</span>
            <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
          </a>
        ))}
      </div>
      {(global.isPending || top.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling CoinGecko…</div>}
    </div>
  );
}
