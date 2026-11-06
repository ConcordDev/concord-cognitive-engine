'use client';

/**
 * Meditation — one Calm/Headspace practice app.
 * Thin shell + single `active` union. Session player + studio screens are panels.
 *
 * All seven views stay MOUNTED (inactive ones hidden): a running
 * session or breathwork pacer must survive a view switch — the old
 * keyed remount discarded an in-progress session outright (F3). A
 * page reload still restarts a session; the player says so.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SessionPlayerPanel, type PractisePreset } from '@/components/meditation/SessionPlayerPanel';
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
  const [active, setActive] = useState<MedView>('session');
  const [practiceTick, setPracticeTick] = useState(0);
  const notifyPractice = () => setPracticeTick((t) => t + 1);
  // A course day's Practise action routes here: the day's own session
  // is loaded into the Session player, and the page holds the pending
  // course day until the performed log completes it server-side.
  const [preset, setPreset] = useState<PractisePreset | null>(null);
  const beginPractise = (p0: PractisePreset) => { setPreset(p0); setActive('session'); };

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

      <DepthBadge lensId="meditation" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="meditation"
        crumb="Meditation"
        subtitle="A quiet session player and streak. Tap a goal, pick a length, breathe."
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as MedView)}
        tabsLabel="Meditation views"
        cta={{ label: 'Begin a session', icon: Wind, onClick: () => setActive('session'), title: 'Open the session player (1)' }}
      >
        <div className="pt-4">
          <div hidden={active !== 'session'}>
            <SessionPlayerPanel practiceTick={practiceTick} preset={preset} onPresetExit={() => { setPreset(null); setActive('courses'); }} />
          </div>
          <div hidden={active !== 'studio'}><MeditationStudio onPractice={notifyPractice} /></div>
          <div hidden={active !== 'breathe'}><BreathingVisual onPractice={notifyPractice} /></div>
          <div hidden={active !== 'sounds'}><SoundscapePlayer /></div>
          <div hidden={active !== 'courses'}><CoursesPanel onPractice={notifyPractice} onPractise={beginPractise} /></div>
          <div hidden={active !== 'reminders'}><RemindersPanel /></div>
          <div hidden={active !== 'insights'}><InsightsPanel onPlayed={notifyPractice} /></div>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
