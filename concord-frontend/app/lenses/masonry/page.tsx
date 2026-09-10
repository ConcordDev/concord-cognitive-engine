'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MasonryFeed } from '@/components/masonry/MasonryFeed';
import { MasonStuff } from '@/components/masonry/MasonStuff';
import { ContractorSuite } from '@/components/masonry/ContractorSuite';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Layers,
  DollarSign,
  CheckCircle2,
  Receipt,
  Hammer,
  CalendarDays,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

interface ScheduleJob { status: string }
interface Invoice { amount: number; amountPaid: number; balance: number }
interface Proposal { status: string; total: number }

async function run<T>(action: string): Promise<T | null> {
  const r = await lensRun<T>('masonry', action, {});
  if (!r.data?.ok) return null;
  return r.data.result as T;
}

/**
 * Header stats are computed live from the real, state-backed masonry
 * macros (schedule-list / invoice-list / proposal-list) — never a
 * client-invented number. If a section has no data yet the stat reads
 * 0, honestly.
 */
function useMasonryStats() {
  const schedule = useQuery({
    queryKey: ['masonry-stats-schedule'],
    queryFn: () => run<{ jobs: ScheduleJob[] }>('schedule-list'),
    staleTime: 15_000,
  });
  const invoices = useQuery({
    queryKey: ['masonry-stats-invoices'],
    queryFn: () => run<{ invoices: Invoice[]; totalCollected: number; outstanding: number }>('invoice-list'),
    staleTime: 15_000,
  });
  const proposals = useQuery({
    queryKey: ['masonry-stats-proposals'],
    queryFn: () => run<{ proposals: Proposal[] }>('proposal-list'),
    staleTime: 15_000,
  });

  return useMemo(() => {
    const jobs = schedule.data?.jobs || [];
    const activeJobs = jobs.filter((j) => j.status === 'scheduled' || j.status === 'in_progress').length;
    const completedJobs = jobs.filter((j) => j.status === 'done').length;
    const revenue = invoices.data?.totalCollected || 0;
    const outstanding = invoices.data?.outstanding || 0;
    const propList = proposals.data?.proposals || [];
    const accepted = propList.filter((p) => p.status === 'accepted').length;
    const acceptRate = propList.length > 0 ? Math.round((accepted / propList.length) * 100) : 0;
    const isLoading = schedule.isLoading || invoices.isLoading || proposals.isLoading;
    return { activeJobs, completedJobs, revenue, outstanding, proposalsCount: propList.length, acceptRate, isLoading };
  }, [schedule.data, invoices.data, proposals.data, schedule.isLoading, invoices.isLoading, proposals.isLoading]);
}

export default function MasonryLensPage() {
  const stats = useMasonryStats();
  const [showFeed, setShowFeed] = useState(false);

  return (
    <LensShell lensId="masonry" asMain={false}>
      <FirstRunTour lensId="masonry" />      <DepthBadge lensId="masonry" size="sm" className="ml-2" />
      <LensPageShell
        domain="masonry"
        title="Masonry"
        description="Contractor operations: takeoff, proposals, scheduling, photos, change orders, price book, invoicing, code library, and clients"
        headerIcon={<Layers className="w-6 h-6" />}
        isLoading={false}
        isError={false}
      >
        {/* Stats row — derived live from real schedule/invoice/proposal state */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className={ds.panel}>
            <Hammer className="w-5 h-5 text-amber-400 mb-2" />
            <p className={ds.textMuted}>Active Jobs</p>
            <p className="text-xl font-bold text-white">{stats.isLoading ? '—' : stats.activeJobs}</p>
          </div>
          <div className={ds.panel}>
            <CalendarDays className="w-5 h-5 text-cyan-400 mb-2" />
            <p className={ds.textMuted}>Completed Jobs</p>
            <p className="text-xl font-bold text-white">{stats.isLoading ? '—' : stats.completedJobs}</p>
          </div>
          <div className={ds.panel}>
            <DollarSign className="w-5 h-5 text-green-400 mb-2" />
            <p className={ds.textMuted}>Revenue Collected</p>
            <p className="text-xl font-bold text-white">{stats.isLoading ? '—' : `$${stats.revenue.toLocaleString()}`}</p>
          </div>
          <div className={ds.panel}>
            <Receipt className="w-5 h-5 text-purple-400 mb-2" />
            <p className={ds.textMuted}>Outstanding</p>
            <p className="text-xl font-bold text-white">{stats.isLoading ? '—' : `$${stats.outstanding.toLocaleString()}`}</p>
          </div>
          <div className={cn(ds.panel, 'hidden md:block')}>
            <CheckCircle2 className="w-5 h-5 text-emerald-400 mb-2" />
            <p className={ds.textMuted}>Proposal Accept Rate</p>
            <p className="text-xl font-bold text-white">{stats.isLoading ? '—' : `${stats.acceptRate}%`} <span className="text-xs text-gray-400 font-normal">({stats.proposalsCount})</span></p>
          </div>
        </div>

        <section className="mt-6">
          <ContractorSuite />
        </section>

        <section className="mt-6">
          <MasonStuff />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowFeed(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Industry chatter (Reddit)</span>
            {showFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showFeed && (
            <div className="mt-3">
              <MasonryFeed />
            </div>
          )}
        </section>
      </LensPageShell>

      <a href="#masonry-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to masonry content</a>      <CrossLensRecentsPanel lensId="masonry" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
