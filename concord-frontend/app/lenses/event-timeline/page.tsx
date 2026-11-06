'use client';

/**
 * Event Timeline — one substrate firehose desk.
 * Thin shell: single `active` union → panels. Macros live in FirehosePanel /
 * MyOnThisDay / OnThisDay / SavedViewsBar / EventDetailPanel / ChannelTrends.
 */

import { useState, type ComponentType } from 'react';
import { Activity, CalendarDays, BookOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { FirehosePanel } from '@/components/event-timeline/FirehosePanel';
import { MyOnThisDay } from '@/components/event-timeline/MyOnThisDay';
import { OnThisDay } from '@/components/event-timeline/OnThisDay';

type TimelineView = 'firehose' | 'my-day' | 'on-this-day';

const VIEWS: { id: TimelineView; label: string; keys: string; icon: typeof Activity }[] = [
  { id: 'firehose', label: 'Firehose', keys: '1', icon: Activity },
  { id: 'my-day', label: 'My on this day', keys: '2', icon: CalendarDays },
  { id: 'on-this-day', label: 'Wikipedia OTD', keys: '3', icon: BookOpen },
];

const PANELS: Record<TimelineView, ComponentType> = {
  firehose: FirehosePanel,
  'my-day': MyOnThisDay,
  'on-this-day': OnThisDay,
};

export default function EventTimelineLens() {
  useLensNav('event-timeline');
  const [active, setActive] = useState<TimelineView>('firehose');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'event-timeline' },
  );

  return (
    <LensShell lensId="event-timeline" asMain={false}>

      <DepthBadge lensId="event-timeline" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="event-timeline"
        crumb="Timeline"
        subtitle="The full firehose of substrate events: combat, quests, NPCs, world-state, cross-world plots, cognition. Search, filter, drill into any event, and export the slice you care about."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as TimelineView)}
        tabsLabel="Event timeline views"
        cta={{ label: 'Open firehose', icon: Activity, onClick: () => setActive('firehose'), title: 'Open the live firehose (1)' }}
      >
        <div className="max-w-6xl">
          {/* Panels stay MOUNTED across view switches (inactive hidden):
              the pass found the OTD view's date/category state reset on
              re-entry because the switch unmounted the panel. The
              crossfade went with the unmount. */}
          {(Object.keys(PANELS) as TimelineView[]).map((id) => {
            const PanelForView = PANELS[id];
            const wrapped = id === 'my-day' || id === 'on-this-day';
            return (
              <div key={id} hidden={active !== id}>
                {wrapped ? (
                  <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                    <PanelForView />
                  </section>
                ) : (
                  <PanelForView />
                )}
              </div>
            );
          })}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
