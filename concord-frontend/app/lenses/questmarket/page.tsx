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
 * verify moves escrowed quest credits (QC) between per-user balances in the
 * lens-local ledger; nothing here is a fabricated success state.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';
import {
  Swords, Target, Trophy, TrendingUp, Gift, Shield, FileCheck2, ShieldCheck,
  Compass, Plus,
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const TITLES: Record<Tab, string> = {
    quests: `Pick your next quest${who ? `, ${who}` : ''}`,
    claims: 'Work your claims',
    verify: 'Judge the submissions',
    bounties: 'Hunt the bounties',
    achievements: 'Earn your rank',
    leaderboard: 'See who leads',
    rewards: 'Run your economy',
    guilds: 'Rally your guild',
    planner: 'Plan the campaign',
  };

  return (
    <LensShell lensId="questmarket" asMain={false}>
      <FirstRunTour lensId="questmarket" />
      <DepthBadge lensId="questmarket" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="questmarket"
        crumb="Questmarket"
        title={TITLES[tab]}
        subtitle="Escrowed quest credits (QC), accept → submit → verify lifecycle, reputation, achievements, and guilds"
        tabs={TABS.map((t) => ({
          id: t.id,
          label: t.badge ? `${t.label} · ${t.badge}` : t.label,
          icon: t.icon,
        }))}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        tabsLabel="Questmarket destinations"
        cta={{ label: 'Post a quest', icon: Plus, onClick: () => setTab('quests'), title: 'Open the quest board to post a quest' }}
      >
        <div className="space-y-6">
        <MarketHeader refreshKey={refreshKey} />


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
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
      </NorthStarFrame>

      {/* Accessibility skip-link sentinel — never visually displayed. */}
      <a href="#questmarket-skip"
        className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500">
        Skip to questmarket content
      </a>
    </LensShell>
  );
}
