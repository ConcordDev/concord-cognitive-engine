'use client';

/**
 * PortfolioBalanceHero — the Coinbase "big balance up top" tell.
 *
 * Replaces a generic icon+title lens header with the one number a wallet
 * app actually leads with. Every value is a prop the caller computes from
 * real chains/transactions/wallets data — this component never fetches or
 * fabricates anything itself, it only renders + reacts to what it's given.
 *
 * The only piece of local state is the value-change flash: it ticks when
 * `totalValue` actually changes between renders (a live price refresh or a
 * new transaction), never on a timer — mirrors the Coinbase/Robinhood
 * flash-green/red-on-tick convention with real data driving it.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';
import { LiveIndicator } from '@/components/lens/LiveIndicator';

export interface PortfolioBalanceHeroProps {
  totalValue: number;
  netFlow: number;
  totalEarned: number;
  chainCount: number;
  walletCount: number;
  showBalances: boolean;
  onToggleBalances: () => void;
  onRefresh: () => void;
  isLoading?: boolean;
  isLive?: boolean;
  lastUpdated?: string | null;
  /** Extra controls rendered next to the built-in eye/refresh buttons
   *  (e.g. DTUExportButton) — kept caller-owned so this component stays
   *  domain-shape only, not a dumping ground for unrelated actions. */
  extraActions?: React.ReactNode;
}

export function PortfolioBalanceHero({
  totalValue,
  netFlow,
  totalEarned,
  chainCount,
  walletCount,
  showBalances,
  onToggleBalances,
  onRefresh,
  isLoading = false,
  isLive,
  lastUpdated,
  extraActions,
}: PortfolioBalanceHeroProps) {
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValueRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLoading) return;
    const prev = prevValueRef.current;
    if (prev !== null && totalValue !== prev) {
      setFlash(totalValue > prev ? 'up' : 'down');
      const t = setTimeout(() => setFlash(null), 900);
      prevValueRef.current = totalValue;
      return () => clearTimeout(t);
    }
    prevValueRef.current = totalValue;
  }, [totalValue, isLoading]);

  const deltaPct = totalEarned > 0 ? Math.abs((netFlow / totalEarned) * 100) : null;

  return (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] uppercase tracking-wider text-gray-400">Portfolio value</span>
          <LiveIndicator isLive={!!isLive} lastUpdated={lastUpdated ?? null} />
        </div>
        {isLoading ? (
          <Skeleton width="220px" height="2.75rem" className="mt-0.5" />
        ) : (
          <>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span
                data-testid="portfolio-balance"
                className={cn(
                  'text-5xl font-mono font-semibold tabular-nums transition-colors duration-300',
                  flash === 'up' ? 'text-neon-green' : flash === 'down' ? 'text-neon-pink' : 'text-white'
                )}
              >
                {showBalances ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••••'}
              </span>
              {showBalances && (
                <span className={cn('text-sm font-mono tabular-nums', netFlow >= 0 ? 'text-neon-green' : 'text-neon-pink')}>
                  {netFlow >= 0 ? <ArrowUp className="w-3 h-3 inline -mt-0.5" /> : <ArrowDown className="w-3 h-3 inline -mt-0.5" />}
                  {deltaPct !== null ? ` ${deltaPct.toFixed(1)}%` : ' —'} all-time
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {chainCount} chain{chainCount === 1 ? '' : 's'} &middot; {walletCount} wallet{walletCount === 1 ? '' : 's'}
            </p>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {extraActions}
        <button
          onClick={onToggleBalances}
          className="group flex items-center gap-1.5 p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
          title={showBalances ? 'Hide balances (H)' : 'Show balances (H)'}
        >
          {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          <kbd className="hidden group-hover:inline text-[9px] px-1 py-0.5 rounded border border-white/15 text-gray-400 font-mono">H</kbd>
        </button>
        <button
          onClick={onRefresh}
          className="p-2 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-white/5"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

export default PortfolioBalanceHero;
