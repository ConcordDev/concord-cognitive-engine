'use client';

import { useState, useRef } from 'react';
import { Baby, ListChecks, Wand2, Users2, CalendarRange } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { ParentingSection } from '@/components/parenting/ParentingSection';
import { ChildBriefPanel } from '@/components/parenting/ChildBriefPanel';
import { ParentingFeed } from '@/components/parenting/ParentingFeed';
import { PgFamilyCalendarPanel } from '@/components/parenting/PgFamilyCalendarPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type Destination = 'care' | 'calendar' | 'brief' | 'community';

const DESTINATIONS: { id: Destination; label: string; icon: typeof Baby; hotkey: string; description: string }[] = [
  { id: 'care', label: 'Baby Care', icon: ListChecks, hotkey: '1', description: 'Children, one-touch logging, growth, milestones, appointments, caregiver sharing' },
  { id: 'calendar', label: 'Family Calendar', icon: CalendarRange, hotkey: '2', description: 'General shared family events — activities, school, travel — family-wide or tagged to a child' },
  { id: 'brief', label: 'Quick Actions & Brief', icon: Wand2, hotkey: '3', description: 'Milestone/routine calculator, snapshot DTU, caregiver DM, agent developmental brief' },
  { id: 'community', label: 'Community & Safety', icon: Users2, hotkey: '4', description: 'Real-world parenting chatter + child-product safety recalls' },
];

export default function ParentingLensPage() {
  useLensNav('parenting');

  const [destination, setDestination] = useState<Destination>('care');
  const shellRef = useRef<HTMLDivElement>(null);

  useLensCommand(
    DESTINATIONS.map((d) => ({
      id: `dest-${d.id}`,
      keys: d.hotkey,
      description: d.label,
      category: 'navigation' as const,
      action: () => setDestination(d.id),
    })),
    { lensId: 'parenting' }
  );

  return (
    <LensShell lensId="parenting" asMain={false}>
      <FirstRunTour lensId="parenting" />
      <a href="#parenting-content" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to parenting content
      </a>

      <div data-lens-theme="parenting" className="space-y-5 p-6" ref={shellRef}>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center">
              <Baby className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Parenting</h1>
                <DepthBadge lensId="parenting" size="sm" />
              </div>
              <p className={ds.textMuted}>Baby &amp; child tracking — feeds, sleep, diapers, growth, milestones, immunizations, and caregiver coordination. Not medical advice.</p>
            </div>
          </div>
          <DTUExportButton domain="parenting" data={{}} compact />
        </header>

        <nav role="tablist" aria-label="Parenting destinations" className="flex flex-wrap gap-2">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const active = destination === d.id;
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`parenting-panel-${d.id}`}
                onClick={() => setDestination(d.id)}
                title={d.description}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500',
                  active ? 'bg-rose-600 text-white' : 'bg-lattice-surface text-gray-400 hover:text-white hover:bg-lattice-elevated border border-lattice-border'
                )}
              >
                <Icon className="w-4 h-4" />
                {d.label}
                <span className="text-[10px] opacity-60 font-mono">{d.hotkey}</span>
              </button>
            );
          })}
        </nav>

        <main id="parenting-content">
          <div id="parenting-panel-care" role="tabpanel" hidden={destination !== 'care'}>
            {destination === 'care' && <ParentingSection />}
          </div>

          <div id="parenting-panel-calendar" role="tabpanel" hidden={destination !== 'calendar'}>
            {destination === 'calendar' && <PgFamilyCalendarPanel />}
          </div>

          <div id="parenting-panel-brief" role="tabpanel" hidden={destination !== 'brief'}>
            {destination === 'brief' && <ChildBriefPanel />}
          </div>

          <div id="parenting-panel-community" role="tabpanel" hidden={destination !== 'community'}>
            {destination === 'community' && (
              <div className="space-y-4">
                <LensFeedButton domain="parenting" label="Child-safety product recalls (CPSC)" />
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <ParentingFeed />
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </LensShell>
  );
}
