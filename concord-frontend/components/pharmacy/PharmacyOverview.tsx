'use client';

/**
 * PharmacyOverview — the pharmacy lens landing surface.
 *
 * Real data only: pulls `pharmacy.pharmacy-dashboard` (medications /
 * today's doses / 30-day adherence / refills due / open refill requests)
 * and presents it as a StatTileGrid, with honest loading/error/empty
 * states and quick-nav cards into the other destinations. Also hosts the
 * page-level density toggle (this is the natural landing view for it) and
 * the live FDA drug-recall feed pull (pharmacy.feed → real DTUs).
 */

import { useCallback, useEffect } from 'react';
import { Pill, Bell, HeartPulse, ArrowRight } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { LensFeedButton } from '@/components/lens/LensFeedButton';

interface Dash {
  medications: number;
  todayDoses: { total: number; taken: number; pending: number };
  adherence30d: number | null;
  refillsDue: number;
  openRefillRequests: number;
}

type DestinationId = 'meds' | 'reference' | 'bench';

export function PharmacyOverview({ onNavigate }: { onNavigate: (id: DestinationId) => void }) {
  const { status, result, error, dispatch } = useMacroDispatchFeedback<Dash>();

  const load = useCallback(() => { void dispatch('pharmacy', 'pharmacy-dashboard', {}); }, [dispatch]);
  useEffect(() => { load(); }, [load]);

  const isLoading = status === 'idle' || status === 'dispatched' || status === 'running';

  if (status === 'error') {
    return (
      <div role="alert">
        <ErrorState message={error || 'Failed to load pharmacy dashboard'} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">At a glance</h2>
        <DensityToggle variant="dropdown" />
      </div>

      {isLoading ? (
        <div role="status" aria-busy="true" aria-live="polite" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <span className="sr-only">Loading pharmacy dashboard</span>
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="block" height={64} />)}
        </div>
      ) : result && result.medications > 0 ? (
        <StatTileGrid columns={5}>
          <StatTile label="Medications" value={result.medications} icon={<Pill className="w-4 h-4" />} />
          <StatTile label="Doses today" value={`${result.todayDoses.taken}/${result.todayDoses.total}`}
            caption={result.todayDoses.pending > 0 ? `${result.todayDoses.pending} pending` : 'all logged'}
            tone={result.todayDoses.pending > 0 ? 'negative' : 'positive'} />
          <StatTile label="Adherence 30d" value={result.adherence30d != null ? `${result.adherence30d}` : '—'} unit={result.adherence30d != null ? '%' : ''}
            tone={result.adherence30d != null && result.adherence30d < 80 ? 'negative' : 'positive'} />
          <StatTile label="Refills due" value={result.refillsDue} tone={result.refillsDue > 0 ? 'negative' : 'positive'} />
          <StatTile label="Open requests" value={result.openRefillRequests} />
        </StatTileGrid>
      ) : (
        <EmptyState
          title="No medications tracked yet"
          description="Add your first medication in My Meds to start tracking doses, adherence, refills and pricing."
          action={{ label: 'Go to My Meds', onClick: () => onNavigate('meds') }}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <NavCard icon={Pill} title="My Meds" desc="Medications, dose schedule, reminders, refills, prices, adherence, health log." onClick={() => onNavigate('meds')} />
        <NavCard icon={HeartPulse} title="Drug Reference & Safety" desc="FDA labels, adverse events, interaction checks, formulary & inventory tools." onClick={() => onNavigate('reference')} />
        <NavCard icon={Bell} title="Rx Bench" desc="Save a lookup as a DTU, DM it, publish a public brief, or get agent counseling." onClick={() => onNavigate('bench')} />
      </div>

      <LensFeedButton domain="pharmacy" label="Pull recent FDA drug recalls into your archive" />
    </div>
  );
}

function NavCard({ icon: Icon, title, desc, onClick }: { icon: typeof Pill; title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 hover:border-amber-600/50 hover:bg-zinc-900/60 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-zinc-100">{title}</span>
        <ArrowRight className="w-3.5 h-3.5 text-zinc-500 ml-auto" />
      </div>
      <p className="text-[11px] text-zinc-400 leading-relaxed">{desc}</p>
    </button>
  );
}
