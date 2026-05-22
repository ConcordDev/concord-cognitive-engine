'use client';

/**
 * /lenses/staking — CC staking products. Multiple risk-reward pools,
 * auto-compound, early-exit with penalty, earnings ledger, APR history,
 * liquid-staking receipt tokens, maturity reminders.
 * Currency: CC. Yield from the treasury share of marketplace fees.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline per panel.

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { StakingMarkets } from '@/components/staking/StakingMarkets';
import { StakingPools, type Pool } from '@/components/staking/StakingPools';
import { RewardsEstimator } from '@/components/staking/RewardsEstimator';
import { AprHistoryChart } from '@/components/staking/AprHistoryChart';
import { StakePositions } from '@/components/staking/StakePositions';
import { EarningsLedger } from '@/components/staking/EarningsLedger';
import { ReceiptTokens } from '@/components/staking/ReceiptTokens';
import { MaturityReminders } from '@/components/staking/MaturityReminders';

export default function StakingPage() {
  useLensCommand(
    [
      {
        id: 'staking-help',
        keys: '?',
        description: 'Lens help',
        category: 'navigation',
        action: () => {
          /* surfaced via tooltip */
        },
      },
    ],
    { lensId: 'staking' },
  );

  const [poolId, setPoolId] = useState('core');
  const [principalCc, setPrincipalCc] = useState(100);
  const [months, setMonths] = useState(6);
  const [autoCompound, setAutoCompound] = useState(false);
  const [liquidReceipt, setLiquidReceipt] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  const openStake = async () => {
    setStatus('Locking…');
    const r = await lensRun('staking', 'open_stake', {
      poolId,
      principalCc,
      months,
      autoCompound,
      liquidReceipt,
    });
    if (r.data?.ok) {
      const res = r.data.result as { receiptTokenId?: string | null } | null;
      setStatus(
        `Locked ${principalCc} CC for ${months}mo${
          res?.receiptTokenId ? ' — liquid receipt minted' : ''
        }.`,
      );
      bumpRefresh();
    } else {
      setStatus(`Failed: ${r.data?.error || 'unknown'}`);
    }
    window.setTimeout(() => setStatus(null), 5000);
  };

  return (
    <LensShell lensId="staking">
      <FirstRunTour lensId="staking" />
      <DepthBadge lensId="staking" size="sm" className="ml-2" />
      <div className="mx-auto max-w-4xl space-y-6 p-6 sm:p-8">
        <header>
          <h1 className="text-2xl font-bold text-zinc-100">CC Staking</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Lock Concord Coin and earn yield from the treasury share of marketplace fees. APR is
            honestly variable — based on actual marketplace activity, not promised.{' '}
            <strong>Currency: CC.</strong>
          </p>
        </header>

        {status && (
          <div className="rounded-lg border border-amber-700/50 bg-amber-950/50 px-3 py-2 text-sm text-amber-200">
            {status}
          </div>
        )}

        {/* Maturity reminders */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
            Maturity reminders
          </h2>
          <MaturityReminders refreshKey={refreshKey} />
        </section>

        {/* New stake — pool picker + form */}
        <section className="space-y-3 rounded-xl border border-amber-800/50 bg-zinc-900/80 p-4">
          <h2 className="text-sm font-bold text-amber-300">New Stake</h2>
          <StakingPools
            selectedPoolId={poolId}
            months={months}
            onSelect={(p: Pool) => setPoolId(p.id)}
          />
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[120px] flex-1">
              <label className="block text-xs text-zinc-400" htmlFor="stk-principal">
                Principal (CC)
              </label>
              <input
                id="stk-principal"
                type="number"
                min={10}
                value={principalCc}
                onChange={(e) =>
                  setPrincipalCc(Math.max(10, Number(e.target.value) || 10))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
            </div>
            <div className="min-w-[120px] flex-1">
              <label className="block text-xs text-zinc-400" htmlFor="stk-months">
                Lock (months)
              </label>
              <input
                id="stk-months"
                type="number"
                min={1}
                max={60}
                value={months}
                onChange={(e) =>
                  setMonths(Math.max(1, Math.min(60, Number(e.target.value) || 1)))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={autoCompound}
                onChange={(e) => setAutoCompound(e.target.checked)}
                className="accent-amber-500"
              />
              Auto-compound at maturity
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={liquidReceipt}
                onChange={(e) => setLiquidReceipt(e.target.checked)}
                className="accent-cyan-500"
              />
              Mint liquid-staking receipt
            </label>
          </div>
          <button
            type="button"
            onClick={openStake}
            className="w-full rounded-lg bg-amber-700 py-2 text-sm text-white hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            Lock {principalCc} CC
          </button>
        </section>

        {/* Estimated rewards */}
        <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
            Estimated rewards
          </h2>
          <RewardsEstimator poolId={poolId} principalCc={principalCc} months={months} />
        </section>

        {/* APR history */}
        <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
            APR history — {poolId} pool
          </h2>
          <AprHistoryChart poolId={poolId} months={months} />
        </section>

        {/* Positions */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
            Your positions
          </h2>
          <StakePositions refreshKey={refreshKey} onChange={bumpRefresh} />
        </section>

        {/* Liquid receipt tokens */}
        <section className="space-y-2 rounded-xl border border-cyan-900/40 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-300">
            Liquid-staking receipts
          </h2>
          <ReceiptTokens refreshKey={refreshKey} onChange={bumpRefresh} />
        </section>

        {/* Earnings ledger */}
        <section className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
            Earnings ledger
          </h2>
          <EarningsLedger refreshKey={refreshKey} />
        </section>

        {/* Real-world PoS markets reference */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <StakingMarkets />
        </section>
      </div>

      <RecentMineCard domain="staking" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="staking" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="staking" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
