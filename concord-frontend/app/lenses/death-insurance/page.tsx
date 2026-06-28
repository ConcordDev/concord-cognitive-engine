'use client';

/**
 * /lenses/death-insurance — sparks-only inheritance pacts.
 * Phase 9.4 #6. CC stays insulated per the no-pay-to-win invariant.
 *
 * (Parked at /lenses/death-insurance because /lenses/insurance is
 * already taken by an existing real-world insurance lens.)
 *
 * Feature-parity backlog (all shipped):
 *  - Multi-beneficiary split with percentages
 *  - Contract renewal / auto-renew before expiry
 *  - Recurring premium payment schedule
 *  - Beneficiary acceptance handshake (opt-in)
 *  - Fired-payout history log
 *  - Expiry / fire / premium-due notifications
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { lensRun } from '@/lib/api/client';
import { InsuranceChatter } from '@/components/death-insurance/InsuranceChatter';
import { PactWriter } from '@/components/death-insurance/PactWriter';
import { PactCard } from '@/components/death-insurance/PactCard';
import { BeneficiaryPactCard } from '@/components/death-insurance/BeneficiaryPactCard';
import { PactNotifications } from '@/components/death-insurance/PactNotifications';
import { PayoutHistory } from '@/components/death-insurance/PayoutHistory';
import type { Pact, Payout, PactNotification } from '@/components/death-insurance/types';

interface ListResult {
  written: Pact[];
  beneficiaryOf: Pact[];
  count: number;
}
interface NotificationsResult {
  notifications: PactNotification[];
  count: number;
  unreadHigh: number;
}
interface PayoutHistoryResult {
  paidOut: Payout[];
  received: Payout[];
  totalPaidOutSparks: number;
  totalReceivedSparks: number;
}

export default function DeathInsurancePage() {
  const [written, setWritten] = useState<Pact[]>([]);
  const [beneficiaryOf, setBeneficiaryOf] = useState<Pact[]>([]);
  const [notifications, setNotifications] = useState<PactNotification[]>([]);
  const [unreadHigh, setUnreadHigh] = useState(0);
  const [payouts, setPayouts] = useState<PayoutHistoryResult>({
    paidOut: [],
    received: [],
    totalPaidOutSparks: 0,
    totalReceivedSparks: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [list, notif, hist] = await Promise.all([
        lensRun<ListResult>('insurance', 'pact-list', {}),
        lensRun<NotificationsResult>('insurance', 'pact-notifications', { windowDays: 14 }),
        lensRun<PayoutHistoryResult>('insurance', 'pact-payout-history', {}),
      ]);
      // pact-list is the load-bearing read; if it failed, surface the real
      // backend reason instead of silently rendering an empty workspace.
      if (!list.data?.ok) {
        setError(list.data?.error || 'Could not load your inheritance pacts. Try refreshing.');
      } else if (list.data.result) {
        setWritten(list.data.result.written || []);
        setBeneficiaryOf(list.data.result.beneficiaryOf || []);
      }
      if (notif.data?.ok && notif.data.result) {
        setNotifications(notif.data.result.notifications || []);
        setUnreadHigh(notif.data.result.unreadHigh || 0);
      }
      if (hist.data?.ok && hist.data.result) {
        setPayouts(hist.data.result);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error loading pacts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useLensCommand(
    [
      {
        id: 'death-insurance-refresh',
        keys: 'r',
        description: 'Refresh pacts',
        category: 'navigation',
        action: () => {
          void refresh();
        },
      },
    ],
    { lensId: 'death-insurance' },
  );

  return (
    <LensShell lensId="death-insurance">
      <FirstRunTour lensId="death-insurance" />
      <DepthBadge lensId="death-insurance" size="sm" className="ml-2" />
      <div className="mx-auto max-w-3xl p-6 sm:p-8" aria-busy={loading} data-testid="death-insurance-root">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Inheritance Pact</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Write a contract: if you fall in Concordia, named friends inherit a share of your sparks.{' '}
            <strong>Currency: ⚡ Sparks only.</strong> CC stays separate per the no-pay-to-win
            invariant. Suicide-pact prevention: a beneficiary cannot equal the insured; payouts
            cannot fire within 24h of writing.
          </p>
        </header>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            data-testid="death-insurance-error"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-rose-700/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded-md border border-rose-600/60 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/50 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              Retry
            </button>
          </div>
        )}

        <div className="mb-6">
          <PactWriter onWritten={() => void refresh()} />
        </div>

        <div className="mb-6">
          <PactNotifications notifications={notifications} unreadHigh={unreadHigh} />
        </div>

        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">
          Pacts You Wrote
        </h2>
        {loading ? (
          <p role="status" className="mb-6 text-sm italic text-zinc-400">Loading…</p>
        ) : written.length === 0 ? (
          <p data-testid="death-insurance-written-empty" className="mb-6 text-sm italic text-zinc-400">
            No pacts yet — write one above.
          </p>
        ) : (
          <ul className="mb-6 space-y-2">
            {written.map((p) => (
              <PactCard key={p.id} pact={p} onChanged={() => void refresh()} />
            ))}
          </ul>
        )}

        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-zinc-300">
          You Are a Beneficiary Of
        </h2>
        {loading ? (
          <p className="mb-6 text-sm italic text-zinc-400">Loading…</p>
        ) : beneficiaryOf.length === 0 ? (
          <p className="mb-6 text-sm italic text-zinc-400">No data yet.</p>
        ) : (
          <ul className="mb-6 space-y-2">
            {beneficiaryOf.map((p) => (
              <BeneficiaryPactCard key={p.id} pact={p} onChanged={() => void refresh()} />
            ))}
          </ul>
        )}

        <div className="mb-6">
          <PayoutHistory
            paidOut={payouts.paidOut}
            received={payouts.received}
            totalPaidOutSparks={payouts.totalPaidOutSparks}
            totalReceivedSparks={payouts.totalReceivedSparks}
          />
        </div>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <InsuranceChatter />
        </section>
      </div>

      <RecentMineCard domain="death-insurance" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="death-insurance" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="death-insurance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
