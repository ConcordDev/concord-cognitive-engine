'use client';

/**
 * BooksShell — a books-chrome sidebar + top-tab chrome.
 *
 * The BooksO interface anyone who has done SMB books recognises: dark sidebar
 * on the left with the major nav buckets (Dashboard / Banking / Sales /
 * Expenses / Reports), each with its own sub-tabs. Keeps Concord branding
 * but the shape says "this is your books".
 */

import React from 'react';
import {
  Home, Banknote, FileText, Receipt, BookOpen, ScrollText, Users, Truck,
  PieChart as PieIcon, Calendar, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export type BooksNav =
  | 'dashboard'
  | 'banking'
  | 'invoices'
  | 'estimates'
  | 'recurring'
  | 'bills'
  | 'expenses'
  | 'customers'
  | 'vendors'
  | 'reports'
  | 'pl'
  | 'cashflow'
  | 'runway'
  | 'ledger'
  | 'coa'
  | 'aging-ar'
  | 'aging-ap'
  | 'ten99'
  | 'payroll'
  | 'budgets'
  | 'inventory'
  | 'salestax'
  | 'purchaseorders'
  | 'ratios';

interface NavItem {
  id: BooksNav;
  label: string;
  icon: typeof Home;
  group: 'core' | 'sales' | 'expenses' | 'reports';
  badge?: number | string;
}

export interface BooksShellProps {
  activeNav: BooksNav;
  onNavChange: (next: BooksNav) => void;
  /** Counts driven by dashboard-summary backend data. Show in nav as red pills. */
  badges?: Partial<Record<BooksNav, number | string>>;
  children: React.ReactNode;
  /** Slot for the JAX-style "Ask anything" bar mounted in the header. */
  askBar?: React.ReactNode;
}

const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard',   icon: Home,     group: 'core' },
  { id: 'banking',   label: 'Banking',     icon: Banknote, group: 'core' },
  { id: 'invoices',  label: 'Invoices',    icon: FileText, group: 'sales' },
  { id: 'estimates', label: 'Estimates',   icon: ScrollText, group: 'sales' },
  { id: 'recurring', label: 'Recurring',   icon: Calendar, group: 'sales' },
  { id: 'customers', label: 'Customers',   icon: Users,    group: 'sales' },
  { id: 'bills',     label: 'Bills',       icon: Receipt,  group: 'expenses' },
  { id: 'expenses',  label: 'Expenses',    icon: Receipt,  group: 'expenses' },
  { id: 'vendors',   label: 'Vendors',     icon: Truck,    group: 'expenses' },
  { id: 'pl',        label: 'P&L',         icon: PieIcon,  group: 'reports' },
  { id: 'cashflow',  label: 'Cash flow',   icon: PieIcon,  group: 'reports' },
  { id: 'runway',    label: 'Runway',      icon: PieIcon,  group: 'reports' },
  { id: 'payroll',   label: 'Payroll',     icon: Users,    group: 'expenses' },
  { id: 'purchaseorders', label: 'Purchase orders', icon: Truck, group: 'expenses' },
  { id: 'inventory', label: 'Inventory',   icon: Receipt,  group: 'sales' },
  { id: 'budgets',   label: 'Budgets',     icon: PieIcon,  group: 'reports' },
  { id: 'salestax',  label: 'Sales tax',   icon: PieIcon,  group: 'reports' },
  { id: 'ratios',    label: 'Ratios',      icon: PieIcon,  group: 'reports' },
  { id: 'aging-ar',  label: 'A/R aging',   icon: PieIcon,  group: 'reports' },
  { id: 'aging-ap',  label: 'A/P aging',   icon: PieIcon,  group: 'reports' },
  { id: 'ledger',    label: 'Ledger',      icon: BookOpen, group: 'reports' },
  { id: 'coa',       label: 'Chart',       icon: BookOpen, group: 'reports' },
  { id: 'ten99',     label: '1099s',       icon: FileText, group: 'reports' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  core: 'Overview',
  sales: 'Sales',
  expenses: 'Expenses',
  reports: 'Reports',
};

export function BooksShell({ activeNav, onNavChange, badges = {}, children, askBar }: BooksShellProps) {
  const groups: NavItem['group'][] = ['core', 'sales', 'expenses', 'reports'];
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      {/* Sidebar */}
      <aside className="w-44 bg-[#0a0c10] border-r border-white/5 flex flex-col flex-shrink-0">
        <header className="px-3 py-3 border-b border-white/5 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-gray-200 tracking-wide">Books</span>
        </header>
        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map((g) => (
            <div key={g} className="mb-3">
              <div className="px-3 mb-1 text-[9px] uppercase tracking-wider text-gray-400 font-semibold">{GROUP_LABELS[g]}</div>
              <ul>
                {NAV.filter((n) => n.group === g).map((n) => {
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
                          active ? 'bg-emerald-500/10 text-emerald-200 border-l-2 border-emerald-400' : 'text-gray-400 hover:text-white hover:bg-white/[0.04] border-l-2 border-transparent',
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
      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {askBar && (
          <header className="px-4 py-2 border-b border-white/5 bg-[#0a0c10]/60">
            {askBar}
          </header>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </main>
    </div>
  );
}

export default BooksShell;
