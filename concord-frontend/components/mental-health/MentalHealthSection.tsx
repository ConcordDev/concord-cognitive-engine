'use client';

/**
 * MentalHealthSection — Calm + Headspace 2026-shape mindfulness
 * companion. Tab chrome owns nav state; panels hydrate via lensRun().
 * Not medical advice.
 */

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Flower2, SmilePlus, Moon, NotebookPen, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MhPracticePanel } from './MhPracticePanel';
import { MhMoodPanel } from './MhMoodPanel';
import { MhSleepPanel } from './MhSleepPanel';
import { MhReflectPanel } from './MhReflectPanel';

interface Dash {
  streak: number; sessionsThisWeek: number; minutesThisWeek: number;
  latestMood: number | null; avgSleepHours: number | null; activeCourses: number; gratitudeEntries: number;
}
type TabId = 'practice' | 'mood' | 'sleep' | 'reflect';
const TABS: { id: TabId; label: string; icon: typeof Flower2 }[] = [
  { id: 'practice', label: 'Practice', icon: Flower2 },
  { id: 'mood', label: 'Mood', icon: SmilePlus },
  { id: 'sleep', label: 'Sleep', icon: Moon },
  { id: 'reflect', label: 'Reflect', icon: NotebookPen },
];

export function MentalHealthSection() {
  const [tab, setTab] = useState<TabId>('practice');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('mental-health', 'wellness-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-sky-600/15 to-transparent">
        <Sparkles className="w-5 h-5 text-sky-400" />
        <h2 className="text-sm font-bold text-zinc-100">Mindfulness</h2>
        <span className="text-[11px] text-zinc-500">Calm + Headspace shape · not medical advice</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Day streak" value={dash.streak} />
          <Stat label="Sessions/wk" value={dash.sessionsThisWeek} />
          <Stat label="Minutes/wk" value={dash.minutesThisWeek} />
          <Stat label="Latest mood" value={dash.latestMood != null ? `${dash.latestMood}/5` : '—'} />
          <Stat label="Avg sleep" value={dash.avgSleepHours != null ? `${dash.avgSleepHours}h` : '—'} />
          <Stat label="Courses" value={dash.activeCourses} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-sky-500',
                active ? 'bg-zinc-900 text-sky-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'practice' && <MhPracticePanel onChange={refreshDash} />}
        {tab === 'mood' && <MhMoodPanel onChange={refreshDash} />}
        {tab === 'sleep' && <MhSleepPanel onChange={refreshDash} />}
        {tab === 'reflect' && <MhReflectPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}
