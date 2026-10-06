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
import { FilePlus, HeartHandshake, Users, MessagesSquare } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { lensRun } from '@/lib/api/client';
import { InsuranceChatter } from '@/components/death-insurance/InsuranceChatter';
import { PactWriter } from '@/components/death-insurance/PactWriter';
import { PactCard } from '@/components/death-insurance/PactCard';
import { BeneficiaryPactCard } from '@/components/death-insurance/BeneficiaryPactCard';
import { PactNotifications } from '@/components/death-insurance/PactNotifications';
import { PayoutHistory } from '@/components/death-insurance/PayoutHistory';
import { InheritanceGraph } from '@/components/death-insurance/InheritanceGraph';
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

type DeskView = 'pacts' | 'payouts' | 'community';

const VIEWS: { id: DeskView; label: string; keys: string; title: string; hint: string; icon: typeof Users }[] = [
  { id: 'pacts', label: 'Pacts', keys: '1', title: 'Who inherits what', hint: 'Write pacts, review the inheritance graph and pacts you benefit from', icon: Users },
  { id: 'payouts', label: 'Payouts', keys: '2', title: 'What has been paid out', hint: 'Fired payout history and notifications', icon: HeartHandshake },
  { id: 'community', label: 'Community', keys: '3', title: 'Talk it through', hint: 'Inheritance community chatter', icon: MessagesSquare },
];

export default function DeathInsurancePage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<DeskView>('pacts');
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

  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      lensRun<ListResult>('insurance', 'pact-list', {}),
      lensRun<NotificationsResult>('insurance', 'pact-notifications', { windowDays: 14 }),
      lensRun<PayoutHistoryResult>('insurance', 'pact-payout-history', {}),
    ])
      .then(([list, notif, hist]) => {
        if (cancelled) return;
        // pact-list is the load-bearing read; if it failed, surface the real
        // backend reason instead of silently rendering an empty workspace.
        if (!list.data?.ok) {
          setError(list.data?.error || 'Could not load your inheritance pacts. Try refreshing.');
        } else if (list.data.result) {
          // PactCard + InheritanceGraph index pact.beneficiaries directly, so a
          // record missing the array would blank the page; fill the honest empty case.
          setWritten((list.data.result.written || []).map((p) => ({ ...p, beneficiaries: p.beneficiaries || [] })));
          setBeneficiaryOf(list.data.result.beneficiaryOf || []);
        }
        if (notif.data?.ok && notif.data.result) {
          setNotifications(notif.data.result.notifications || []);
          setUnreadHigh(notif.data.result.unreadHigh || 0);
        }
        if (hist.data?.ok && hist.data.result) {
          setPayouts(hist.data.result);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Network error loading pacts.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useLensCommand(
    [
      {
        id: 'death-insurance-refresh',
        keys: 'r',
        description: 'Refresh pacts',
        category: 'navigation',
        action: () => {
          refresh();
        },
      },
      ...VIEWS.map((v) => ({
        id: `death-insurance-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
    ],
    { lensId: 'death-insurance' },
  );

  const current = VIEWS.find((v) => v.id === view)!;
  const card = 'rounded-2xl border border-white/10 bg-[#111] p-4';

  return (
    <LensShell lensId="death-insurance" asMain={false}>
      <FirstRunTour lensId="death-insurance" />
      <DepthBadge lensId="death-insurance" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="death-insurance"
        crumb="Inheritance"
        title={`${current.title}${view === 'pacts' && who ? `, ${who}` : ''}`}
        subtitle="If you fall in Concordia, named friends inherit a share of your sparks. Currency: Sparks only. CC stays separate per the no-pay-to-win invariant. A beneficiary cannot equal the insured, and payouts cannot fire within 24h of writing."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.id === 'pacts' && unreadHigh > 0 ? `${v.label} (${unreadHigh} urgent)` : v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as DeskView)}
        tabsLabel="Inheritance views"
        cta={{ label: 'Write a pact', icon: FilePlus, onClick: () => setView('pacts'), title: 'Open the pact writer' }}
      >
        <div className="space-y-5" aria-busy={loading} data-testid="death-insurance-root">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              data-testid="death-insurance-error"
              className="flex items-center justify-between gap-3 rounded-lg border border-rose-700/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
            >
              <span>{error}</span>
              <button
                type="button"
                onClick={() => refresh()}
                className="shrink-0 rounded-md border border-rose-600/60 px-2 py-1 text-xs font-medium text-rose-100 hover:bg-rose-900/50 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                Retry
              </button>
            </div>
          )}

          {view === 'pacts' && (
            <>
              <PactWriter onWritten={() => refresh()} />
              <PactNotifications notifications={notifications} unreadHigh={unreadHigh} />
              {!loading && <InheritanceGraph written={written} beneficiaryOf={beneficiaryOf} />}
              <section className={card}>
                <h2 className="mb-2 text-sm font-semibold text-white">Pacts You Wrote</h2>
                {loading ? (
                  <p role="status" className="text-sm italic text-zinc-400">Loading…</p>
                ) : written.length === 0 ? (
                  <p data-testid="death-insurance-written-empty" className="text-sm italic text-zinc-400">
                    No pacts yet — write one above.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {written.map((p) => (
                      <PactCard key={p.id} pact={p} onChanged={() => refresh()} />
                    ))}
                  </ul>
                )}
              </section>
              <section className={card}>
                <h2 className="mb-2 text-sm font-semibold text-white">You Are a Beneficiary Of</h2>
                {loading ? (
                  <p className="text-sm italic text-zinc-400">Loading…</p>
                ) : beneficiaryOf.length === 0 ? (
                  <p className="text-sm italic text-zinc-400">No data yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {beneficiaryOf.map((p) => (
                      <BeneficiaryPactCard key={p.id} pact={p} onChanged={() => refresh()} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {view === 'payouts' && (
            <>
              <PayoutHistory
                paidOut={payouts.paidOut}
                received={payouts.received}
                totalPaidOutSparks={payouts.totalPaidOutSparks}
                totalReceivedSparks={payouts.totalReceivedSparks}
              />
            </>
          )}

          {view === 'community' && (
            <section className={card}>
              <InsuranceChatter />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
