'use client';

/**
 * CreatorStudioSection — YouTube Studio + Buffer + Patreon shape
 * creator studio. Dashboard + goal + tabbed panels, all via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Megaphone, KanbanSquare, Users, DollarSign, CalendarDays, Loader2, Target,
  LineChart, Gauge, PieChart, Crown, Banknote, CalendarClock, MessageSquare,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { CrtPipelinePanel } from './CrtPipelinePanel';
import { CrtAudiencePanel } from './CrtAudiencePanel';
import { CrtRevenuePanel } from './CrtRevenuePanel';
import { CrtCalendarPanel } from './CrtCalendarPanel';
import { CrtRevenueChartPanel } from './CrtRevenueChartPanel';
import { CrtPerformancePanel } from './CrtPerformancePanel';
import { CrtDemographicsPanel } from './CrtDemographicsPanel';
import { CrtMembershipPanel } from './CrtMembershipPanel';
import { CrtPayoutPanel } from './CrtPayoutPanel';
import { CrtScheduledPanel } from './CrtScheduledPanel';
import { CrtCommentsPanel } from './CrtCommentsPanel';

interface Dash {
  platforms: number; totalFollowers: number; ideas: number; inProgress: number;
  published: number; publishedThisMonth: number; revenueThisMonth: number;
}
interface Goal {
  hasGoal: boolean; metric?: string; target?: number; current?: number; pct?: number; met?: boolean;
}
type TabId =
  | 'pipeline' | 'audience' | 'revenue' | 'calendar'
  | 'trends' | 'performance' | 'demographics' | 'membership'
  | 'payouts' | 'scheduled' | 'comments';
const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { id: 'audience', label: 'Audience', icon: Users },
  { id: 'revenue', label: 'Revenue', icon: DollarSign },
  { id: 'trends', label: 'Trends', icon: LineChart },
  { id: 'performance', label: 'Performance', icon: Gauge },
  { id: 'demographics', label: 'Demographics', icon: PieChart },
  { id: 'membership', label: 'Membership', icon: Crown },
  { id: 'payouts', label: 'Payouts', icon: Banknote },
  { id: 'scheduled', label: 'Scheduled', icon: CalendarClock },
  { id: 'comments', label: 'Comments', icon: MessageSquare },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];
const GOAL_METRICS = [
  { id: 'followers', label: 'Total followers' },
  { id: 'monthly_revenue', label: 'Monthly revenue' },
  { id: 'monthly_posts', label: 'Posts this month' },
];

export function CreatorStudioSection() {
  const [tab, setTab] = useState<TabId>('pipeline');
  const [dash, setDash] = useState<Dash | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [loading, setLoading] = useState(true);
  const [goalForm, setGoalForm] = useState({ metric: 'followers', target: '' });

  const refresh = useCallback(async () => {
    const [d, g] = await Promise.all([
      lensRun('creator', 'creator-dashboard', {}),
      lensRun('creator', 'creator-goal-status', {}),
    ]);
    setDash((d.data?.result as Dash | null) || null);
    setGoal((g.data?.result as Goal | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setGoalTarget = async () => {
    const t = Number(goalForm.target);
    if (!(t > 0)) return;
    await lensRun('creator', 'creator-goal-set', { metric: goalForm.metric, target: t });
    setGoalForm({ ...goalForm, target: '' });
    await refresh();
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-red-600/15 to-transparent">
        <Megaphone className="w-5 h-5 text-red-400" />
        <h2 className="text-sm font-bold text-zinc-100">Creator Studio</h2>
        <span className="text-[11px] text-zinc-400">YouTube Studio + Buffer + Patreon shape</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : (
        <>
          {dash && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
              <Stat label="Platforms" value={dash.platforms} />
              <Stat label="Followers" value={dash.totalFollowers.toLocaleString()} />
              <Stat label="Ideas" value={dash.ideas} />
              <Stat label="In progress" value={dash.inProgress} />
              <Stat label="Published/mo" value={dash.publishedThisMonth} />
              <Stat label="Revenue/mo" value={`$${dash.revenueThisMonth.toLocaleString()}`} />
            </div>
          )}

          {/* Goal */}
          <div className="px-4 py-2.5 border-b border-zinc-800">
            {goal?.hasGoal ? (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                    <Target className="w-3.5 h-3.5 text-red-400" />
                    {GOAL_METRICS.find((m) => m.id === goal.metric)?.label || goal.metric}
                  </span>
                  <span className={cn('text-[11px]', goal.met ? 'text-emerald-400' : 'text-zinc-400')}>
                    {goal.current?.toLocaleString()} / {goal.target?.toLocaleString()} ({goal.pct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div className={cn('h-full rounded-full', goal.met ? 'bg-emerald-500' : 'bg-red-500')}
                    style={{ width: `${Math.min(100, goal.pct || 0)}%` }} />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-400">Set a goal:</span>
                <select value={goalForm.metric} onChange={(e) => setGoalForm({ ...goalForm, metric: e.target.value })}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
                  {GOAL_METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
                <input placeholder="Target" inputMode="numeric" value={goalForm.target}
                  onChange={(e) => setGoalForm({ ...goalForm, target: e.target.value })}
                  className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                <button type="button" onClick={setGoalTarget}
                  className="px-2.5 py-1 text-[11px] bg-red-600 hover:bg-red-500 text-white rounded-lg">Set</button>
              </div>
            )}
          </div>

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
            {tab === 'pipeline' && <CrtPipelinePanel onChange={refresh} />}
            {tab === 'audience' && <CrtAudiencePanel onChange={refresh} />}
            {tab === 'revenue' && <CrtRevenuePanel onChange={refresh} />}
            {tab === 'trends' && <CrtRevenueChartPanel />}
            {tab === 'performance' && <CrtPerformancePanel />}
            {tab === 'demographics' && <CrtDemographicsPanel />}
            {tab === 'membership' && <CrtMembershipPanel onChange={refresh} />}
            {tab === 'payouts' && <CrtPayoutPanel />}
            {tab === 'scheduled' && <CrtScheduledPanel />}
            {tab === 'comments' && <CrtCommentsPanel />}
            {tab === 'calendar' && <CrtCalendarPanel />}
          </div>
        </>
      )}
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
