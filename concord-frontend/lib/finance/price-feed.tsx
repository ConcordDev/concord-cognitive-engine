'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { lensRun } from '@/lib/api/client';

export interface PriceTick {
  symbol: string;
  price: number | null;
  changePct24h: number | null;
}

export type PriceFeedStatus = 'loading' | 'live' | 'stale' | 'unavailable';

/** One phrase for the header and the tape. They must not disagree. */
export const PRICE_FEED_UNAVAILABLE = 'price feed unavailable';

const POLL_MS = 25_000;

export function priceFeedLabel(status: PriceFeedStatus): string {
  if (status === 'live') return 'Market feed live';
  if (status === 'stale') return 'Market feed stale';
  if (status === 'unavailable') return PRICE_FEED_UNAVAILABLE;
  return 'Market feed loading';
}

interface PriceFeedValue {
  ticks: PriceTick[];
  status: PriceFeedStatus;
}

const PriceFeedContext = createContext<PriceFeedValue | null>(null);

function statusOf(everLoaded: boolean, stale: boolean): PriceFeedStatus {
  if (!everLoaded) return stale ? 'unavailable' : 'loading';
  return stale ? 'stale' : 'live';
}

/**
 * Poll `crypto.live_top`. `active` is false when a parent provider already
 * owns the poll, so the tape and the header share one request.
 */
export function usePriceFeedPoll(active = true): PriceFeedValue {
  const [ticks, setTicks] = useState<PriceTick[]>([]);
  const [stale, setStale] = useState(false);
  const [everLoaded, setEverLoaded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!active) return undefined;
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
  }, [active]);

  return { ticks, status: statusOf(everLoaded, stale) };
}

export function PriceFeedProvider({ children }: { children: ReactNode }) {
  const feed = usePriceFeedPoll(true);
  return <PriceFeedContext.Provider value={feed}>{children}</PriceFeedContext.Provider>;
}

export function useSharedPriceFeed(): PriceFeedValue | null {
  return useContext(PriceFeedContext);
}
