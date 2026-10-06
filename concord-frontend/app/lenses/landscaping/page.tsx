'use client';

/**
 * Landscaping: north-star chrome over the yard design studio, garden beds,
 * plant finder (with live species feed), pro calculators and job dispatch.
 */

import { useState } from 'react';
import { TreePine, Sprout, Flower2, Leaf, Calculator, CalendarClock } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { PlantFinder } from '@/components/landscaping/PlantFinder';
import { ProLandscape } from '@/components/landscaping/ProLandscape';
import { GardenStudio } from '@/components/landscaping/GardenStudio';
import { GardenBeds } from '@/components/landscaping/GardenBeds';
import { JobDispatchBoard } from '@/components/landscaping/JobDispatchBoard';

type PageTab = 'studio' | 'beds' | 'finder' | 'calculators' | 'jobs';

const PAGE_TABS: { id: PageTab; label: string; title: string; icon: typeof TreePine; hint: string }[] = [
  { id: 'studio', label: 'Garden Studio', title: 'Design your yard', icon: Sprout, hint: '1' },
  { id: 'beds', label: 'Garden Beds', title: 'What is growing where', icon: Flower2, hint: '2' },
  { id: 'finder', label: 'Plant Finder', title: 'Find the right plant', icon: Leaf, hint: '3' },
  { id: 'calculators', label: 'Pro Calculators', title: 'Quantities and costs', icon: Calculator, hint: '4' },
  { id: 'jobs', label: 'Jobs', title: 'The crew schedule', icon: CalendarClock, hint: '5' },
];

export default function LandscapingLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<PageTab>('studio');

  useLensCommand(
    [
      ...PAGE_TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.hint,
        description: t.label,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
    ],
    { lensId: 'landscaping' },
  );

  const current = PAGE_TABS.find((t) => t.id === tab)!;
  const card = 'rounded-2xl border border-white/10 bg-[#111] p-5';

  return (
    <LensShell lensId="landscaping" asMain={false}>
      <FirstRunTour lensId="landscaping" />
      <DepthBadge lensId="landscaping" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="landscaping"
        crumb="Landscaping"
        title={`${current.title}${tab === 'studio' && who ? `, ${who}` : ''}`}
        subtitle="Yard design studio, garden beds, plant lookup and pro landscaping calculators."
        tabs={PAGE_TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.hint }))}
        activeTab={tab}
        onTab={(id) => setTab(id as PageTab)}
        cta={{ label: 'New design', icon: Sprout, onClick: () => setTab('studio'), title: 'Start a new design' }}
      >
        {tab === 'studio' && <section className={card}><GardenStudio /></section>}
        {tab === 'beds' && <section className={card}><GardenBeds /></section>}
        {tab === 'finder' && (
          <div className="space-y-5">
            <section className={card}><PlantFinder /></section>
            <LensFeedButton domain="landscaping" label="Live plant species feed" />
          </div>
        )}
        {tab === 'calculators' && <ProLandscape />}
        {tab === 'jobs' && <section className={card}><JobDispatchBoard /></section>}
      </NorthStarFrame>
    </LensShell>
  );
}
