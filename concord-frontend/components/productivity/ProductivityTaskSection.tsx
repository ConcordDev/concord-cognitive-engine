'use client';

/**
 * ProductivityTaskSection — task manager.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Sun, ListTodo, Repeat, Timer, Loader2, Wand2, Bell, Filter, CalendarDays, Users, Flame } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ProductivityTodayPanel } from './ProductivityTodayPanel';
import { ProductivityTasksPanel } from './ProductivityTasksPanel';
import { ProductivityHabitsPanel } from './ProductivityHabitsPanel';
import { ProductivityFocusPanel } from './ProductivityFocusPanel';
import { ProductivityQuickAddPanel } from './ProductivityQuickAddPanel';
import { ProductivityRemindersPanel } from './ProductivityRemindersPanel';
import { ProductivityFiltersPanel } from './ProductivityFiltersPanel';
import { ProductivityCalendarPanel } from './ProductivityCalendarPanel';
import { ProductivityCollabPanel } from './ProductivityCollabPanel';

interface Dash {
  activeTasks: number; dueToday: number; projects: number; habits: number;
  completedToday: number; focusMinutesToday: number;
}
interface ProdStats {
  completedToday: number; completedWeek: number; totalCompleted: number;
  activeTasks: number; streak: number;
}

export type ProductivityTabId =
  | 'today' | 'quickadd' | 'tasks' | 'filters' | 'calendar'
  | 'reminders' | 'collab' | 'habits' | 'focus';

/**
 * Tab metadata is exported so the lens page can register the same
 * keyboard shortcuts it renders as kbd chips — one source of truth for
 * label + icon + the `g <key>` chord (Linear-style keyboard-first nav).
 */
export const PRODUCTIVITY_TABS: {
  id: ProductivityTabId; label: string; icon: typeof Sun; chord: string; hint: string;
}[] = [
  { id: 'today', label: 'Today', icon: Sun, chord: 'g t', hint: 't' },
  { id: 'quickadd', label: 'Quick add', icon: Wand2, chord: 'g a', hint: 'a' },
  { id: 'tasks', label: 'Tasks', icon: ListTodo, chord: 'g k', hint: 'k' },
  { id: 'filters', label: 'Filters', icon: Filter, chord: 'g f', hint: 'f' },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, chord: 'g c', hint: 'c' },
  { id: 'reminders', label: 'Reminders', icon: Bell, chord: 'g r', hint: 'r' },
  { id: 'collab', label: 'Collaborate', icon: Users, chord: 'g b', hint: 'b' },
  { id: 'habits', label: 'Habits', icon: Repeat, chord: 'g h', hint: 'h' },
  { id: 'focus', label: 'Focus', icon: Timer, chord: 'g o', hint: 'o' },
];

interface ProductivityTaskSectionProps {
  /** Controlled active tab. Falls back to internal state when omitted. */
  activeTab?: ProductivityTabId;
  /** Notified when the user switches tabs (keeps the page's keyboard/persistence in sync). */
  onTabChange?: (tab: ProductivityTabId) => void;
}

export function ProductivityTaskSection({ activeTab, onTabChange }: ProductivityTaskSectionProps = {}) {
  const [internalTab, setInternalTab] = useState<ProductivityTabId>('today');
  const tab = activeTab ?? internalTab;
  const setTab = useCallback((next: ProductivityTabId) => {
    setInternalTab(next);
    onTabChange?.(next);
  }, [onTabChange]);

  const [dash, setDash] = useState<Dash | null>(null);
  const [stats, setStats] = useState<ProdStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const [d, s] = await Promise.all([
      lensRun('productivity', 'productivity-dashboard', {}),
      lensRun('productivity', 'productivity-stats', {}),
    ]);
    setDash((d.data?.result as Dash | null) || null);
    setStats((s.data?.result as ProdStats | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="mb-5 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-7">
          <Stat label="Active" value={dash.activeTasks} />
          <Stat label="Due today" value={dash.dueToday} alert={dash.dueToday > 0} />
          <Stat label="Done today" value={dash.completedToday} />
          <Stat label="This week" value={stats?.completedWeek ?? 0} />
          <Stat label="Projects" value={dash.projects} />
          <Stat label="Habits" value={dash.habits} />
          <Stat label="Focus min" value={dash.focusMinutesToday} />
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Task manager views">
          {PRODUCTIVITY_TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                aria-pressed={active}
                title={`${t.label} — press ${t.chord}`}
                className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  active ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200')}>
                <Icon className="h-3.5 w-3.5" /> {t.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 md:inline-block">{t.hint}</kbd>
              </button>
            );
          })}
        </nav>
        {stats && stats.streak > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-amber-800/50 bg-amber-950/30 px-3 py-1 text-[12px] font-medium text-amber-300"
            title={`${stats.streak}-day completion streak · ${stats.completedWeek} done this week`}
          >
            <Flame className="w-3 h-3" /> {stats.streak}-day streak
          </span>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-[#111] p-5">
        {tab === 'today' && <ProductivityTodayPanel onChange={refreshDash} />}
        {tab === 'quickadd' && <ProductivityQuickAddPanel onChange={refreshDash} />}
        {tab === 'tasks' && <ProductivityTasksPanel onChange={refreshDash} />}
        {tab === 'filters' && <ProductivityFiltersPanel onChange={refreshDash} />}
        {tab === 'calendar' && <ProductivityCalendarPanel onChange={refreshDash} />}
        {tab === 'reminders' && <ProductivityRemindersPanel onChange={refreshDash} />}
        {tab === 'collab' && <ProductivityCollabPanel onChange={refreshDash} />}
        {tab === 'habits' && <ProductivityHabitsPanel onChange={refreshDash} />}
        {tab === 'focus' && <ProductivityFocusPanel onChange={refreshDash} />}
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="bg-[#111] px-2 py-3 text-center">
      <p className={cn('text-xl font-semibold', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}
