'use client';

/**
 * Event Timeline — one substrate firehose desk.
 * Thin shell: single `active` union → panels. Macros live in FirehosePanel /
 * MyOnThisDay / OnThisDay / SavedViewsBar / EventDetailPanel / ChannelTrends.
 */

import { useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, CalendarDays, BookOpen } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
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
  const reduceMotion = useReducedMotion();
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

  const Panel = PANELS[active];

  return (
    <LensShell lensId="event-timeline" asMain={false}>
      <FirstRunTour lensId="event-timeline" />
      <DepthBadge lensId="event-timeline" size="sm" className="ml-2" />
      <div className="min-h-screen bg-zinc-950 px-4 py-8 text-zinc-100 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <header className="mb-6">
            <h1 className="mb-1 text-2xl font-semibold">Substrate Event Timeline</h1>
            <p className="text-sm text-zinc-400">
              The full firehose of substrate events — combat, quests, NPCs, world-state,
              cross-world plots, cognition. Search, filter, drill into any event, and
              export the slice you care about.
            </p>
          </header>

          <nav
            className="mb-4 flex gap-1 border-b border-zinc-800 overflow-x-auto"
            aria-label="Event timeline views"
          >
            {VIEWS.map(({ id, label, keys, icon: Icon }) => {
              const on = active === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActive(id)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px whitespace-nowrap',
                    on
                      ? 'border-indigo-500 text-indigo-300'
                      : 'border-transparent text-zinc-400 hover:text-zinc-300',
                  )}
                  aria-current={on ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" /> {label}
                  <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                    {keys}
                  </kbd>
                </button>
              );
            })}
          </nav>

          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              {active === 'my-day' || active === 'on-this-day' ? (
                <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                  <Panel />
                </section>
              ) : (
                <Panel />
              )}
            </motion.div>
          </AnimatePresence>

          <CrossLensRecentsPanel
            lensId="event-timeline"
            sinceDays={7}
            limit={6}
            hideWhenEmpty
            className="mt-3"
          />
        </div>
      </div>
    </LensShell>
  );
}
