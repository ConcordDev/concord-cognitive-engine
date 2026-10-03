'use client';

/**
 * Meditation — one Calm/Headspace practice app.
 * Thin shell + single `active` union. Session player + studio screens are panels.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="meditation"
        crumb="Meditation"
        title={`Take a breath${who ? `, ${who}` : ''}`}
        subtitle="A quiet session player and streak. Tap a goal, pick a length, breathe."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as MedView)}
        tabsLabel="Meditation views"
        cta={{ label: 'Begin a session', icon: Wind, onClick: () => setActive('session'), title: 'Open the session player (1)' }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
