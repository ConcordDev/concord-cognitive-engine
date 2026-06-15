'use client';

/**
 * ProductivityTaskSection — task manager.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { CheckSquare, Sun, ListTodo, Repeat, Timer, Loader2, Wand2, Bell, Filter, CalendarDays, Users } from 'lucide-react';
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
type TabId = 'today' | 'quickadd' | 'tasks' | 'filters' | 'calendar' | 'reminders' | 'collab' | 'habits' | 'focus';
const TABS: { id: TabId; label: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', icon: Sun },
  { id: 'quickadd', label: 'Quick add', icon: Wand2 },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'filters', label: 'Filters', icon: Filter },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'collab', label: 'Collaborate', icon: Users },
  { id: 'habits', label: 'Habits', icon: Repeat },
  { id: 'focus', label: 'Focus', icon: Timer },
];

export function ProductivityTaskSection() {
  const [tab, setTab] = useState<TabId>('today');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('productivity', 'productivity-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <CheckSquare className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Task Manager</h2>
        
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Active" value={dash.activeTasks} />
          <Stat label="Due today" value={dash.dueToday} alert={dash.dueToday > 0} />
          <Stat label="Done today" value={dash.completedToday} />
          <Stat label="Projects" value={dash.projects} />
          <Stat label="Habits" value={dash.habits} />
          <Stat label="Focus min" value={dash.focusMinutesToday} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-red-500',
                active ? 'bg-zinc-900 text-red-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
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
