'use client';

/**
 * Meditation — one Calm/Headspace practice app.
 * Thin shell + single `active` union. Session player + studio screens are panels.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SessionPlayerPanel } from '@/components/meditation/SessionPlayerPanel';
import { MeditationStudio } from '@/components/meditation/MeditationStudio';
import { BreathingVisual } from '@/components/meditation/BreathingVisual';
import { SoundscapePlayer } from '@/components/meditation/SoundscapePlayer';
import { CoursesPanel } from '@/components/meditation/CoursesPanel';
import { RemindersPanel } from '@/components/meditation/RemindersPanel';
import { InsightsPanel } from '@/components/meditation/InsightsPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Wind, Sparkles, Volume2, GraduationCap, Bell, Lightbulb, type LucideIcon,
} from 'lucide-react';

type MedView = 'session' | 'studio' | 'breathe' | 'sounds' | 'courses' | 'reminders' | 'insights';

const VIEWS: { id: MedView; label: string; keys: string; icon: LucideIcon }[] = [
  { id: 'session', label: 'Session', keys: '1', icon: Wind },
  { id: 'studio', label: 'Library', keys: '2', icon: Sparkles },
  { id: 'breathe', label: 'Breathe', keys: '3', icon: Wind },
  { id: 'sounds', label: 'Sounds', keys: '4', icon: Volume2 },
  { id: 'courses', label: 'Courses', keys: '5', icon: GraduationCap },
  { id: 'reminders', label: 'Reminders', keys: '6', icon: Bell },
  { id: 'insights', label: 'For You', keys: '7', icon: Lightbulb },
];

export default function MeditationLensPage() {
  useLensNav('meditation');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<MedView>('session');
  const [practiceTick, setPracticeTick] = useState(0);
  const notifyPractice = () => setPracticeTick((t) => t + 1);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'meditation' },
  );

  return (
    <LensShell lensId="meditation" asMain={false}>
      <FirstRunTour lensId="meditation" />
      <DepthBadge lensId="meditation" size="sm" className="ml-2" />
      <div data-lens-theme="meditation" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Wind className="w-6 h-6 text-purple-400" />
            </div>
            <div className="min-w-0">
              <h1 className={ds.heading1}>Meditation</h1>
              <p className={ds.textMuted}>
                A quiet session player + streak. Tap a goal, pick a length, breathe.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Meditation views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
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
            className="pt-4"
          >
            {active === 'session' && <SessionPlayerPanel practiceTick={practiceTick} />}
            {active === 'studio' && <MeditationStudio onPractice={notifyPractice} />}
            {active === 'breathe' && <BreathingVisual onPractice={notifyPractice} />}
            {active === 'sounds' && <SoundscapePlayer />}
            {active === 'courses' && <CoursesPanel onPractice={notifyPractice} />}
            {active === 'reminders' && <RemindersPanel />}
            {active === 'insights' && <InsightsPanel onPlayed={notifyPractice} />}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="meditation" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
