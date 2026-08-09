'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { LineChart } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const CandleChart = dynamic(() => import('@/components/charts/CandleChart'), { ssr: false });

interface Holding {
  symbol: string;
  assetClass: string;
}

// Same CoinGecko id set crypto.token-candles accepts (matches app/lenses/crypto/page.tsx's picker)
const KNOWN_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'cardano', 'ripple', 'dogecoin', 'polkadot', 'usd-coin', 'tether'];
const SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin', ADA: 'cardano',
  XRP: 'ripple', DOGE: 'dogecoin', DOT: 'polkadot', USDC: 'usd-coin', USDT: 'tether',
};

/**
 * Real crypto price context for the Positions view — reuses the shared
 * CandleChart + the same crypto.token-candles macro the crypto lens uses.
 * Not a per-holding chart (manually-entered holdings carry a single price,
 * not an OHLC history) — an honest market-price panel scoped to whichever
 * of the user's crypto holdings we can resolve to a known market id, with a
 * manual picker fallback so it's still useful with zero crypto holdings.
 */
export default function CryptoExposureChart() {
  const [cryptoSymbols, setCryptoSymbols] = useState<string[]>([]);
  const [tokenId, setTokenId] = useState('bitcoin');
  const [days, setDays] = useState(30);
  const [candles, setCandles] = useState<Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await lensRun({ domain: 'finance', action: 'holdings-list', input: {} });
        const holdings = (res.data?.result?.holdings || []) as Holding[];
        const symbols = holdings.filter(h => h.assetClass === 'crypto').map(h => h.symbol.toUpperCase());
        setCryptoSymbols(symbols);
        const firstKnown = symbols.map(s => SYMBOL_TO_ID[s]).find(Boolean);
        if (firstKnown) setTokenId(firstKnown);
      } catch (e) { console.error('[CryptoExposureChart] holdings-list failed', e); }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({ domain: 'crypto', action: 'token-candles', input: { id: tokenId, days } });
        if (!cancelled) setCandles(res?.data?.result?.candles || []);
      } catch (e) {
        console.error('[CryptoExposureChart] token-candles failed', e);
        if (!cancelled) setCandles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tokenId, days]);

  const unresolvedSymbols = useMemo(
    () => cryptoSymbols.filter(s => !SYMBOL_TO_ID[s]),
    [cryptoSymbols],
  );

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2 flex-wrap">
        <LineChart className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Crypto exposure</span>
        <select
          value={tokenId}
          onChange={(e) => setTokenId(e.target.value)}
          className="ml-auto px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono"
        >
          {KNOWN_IDS.map(id => <option key={id} value={id}>{id.toUpperCase()}</option>)}
        </select>
        <div className="flex items-center gap-1">
          {[1, 7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={cn('px-2 py-1 text-[10px] rounded', days === d ? 'bg-cyan-500 text-black font-bold' : 'border border-white/10 text-gray-300 hover:text-white')}
            >
              {d === 1 ? '24h' : `${d}d`}
            </button>
          ))}
        </div>
      </header>
      <CandleChart candles={candles} loading={loading} symbol={tokenId.toUpperCase()} height={260} emaPeriod={20} showVolume={false} />
      {cryptoSymbols.length === 0 ? (
        <div className="px-4 py-2 text-[10px] text-gray-500 border-t border-white/5">
          No crypto holdings yet — showing market price. Add a holding with asset class &ldquo;crypto&rdquo; to track your own exposure here.
        </div>
      ) : unresolvedSymbols.length > 0 ? (
        <div className="px-4 py-2 text-[10px] text-gray-500 border-t border-white/5">
          Chart not available for: {unresolvedSymbols.join(', ')} (no known market id) — showing {tokenId.toUpperCase()} instead.
        </div>
      ) : null}
    </div>
  );
}
