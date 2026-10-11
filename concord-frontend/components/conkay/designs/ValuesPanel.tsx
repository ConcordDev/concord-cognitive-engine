'use client';

/**
 * ValuesPanel — every value in the snapshot with its status and source.
 * Filter by status, search by name. A value with a URL links to it; a value
 * whose only "source" is the text that asserted it says so (that is not
 * evidence); an unknown shows no number.
 */

import { useMemo, useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { VALUE_STATUSES, countByStatus, formatValue, type DesignValue, type ValueStatus } from '@/lib/conkay/designs-api';
import { FilterChip } from './ChecksPanel';
import { PANEL, VALUE_STYLE } from './design-styles';

export function ValuesPanel({ values, meaning }: { values: DesignValue[]; meaning: Record<ValueStatus, string> }) {
  const [filter, setFilter] = useState<ValueStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const counts = useMemo(() => countByStatus(values), [values]);
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = new Map<string, DesignValue[]>();
    for (const v of values) {
      if (filter !== 'all' && v.status !== filter) continue;
      if (needle && !`${v.name} ${v.subject || ''} ${v.statement || ''} ${v.source?.title || ''}`.toLowerCase().includes(needle)) continue;
      out.set(v.group, [...(out.get(v.group) || []), v]);
    }
    return [...out.entries()];
  }, [values, filter, q]);

  return (
    <section className={PANEL} aria-label="Values and sources">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Values and sources</h2>
        <label className="flex items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-xs text-slate-300">
          <Search className="h-3 w-3 text-slate-500" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter values" aria-label="Filter values" className="w-36 bg-transparent placeholder:text-slate-600 focus:outline-none" />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter values by status">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All {values.length}</FilterChip>
        {VALUE_STATUSES.filter((s) => counts[s] > 0).map((s) => (
          <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} className={VALUE_STYLE[s].chip}>
            <span title={meaning[s]}>{s} {counts[s]}</span>
          </FilterChip>
        ))}
      </div>
      {filter !== 'all' && <p className="mt-1.5 text-[11px] text-slate-500">{filter}: {meaning[filter]}</p>}
      {groups.length === 0 && <p className="mt-3 text-xs text-slate-500">No values match.</p>}
      {groups.map(([group, rows]) => (
        <div key={group} className="mt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{group} <span className="text-slate-600">· {rows.length}</span></h3>
          <ul className="mt-1 divide-y divide-white/5">
            {rows.map((v) => <ValueRow key={v.id} v={v} />)}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ValueRow({ v }: { v: DesignValue }) {
  const amount = v.value == null ? null : `${formatValue(v.value)}${v.unit && v.unit !== '1' ? ` ${v.unit}` : ''}`;
  return (
    <li className="grid gap-x-3 gap-y-1 py-2 text-xs sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_auto_minmax(0,1.3fr)] sm:items-start">
      <div className="min-w-0">
        <p className="truncate text-slate-200" title={v.name}>{v.name}</p>
        {v.statement && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{v.statement}</p>}
      </div>
      <div className="tabular-nums text-slate-100">
        {amount ?? <span className="text-slate-500">—</span>}
        {v.range && <p className="text-[10px] text-slate-500">{formatValue(v.range.low)} – {formatValue(v.range.high)}</p>}
      </div>
      <span className={`h-fit w-fit rounded-md border px-1.5 py-0.5 text-[10px] ${VALUE_STYLE[v.status].chip}`} title={v.statusLabel}>{v.status}</span>
      <div className="min-w-0 text-[11px] leading-snug text-slate-400">
        {v.source?.url ? (
          <a href={v.source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 text-sky-300 hover:text-sky-200">
            <span className="truncate">{v.source.title || v.source.url}</span> <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : v.source ? (
          <span className="line-clamp-2">{v.source.title}{v.source.locator ? ` · ${v.source.locator}` : ''}</span>
        ) : (
          <span className="text-rose-300/80">no source</span>
        )}
        {v.sourceRole && v.sourceRole !== 'evidence' && <p className="text-[10px] text-slate-500">{v.sourceRole}</p>}
        {v.note && <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500" title={v.note}>{v.note}</p>}
      </div>
    </li>
  );
}
