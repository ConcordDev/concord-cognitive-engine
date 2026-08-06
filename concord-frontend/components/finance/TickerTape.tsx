'use client';

import { useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Tick {
  symbol: string;
  price: number | null;
  changePct24h: number | null;
}

const POLL_MS = 25_000;

/**
 * Honest scrolling price strip — polls `crypto.live_top` (real CryptoCompare
 * data, server/domains/crypto-live.js) every ~25s. Each tick is a genuine
 * network round-trip; on failure the last-known-good tape stays up with a
 * "stale" marker rather than freezing silently or fabricating a value. No
 * setInterval-driven fake animation — the visual scroll is pure CSS over
 * real data, not a substitute for it.
 */
export default function TickerTape({ className }: { className?: string }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [stale, setStale] = useState(false);
  const [everLoaded, setEverLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await lensRun({ domain: 'crypto', action: 'live_top', input: { limit: 20 } });
        const coins = res?.data?.result?.coins as Array<{ symbol: string; price: number | null; changePct24h: number | null }> | undefined;
        if (cancelled) return;
        if (res?.data?.result?.ok === false || !coins) {
          setStale(true);
          return;
        }
        setTicks(coins.map((c) => ({ symbol: c.symbol, price: c.price, changePct24h: c.changePct24h })));
        setStale(false);
        setEverLoaded(true);
      } catch {
        if (!cancelled) setStale(true);
      }
    }

    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  if (!everLoaded && !stale) {
    return (
      <div className={cn('h-7 flex items-center px-3 text-[10px] font-mono text-gray-500 border-b border-white/5', className)}>
        loading live prices…
      </div>
    );
  }

  if (!everLoaded && stale) {
    return (
      <div className={cn('h-7 flex items-center px-3 text-[10px] font-mono text-amber-400 border-b border-white/5', className)}>
        price feed unavailable
      </div>
    );
  }

  return (
    <div
      className={cn('relative h-7 overflow-hidden border-b border-white/5 bg-black/30 group', className)}
      role="marquee"
      aria-label="Live crypto price ticker"
    >
      <div className="absolute inset-0 flex items-center gap-6 whitespace-nowrap animate-[ticker-scroll_60s_linear_infinite] group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused] px-3">
        {[...ticks, ...ticks].map((t, i) => (
          <span key={`${t.symbol}-${i}`} className="inline-flex items-center gap-1.5 text-[11px] font-mono tabular-nums">
            <span className="text-gray-300 font-semibold">{t.symbol}</span>
            <span className="text-white">{t.price != null ? `$${t.price.toLocaleString(undefined, { maximumFractionDigits: t.price < 1 ? 4 : 2 })}` : '—'}</span>
            {t.changePct24h != null && (
              <span className={t.changePct24h >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {t.changePct24h >= 0 ? '▲' : '▼'} {Math.abs(t.changePct24h).toFixed(2)}%
              </span>
            )}
          </span>
        ))}
      </div>
      {stale && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-amber-400 bg-black/60 px-1.5 rounded">
          stale
        </span>
      )}
    </div>
  );
}
