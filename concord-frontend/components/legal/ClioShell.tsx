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
  Scale, FolderOpen, BarChart3, Mail, ClipboardList, CreditCard,
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
  | 'payments'
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
  { id: 'payments',  label: 'Payments',   icon: CreditCard,      group: 'financial' },
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
    // FIX-legal-010: below sm the shell stacks — the rail becomes a
    // full-width horizontal nav strip and the main pane takes the whole
    // width. The fixed w-44 rail previously ate ~half of a 390px
    // viewport and clipped the Matters pane (and its create form).
    <div className="flex flex-col bg-lattice-surface border border-amber-500/15 rounded-lg overflow-hidden sm:flex-row sm:h-[calc(100vh-180px)] sm:min-h-[640px]">
      <aside className="flex w-full flex-shrink-0 flex-row items-stretch border-b border-white/5 bg-[#0a0c10] sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
        <header className="hidden px-3 py-3 border-b border-white/5 sm:flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-gray-200 tracking-wide">Practice</span>
        </header>
        <nav className="flex flex-1 gap-3 overflow-x-auto px-2 py-2 sm:block sm:overflow-y-auto sm:px-0">
          {groups.map(g => (
            <div key={g} className="flex gap-1 sm:mb-3 sm:block">
              {GROUP_LABELS[g] && (
                <div className="hidden px-3 mb-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold sm:block">{GROUP_LABELS[g]}</div>
              )}
              <ul className="flex sm:block">
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
                          'flex w-auto items-center gap-2 whitespace-nowrap px-3 py-1.5 text-xs transition-colors sm:w-full',
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
      <main className="flex min-w-0 flex-1 flex-col sm:overflow-hidden">
        {askBar && (
          <header className="px-4 py-2 border-b border-white/5 bg-[#0a0c10]/60">
            {askBar}
          </header>
        )}
        <div className="flex-1 p-4 sm:overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}

export default ClioShell;
