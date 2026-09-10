'use client';

/**
 * Science Workbench as a first-class view (stats / data grid / charts /
 * notebook / protocol runs / reagents / publication / field log).
 * Same macros as the former slide-over; no longer a competing FAB machine.
 */

import { useState } from 'react';
import {
  Sigma, BarChart3, Activity, Table2, BookOpen,
  ClipboardCheck, FlaskRound, FileText, MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScienceCharts } from '@/components/science/ScienceCharts';
import { ScienceStats } from '@/components/science/ScienceStats';
import { ScienceNotebook } from '@/components/science/ScienceNotebook';
import { ScienceDataGrid } from '@/components/science/ScienceDataGrid';
import { ScienceProtocolRuns } from '@/components/science/ScienceProtocolRuns';
import { ScienceReagents } from '@/components/science/ScienceReagents';
import { SciencePublicationExport } from '@/components/science/SciencePublicationExport';
import { ScienceFieldLog } from '@/components/science/ScienceFieldLog';

type Tab =
  | 'datagrid' | 'charts' | 'stats' | 'notebook'
  | 'protocols' | 'reagents' | 'publication' | 'fieldlog';

const TABS: { id: Tab; label: string; icon: typeof Sigma }[] = [
  { id: 'datagrid', label: 'Data Grid', icon: Table2 },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'stats', label: 'Statistics', icon: Activity },
  { id: 'notebook', label: 'Notebook', icon: BookOpen },
  { id: 'protocols', label: 'Protocol Runs', icon: ClipboardCheck },
  { id: 'reagents', label: 'Reagents', icon: FlaskRound },
  { id: 'publication', label: 'Publication', icon: FileText },
  { id: 'fieldlog', label: 'Field Log', icon: MapPin },
];

export function WorkbenchPanel() {
  const [tab, setTab] = useState<Tab>('datagrid');

  return (
    <div className="rounded-xl border border-teal-500/20 bg-[#0d1117] overflow-hidden flex flex-col min-h-[640px]">
      <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 bg-gradient-to-r from-teal-950/40 to-transparent">
        <Sigma className="w-4 h-4 text-teal-400" />
        <span className="text-sm font-semibold text-gray-200">Science Workbench</span>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-teal-500/15 text-teal-200 border border-teal-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}
            >
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'datagrid' && <ScienceDataGrid />}
        {tab === 'charts' && <ScienceCharts />}
        {tab === 'stats' && <ScienceStats />}
        {tab === 'notebook' && <ScienceNotebook />}
        {tab === 'protocols' && <ScienceProtocolRuns />}
        {tab === 'reagents' && <ScienceReagents />}
        {tab === 'publication' && <SciencePublicationExport />}
        {tab === 'fieldlog' && <ScienceFieldLog />}
      </div>
    </div>
  );
}

export default WorkbenchPanel;
