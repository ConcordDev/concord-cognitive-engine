'use client';

/**
 * ReflectionSection — the "Journal" surface (Day One 2026-shape journaling
 * companion). Tab chrome owns nav state; panels hydrate via lensRun().
 *
 * This is the ONLY substrate-B (personal journaling) entry point on the
 * lens page — everything that used to be three separately-stacked panels
 * (this component's own 4 tabs, the standalone `JournalStudio` widget, and
 * the standalone `JournalActionPanel` widget) is now one tab bar, so only
 * one composer is visible at a time instead of three competing ones.
 * `Studio` nests the Day One-parity backlog surface (media/geo/voice/
 * encryption/timeline-map/reminders/sync/export); `Share` nests the
 * DTU-save/DM/publish/agent-prompt quick actions; `Analytics` is the
 * correctly-wired real analysis (see `RfAnalyticsPanel`'s header comment
 * for what was broken about the two prior attempts at this).
 *
 * This is substrate B. The self-critique engine log (substrate A — a
 * completely different backend system that also happens to be registered
 * under the domain name "reflection") is NOT rendered here — see the
 * "Self-Critique Log" mode on the lens page for that disclosure.
 */

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, NotebookPen, CalendarClock, TrendingUp, Lightbulb, Loader2, Wand2, Share2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RfEntriesPanel } from './RfEntriesPanel';
import { RfOnThisDayPanel } from './RfOnThisDayPanel';
import { RfInsightsPanel } from './RfInsightsPanel';
import { RfPromptsPanel } from './RfPromptsPanel';
import { RfAnalyticsPanel } from './RfAnalyticsPanel';
import { JournalStudio } from './JournalStudio';
import { JournalActionPanel } from './JournalActionPanel';
import { PipingProvider } from '@/components/panel-polish';

interface Dash {
  currentStreak: number; longestStreak: number; totalEntries: number;
  entriesThisWeek: number; journals: number; totalWords: number;
  latestMood: string | null; wroteToday: boolean;
  promptOfTheDay: { category: string; text: string };
}
type TabId = 'entries' | 'onthisday' | 'insights' | 'analytics' | 'prompts' | 'studio' | 'share';
const TABS: { id: TabId; label: string; icon: typeof NotebookPen }[] = [
  { id: 'entries', label: 'Entries', icon: NotebookPen },
  { id: 'onthisday', label: 'On This Day', icon: CalendarClock },
  { id: 'insights', label: 'Insights', icon: TrendingUp },
  { id: 'analytics', label: 'Analytics', icon: Wand2 },
  { id: 'prompts', label: 'Prompts', icon: Lightbulb },
  { id: 'studio', label: 'Studio', icon: BookOpen },
  { id: 'share', label: 'Share', icon: Share2 },
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
        {tab === 'analytics' && <RfAnalyticsPanel />}
        {tab === 'prompts' && <RfPromptsPanel onChange={refreshDash} />}
        {tab === 'studio' && <JournalStudio />}
        {tab === 'share' && (
          <PipingProvider>
            <JournalActionPanel />
          </PipingProvider>
        )}
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
