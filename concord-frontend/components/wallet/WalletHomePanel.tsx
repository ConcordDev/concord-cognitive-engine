'use client';

import { useMemo, type ReactNode } from 'react';
import { ArrowDownToLine, CreditCard, Send } from 'lucide-react';
import { PurchaseFlow } from '@/components/wallet/PurchaseFlow';
import { TokenBalance } from '@/components/economy/TokenBalance';
import { TransactionHistory } from '@/components/economy/TransactionHistory';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { PendingWithdrawalsBanner } from './PendingWithdrawalsBanner';
import { WalletSparkline } from './WalletSparkline';
import {
  deriveEarnings,
  flattenHistoryPages,
  useWalletBalance,
  useWalletConnectStatus,
  useWalletHistory,
  useWalletInvalidate,
  useWalletWithdrawals,
} from './useWalletQueries';
import type { WalletPanelProps } from './wallet-model';

export function WalletHomePanel({ onNavigate }: WalletPanelProps) {
  const invalidate = useWalletInvalidate();
  const { data: balanceData, isLoading, isError, refetch } = useWalletBalance();
  const { data: connectStatus } = useWalletConnectStatus();
  const { data: withdrawalsData } = useWalletWithdrawals();
  const history = useWalletHistory('all');

  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;
  const totalCredits = balanceData?.totalCredits ?? 0;
  const totalDebits = balanceData?.totalDebits ?? 0;
  const transactions = flattenHistoryPages(history.data?.pages);
  const earnings = useMemo(
    () => deriveEarnings(transactions, totalCredits),
    [transactions, totalCredits],
  );

  const sparklineData = useMemo(() => {
    if (transactions.length < 2) return null;
    let running = balance;
    const points: number[] = [balance];
    for (const tx of transactions.slice(0, 19)) {
      running -= tx.amount;
      points.unshift(running);
    }
    return points;
  }, [transactions, balance]);

  if (isError) {
    return <ErrorState message="Could not load wallet balance." onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-5">
      <section className={cn(ds.panel, 'relative overflow-hidden px-5 py-8 sm:px-8')}>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-400 text-center">Concord Coin</p>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Skeleton variant="block" width={220} height={56} />
          </div>
        ) : (
          <p
            className="mt-2 text-center text-5xl sm:text-6xl font-mono font-semibold tabular-nums tracking-tight text-white"
            aria-live="polite"
          >
            {balance.toLocaleString()}
            <span className="ml-2 text-lg font-normal text-gray-400">CC</span>
          </p>
        )}
        <p className="mt-1 text-center text-sm text-gray-400 font-mono tabular-nums">
          ${balance.toLocaleString()} USD · 1:1 peg
        </p>
        {sparklineData && sparklineData.length > 2 && (
          <div className="mt-3 flex justify-center">
            <WalletSparkline data={sparklineData} />
          </div>
        )}
        <div className="mt-2 flex justify-center">
          <TokenBalance />
        </div>

        <div className="mt-6 flex justify-center gap-6">
          <HomeAction
            label="Add"
            hint="B"
            icon={<CreditCard className="w-5 h-5" />}
            onClick={() => {
              const reduce =
                typeof window !== 'undefined' &&
                window.matchMedia('(prefers-reduced-motion: reduce)').matches;
              document
                .getElementById('wallet-add-cash')
                ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
            }}
          />
          <HomeAction label="Pay" hint="S" icon={<Send className="w-5 h-5" />} onClick={() => onNavigate?.('pay')} />
          <HomeAction
            label="Cash Out"
            hint="W"
            icon={<ArrowDownToLine className="w-5 h-5" />}
            onClick={() => onNavigate?.('cashout')}
          />
        </div>
      </section>

      <PendingWithdrawalsBanner withdrawalsData={withdrawalsData} />

      <StatTileGrid columns={4}>
        <StatTile label="Credits (CC)" value={totalCredits} size="sm" />
        <StatTile label="Debits (CC)" value={totalDebits} size="sm" />
        <StatTile label="This month (CC)" value={earnings.thisMonth} size="sm" />
        <StatTile
          label="Payouts"
          value={connectStatus?.onboardingComplete ? 'Active' : 'Not set up'}
          size="sm"
          formatValue={(v) => String(v)}
        />
      </StatTileGrid>

      <section id="wallet-add-cash" className={ds.panel}>
        <PurchaseFlow mode="inline" onSuccess={() => invalidate()} />
      </section>

      <section className={ds.panel}>
        <div className="flex items-center justify-between mb-3">
          <h3 className={ds.heading3}>Recent activity</h3>
          <button
            type="button"
            onClick={() => onNavigate?.('activity')}
            className="text-xs text-gray-400 hover:text-white"
          >
            See all
          </button>
        </div>
        <TransactionHistory limit={5} />
      </section>
    </div>
  );
}

function HomeAction({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string;
  hint: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-2 group" title={`${label} (${hint})`}>
      <span
        className="w-14 h-14 rounded-full border border-lattice-border bg-lattice-elevated flex items-center justify-center text-white group-hover:border-[var(--lens-accent)]/60 group-hover:bg-[var(--lens-accent)]/10 transition-colors"
      >
        {icon}
      </span>
      <span className="text-xs text-gray-300">
        {label}{' '}
        <kbd className="hidden sm:inline ml-0.5 text-[10px] font-mono text-gray-500 border border-lattice-border rounded px-1">
          {hint}
        </kbd>
      </span>
    </button>
  );
}
