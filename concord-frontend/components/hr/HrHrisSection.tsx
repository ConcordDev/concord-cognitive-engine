'use client';

/**
 * HrHrisSection — an HRIS workbench.
 * Tab chrome owns nav state; panels hydrate via lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Users, UserRound, CalendarOff, Target, Briefcase, Loader2,
  DollarSign, ShieldCheck, Clock, GraduationCap, FileCheck, BarChart3, UserCog,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
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

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-emerald-600/15 to-transparent">
        <Users className="w-5 h-5 text-emerald-400" />
        <h2 className="text-sm font-bold text-zinc-100">People Hub</h2>
        <span className="text-[11px] text-zinc-400">HRIS</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
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

      <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-emerald-500',
                active ? 'bg-zinc-900 text-emerald-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="p-4">
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
