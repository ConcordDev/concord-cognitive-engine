'use client';

/**
 * EpicShell — Epic Hyperspace-shape sidebar chrome with the canonical
 * top nav clinicians know: Patient Chart / Schedule / Encounters /
 * Inbox / Refills / Coding / Reports.
 */

import React from 'react';
import {
  LayoutDashboard, Users, Calendar, ClipboardList, Mail, Pill,
  Activity, FileSearch, Stethoscope, Sparkles, Database, FlaskConical, HeartPulse,
  Video, Watch, ShieldCheck, ShieldAlert, Share2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type EpicNav =
  | 'dashboard'
  | 'patients'
  | 'chart'
  | 'orders'
  | 'cds'
  | 'care'
  | 'encounters'
  | 'schedule'
  | 'telehealth'
  | 'results'
  | 'devices'
  | 'insurance'
  | 'sharing'
  | 'inbox'
  | 'refills'
  | 'scribe'
  | 'smartphrases'
  | 'codes'
  | 'reports';

interface NavItem {
  id: EpicNav;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'home' | 'clinical' | 'patient' | 'communications' | 'tools';
}

const NAV: NavItem[] = [
  { id: 'dashboard',    label: 'Dashboard',    icon: LayoutDashboard, group: 'home' },
  { id: 'patients',     label: 'Patients',     icon: Users,           group: 'clinical' },
  { id: 'chart',        label: 'Chart',        icon: Stethoscope,     group: 'clinical' },
  { id: 'orders',       label: 'Orders',       icon: FlaskConical,    group: 'clinical' },
  { id: 'cds',          label: 'Order Check',  icon: ShieldAlert,     group: 'clinical' },
  { id: 'care',         label: 'Care',         icon: HeartPulse,      group: 'clinical' },
  { id: 'encounters',   label: 'Encounters',   icon: ClipboardList,   group: 'clinical' },
  { id: 'schedule',     label: 'Schedule',     icon: Calendar,        group: 'clinical' },
  { id: 'telehealth',   label: 'Telehealth',   icon: Video,           group: 'patient' },
  { id: 'results',      label: 'Results',      icon: FlaskConical,    group: 'patient' },
  { id: 'devices',      label: 'Device Data',  icon: Watch,           group: 'patient' },
  { id: 'insurance',    label: 'Insurance',    icon: ShieldCheck,     group: 'patient' },
  { id: 'sharing',      label: 'Record Share', icon: Share2,          group: 'patient' },
  { id: 'inbox',        label: 'Inbox',        icon: Mail,            group: 'communications' },
  { id: 'refills',      label: 'Refills',      icon: Pill,            group: 'communications' },
  { id: 'scribe',       label: 'AI Scribe',    icon: Sparkles,        group: 'tools' },
  { id: 'smartphrases', label: 'SmartPhrases', icon: FileSearch,      group: 'tools' },
  { id: 'codes',        label: 'ICD-10 / CPT', icon: Database,        group: 'tools' },
  { id: 'reports',      label: 'Reports',      icon: Activity,        group: 'tools' },
];

const GROUP_LABELS = { home: '', clinical: 'Clinical', patient: 'Patient Portal', communications: 'Inbox', tools: 'Tools' } as const;

export interface EpicShellProps {
  activeNav: EpicNav;
  onNavChange: (n: EpicNav) => void;
  badges?: Partial<Record<EpicNav, number | string>>;
  children: React.ReactNode;
  askBar?: React.ReactNode;
}

export function EpicShell({ activeNav, onNavChange, badges = {}, children, askBar }: EpicShellProps) {
  const groups: NavItem['group'][] = ['home', 'clinical', 'patient', 'communications', 'tools'];
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-cyan-500/15 rounded-lg overflow-hidden">
      <aside className="w-44 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5 flex items-center gap-2">
          <Stethoscope className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold text-gray-200 tracking-wide">Clinical</span>
        </header>
        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map(g => (
            <div key={g} className="mb-3">
              {GROUP_LABELS[g] && (
                <div className="px-3 mb-1 text-[9px] uppercase tracking-wider text-gray-600 font-semibold">{GROUP_LABELS[g]}</div>
              )}
              <ul>
                {NAV.filter(n => n.group === g).map(n => {
                  const Icon = n.icon;
                  const active = activeNav === n.id;
                  const badge = badges[n.id];
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => onNavChange(n.id)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                          active ? 'bg-cyan-500/10 text-cyan-200 border-l-2 border-cyan-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border-l-2 border-transparent',
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="truncate flex-1 text-left">{n.label}</span>
                        {badge !== undefined && badge !== 0 && (
                          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-mono', badge === '!' || (typeof badge === 'number' && badge > 0 && (n.id === 'inbox' || n.id === 'refills')) ? 'bg-rose-500/30 text-rose-200' : 'bg-cyan-500/20 text-cyan-300')}>
                            {badge}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <main className="flex-1 flex flex-col overflow-hidden">
        {askBar && (
          <header className="px-4 py-2 border-b border-white/5 bg-[#0a0c10]/60">
            {askBar}
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </main>
    </div>
  );
}

export default EpicShell;
