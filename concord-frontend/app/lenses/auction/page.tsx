'use client';

/**
 * Auction — one auction-house desk.
 *
 * Single view union (board | market | buy-orders). Inline grid/market/buy-order
 * surfaces extracted to panels. Page is a thin shell (paper/government gold).
 */

import { useCallback, useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Gavel, BarChart3, ShoppingCart } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { BoardPanel } from '@/components/auction/BoardPanel';
import { MarketPanel } from '@/components/auction/MarketPanel';
import { BuyOrdersPanel } from '@/components/auction/BuyOrdersPanel';

type AuctionView = 'board' | 'market' | 'buy-orders';

const VIEWS: { id: AuctionView; label: string; keys: string; hint: string; icon: typeof Gavel }[] = [
  { id: 'board', label: 'Board', keys: '1', hint: 'Active auctions', icon: Gavel },
  { id: 'market', label: 'Market', keys: '2', hint: 'Price history · depth', icon: BarChart3 },
  { id: 'buy-orders', label: 'Buy orders', keys: '3', hint: 'EVE-style escrow', icon: ShoppingCart },
];

export default function AuctionLensPage() {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<AuctionView>('board');
  const [marketSeed, setMarketSeed] = useState('');

  const goMarket = useCallback((itemId: string) => {
    setMarketSeed(itemId);
    setActive('market');
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'auction' },
  );

  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="auction" asMain={false}>
      <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Gavel className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Auction house</h1>
              <p className="mt-0.5 truncate text-xs text-slate-400">Time-bound bidding · 60s snipe protection · 5% platform fee.</p>
            </div>
          </div>
          <nav className="mx-auto mt-3 flex max-w-screen-2xl items-center gap-1 overflow-x-auto" aria-label="Auction views">
            {VIEWS.map((v) => {
              const Icon = v.icon;
              const on = active === v.id;
              return (
                <button key={v.id} type="button" onClick={() => setActive(v.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                    on ? 'border-amber-400 text-amber-100' : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600',
                  )}
                  aria-current={on ? 'page' : undefined}>
                  <Icon className="w-4 h-4" />
                  {v.label}
                  <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">{v.keys}</kbd>
                </button>
              );
            })}
          </nav>
        </header>

        <section className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps}>
              {active === 'board' && <BoardPanel onCheckMarket={goMarket} />}
              {active === 'market' && <MarketPanel initialItemId={marketSeed} />}
              {active === 'buy-orders' && <BuyOrdersPanel onCheckMarket={goMarket} />}
            </motion.div>
          </AnimatePresence>
        </section>
      </main>
    </LensShell>
  );
}
