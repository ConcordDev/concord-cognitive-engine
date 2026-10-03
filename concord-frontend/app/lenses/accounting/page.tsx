'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { Calculator } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import IndicatorChart, { type IndicatorPayload } from '@/components/lens/IndicatorChart';
import AccountingWorkbench from '@/components/accounting/AccountingWorkbench';
import { BooksSection } from '@/components/accounting/BooksSection';
import type { BooksNav } from '@/components/accounting/BooksShell';
import { CategoryRulesPanel } from '@/components/accounting/CategoryRulesPanel';
import { PipingProvider } from '@/components/panel-polish';

/* ------------------------------------------------------------------ */
/*  Accounting & Finance lens                                          */
/*                                                                      */
/*  This lens is a real double-entry books engine (QuickBooks Online / *
 *  Xero-class parity — chart of accounts, journal, bills, invoices,   *
 *  vendors, customers, payroll, budgets, tax, bank-feed AI            *
 *  categorization, purchase orders, 1099/W-2 e-file). All of it is    *
 *  server-authoritative: every macro reads/writes a persistent        *
 *  per-user CoA + journal (`server/domains/accounting.js`), not a     *
 *  client-editable sandbox.                                           *
 *                                                                      *
 *  BooksSection is the primary surface (sidebar-nav "books" shell —   *
 *  dashboard / banking / invoices / bills / customers / vendors /     *
 *  reports). AccountingWorkbench is a companion drawer for the raw    *
 *  CoA / journal-entry / ledger / balance-sheet / AR-aging power-user *
 *  flows. A prior generation of this page duplicated all of this      *
 *  behind a disconnected generic-artifact CRUD sandbox (client-typed  *
 *  "Account"/"Transaction"/"Invoice" records with no relationship to  *
 *  the real ledger) whose "Server-Computed Trial Balance" button      *
 *  always returned an empty, trivially-balanced report because it     *
 *  ran the trialBalance macro against a mismatched artifact shape —   *
 *  a phantom-success bug, not a working feature. That system has been *
 *  removed; this page now has exactly one book of record.             */
/* ------------------------------------------------------------------ */

export default function AccountingLensPage() {
  useLensNav('accounting');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('accounting');

  // Wallet balance — the platform CC wallet, a distinct concept from the
  // books' own "cash on hand" (fed by /api/economy/balance vs the real
  // dashboard-summary macro inside BooksSection).
  const walletQuery = useQuery({
    queryKey: ['accounting-wallet'],
    queryFn: async () => {
      const res = await api.get<{ ok: boolean; balance: number; tier?: string }>('/api/economy/balance').catch(() => null);
      return res?.data || null;
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [booksNav, setBooksNav] = useState<BooksNav>('dashboard');

  // Lens-scoped keyboard commands — each one drives a real state change
  // in the real books shell, not a decorative no-op.
  useLensCommand(
    [
      { id: 'nav-dashboard', keys: 'd', description: 'Dashboard', category: 'navigation', action: () => setBooksNav('dashboard') },
      { id: 'nav-banking',   keys: 'b', description: 'Banking (AI categorize)', category: 'navigation', action: () => setBooksNav('banking') },
      { id: 'nav-invoices',  keys: 'i', description: 'Invoices', category: 'navigation', action: () => setBooksNav('invoices') },
      { id: 'nav-bills',     keys: 'x', description: 'Bills', category: 'navigation', action: () => setBooksNav('bills') },
      { id: 'nav-reports',   keys: 'p', description: 'P&L report', category: 'navigation', action: () => setBooksNav('pl') },
      { id: 'nav-actions',   keys: 'a', description: 'CFO bench', category: 'navigation', action: () => setBooksNav('actions') },
      { id: 'open-workbench', keys: 'w', description: 'Open workbench', category: 'actions', action: () => setWorkbenchOpen(true) },
    ],
    { lensId: 'accounting' }
  );

  const balance = walletQuery.data?.balance ?? null;
  const tier = walletQuery.data?.tier;

  return (
    <LensShell lensId="accounting" asMain={false}>
      <FirstRunTour lensId="accounting" />
      <div data-lens-theme="accounting" className="relative min-h-full space-y-5 px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Accounting</p>
            <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {booksNav === 'dashboard' ? `Where the books stand${who ? `, ${who}` : ''}` : 'Your books'}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {balance != null && (
              <div className="text-right leading-tight">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Wallet</div>
                <div className="font-mono text-sm tabular-nums text-zinc-100">
                  {Math.round(balance).toLocaleString()} CC
                  {tier && <span className="ml-1 text-[10px] uppercase text-zinc-500">{tier}</span>}
                </div>
              </div>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <DepthBadge lensId="accounting" size="sm" />
            <DTUExportButton domain="accounting" data={{}} compact />
          </div>
        </div>

        {/* Primary surface — the real books shell */}
        <BooksSection nav={booksNav} onNavChange={setBooksNav} />

        {/* Macro context — World Bank economic indicators, real external feed. */}
        <details className="rounded-xl border border-lattice-border bg-lattice-surface/40 backdrop-blur-sm overflow-hidden">
          <summary className="px-4 py-2 text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:bg-white/[0.02] flex items-center justify-between">
            <span>Macro context — World Bank indicators</span>
            <span className="text-gray-600">expand</span>
          </summary>
          <div className="p-2 border-t border-white/10">
            <IndicatorChart
              data={realtimeData as IndicatorPayload | null}
              isLive={isLive}
              lastUpdated={lastUpdated}
            />
          </div>
        </details>

        <RealtimeDataPanel domain="accounting" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        {/* Lens Features (reference / discoverability, collapsed by default —
            the designed nav above is the primary surface). */}

        <button
          type="button"
          onClick={() => setWorkbenchOpen(true)}
          title="Open the accounting workbench (W)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Calculator className="h-4 w-4" />
          Workbench
        </button>
      </div>

      {/* Companion drawer — raw CoA / journal-entry / ledger / balance
          sheet / AR-aging power-user flows over the same real backend. */}
      <AccountingWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />

      <PipingProvider>
        <section className="mt-6 max-w-7xl mx-auto px-4">
          <CategoryRulesPanel />
        </section>
      </PipingProvider>      <CrossLensRecentsPanel lensId="accounting" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
