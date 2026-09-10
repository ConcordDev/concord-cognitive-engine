'use client';

import { useQuery } from '@tanstack/react-query';
import { Smile, TrendingUp, Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { CrossLensCTA } from './CrossLensCTA';
import { StatTile } from './StatTile';

async function safeRunDomain(domain: string, action: string, input: Record<string, unknown> = {}) {
  try {
    const r = await apiHelpers.lens.runDomain(domain, action, input);
    return (r.data?.result ?? r.data) as Record<string, unknown>;
  } catch { return null; }
}

/** Mood tab — affect.trends substrate. */
export function MoodSubstratePanel() {
  const mood = useQuery({
    queryKey: ['self-mood'],
    queryFn: async () => {
      const r = await safeRunDomain('affect', 'trends', { sinceDays: 30 });
      return r as {
        hasData?: boolean;
        overallAvg?: number;
        entryCount?: number;
        dayOfWeek?: Array<{ label: string; avgMood: number | null; count: number }>;
      } | null;
    },
  });

  if (mood.isLoading) {
    return (
      <div role="status" className="flex items-center gap-2 text-xs text-rose-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /><span>Loading mood trends…</span>
      </div>
    );
  }
  if (mood.data?.hasData) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <StatTile label="Avg mood" value={mood.data.overallAvg != null ? mood.data.overallAvg.toFixed(1) : '—'} icon={Smile} />
          <StatTile label="Check-ins" value={mood.data.entryCount ?? 0} icon={Smile} />
          <StatTile
            label="Best day"
            value={(() => {
              const dow = (mood.data?.dayOfWeek ?? []).filter((d) => d.avgMood != null);
              if (dow.length === 0) return '—';
              return dow.reduce((best, d) => (d.avgMood! > (best.avgMood ?? -Infinity) ? d : best)).label;
            })()}
            icon={TrendingUp}
          />
        </div>
        <p className="text-[11px] text-rose-800">Last 30 days · from your affect check-ins.</p>
      </div>
    );
  }
  return (
    <CrossLensCTA
      icon={Smile}
      body="No mood check-ins in the last 30 days. Log how you feel in the Affect lens and your mood trend surfaces here."
      href="/lenses/affect"
      cta="Open the Affect lens"
    />
  );
}
