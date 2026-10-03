'use client';

/**
 * Maintenance — repair-telemetry operator lens.
 * Thin shell + one `active` union; panels own ledger / escalations / patterns.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Activity, ClipboardList, Inbox, RefreshCcw, ScrollText, XCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { AdminRequiredState } from '@/components/common/EmptyState';
import { Skeleton, SkeletonTableRows } from '@/components/ui/Skeleton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRepairTelemetry } from '@/components/repair-telemetry/useRepairTelemetry';
import { StatsStrip } from '@/components/repair-telemetry/StatsStrip';
import { EscalationInboxPanel } from '@/components/repair-telemetry/EscalationInboxPanel';
import { PatternsPanel } from '@/components/repair-telemetry/PatternsPanel';
import { LedgerPanel } from '@/components/repair-telemetry/LedgerPanel';
import type { FilterTab } from '@/components/repair-telemetry/types';

type RepairView = 'overview' | 'escalations' | 'patterns' | 'ledger';

const TABS: { id: RepairView; label: string; keys: string; title: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', keys: 'o', title: 'What the world repaired', icon: Activity },
  { id: 'escalations', label: 'Escalations', keys: 'e', title: 'What needs your decision', icon: Inbox },
  { id: 'patterns', label: 'Patterns', keys: 'p', title: 'What keeps breaking', icon: ClipboardList },
  { id: 'ledger', label: 'Ledger', keys: 'l', title: 'Every finding on record', icon: ScrollText },
];

export default function RepairTelemetryPage() {
  const {
    log, escalations, mem, forbidden, state, refreshing, lastRefresh,
    errorBanner, setErrorBanner, pendingEscalationId, autoRefresh, setAutoRefresh,
    refresh, resolve,
  } = useRepairTelemetry();

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<RepairView>('overview');
  const [filter, setFilter] = useState<FilterTab>('all');
  const [selectedEscalationId, setSelectedEscalationId] = useState<string | null>(null);

  const escalationIdsRef = useRef<string[]>([]);
  useEffect(() => {
    escalationIdsRef.current = escalations.map((e) => e.id);
  }, [escalations]);

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

  const current = TABS.find((t) => t.id === active)!;

  return (
    <LensShell lensId="repair-telemetry" asMain={false}>
      <NorthStarFrame
        lensId="repair-telemetry"
        crumb="Maintenance"
        title={`${current.title}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="What the world repaired, and what it refused to decide, while you were away."
        actions={
          <label className="hidden items-center gap-1.5 text-[12px] text-zinc-400 sm:flex">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-3 w-3 accent-teal-400" />
            auto-refresh
          </label>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={active}
        onTab={(id) => setActive(id as RepairView)}
        tabsLabel="Repair views"
        cta={{
          label: refreshing ? 'Refreshing…' : 'Refresh telemetry',
          icon: RefreshCcw,
          onClick: () => void refresh(true),
          disabled: isLoading || refreshing,
          title: 'Refresh telemetry (R)',
        }}
      >
        <div id="repair-telemetry-content" aria-label="Repair telemetry dashboard">
          {(isLoading || refreshing) && <span role="status" aria-live="polite" className="sr-only">Refreshing telemetry</span>}
          {errorBanner && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-[12px] text-red-200">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> <span className="flex-1 break-words">{errorBanner}</span>
              <button onClick={() => setErrorBanner(null)} className="shrink-0 rounded border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-100 hover:bg-red-500/20">dismiss</button>
            </div>
          )}
          {lastRefresh && (
            <div className="mb-3 text-[11px] text-zinc-500">last refreshed {lastRefresh.toLocaleTimeString()}</div>
          )}

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
      </NorthStarFrame>
    </LensShell>
  );
}
