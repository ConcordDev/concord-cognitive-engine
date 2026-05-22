'use client';

import { useState, useCallback } from 'react';
import {
  X, Sigma, BarChart3, Activity, Table2, BookOpen,
  ClipboardCheck, FlaskRound, FileText, Loader2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ScienceCharts } from '@/components/science/ScienceCharts';
import { ScienceStats } from '@/components/science/ScienceStats';
import { ScienceNotebook } from '@/components/science/ScienceNotebook';
import { ScienceDataGrid } from '@/components/science/ScienceDataGrid';
import { ScienceProtocolRuns } from '@/components/science/ScienceProtocolRuns';
import { ScienceReagents } from '@/components/science/ScienceReagents';
import { SciencePublicationExport } from '@/components/science/SciencePublicationExport';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab =
  | 'datagrid' | 'charts' | 'stats' | 'notebook'
  | 'protocols' | 'reagents' | 'publication';

const TABS: { id: Tab; label: string; icon: typeof Sigma }[] = [
  { id: 'datagrid', label: 'Data Grid', icon: Table2 },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'stats', label: 'Statistics', icon: Activity },
  { id: 'notebook', label: 'Notebook', icon: BookOpen },
  { id: 'protocols', label: 'Protocol Runs', icon: ClipboardCheck },
  { id: 'reagents', label: 'Reagents', icon: FlaskRound },
  { id: 'publication', label: 'Publication', icon: FileText },
];

export function ScienceWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('datagrid');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[720px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-teal-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-teal-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Sigma className="w-4 h-4 text-teal-400" />
          <span className="text-sm font-semibold text-gray-200">Science Workbench</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
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
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared dataset hook — used by Data Grid + Charts tabs              */
/* ------------------------------------------------------------------ */

export interface DatasetMeta {
  id: string;
  name: string;
  columns: string[];
  rowCount: number;
  createdAt: string;
  updatedAt?: string;
}

export interface DatasetFull extends Omit<DatasetMeta, 'rowCount'> {
  rows: unknown[][];
}

export function useDatasets() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<{ datasets: DatasetMeta[] }>('science', 'dataset-list', {});
    if (r.data?.ok && r.data.result) {
      setDatasets(r.data.result.datasets || []);
    } else {
      setError(r.data?.error || 'Failed to load datasets');
    }
    setLoading(false);
  }, []);

  return { datasets, loading, error, refresh, setDatasets };
}

/* shared inline-loading button */
export function RunButton({
  onClick, busy, children, className,
}: {
  onClick: () => void;
  busy?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-teal-500/40 bg-teal-500/15 text-xs text-teal-100 disabled:opacity-50',
        className,
      )}
    >
      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
      {children}
    </button>
  );
}

export default ScienceWorkbench;
