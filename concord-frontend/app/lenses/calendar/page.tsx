'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GCalSection } from '@/components/calendar/GCalSection';
import { TimezoneTools } from '@/components/calendar/TimezoneTools';
import { ScheduleAnalyzer } from '@/components/calendar/ScheduleAnalyzer';
import { AppointmentSchedules } from '@/components/calendar/AppointmentSchedules';
import { CalendarParityHub } from '@/components/calendar/CalendarParityHub';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CalendarActionPanel } from '@/components/calendar/CalendarActionPanel';
import { CalendarGridWorkbench } from '@/components/calendar/CalendarGridWorkbench';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';
import { CalendarDays, Clock, Share2, Globe, Sparkles, Wrench } from 'lucide-react';
import { DensityToggle } from '@/components/ui/DensityToggle';

/** Linear / Fantastical: the grid is the product; tools are views, not accordions. */
export type CalendarView = 'calendar' | 'google' | 'book' | 'sync' | 'analyze' | 'tools' | 'bench';

const VIEWS: { id: CalendarView; label: string; icon: typeof CalendarDays }[] = [
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'google', label: 'Google + tasks', icon: Sparkles },
  { id: 'book', label: 'Booking pages', icon: Clock },
  { id: 'sync', label: 'Sync & share', icon: Share2 },
  { id: 'analyze', label: 'Conflicts', icon: Sparkles },
  { id: 'tools', label: 'Timezones', icon: Globe },
  { id: 'bench', label: 'Scheduler', icon: Wrench },
];

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function CalendarLensPage() {
  useLensNav('calendar');
  useLensIdentity('calendar');
  const [activeView, setActive] = useState<CalendarView>('calendar');
  const reduced = prefersReducedMotion();

  useLensCommand(
    [
      { id: 'cal-grid', keys: 'g', description: 'Calendar grid', category: 'navigation', action: () => setActive('calendar') },
      { id: 'cal-google', keys: 'o', description: 'Google + tasks', category: 'navigation', action: () => setActive('google') },
      { id: 'cal-book', keys: 'b', description: 'Booking pages', category: 'navigation', action: () => setActive('book') },
      { id: 'cal-sync', keys: 's', description: 'Sync & share', category: 'navigation', action: () => setActive('sync') },
      { id: 'cal-analyze', keys: 'c', description: 'Conflicts', category: 'navigation', action: () => setActive('analyze') },
    ],
    { lensId: 'calendar' },
  );

  return (
    <LensShell lensId="calendar" asMain={false}>
      <FirstRunTour lensId="calendar" />
      <DepthBadge lensId="calendar" size="sm" className="ml-2" />
      <div data-lens-theme="calendar" className="flex flex-col min-h-[calc(100vh-4rem)]">
        <header className="flex items-center justify-between gap-3 px-4 py-2 border-b border-lattice-border">
          <div className="flex items-center gap-3 min-w-0">
            <CalendarDays className="w-5 h-5 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight">Calendar</h1>
              <p className="text-[11px] text-gray-400 truncate">
                Fantastical density — month, week, day, agenda.
                <kbd className="ml-2 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">G</kbd> grid
                <kbd className="ml-1 px-1 py-0.5 rounded bg-black/30 font-mono text-[10px]">N</kbd> new
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DensityToggle />
            <nav className="flex items-center gap-0.5 overflow-x-auto" aria-label="Calendar views">
              {VIEWS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActive(tab.id)}
                  className={cn(
                    'px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors',
                    activeView === tab.id
                      ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30'
                      : 'text-gray-400 hover:text-white border border-transparent',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeView}
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduced ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 min-h-0"
          >
            {activeView === 'calendar' && <CalendarGridWorkbench />}
            {activeView === 'google' && (
              <div className="p-4">
                <GCalSection />
              </div>
            )}
            {activeView === 'book' && (
              <div className="p-4">
                <AppointmentSchedules />
              </div>
            )}
            {activeView === 'sync' && (
              <div className="p-4">
                <CalendarParityHub />
              </div>
            )}
            {activeView === 'analyze' && (
              <div className="p-4">
                <ScheduleAnalyzer />
              </div>
            )}
            {activeView === 'tools' && (
              <div className="p-4">
                <TimezoneTools />
              </div>
            )}
            {activeView === 'bench' && (
              <div className="p-4 space-y-3">
                <LensFeedButton domain="calendar" />
                <PipingProvider>
                  <CalendarActionPanel />
                </PipingProvider>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="px-4 pb-3">
          <CrossLensRecentsPanel lensId="calendar" sinceDays={7} limit={6} hideWhenEmpty />
        </div>
      </div>
    </LensShell>
  );
}
