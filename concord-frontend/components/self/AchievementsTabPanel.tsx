'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';

const AchievementSystem = dynamic(() => import('@/components/world-lens/AchievementSystem'), { ssr: false });

type ServerAch = {
  id: string; name: string; description: string; category: string;
  unlocked: boolean; progress: number; target: number;
  earnedAt?: string | null; worldImpact?: string;
};
type FrontendAch = {
  id: string; title: string; description: string; icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  category: 'Creation' | 'Validation' | 'Citation' | 'Social' | 'Exploration' | 'Mentorship' | 'Governance' | 'Mastery';
  unlocked: boolean; unlockDate?: string; worldImpact?: string;
};
type FrontendProgress = { achievementId: string; current: number; target: number };

const CATEGORY_MAP: Record<string, FrontendAch['category']> = {
  knowledge: 'Creation', creation: 'Creation', validation: 'Validation', citation: 'Citation',
  social: 'Social', exploration: 'Exploration', mentorship: 'Mentorship', governance: 'Governance', mastery: 'Mastery',
};

/** Achievements — /api/world/achievements/:userId + auth.whoami. */
export function AchievementsTabPanel() {
  const achievementsQ = useQuery({
    queryKey: ['self-achievements'],
    queryFn: async () => {
      const me = await apiHelpers.lens.runDomain('auth', 'whoami').catch(() => null);
      const userId = (me?.data?.result as { userId?: string } | undefined)?.userId
        ?? (me?.data as { userId?: string } | undefined)?.userId;
      if (!userId) return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
      try {
        const r = await fetch(`/api/world/achievements/${encodeURIComponent(userId)}`, {
          credentials: 'same-origin',
        });
        if (!r.ok) return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
        const j = (await r.json()) as { achievements?: ServerAch[] };
        const list = j.achievements ?? [];
        const achievements: FrontendAch[] = list.map((a) => ({
          id: a.id, title: a.name, description: a.description, icon: '⭐', rarity: 'common',
          category: CATEGORY_MAP[a.category] ?? 'Creation', unlocked: a.unlocked,
          unlockDate: a.earnedAt ? new Date(a.earnedAt).toLocaleDateString() : undefined,
          worldImpact: a.worldImpact,
        }));
        const progress: FrontendProgress[] = list.map((a) => ({
          achievementId: a.id, current: a.progress, target: a.target,
        }));
        return { achievements, progress };
      } catch {
        return { achievements: [] as FrontendAch[], progress: [] as FrontendProgress[] };
      }
    },
  });

  if (achievementsQ.isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-rose-500" />;
  }
  return (
    <AchievementSystem
      achievements={achievementsQ.data?.achievements ?? []}
      progress={achievementsQ.data?.progress ?? []}
    />
  );
}
