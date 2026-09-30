'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';

const DailyRituals = dynamic(() => import('@/components/world-lens/DailyRituals'), { ssr: false });

async function safeRunDomain(domain: string, action: string, input: Record<string, unknown> = {}) {
  try {
    const r = await apiHelpers.lens.runDomain(domain, action, input);
    return (r.data?.result ?? r.data) as Record<string, unknown>;
  } catch { return null; }
}

type StreaksMacroResult = {
  overall?: number;
  loggedToday?: boolean;
  perMetric?: Array<{ longest?: number }>;
};
type BeatRow = {
  id?: string;
  prose?: string;
  surfaced_at?: number;
  completed_at?: number | null;
  outcome?: string | null;
};

/**
 * Rituals tab — only substrate-backed props (self.streaks + beats.list).
 * Everything else stays undefined on purpose (no substrate).
 */
export function RitualsTabPanel({ refreshKey }: { refreshKey: number }) {
  const ritualsStreak = useQuery({
    queryKey: ['self-rituals-streak', refreshKey],
    queryFn: async () => {
      const r = (await safeRunDomain('self', 'streaks')) as StreaksMacroResult | null;
      if (!r || typeof r.overall !== 'number') return null;
      const perMetricLongest = (r.perMetric ?? []).map((m) => Number(m?.longest) || 0);
      return {
        currentStreak: r.overall,
        longestStreak: Math.max(r.overall, ...perMetricLongest, 0),
        todayCheckedIn: r.loggedToday === true,
        rewards: [] as { day: number; reward: string; claimed: boolean }[],
      };
    },
  });

  const ritualsBeat = useQuery({
    queryKey: ['self-rituals-beat'],
    queryFn: async () => {
      const r = (await safeRunDomain('beats', 'list', { limit: 20 })) as { beats?: BeatRow[] } | null;
      const open = (r?.beats ?? []).find(
        (b) => b && !b.completed_at && !b.outcome && typeof b.prose === 'string' && b.prose.trim().length > 0,
      );
      if (!open) return null;
      return {
        action: (open.prose as string).trim(),
        reason: open.surfaced_at
          ? `Open personal beat, surfaced ${new Date(open.surfaced_at * 1000).toLocaleDateString()}`
          : 'Open personal beat from your world activity',
      };
    },
  });

  return (
    <DailyRituals
      streak={ritualsStreak.data ?? undefined}
      suggestedAction={ritualsBeat.data ?? undefined}
    />
  );
}
