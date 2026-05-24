'use client';

/**
 * ReflectionSection — Day One 2026-shape journaling companion. Tab
 * chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, NotebookPen, CalendarClock, TrendingUp, Lightbulb, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RfEntriesPanel } from './RfEntriesPanel';
import { RfOnThisDayPanel } from './RfOnThisDayPanel';
import { RfInsightsPanel } from './RfInsightsPanel';
import { RfPromptsPanel } from './RfPromptsPanel';

interface Dash {
  currentStreak: number; longestStreak: number; totalEntries: number;
  entriesThisWeek: number; journals: number; totalWords: number;
  latestMood: string | null; wroteToday: boolean;
  promptOfTheDay: { category: string; text: string };
}
type TabId = 'entries' | 'onthisday' | 'insights' | 'prompts';
const TABS: { id: TabId; label: string; icon: typeof NotebookPen }[] = [
  { id: 'entries', label: 'Entries', icon: NotebookPen },
  { id: 'onthisday', label: 'On This Day', icon: CalendarClock },
  { id: 'insights', label: 'Insights', icon: TrendingUp },
  { id: 'prompts', label: 'Prompts', icon: Lightbulb },
];

export function ReflectionSection() {
  const [tab, setTab] = useState<TabId>('entries');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('reflection', 'reflection-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-indigo-600/15 to-transparent">
        <BookOpen className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-bold text-zinc-100">Journal</h2>
        <span className="text-[11px] text-zinc-400">Day One shape · your journal for life</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Day streak" value={dash.currentStreak} />
          <Stat label="Longest" value={dash.longestStreak} />
          <Stat label="Entries/wk" value={dash.entriesThisWeek} />
          <Stat label="Total entries" value={dash.totalEntries} />
          <Stat label="Words" value={dash.totalWords.toLocaleString()} />
          <Stat label="Journals" value={dash.journals} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-indigo-500',
                active ? 'bg-zinc-900 text-indigo-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
        {tab === 'entries' && <RfEntriesPanel onChange={refreshDash} />}
        {tab === 'onthisday' && <RfOnThisDayPanel />}
        {tab === 'insights' && <RfInsightsPanel />}
        {tab === 'prompts' && <RfPromptsPanel onChange={refreshDash} />}
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
