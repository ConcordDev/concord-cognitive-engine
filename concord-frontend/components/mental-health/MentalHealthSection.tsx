'use client';

/**
 * MentalHealthSection — Calm + Headspace 2026-shape mindfulness
 * companion. Tab chrome owns nav state; panels hydrate via lensRun().
 * Not medical advice.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Sparkles, Flower2, SmilePlus, Moon, NotebookPen, Loader2,
  MessageCircleHeart, Tags, CalendarDays, Bell, ClipboardList, ShieldCheck, FileText,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { MhPracticePanel } from './MhPracticePanel';
import { MhMoodPanel } from './MhMoodPanel';
import { MhSleepPanel } from './MhSleepPanel';
import { MhReflectPanel } from './MhReflectPanel';
import { MhCompanionPanel } from './MhCompanionPanel';
import { MhFactorsPanel } from './MhFactorsPanel';
import { MhCalendarPanel } from './MhCalendarPanel';
import { MhRemindersPanel } from './MhRemindersPanel';
import { MhWorksheetsPanel } from './MhWorksheetsPanel';
import { MhSafetyPlanPanel } from './MhSafetyPlanPanel';
import { MhReportPanel } from './MhReportPanel';

interface Dash {
  streak: number; sessionsThisWeek: number; minutesThisWeek: number;
  latestMood: number | null; avgSleepHours: number | null; activeCourses: number; gratitudeEntries: number;
}
type TabId =
  | 'practice' | 'mood' | 'sleep' | 'reflect'
  | 'companion' | 'factors' | 'calendar' | 'reminders' | 'worksheets' | 'safety' | 'report';
const TABS: { id: TabId; label: string; icon: typeof Flower2 }[] = [
  { id: 'practice', label: 'Practice', icon: Flower2 },
  { id: 'mood', label: 'Mood', icon: SmilePlus },
  { id: 'sleep', label: 'Sleep', icon: Moon },
  { id: 'reflect', label: 'Reflect', icon: NotebookPen },
  { id: 'companion', label: 'Companion', icon: MessageCircleHeart },
  { id: 'factors', label: 'Factors', icon: Tags },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'worksheets', label: 'Worksheets', icon: ClipboardList },
  { id: 'safety', label: 'Safety plan', icon: ShieldCheck },
  { id: 'report', label: 'Report', icon: FileText },
];

export function MentalHealthSection() {
  const [tab, setTab] = useState<TabId>('practice');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshDash = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // wellness-dashboard returns ok:true even for an empty user (all-zero
      // stats), so a thrown request is the only real failure path — surface it
      // instead of swallowing it into a silent empty (the sibling-lens defect).
      const r = await lensRun('mental-health', 'wellness-dashboard', {});
      const result = r.data?.result as Dash | null | undefined;
      if (r.data?.ok === false) {
        setError(String(r.data?.error || 'Failed to load wellness dashboard.'));
        setDash(null);
      } else {
        setDash(result || null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wellness dashboard.');
      setDash(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  // An all-zero dashboard (no sessions, no moods, no courses) is the genuine
  // "empty" state — prompt the user toward their first check-in.
  const isEmptyDash = !!dash && dash.streak === 0 && dash.sessionsThisWeek === 0
    && dash.minutesThisWeek === 0 && dash.latestMood == null
    && dash.avgSleepHours == null && dash.activeCourses === 0 && dash.gratitudeEntries === 0;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-sky-600/15 to-transparent">
        <Sparkles className="w-5 h-5 text-sky-400" />
        <h2 className="text-sm font-bold text-zinc-100">Mindfulness</h2>
        <span className="text-[11px] text-zinc-400">Calm + Headspace shape · not medical advice</span>
      </header>

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-6 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading your wellness dashboard…</span>
        </div>
      ) : error ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-6 px-4 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void refreshDash()}
            className="px-3 py-1.5 text-xs rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            Retry
          </button>
        </div>
      ) : isEmptyDash ? (
        <div className="flex flex-col items-center gap-2 py-6 px-4 text-center">
          <p className="text-sm text-zinc-300">No check-ins yet.</p>
          <p className="text-xs text-zinc-400">Log a mood, breathe, or start a practice session below to begin tracking your wellbeing.</p>
        </div>
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
        {tab === 'companion' && <MhCompanionPanel />}
        {tab === 'factors' && <MhFactorsPanel onChange={refreshDash} />}
        {tab === 'calendar' && <MhCalendarPanel />}
        {tab === 'reminders' && <MhRemindersPanel />}
        {tab === 'worksheets' && <MhWorksheetsPanel />}
        {tab === 'safety' && <MhSafetyPlanPanel />}
        {tab === 'report' && <MhReportPanel />}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
