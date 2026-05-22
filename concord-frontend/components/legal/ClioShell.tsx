'use client';

/**
 * ClioShell — Clio Manage-shape left-rail navigation chrome.
 *
 * Top-row brand + global search; left sidebar with 7 nav groups
 * (Dashboard, Matters, Contacts, Calendar, Time, Bills, Trust,
 * Documents, Reports); main pane renders the chosen panel.
 */

import React from 'react';
import {
  LayoutDashboard, Briefcase, Users, Calendar, Timer, FileText,
  Scale, FolderOpen, BarChart3, Mail, ClipboardList,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type ClioNav =
  | 'dashboard'
  | 'matters'
  | 'intake'
  | 'contacts'
  | 'calendar'
  | 'time'
  | 'invoices'
  | 'trust'
  | 'documents'
  | 'templates'
  | 'esign'
  | 'reports';

interface NavItem {
  id: ClioNav;
  label: string;
  icon: typeof LayoutDashboard;
  group: 'home' | 'practice' | 'financial' | 'docs';
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard',  icon: LayoutDashboard, group: 'home' },
  { id: 'intake',    label: 'Intake',     icon: ClipboardList,   group: 'practice' },
  { id: 'matters',   label: 'Matters',    icon: Briefcase,       group: 'practice' },
  { id: 'contacts',  label: 'Contacts',   icon: Users,           group: 'practice' },
  { id: 'calendar',  label: 'Calendar',   icon: Calendar,        group: 'practice' },
  { id: 'time',      label: 'Time',       icon: Timer,           group: 'financial' },
  { id: 'invoices',  label: 'Bills',      icon: FileText,        group: 'financial' },
  { id: 'trust',     label: 'Trust',      icon: Scale,           group: 'financial' },
  { id: 'documents', label: 'Documents',  icon: FolderOpen,      group: 'docs' },
  { id: 'templates', label: 'Templates',  icon: FileText,        group: 'docs' },
  { id: 'esign',     label: 'E-sign',     icon: Mail,            group: 'docs' },
  { id: 'reports',   label: 'Reports',    icon: BarChart3,       group: 'docs' },
];

const GROUP_LABELS = { home: '', practice: 'Practice', financial: 'Financial', docs: 'Documents' } as const;

export interface ClioShellProps {
  activeNav: ClioNav;
  onNavChange: (n: ClioNav) => void;
  badges?: Partial<Record<ClioNav, number | string>>;
  children: React.ReactNode;
  askBar?: React.ReactNode;
}

export function ClioShell({ activeNav, onNavChange, badges = {}, children, askBar }: ClioShellProps) {
  const groups: NavItem['group'][] = ['home', 'practice', 'financial', 'docs'];
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
      <aside className="w-44 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5 flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-gray-200 tracking-wide">Practice</span>
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
                          active ? 'bg-amber-500/10 text-amber-200 border-l-2 border-amber-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border-l-2 border-transparent',
                        )}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span className="truncate flex-1 text-left">{n.label}</span>
                        {badge !== undefined && badge !== 0 && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-300 font-mono">{badge}</span>
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

export default ClioShell;
