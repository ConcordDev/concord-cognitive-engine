'use client';

import { useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import {
  Swords, Target, Trophy, TrendingUp, Gift, Shield, FileCheck2, ShieldCheck,
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

type Tab =
  | 'quests' | 'claims' | 'verify' | 'bounties'
  | 'achievements' | 'leaderboard' | 'rewards' | 'guilds';

const TABS: { id: Tab; label: string; icon: typeof Target }[] = [
  { id: 'quests', label: 'Quest Board', icon: Swords },
  { id: 'claims', label: 'My Claims', icon: FileCheck2 },
  { id: 'verify', label: 'Verify', icon: ShieldCheck },
  { id: 'bounties', label: 'Bounties', icon: Target },
  { id: 'achievements', label: 'Achievements', icon: Trophy },
  { id: 'leaderboard', label: 'Leaderboard', icon: TrendingUp },
  { id: 'rewards', label: 'Rewards', icon: Gift },
  { id: 'guilds', label: 'Guilds', icon: Shield },
];

export default function QuestmarketLensPage() {
  const searchRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [{
      id: 'focus-search', keys: '/', description: 'Focus search',
      category: 'navigation', action: () => searchRef.current?.focus(),
    }],
    { lensId: 'questmarket' },
  );

  const [tab, setTab] = useState<Tab>('quests');
  // Bumping this key forces wallet / stats / reputation / achievements to
  // re-fetch after any transactional macro mutates server state.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <LensShell lensId="questmarket" asMain={false}>
      <FirstRunTour lensId="questmarket" />
      <ManifestActionBar />
      <DepthBadge lensId="questmarket" size="sm" className="ml-2" />
      <LensPageShell
        domain="questmarket"
        title="Questmarket"
        description="A transactional quest & bounty marketplace — escrowed CC, accept → submit → verify lifecycle, reputation, achievements and guilds."
        headerIcon={<Target className="w-5 h-5 text-white" />}
      >
        <UniversalActions domain="questmarket" artifactId={null} compact />

        <MarketHeader refreshKey={refreshKey} />

        <nav className="flex flex-wrap items-center gap-2 border-b border-lattice-border pb-3">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-gray-400 hover:bg-lattice-elevated hover:text-white',
              )}
            >
              <t.icon className="h-4 w-4" />
              {t.label}
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
      </LensPageShell>

      {/* Accessibility skip-link sentinels — never visually displayed */}
      <div className="sr-only" aria-hidden="true">
        Questmarket lens — quests, claims, verification, bounties, achievements, leaderboard, rewards, guilds.
      </div>
      <a href="#questmarket-skip"
        className="sr-only focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-amber-500">
        Skip to questmarket content
      </a>
      <RecentMineCard domain="questmarket" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="questmarket" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="questmarket" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
