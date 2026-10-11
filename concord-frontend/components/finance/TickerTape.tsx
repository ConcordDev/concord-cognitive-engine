'use client';

import { PRICE_FEED_UNAVAILABLE, usePriceFeedPoll, useSharedPriceFeed } from '@/lib/finance/price-feed';
import { cn } from '@/lib/utils';

/**
 * Honest scrolling price strip. The poll lives in the shared price-feed
 * store when a provider is mounted (finance page header reads the same
 * status). Without a provider it polls on its own.
 */
export default function TickerTape({ className }: { className?: string }) {
  const shared = useSharedPriceFeed();
  const local = usePriceFeedPoll(shared == null);
  const { ticks, status } = shared ?? local;

  if (status === 'loading') {
    return (
      <div className={cn('h-7 flex items-center px-3 text-[10px] font-mono text-gray-500 border-b border-white/5', className)}>
        loading live prices…
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className={cn('h-7 flex items-center px-3 text-[10px] font-mono text-amber-400 border-b border-white/5', className)}>
        {PRICE_FEED_UNAVAILABLE}
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
      {status === 'stale' && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-amber-400 bg-black/60 px-1.5 rounded">
          stale
        </span>
      )}
    </div>
  );
}
