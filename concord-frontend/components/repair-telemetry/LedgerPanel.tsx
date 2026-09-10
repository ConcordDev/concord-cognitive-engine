'use client';

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { useDensity } from '@/lib/hooks/useDensity';
import { cn, formatRelativeTime } from '@/lib/utils';
import {
  CATEGORY_STYLE, FILTER_TABS, formatDetail,
  type Disposition, type FilterTab, type HealthEntry,
} from './types';

const DISPOSITION_STYLE: Record<Disposition, { text: string; icon: typeof CheckCircle2 }> = {
  healed: { text: 'text-emerald-300', icon: CheckCircle2 },
  escalated: { text: 'text-amber-300', icon: AlertTriangle },
  noted: { text: 'text-slate-400', icon: Circle },
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('text-right text-slate-200', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

export function LedgerPanel({
  log, filter, setFilter, refreshing,
}: {
  log: HealthEntry[];
  filter: FilterTab;
  setFilter: (f: FilterTab) => void;
  refreshing: boolean;
}) {
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const { density } = useDensity();
  const tableDensity = density === 'low' ? 'comfortable' : 'compact';

  const counts = useMemo(() => {
    const c = { all: log.length, healed: 0, escalated: 0, noted: 0 };
    for (const e of log) c[e.disposition]++;
    return c;
  }, [log]);

  const filteredLog = useMemo(
    () => (filter === 'all' ? log : log.filter((e) => e.disposition === filter)),
    [log, filter],
  );

  const selectedFinding = useMemo(
    () => filteredLog.find((e) => e.id === selectedFindingId) || null,
    [filteredLog, selectedFindingId],
  );

  const columns: DataTableColumn<HealthEntry>[] = [
    {
      id: 'disposition', header: 'disposition', sortable: true,
      sortValue: (r) => r.disposition,
      accessor: (r) => {
        const s = DISPOSITION_STYLE[r.disposition];
        const Icon = s.icon;
        return (
          <span className={cn('flex items-center gap-1.5 font-medium', s.text)}>
            <Icon className="h-3 w-3" aria-hidden="true" /> {r.disposition}
          </span>
        );
      },
    },
    { id: 'pathology', header: 'pathology', sortable: true, monospace: true, sortValue: (r) => r.pathology, accessor: (r) => r.pathology },
    {
      id: 'category', header: 'category', sortable: true, sortValue: (r) => r.category,
      accessor: (r) => <span className={cn('rounded border px-1.5 py-0.5 text-[10px] font-medium', CATEGORY_STYLE[r.category])}>{r.category}</span>,
    },
    { id: 'subject', header: 'subject', monospace: true, accessor: (r) => r.subject_id || '—' },
    { id: 'detail', header: 'detail', accessor: (r) => <span className="text-slate-400">{formatDetail(r.pathology, r.detail)}</span> },
    {
      id: 'checked_at', header: 'when', align: 'right', sortable: true, monospace: true,
      sortValue: (r) => r.checked_at, accessor: (r) => formatRelativeTime(r.checked_at * 1000),
    },
  ];

  return (
    <section aria-labelledby="ledger-heading" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 id="ledger-heading" className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-slate-300">
          <Activity className="h-4 w-4" /> Homeostasis ledger
        </h2>
        <div className="ml-1 flex items-center gap-1" role="tablist" aria-label="Filter findings by disposition">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={filter === t.id}
              onClick={() => setFilter(t.id)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors duration-150',
                filter === t.id ? 'border-amber-400/50 bg-amber-500/15 text-amber-200' : 'border-zinc-700 text-slate-400 hover:border-zinc-600',
              )}
            >
              {t.label} <span className="opacity-60">{counts[t.id]}</span>
              <kbd className="ml-0.5 hidden rounded border border-white/10 bg-black/20 px-1 font-mono text-[8px] sm:inline">{t.key}</kbd>
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <DensityToggle variant="dropdown" showLabels={false} />
        </div>
      </div>

      <div className={cn('grid gap-3', selectedFinding ? 'lg:grid-cols-[1fr_280px]' : 'grid-cols-1')}>
        <div className={cn('transition-opacity duration-150', refreshing ? 'opacity-60' : 'opacity-100')}>
          <DataTable
            columns={columns}
            rows={filteredLog}
            getRowId={(r) => r.id}
            selectedRowId={selectedFindingId}
            onRowClick={(r) => setSelectedFindingId(r.id === selectedFindingId ? null : r.id)}
            onRowActivate={(r) => setSelectedFindingId(r.id === selectedFindingId ? null : r.id)}
            density={tableDensity}
            defaultSort={{ columnId: 'checked_at', direction: 'desc' }}
            maxHeight="480px"
            caption="Homeostasis ledger — monitor findings, disposition, and detail"
            emptyState={<p className="py-6 text-center text-[11px] text-slate-500">No findings match this filter.</p>}
          />
        </div>

        {selectedFinding && (
          <aside aria-label="Finding detail" className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-amber-200">{selectedFinding.pathology}</span>
              <button onClick={() => setSelectedFindingId(null)} aria-label="Close detail" className="text-slate-500 hover:text-slate-300">
                <XCircle className="h-3.5 w-3.5" />
              </button>
            </div>
            <dl className="space-y-1.5">
              <Row label="disposition" value={selectedFinding.disposition} />
              <Row label="category" value={selectedFinding.category} />
              <Row label="subject" value={selectedFinding.subject_id || '—'} mono />
              <Row label="checked" value={formatRelativeTime(selectedFinding.checked_at * 1000)} />
            </dl>
            {Object.keys(selectedFinding.detail || {}).length > 0 && (
              <div className="mt-2 border-t border-white/10 pt-2">
                <p className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">detail</p>
                <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[10px] text-slate-300">
                  {JSON.stringify(selectedFinding.detail, null, 2)}
                </pre>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
