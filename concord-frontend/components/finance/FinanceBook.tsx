'use client';

/**
 * Finance north star — one book (cash and positions) once the feed answers.
 * The terminal stays under More. Indices are not painted while loading.
 */

import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { BookRow, FamilyPill, NorthError, NorthNote, northPage, usd } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Summary = { breakdown?: { cash?: number } };
type Holding = { id?: string; symbol?: string; name?: string; shares?: number; value?: number };

const PILL = [
  { id: 'finance', label: 'Finance', href: '/lenses/finance' },
  { id: 'markets', label: 'Markets', href: '/lenses/markets' },
  { id: 'wallet', label: 'Wallet', href: '/lenses/wallet' },
];

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

export function FinanceBook({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('finance');
  useLensIdentity('finance');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  const cashQ = useQuery({
    queryKey: ['finance-northstar', 'cash'],
    ...quiet,
    queryFn: async () => {
      const res = await lensRun<Summary>('finance', 'dashboard-summary', {});
      const cash = res.data.result?.breakdown?.cash;
      if (!res.data.ok || cash == null || !Number.isFinite(Number(cash))) {
        throw new Error(res.data.error || 'The book did not answer.');
      }
      return Number(cash);
    },
  });
  const holdingsQ = useQuery({
    queryKey: ['finance-northstar', 'holdings'],
    ...quiet,
    queryFn: async () => {
      const res = await lensRun<{ holdings?: Holding[] }>('finance', 'holdings-list', {});
      if (!res.data.ok || !Array.isArray(res.data.result?.holdings)) {
        throw new Error(res.data.error || 'Positions did not answer.');
      }
      return res.data.result.holdings;
    },
  });

  const cash = cashQ.data;
  const holdings = holdingsQ.data;
  const waiting = cashQ.isLoading && holdingsQ.isLoading;
  const error = [cashQ.error, holdingsQ.error].filter(Boolean).map((e) => (e instanceof Error ? e.message : 'The book did not answer.')).join(' ');
  const refreshing = cashQ.isFetching || holdingsQ.isFetching;

  return (
    <LensShell lensId="finance" asMain={false} disableAgentFab>
      <div data-lens-theme="finance" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Finance" title={who ? `What you hold, ${who}` : 'What you hold'} />
            <FamilyPill label="Finance" active="finance" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Terminal' }]} onPick={onOpenDesk} />
        </div>

        {waiting && (
          <NorthNote>Live prices were still loading. The book stays one list, not a terminal.</NorthNote>
        )}
        {error && <NorthError message={error} />}

        <div className="mt-6 max-w-xl space-y-2">
          <BookRow label="Cash" value={cash == null ? '—' : usd(cash)} />
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[15px] text-zinc-200">Positions</span>
              {!holdings?.length && <span className="text-[14px] text-zinc-500">none loaded</span>}
            </div>
            {holdings && holdings.length > 0 && (
              <ul className="mt-3 space-y-2">
                {holdings.map((h) => (
                  <li key={h.id || h.symbol} className="flex items-baseline justify-between gap-4 text-[14px]">
                    <span className="text-zinc-200">{h.symbol || h.name}</span>
                    <span className="tabular-nums text-zinc-400">
                      {Number.isFinite(Number(h.shares)) ? `${h.shares} · ` : ''}
                      {Number.isFinite(Number(h.value)) ? usd(Number(h.value)) : '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <button
          type="button"
          className={northCtaClass}
          onClick={() => { void cashQ.refetch(); void holdingsQ.refetch(); }}
          disabled={refreshing}
        >
          Refresh
        </button>
      </div>
    </LensShell>
  );
}
