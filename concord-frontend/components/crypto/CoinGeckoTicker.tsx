'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bitcoin, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Coin {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d_in_currency?: number;
  circulating_supply: number;
  ath: number;
  ath_change_percentage: number;
}

const VS = [
  { id: 'usd', label: 'USD' },
  { id: 'eur', label: 'EUR' },
  { id: 'btc', label: 'BTC' },
  { id: 'eth', label: 'ETH' },
];

export function CoinGeckoTicker() {
  const [vs, setVs] = useState('usd');
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const coins = useQuery({
    queryKey: ['coingecko-markets', vs],
    queryFn: async () => {
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=30&page=1&price_change_percentage=24h,7d`);
      if (!r.ok) throw new Error(`coingecko ${r.status}`);
      return (await r.json()) as Coin[];
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const list = coins.data || [];
  const sym = vs === 'usd' ? '$' : vs === 'eur' ? '€' : vs === 'btc' ? '₿' : 'Ξ';
  const fmt = (n: number) => n >= 1 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toLocaleString(undefined, { maximumSignificantDigits: 4 });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Bitcoin className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Live crypto markets</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.coingecko.com · 60s poll · top 30 by mcap</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
            {VS.map((v) => (
              <button key={v.id} onClick={() => setVs(v.id)} className={`rounded px-2 py-0.5 font-mono uppercase ${vs === v.id ? 'bg-cyan-500/20 text-cyan-200' : 'text-zinc-400 hover:text-zinc-300'}`}>{v.label}</button>
            ))}
          </div>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="coingecko"
              apiUrl={`https://api.coingecko.com/api/v3/coins/markets?vs_currency=${vs}`}
              title={`Crypto markets (${vs.toUpperCase()}) — ${list.length} coins`}
              content={list.slice(0, 20).map((c) => `#${c.market_cap_rank} ${c.symbol.toUpperCase()} ${c.name} · ${sym}${fmt(c.current_price)} · 24h ${c.price_change_percentage_24h?.toFixed(2)}% · mcap ${sym}${(c.market_cap / 1e9).toFixed(2)}B`).join('\n')}
              extraTags={['crypto', 'markets', 'coingecko', vs]}
              rawData={{ vs, coins: list }}
            />
          )}
        </div>
      </header>
      {coins.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">CoinGecko rate-limited or unreachable.</div>}
      {coins.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling live ticker…</div>}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {list.map((c) => {
          const ch24 = c.price_change_percentage_24h ?? 0;
          const ch7 = c.price_change_percentage_7d_in_currency ?? 0;
          return (
            <a key={c.id} href={`https://www.coingecko.com/en/coins/${c.id}`} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2 hover:border-cyan-500/30">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.image} alt={c.symbol} className="h-6 w-6" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[10px] text-zinc-400">#{c.market_cap_rank}</span>
                    <span className="font-mono text-sm font-semibold uppercase text-white">{c.symbol}</span>
                    <span className="line-clamp-1 text-[11px] text-zinc-400">{c.name}</span>
                  </div>
                  <div className="font-mono text-[10px] text-zinc-400">mcap {sym}{(c.market_cap / 1e9).toFixed(2)}B · vol {sym}{(c.total_volume / 1e9).toFixed(2)}B</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm text-cyan-300">{sym}{fmt(c.current_price)}</div>
                  <div className="flex items-center gap-1 font-mono text-[10px]">
                    {ch24 >= 0 ? <TrendingUp className="h-2.5 w-2.5 text-emerald-300" /> : <TrendingDown className="h-2.5 w-2.5 text-red-300" />}
                    <span className={ch24 >= 0 ? 'text-emerald-300' : 'text-red-300'}>{ch24 >= 0 ? '+' : ''}{ch24.toFixed(2)}%</span>
                    <span className={`text-[9px] ${ch7 >= 0 ? 'text-emerald-300/70' : 'text-red-300/70'}`}>(7d {ch7 >= 0 ? '+' : ''}{ch7.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
