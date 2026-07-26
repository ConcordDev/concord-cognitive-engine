'use client';

/**
 * HrHrisSection — an HRIS workbench.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserRound, CalendarOff, Target, Briefcase,
  DollarSign, ShieldCheck, Clock, GraduationCap, FileCheck, BarChart3, UserCog,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Skeleton } from '@/components/ui';
import { HrPeoplePanel } from './HrPeoplePanel';
import { HrTimeOffPanel } from './HrTimeOffPanel';
import { HrPerformancePanel } from './HrPerformancePanel';
import { HrRecruitingPanel } from './HrRecruitingPanel';
import { HrPayrollPanel } from './HrPayrollPanel';
import { HrBenefitsPanel } from './HrBenefitsPanel';
import { HrClockPanel } from './HrClockPanel';
import { HrLearningPanel } from './HrLearningPanel';
import { HrCompliancePanel } from './HrCompliancePanel';
import { HrAnalyticsPanel } from './HrAnalyticsPanel';
import { HrSelfServicePanel } from './HrSelfServicePanel';

interface Dash {
  headcount: number; departments: number; pendingTimeoff: number;
  openOnboarding: number; openJobs: number; applicants: number; openGoals: number;
}
type TabId = 'people' | 'timeoff' | 'performance' | 'recruiting'
  | 'payroll' | 'benefits' | 'clock' | 'training' | 'compliance' | 'analytics' | 'self';
const TABS: { id: TabId; label: string; icon: typeof Users }[] = [
  { id: 'people', label: 'People', icon: UserRound },
  { id: 'timeoff', label: 'Time Off', icon: CalendarOff },
  { id: 'payroll', label: 'Payroll', icon: DollarSign },
  { id: 'benefits', label: 'Benefits', icon: ShieldCheck },
  { id: 'clock', label: 'Time Clock', icon: Clock },
  { id: 'performance', label: 'Performance', icon: Target },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'compliance', label: 'Compliance', icon: FileCheck },
  { id: 'recruiting', label: 'Recruiting', icon: Briefcase },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'self', label: 'Self-Service', icon: UserCog },
];

const TAB_ORDER: TabId[] = TABS.map((t) => t.id);

export function HrHrisSection() {
  const [tab, setTab] = useState<TabId>('people');
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshDash = useCallback(async () => {
    const r = await lensRun('hr', 'hr-dashboard', {});
    setDash((r.data?.result as Dash | null) || null);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshDash(); }, [refreshDash]);

  const cycleTab = useCallback((dir: 1 | -1) => {
    setTab((cur) => {
      const i = TAB_ORDER.indexOf(cur);
      return TAB_ORDER[(i + dir + TAB_ORDER.length) % TAB_ORDER.length];
    });
  }, []);

  // Real per-tab badges — every count traces to the `hr-dashboard` macro
  // result already fetched above; nothing here is invented for display.
  const tabBadges = useMemo<Partial<Record<TabId, { text: string; tone: 'neutral' | 'warning' }>>>(() => {
    if (!dash) return {};
    return {
      people: dash.openOnboarding > 0 ? { text: String(dash.openOnboarding), tone: 'warning' } : undefined,
      timeoff: dash.pendingTimeoff > 0 ? { text: String(dash.pendingTimeoff), tone: 'warning' } : undefined,
      recruiting: dash.openJobs > 0 ? { text: String(dash.openJobs), tone: 'neutral' } : undefined,
      performance: dash.openGoals > 0 ? { text: String(dash.openGoals), tone: 'neutral' } : undefined,
    };
  }, [dash]);

  useLensCommand(
    [
      { id: 'hris-tab-next', keys: ']', description: 'Next HRIS tab', category: 'navigation', action: () => cycleTab(1) },
      { id: 'hris-tab-prev', keys: '[', description: 'Previous HRIS tab', category: 'navigation', action: () => cycleTab(-1) },
    ],
    { lensId: 'hr' }
  );

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-600/15 to-transparent">
        <Users className="w-5 h-5 text-emerald-400" />
        <h2 className="text-sm font-bold text-zinc-100">People Hub</h2>
        <span className="text-[11px] text-zinc-400">HRIS</span>
      </header>

      {loading ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} variant="block" height={40} />)}
        </div>
      ) : dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          <Stat label="Headcount" value={dash.headcount} />
          <Stat label="Departments" value={dash.departments} />
          <Stat label="PTO pending" value={dash.pendingTimeoff} alert={dash.pendingTimeoff > 0} />
          <Stat label="Onboarding" value={dash.openOnboarding} />
          <Stat label="Open jobs" value={dash.openJobs} />
          <Stat label="Open goals" value={dash.openGoals} />
        </div>
      )}

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto" aria-label="HRIS sections">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          const badge = tabBadges[t.id];
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              aria-current={active ? 'page' : undefined}
              className={cn('relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500',
                active ? 'text-emerald-300' : 'text-zinc-400 hover:text-zinc-200')}>
              {active && (
                <motion.span layoutId="hris-tab-active" className="absolute inset-0 rounded-t-lg bg-zinc-900 border-x border-t border-zinc-800"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
              )}
              <span className="relative flex items-center gap-1.5">
                <Icon className="w-3.5 h-3.5" /> {t.label}
                {badge && (
                  <span className={cn('inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[9px] font-bold tabular-nums',
                    badge.tone === 'warning' ? 'bg-amber-500/25 text-amber-300' : 'bg-white/10 text-zinc-300')}>
                    {badge.text}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
            {tab === 'people' && <HrPeoplePanel onChange={refreshDash} />}
            {tab === 'timeoff' && <HrTimeOffPanel onChange={refreshDash} />}
            {tab === 'payroll' && <HrPayrollPanel />}
            {tab === 'benefits' && <HrBenefitsPanel />}
            {tab === 'clock' && <HrClockPanel />}
            {tab === 'performance' && <HrPerformancePanel />}
            {tab === 'training' && <HrLearningPanel />}
            {tab === 'compliance' && <HrCompliancePanel />}
            {tab === 'recruiting' && <HrRecruitingPanel onChange={refreshDash} />}
            {tab === 'analytics' && <HrAnalyticsPanel />}
            {tab === 'self' && <HrSelfServicePanel />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold tabular-nums', alert ? 'text-amber-400' : 'text-zinc-100')}>{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
