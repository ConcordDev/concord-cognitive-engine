'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MasonryFeed } from '@/components/masonry/MasonryFeed';
import { MasonStuff } from '@/components/masonry/MasonStuff';
import { ContractorSuite } from '@/components/masonry/ContractorSuite';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  DollarSign,
  CheckCircle2,
  Receipt,
  Hammer,
  CalendarDays,
} from 'lucide-react';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';

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
  useLensNav('masonry');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('masonry');
  const stats = useMasonryStats();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="masonry" asMain={false}>
      <FirstRunTour lensId="masonry" />      <DepthBadge lensId="masonry" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="masonry"
        crumb="Masonry"
        title={`Jobs, bids and brick${who ? `, ${who}` : ''}`}
        subtitle="Takeoff, proposals, scheduling, photos, change orders, price book, invoicing, code library and clients"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="masonry" data={realtimeData || {}} compact />
          </>
        }
        cta={{
          label: 'Open job tools',
          icon: Hammer,
          onClick: () => document.getElementById('masonry-suite')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
          title: 'Jump to the contractor suite',
        }}
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

        <section id="masonry-suite" className="mt-6 scroll-mt-6">
          <ContractorSuite />
        </section>

        <section className="mt-6">
          <MasonStuff />
        </section>

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <h2 className="mb-3 text-sm font-semibold text-white">Industry chatter (Reddit)</h2>
          <MasonryFeed />
        </section>

        {realtimeData && (
          <RealtimeDataPanel domain="masonry" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
