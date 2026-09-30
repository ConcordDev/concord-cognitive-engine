'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { CrossLensCTA } from './CrossLensCTA';
import { StatTile } from './StatTile';

async function safeRunDomain(domain: string, action: string, input: Record<string, unknown> = {}) {
  try {
    const r = await apiHelpers.lens.runDomain(domain, action, input);
    return (r.data?.result ?? r.data) as Record<string, unknown>;
  } catch { return null; }
}

/** Fitness tab — fitness.activity-summary substrate only. */
export function FitnessSubstratePanel() {
  const fitness = useQuery({
    queryKey: ['self-fitness'],
    queryFn: async () => {
      const r = await safeRunDomain('fitness', 'activity-summary', { days: 7 });
      return r as { days?: Array<{ date?: string; steps?: number; exerciseMinutes?: number }>; source?: string; notes?: string } | null;
    },
  });

  if (fitness.isLoading) {
    return (
      <div role="status" className="flex items-center gap-2 text-xs text-rose-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span>Loading activity…</span>
      </div>
    );
  }
  if ((fitness.data?.days ?? []).length > 0) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile label="Days logged" value={(fitness.data?.days ?? []).length} icon={Activity} />
          <StatTile label="Total steps" value={(fitness.data?.days ?? []).reduce((a, d) => a + (d.steps ?? 0), 0) || '—'} icon={Activity} />
          <StatTile label="Active min" value={(fitness.data?.days ?? []).reduce((a, d) => a + (d.exerciseMinutes ?? 0), 0) || '—'} icon={Activity} />
        </div>
        <p className="text-[11px] text-rose-800">Last 7 days · sourced from {fitness.data?.source ?? 'your activity ledger'}.</p>
      </div>
    );
  }
  return (
    <CrossLensCTA
      icon={Activity}
      body={fitness.data?.notes ?? 'No activity logged in the last 7 days.'}
      href="/lenses/fitness"
      cta="Open the Fitness lens"
    />
  );
}
