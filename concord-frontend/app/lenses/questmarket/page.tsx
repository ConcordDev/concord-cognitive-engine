'use client';

/**
 * Questmarket — bounty-board rebuild (Frontend Rebuild Program, Wave 2).
 *
 * Reference target: Gitcoin Bounties (post → escrow → accept → submit →
 * approve → payout, on a real balance) crossed with the RPG-guild
 * gamification layer of a tool like Habitica (reputation ranks, streaks,
 * achievements, guilds). See docs/lens-specs/questmarket-capability-map.md
 * for the full researched checklist and disposition of every item.
 *
 * Every tab below dispatches real `questmarket` macros — accept/submit/
 * verify moves real escrowed CC between real per-user wallets in the
 * lens-local ledger; nothing here is a fabricated success state.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  Swords, Target, Trophy, TrendingUp, Gift, Shield, FileCheck2, ShieldCheck,
  Compass,
} from 'lucide-react';

import { MarketHeader } from '@/components/questmarket/MarketHeader';
import { QuestBoard } from '@/components/questmarket/QuestBoard';
import { MyClaimsPanel } from '@/components/questmarket/MyClaimsPanel';
import { VerifyQueue } from '@/components/questmarket/VerifyQueue';
import { ReputationCard } from '@/components/questmarket/ReputationCard';
import { AchievementShowcase } from '@/components/questmarket/AchievementShowcase';
import { LeaderboardPanel } from '@/components/questmarket/LeaderboardPanel';
import { GuildsPanel } from '@/components/questmarket/GuildsPanel';
import { RewardsPanel } from '@/components/questmarket/RewardsPanel';
import { BountiesFeed } from '@/components/questmarket/BountiesFeed';
import { PlanningTools } from '@/components/questmarket/PlanningTools';

type Tab =
  | 'quests' | 'claims' | 'verify' | 'bounties'
  | 'achievements' | 'leaderboard' | 'rewards' | 'guilds' | 'planner';

export default function QuestmarketLensPage() {
  const [tab, setTab] = useState<Tab>('quests');
  // Bumping this key forces wallet / stats / reputation / achievements to
  // re-fetch after any transactional macro mutates server state.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Real badge counts (posted quests awaiting your verdict, your own
  // active claims) — a single lightweight marketStats + myClaims poll,
  // re-fetched whenever a transactional action bumps refreshKey.
  const [pendingVerify, setPendingVerify] = useState(0);
  const [activeClaims, setActiveClaims] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stats, mine] = await Promise.all([
        lensRun<{ pendingVerification: number }>('questmarket', 'marketStats', {}),
        lensRun<{ claims: Array<{ status: string }> }>('questmarket', 'myClaims', {}),
      ]);
      if (cancelled) return;
      if (stats.data?.ok) setPendingVerify(stats.data.result?.pendingVerification ?? 0);
      if (mine.data?.ok) {
        setActiveClaims((mine.data.result?.claims || []).filter((c) => c.status === 'accepted' || c.status === 'submitted').length);
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  const TABS: { id: Tab; label: string; icon: typeof Target; badge?: number }[] = [
    { id: 'quests', label: 'Quest Board', icon: Swords },
    { id: 'claims', label: 'My Claims', icon: FileCheck2, badge: activeClaims || undefined },
    { id: 'verify', label: 'Verify', icon: ShieldCheck, badge: pendingVerify || undefined },
    { id: 'bounties', label: 'Bounties', icon: Target },
    { id: 'achievements', label: 'Achievements', icon: Trophy },
    { id: 'leaderboard', label: 'Leaderboard', icon: TrendingUp },
    { id: 'rewards', label: 'Economy', icon: Gift },
    { id: 'guilds', label: 'Guilds', icon: Shield },
    { id: 'planner', label: 'Planner', icon: Compass },
  ];

  useLensCommand(
    TABS.map((t) => ({
      id: `goto-${t.id}`, keys: `g ${t.id[0]}`, description: `Go to ${t.label}`,
      category: 'navigation', action: () => setTab(t.id),
    })),
    { lensId: 'questmarket' },
  );

  return (
    <LensShell lensId="questmarket" asMain={false}>
      <FirstRunTour lensId="questmarket" />
      <div className="p-6 space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Target className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">Questmarket</h1>
                <DepthBadge lensId="questmarket" size="sm" />
              </div>
              <p className="text-sm text-gray-400">
                A transactional quest &amp; bounty marketplace — escrowed CC, accept → submit → verify
                lifecycle, reputation, achievements, and guilds.
              </p>
            </div>
          </div>
        </header>

        <MarketHeader refreshKey={refreshKey} />

        <nav className="flex flex-wrap items-center gap-2 border-b border-lattice-border pb-3" aria-label="Questmarket destinations">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className={cn(
                'relative flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              {!!t.badge && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-black">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        {tab === 'quests' && (
          <QuestBoard kind="quest" onChanged={bump} />
        )}

        {tab === 'claims' && (
          <MyClaimsPanel onChanged={bump} />
        )}

        {tab === 'verify' && (
          <VerifyQueue onChanged={bump} />
        )}

        {tab === 'bounties' && (
          <div className="space-y-6">
            <QuestBoard kind="bounty" onChanged={bump} />
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <BountiesFeed />
            </section>
          </div>
        )}

        {tab === 'achievements' && (
          <div className="space-y-4">
            <ReputationCard refreshKey={refreshKey} />
            <AchievementShowcase refreshKey={refreshKey} />
          </div>
        )}

        {tab === 'leaderboard' && (
          <LeaderboardPanel refreshKey={refreshKey} />
        )}

        {tab === 'rewards' && (
          <RewardsPanel refreshKey={refreshKey} />
        )}

        {tab === 'guilds' && (
          <GuildsPanel onChanged={bump} />
        )}

        {tab === 'planner' && (
          <PlanningTools />
        )}
      </div>

      {/* Accessibility skip-link sentinel — never visually displayed. */}
      <a href="#questmarket-skip"
        className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500">
        Skip to questmarket content
      </a>
    </LensShell>
  );
}
