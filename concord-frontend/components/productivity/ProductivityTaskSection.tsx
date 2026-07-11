'use client';

/**
 * ProductivityTaskSection — task manager.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckSquare, Sun, ListTodo, Repeat, Timer, Loader2, Wand2, Bell, Filter, CalendarDays, Users, Flame } from 'lucide-react';
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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <CheckSquare className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Task Manager</h2>
        {stats && stats.streak > 0 && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-800/50 bg-amber-950/30 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
            title={`${stats.streak}-day completion streak · ${stats.completedWeek} done this week`}
          >
            <Flame className="w-3 h-3" /> {stats.streak}-day streak
          </span>
        )}
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Active" value={dash.activeTasks} />
          <Stat label="Due today" value={dash.dueToday} alert={dash.dueToday > 0} />
          <Stat label="Done today" value={dash.completedToday} />
          <Stat label="This week" value={stats?.completedWeek ?? 0} />
          <Stat label="Projects" value={dash.projects} />
          <Stat label="Habits" value={dash.habits} />
          <Stat label="Focus min" value={dash.focusMinutesToday} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto" aria-label="Task manager views">
        {PRODUCTIVITY_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              aria-pressed={active}
              title={`${t.label} — press ${t.chord}`}
              className={cn('group flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500',
                active ? 'bg-zinc-900 text-red-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
              <kbd className={cn('ml-0.5 hidden md:inline rounded border px-1 text-[9px] font-mono leading-none',
                active ? 'border-red-800/60 text-red-300/80' : 'border-zinc-700 text-zinc-500 group-hover:text-zinc-400')}>
                {t.hint}
              </kbd>
            </button>
          );
        })}
      </nav>

      <div className="p-4">
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
    <div className="text-center">
      <p className={cn('text-lg font-bold', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
