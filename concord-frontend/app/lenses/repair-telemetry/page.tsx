'use client';

/**
 * Maintenance — repair-telemetry operator lens.
 * Thin shell + one `active` union; panels own ledger / escalations / patterns.
 */

import { useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, RefreshCcw, XCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { Skeleton, SkeletonTableRows } from '@/components/ui/Skeleton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { useRepairTelemetry } from '@/components/repair-telemetry/useRepairTelemetry';
import { StatsStrip } from '@/components/repair-telemetry/StatsStrip';
import { EscalationInboxPanel } from '@/components/repair-telemetry/EscalationInboxPanel';
import { PatternsPanel } from '@/components/repair-telemetry/PatternsPanel';
import { LedgerPanel } from '@/components/repair-telemetry/LedgerPanel';
import type { FilterTab } from '@/components/repair-telemetry/types';

type RepairView = 'overview' | 'escalations' | 'patterns' | 'ledger';

const TABS: { id: RepairView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'escalations', label: 'Escalations' },
  { id: 'patterns', label: 'Patterns' },
  { id: 'ledger', label: 'Ledger' },
];

export default function RepairTelemetryPage() {
  const {
    log, escalations, mem, forbidden, state, refreshing, lastRefresh,
    errorBanner, setErrorBanner, pendingEscalationId, autoRefresh, setAutoRefresh,
    refresh, resolve,
  } = useRepairTelemetry();

  const [active, setActive] = useState<RepairView>('overview');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | null>(null);

  const escalationIdsRef = useRef<string[]>([]);
  escalationIdsRef.current = escalations.map((e) => e.id);

  useLensCommand(
    [
      { id: 'refresh', keys: 'r', description: 'Refresh telemetry', category: 'actions', action: () => void refresh(true), global: true },
      { id: 'tab-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActive('overview') },
      { id: 'tab-escalations', keys: 'e', description: 'Escalations', category: 'navigation', action: () => setActive('escalations') },
      { id: 'tab-patterns', keys: 'p', description: 'Patterns', category: 'navigation', action: () => setActive('patterns') },
      { id: 'tab-ledger', keys: 'l', description: 'Ledger', category: 'navigation', action: () => setActive('ledger') },
      { id: 'filter-all', keys: '1', description: 'Show all findings', category: 'navigation', action: () => { setActive('ledger'); setFilter('all'); } },
      { id: 'filter-healed', keys: '2', description: 'Show healed findings', category: 'navigation', action: () => { setActive('ledger'); setFilter('healed'); } },
      { id: 'filter-escalated', keys: '3', description: 'Show escalated findings', category: 'navigation', action: () => { setActive('ledger'); setFilter('escalated'); } },
      { id: 'filter-noted', keys: '4', description: 'Show noted findings', category: 'navigation', action: () => { setActive('ledger'); setFilter('noted'); } },
      {
        id: 'escalation-next', keys: 'j', description: 'Next escalation', category: 'navigation', action: () => {
          setActive('escalations');
          const ids = escalationIdsRef.current;
          if (!ids.length) return;
          const idx = selectedEscalationId ? ids.indexOf(selectedEscalationId) : -1;
          setSelectedEscalationId(ids[Math.min(idx + 1, ids.length - 1)]);
        },
      },
      {
        id: 'escalation-prev', keys: 'k', description: 'Previous escalation', category: 'navigation', action: () => {
          setActive('escalations');
          const ids = escalationIdsRef.current;
          if (!ids.length) return;
          const idx = selectedEscalationId ? ids.indexOf(selectedEscalationId) : 0;
          setSelectedEscalationId(ids[Math.max(idx - 1, 0)]);
        },
      },
      {
        id: 'escalation-approve', keys: 'a', description: 'Approve selected escalation', category: 'actions',
        action: () => { if (selectedEscalationId) void resolve(selectedEscalationId, 'approved'); },
        enabled: !!selectedEscalationId,
      },
      {
        id: 'escalation-dismiss', keys: 'x', description: 'Dismiss selected escalation', category: 'actions',
        action: () => { if (selectedEscalationId) void resolve(selectedEscalationId, 'dismissed'); },
        enabled: !!selectedEscalationId,
      },
      {
        id: 'deselect', keys: 'esc', description: 'Deselect finding / escalation', category: 'navigation',
        action: () => { setSelectedEscalationId(null); },
      },
    ],
    { lensId: 'repair-telemetry' },
  );

  const counts = useMemo(() => {
    const c = { all: log.length, healed: 0, escalated: 0, noted: 0 };
    for (const e of log) c[e.disposition]++;
    return c;
  }, [log]);

  if (forbidden) {
    return (
      <LensShell lensId="repair-telemetry" asMain={false}>
        <AdminRequiredState roles={['admin', 'operator']} />
      </LensShell>
    );
  }

  const isLoading = state === 'loading';
  const isError = state === 'error';
  const isEmpty = state === 'ready' && log.length === 0 && escalations.length === 0
    && (!mem || (mem.totalPatterns === 0 && mem.totalRepairs === 0));

  return (
    <LensShell lensId="repair-telemetry" asMain={false}>
      <main aria-label="Repair telemetry dashboard" className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
        <header className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
              <Activity className="h-5 w-5 text-amber-400" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">Repair Telemetry</h1>
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
                What the world repaired — and what it refused to decide — while you were away.
              </p>
            </div>
            <label className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:flex">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-3 w-3 accent-amber-500" />
              auto-refresh
            </label>
            <button
              onClick={() => void refresh(true)}
              disabled={isLoading || refreshing}
              aria-label="Refresh telemetry"
              className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-60"
            >
              <RefreshCcw className={cn('h-3 w-3', (isLoading || refreshing) && 'animate-spin')} aria-hidden="true" />
              {refreshing ? 'refreshing…' : 'refresh'}
              <kbd className="ml-0.5 hidden rounded border border-amber-400/30 bg-black/20 px-1 py-0.5 font-mono text-[9px] sm:inline">R</kbd>
            </button>
            {(isLoading || refreshing) && <span role="status" aria-live="polite" className="sr-only">Refreshing telemetry</span>}
          </div>
          {errorBanner && (
            <div role="alert" className="mx-auto mt-2 flex max-w-screen-2xl items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="flex-1 break-words">{errorBanner}</span>
              <button onClick={() => setErrorBanner(null)} className="shrink-0 rounded border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-100 hover:bg-red-500/20">dismiss</button>
            </div>
          )}
          {lastRefresh && (
            <div className="mx-auto mt-1 max-w-screen-2xl text-[10px] text-slate-500">last refreshed {lastRefresh.toLocaleTimeString()}</div>
          )}
        </header>

        <div id="repair-telemetry-content" className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-5">
          <nav aria-label="Repair views" className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800 pb-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActive(t.id)}
                className={cn(
                  'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
                  active === t.id
                    ? 'bg-amber-500/15 text-amber-200 border border-amber-500/20'
                    : 'text-slate-400 hover:text-amber-200 border border-transparent',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {isLoading && (
            <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} variant="block" height={54} />)}
              </div>
              <Skeleton variant="block" height={140} />
              <SkeletonTableRows rows={6} columns={6} />
              <span className="sr-only">Loading repair telemetry…</span>
            </div>
          )}

          {isError && (
            <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
              <XCircle className="h-6 w-6 text-red-400" aria-hidden="true" />
              <p className="text-sm text-slate-300">Couldn&apos;t load repair telemetry.</p>
              <button onClick={() => void refresh(false)} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20">Retry</button>
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
              <span aria-hidden="true" className="text-2xl">🩹</span>
              <p className="text-sm">All quiet. The monitor has logged no findings yet — it runs on a slow (~4h) cadence.</p>
            </div>
          )}

          {state === 'ready' && !isEmpty && (
            <div className="space-y-5">
              {(active === 'overview') && mem && <StatsStrip counts={counts} mem={mem} />}
              {(active === 'overview' || active === 'escalations') && (
                <EscalationInboxPanel
                  escalations={escalations}
                  selectedEscalationId={selectedEscalationId}
                  setSelectedEscalationId={setSelectedEscalationId}
                  pendingEscalationId={pendingEscalationId}
                  resolve={resolve}
                />
              )}
              {(active === 'overview' || active === 'patterns') && (
                <PatternsPanel topPatterns={mem?.topPatterns || []} />
              )}
              {(active === 'overview' || active === 'ledger') && (
                <LedgerPanel log={log} filter={filter} setFilter={setFilter} refreshing={refreshing} />
              )}
            </div>
          )}
        </div>
      </main>
    </LensShell>
  );
}
