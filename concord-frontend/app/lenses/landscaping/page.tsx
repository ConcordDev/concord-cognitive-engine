'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { TreePine, Sprout, Flower2, Leaf, Calculator, CalendarClock } from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { PlantFinder } from '@/components/landscaping/PlantFinder';
import { ProLandscape } from '@/components/landscaping/ProLandscape';
import { GardenStudio } from '@/components/landscaping/GardenStudio';
import { GardenBeds } from '@/components/landscaping/GardenBeds';
import { JobDispatchBoard } from '@/components/landscaping/JobDispatchBoard';

type PageTab = 'studio' | 'beds' | 'finder' | 'calculators' | 'jobs';

const PAGE_TABS: { id: PageTab; label: string; icon: typeof TreePine; hint: string }[] = [
  { id: 'studio', label: 'Garden Studio', icon: Sprout, hint: '1' },
  { id: 'beds', label: 'Garden Beds', icon: Flower2, hint: '2' },
  { id: 'finder', label: 'Plant Finder', icon: Leaf, hint: '3' },
  { id: 'calculators', label: 'Pro Calculators', icon: Calculator, hint: '4' },
  { id: 'jobs', label: 'Jobs', icon: CalendarClock, hint: '5' },
];

export default function LandscapingLensPage() {
  const [tab, setTab] = useState<PageTab>('studio');

  useLensCommand(
    [
      { id: 'tab-studio', keys: '1', description: 'Garden Studio', category: 'navigation', action: () => setTab('studio') },
      { id: 'tab-beds', keys: '2', description: 'Garden Beds', category: 'navigation', action: () => setTab('beds') },
      { id: 'tab-finder', keys: '3', description: 'Plant Finder', category: 'navigation', action: () => setTab('finder') },
      { id: 'tab-calculators', keys: '4', description: 'Pro Calculators', category: 'navigation', action: () => setTab('calculators') },
      { id: 'tab-jobs', keys: '5', description: 'Jobs', category: 'navigation', action: () => setTab('jobs') },
    ],
    { lensId: 'landscaping' }
  );

  return (
    <LensShell lensId="landscaping" asMain={false}>
      <FirstRunTour lensId="landscaping" />      <DepthBadge lensId="landscaping" size="sm" className="ml-2" />
      <LensPageShell
        domain="landscaping"
        title="Landscaping"
        description="Yard design studio, garden beds, plant lookup, and pro landscaping calculators"
        headerIcon={<TreePine className="w-6 h-6" />}
      >
        <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
          {PAGE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                tab === t.id
                  ? 'bg-neon-blue/20 text-neon-blue'
                  : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
              )}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
              <kbd className="ml-1 rounded border border-white/10 bg-black/20 px-1 text-[10px] text-gray-500">
                {t.hint}
              </kbd>
            </button>
          ))}
        </nav>

        {tab === 'studio' && (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <GardenStudio />
          </section>
        )}
        {tab === 'beds' && (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <GardenBeds />
          </section>
        )}
        {tab === 'finder' && (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PlantFinder />
          </section>
        )}
        {tab === 'calculators' && (
          <section className="mt-6">
            <ProLandscape />
          </section>
        )}
        {tab === 'jobs' && (
          <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <JobDispatchBoard />
          </section>
        )}
      </LensPageShell>

      <a href="#landscaping-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to landscaping content</a>
      <section className="mt-4"><LensFeedButton domain="landscaping" label="Live plant species feed" /></section>
          <CrossLensRecentsPanel lensId="landscaping" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
