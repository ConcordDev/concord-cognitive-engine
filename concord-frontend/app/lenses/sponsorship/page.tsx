'use client';

/**
 * Sponsorship: north-star chrome over the creator-membership platform
 * (Patreon-shaped): tiered membership, discovery, billing, sponsor inbox,
 * creator hub, and GitHub open-source sponsorship. Currency: CC.
 */

import { useState } from 'react';
import { Compass, Heart, CreditCard, Inbox, Sparkles, GitBranch } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { SponsorRepos } from '@/components/sponsorship/SponsorRepos';
import { DiscoverPanel } from '@/components/sponsorship/DiscoverPanel';
import { MySponsorships } from '@/components/sponsorship/MySponsorships';
import { BillingDashboard } from '@/components/sponsorship/BillingDashboard';
import { SponsorInbox } from '@/components/sponsorship/SponsorInbox';
import { CreatorHub } from '@/components/sponsorship/CreatorHub';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Tab = 'discover' | 'memberships' | 'billing' | 'inbox' | 'creator' | 'repos';

const TABS: { id: Tab; label: string; keys: string; title: string; icon: typeof Compass }[] = [
  { id: 'discover', label: 'Discover', keys: 'g d', title: 'Creators worth backing', icon: Compass },
  { id: 'memberships', label: 'My memberships', keys: 'g m', title: 'Who you support', icon: Heart },
  { id: 'billing', label: 'Billing', keys: 'g b', title: 'What you have given', icon: CreditCard },
  { id: 'inbox', label: 'Inbox', keys: 'g i', title: 'Thank-yous and dispatches', icon: Inbox },
  { id: 'creator', label: 'Creator hub', keys: 'g c', title: 'Your supporters', icon: Sparkles },
  { id: 'repos', label: 'Open source', keys: 'g o', title: 'Back the code you use', icon: GitBranch },
];

export default function SponsorshipPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<Tab>('discover');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `sponsorship-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'sponsorship-find', keys: 'n', description: 'Find a creator to sponsor', category: 'actions' as const, action: () => setTab('discover') },
    ],
    { lensId: 'sponsorship' },
  );

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="sponsorship" asMain={false}>
      <FirstRunTour lensId="sponsorship" />
      <DepthBadge lensId="sponsorship" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="sponsorship"
        crumb="Sponsorship"
        title={`${current.title}${tab === 'discover' && who ? `, ${who}` : ''}`}
        subtitle="Support NPC-creators with recurring CC. Pick a tier, unlock sponsor-only dispatches, track billing and climb the leaderboard."
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, keys: t.keys, icon: t.icon }))}
        activeTab={tab}
        onTab={(id) => setTab(id as Tab)}
        cta={{ label: 'Find a creator', icon: Compass, onClick: () => setTab('discover'), title: 'Find a creator to sponsor (N)' }}
      >
        <div className="max-w-5xl">
          {tab === 'discover' && <DiscoverPanel onSubscribed={bump} />}
          {tab === 'memberships' && <MySponsorships refreshKey={refreshKey} onChange={bump} />}
          {tab === 'billing' && <BillingDashboard refreshKey={refreshKey} />}
          {tab === 'inbox' && <SponsorInbox refreshKey={refreshKey} />}
          {tab === 'creator' && <CreatorHub />}
          {tab === 'repos' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
              <SponsorRepos />
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
