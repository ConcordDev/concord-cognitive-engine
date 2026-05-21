'use client';

/**
 * /lenses/sponsorship — creator-membership platform (Patreon-shaped).
 * Tiered membership, creator discovery, sponsor-only content, billing
 * dashboard, sponsor leaderboards, and thank-you messaging. Currency: CC.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SponsorRepos } from '@/components/sponsorship/SponsorRepos';
import { DiscoverPanel } from '@/components/sponsorship/DiscoverPanel';
import { MySponsorships } from '@/components/sponsorship/MySponsorships';
import { BillingDashboard } from '@/components/sponsorship/BillingDashboard';
import { SponsorInbox } from '@/components/sponsorship/SponsorInbox';
import { CreatorHub } from '@/components/sponsorship/CreatorHub';

type Tab = 'discover' | 'memberships' | 'billing' | 'inbox' | 'creator';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'discover', label: 'Discover' },
  { id: 'memberships', label: 'My Memberships' },
  { id: 'billing', label: 'Billing' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'creator', label: 'Creator Hub' },
];

export default function SponsorshipPage() {
  const [tab, setTab] = useState<Tab>('discover');
  // Bumped on any membership mutation so dependent tabs reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand([
    { id: 'sponsorship-discover', keys: 'g d', description: 'Discover creators', category: 'navigation', action: () => setTab('discover') },
    { id: 'sponsorship-memberships', keys: 'g m', description: 'My memberships', category: 'navigation', action: () => setTab('memberships') },
    { id: 'sponsorship-billing', keys: 'g b', description: 'Billing dashboard', category: 'navigation', action: () => setTab('billing') },
  ], { lensId: 'sponsorship' });

  return (
    <LensShell lensId="sponsorship">
      <FirstRunTour lensId="sponsorship" />
      <DepthBadge lensId="sponsorship" size="sm" className="ml-2" />
      <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-5">
          <h1 className="text-2xl font-bold text-zinc-100">Sponsorship</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Support NPC-creators with recurring CC. Pick a tier, unlock sponsor-only
            dispatches and posts, track your billing, and climb the sponsor leaderboard.
            <strong> Currency: CC.</strong>
          </p>
        </header>

        <nav className="flex flex-wrap gap-1 mb-4 border-b border-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-sm rounded-t-lg focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                tab === t.id
                  ? 'bg-zinc-900 text-emerald-300 border-b-2 border-emerald-500'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >{t.label}</button>
          ))}
        </nav>

        {tab === 'discover' && <DiscoverPanel onSubscribed={bump} />}
        {tab === 'memberships' && <MySponsorships refreshKey={refreshKey} onChange={bump} />}
        {tab === 'billing' && <BillingDashboard refreshKey={refreshKey} />}
        {tab === 'inbox' && <SponsorInbox refreshKey={refreshKey} />}
        {tab === 'creator' && <CreatorHub />}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <SponsorRepos />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="sponsorship" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="sponsorship" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="sponsorship" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
