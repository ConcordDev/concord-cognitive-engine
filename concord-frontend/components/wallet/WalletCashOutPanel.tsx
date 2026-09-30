'use client';

import { useMemo, type ReactNode } from 'react';
import { Clock, Gift, Info, Target, TrendingUp, DollarSign } from 'lucide-react';
import { StripeConnectPanel } from '@/components/wallet/StripeConnectPanel';
import { WithdrawFlow } from '@/components/wallet/WithdrawFlow';
import { BountiesAndFutures } from '@/components/economy/BountiesAndFutures';
import { Skeleton } from '@/components/ui/Skeleton';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  deriveEarnings,
  flattenHistoryPages,
  useWalletBalance,
  useWalletConnectStatus,
  useWalletHistory,
  useWalletInvalidate,
} from './useWalletQueries';
import type { WalletPanelProps } from './wallet-model';

export function WalletCashOutPanel(_props: WalletPanelProps) {
  const invalidate = useWalletInvalidate();
  const { data: balanceData } = useWalletBalance();
  const { data: connectStatus, isLoading: connectLoading } = useWalletConnectStatus();
  const history = useWalletHistory('all');
  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;
  const totalCredits = balanceData?.totalCredits ?? 0;
  const transactions = flattenHistoryPages(history.data?.pages);
  const earnings = useMemo(
    () => deriveEarnings(transactions, totalCredits),
    [transactions, totalCredits],
  );
  const onboarded = connectStatus?.onboardingComplete === true;

  return (
    <div className="space-y-5">
      <section className={cn(ds.panel, 'space-y-2')}>
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <h2 className={ds.heading3}>Cash out policy</h2>
            <p className="text-sm text-gray-300">
              Withdrawals are <span className="text-white font-medium">earned-only</span>. Purchased CC
              is closed-loop store credit and cannot be cashed out. Newly earned credits sit on a{' '}
              <span className="text-white font-medium">48-hour hold</span> before they become withdrawable
              (anti-refund-exploit gate). Peer transfers in are not earned.
            </p>
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Platform fee 1.46% (display of the server fee, not a second rate). Min 20 CC on the
              cash-out flow.
            </p>
          </div>
        </div>
      </section>

      {connectLoading && <Skeleton variant="block" height={220} />}
      {!connectLoading && !onboarded && <StripeConnectPanel />}
      {!connectLoading && onboarded && (
        <div className={ds.panel}>
          <WithdrawFlow mode="inline" balance={balance} onSuccess={invalidate} />
        </div>
      )}

      {(earnings.totalEarned > 0 || totalCredits > 0) && (
        <section className={ds.panel}>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5" style={{ color: 'var(--lens-secondary)' }} />
            <h3 className={ds.heading3}>Earnings</h3>
          </div>
          <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border mb-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Total earned</p>
            <p className="text-2xl font-mono font-bold tabular-nums mt-1" style={{ color: 'var(--lens-accent)' }}>
              {earnings.totalEarned.toLocaleString()} CC
            </p>
          </div>
          <div className="space-y-2">
            <EarningRow label="Tips received" amount={earnings.tips} icon={<Gift className="w-4 h-4" />} />
            <EarningRow label="Bounty rewards" amount={earnings.bounties} icon={<Target className="w-4 h-4" />} />
            <EarningRow label="Sales" amount={earnings.sales} icon={<DollarSign className="w-4 h-4" />} />
          </div>
          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-lattice-border mt-3">
            <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border">
              <p className="text-xs text-gray-400">This month</p>
              <p className="text-lg font-mono font-bold text-white mt-1 tabular-nums">
                {earnings.thisMonth.toLocaleString()}
              </p>
            </div>
            <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border">
              <p className="text-xs text-gray-400">Last month</p>
              <p className="text-lg font-mono font-bold text-gray-400 mt-1 tabular-nums">
                {earnings.lastMonth.toLocaleString()}
              </p>
            </div>
            {earnings.lastMonth > 0 && (
              <p
                className={cn(
                  'col-span-2 text-xs',
                  earnings.thisMonth >= earnings.lastMonth ? 'text-[var(--lens-accent)]' : 'text-red-400',
                )}
              >
                {(((earnings.thisMonth - earnings.lastMonth) / earnings.lastMonth) * 100).toFixed(1)}% vs last
                month
              </p>
            )}
          </div>
        </section>
      )}

      <section className={ds.panel}>
        <BountiesAndFutures />
      </section>
    </div>
  );
}

function EarningRow({
  label,
  amount,
  icon,
}: {
  label: string;
  amount: number;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2 text-gray-400">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-sm font-mono text-white tabular-nums">{amount.toLocaleString()} CC</span>
    </div>
  );
}
