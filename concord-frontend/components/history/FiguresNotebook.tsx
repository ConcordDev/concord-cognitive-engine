'use client';

/**
 * FiguresNotebook — personal research notes on historical figures.
 *
 * Honest scoping (see docs/lens-specs/history-capability-map.md for the
 * full Group A/B resolution): the history domain's 25 registered macros
 * have NO concept of a "historical figure" — there is no backend
 * validation, scoring, or analysis for a person record. This is real,
 * private, per-user persistence via the generic lens-artifact store
 * (`useLensData`, `/api/lens/history` — genuinely saved, not fabricated),
 * kept honestly labeled as personal notes rather than presented as
 * something the backend understands or grades.
 *
 * The old page also had generic "Event", "Period", and "Source" notebook
 * types sharing this same disconnected CRUD. Those three are RETIRED here
 * because each has a real, better-fitting home now: Events -> the real
 * Timeline substrate (VisualTimeline/TimelineBuilder), Periods -> the new
 * comparePeriods-backed PeriodCauseEffectTools, Sources -> the existing
 * sourceEvaluate-backed TimelineSourceTools. Figures is the one type with
 * no macro to grow into, so it stays as an honestly-scoped notebook.
 */

import { useMemo, useState } from 'react';
import { Users, Plus, Trash2, Search, UserRound, Check, Loader2 } from 'lucide-react';
import { DataTable, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useDensity } from '@/lib/hooks/useDensity';

interface FigureData {
  role?: string;
  birthYear?: string;
  deathYear?: string;
  region?: string;
  notes?: string;
}

const REGIONS = ['global', 'europe', 'asia', 'africa', 'americas', 'middle_east', 'oceania', 'other'] as const;

export function FiguresNotebook() {
  const { items, isLoading, isError, error, refetch, create, update, remove } = useLensData<FigureData>('history', 'Figure', { seed: [] });
  const { density } = useDensity();
  const tableDensity = density === 'high' ? 'compact' : 'comfortable';

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', role: '', birthYear: '', deathYear: '', region: 'global', notes: '' });

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.title.toLowerCase().includes(q) || (i.data.role || '').toLowerCase().includes(q) || (i.data.notes || '').toLowerCase().includes(q));
  }, [items, search]);

  const selected = items.find((i) => i.id === selectedId) || null;

  const columns: DataTableColumn<(typeof items)[number]>[] = [
    { id: 'name', header: 'Name', accessor: (r) => r.title, sortable: true },
    { id: 'role', header: 'Role', accessor: (r) => r.data.role || '—', sortable: true },
    { id: 'born', header: 'Born', accessor: (r) => r.data.birthYear || '—', sortable: true, monospace: true, align: 'right', width: '80px' },
    { id: 'died', header: 'Died', accessor: (r) => r.data.deathYear || '—', sortable: true, monospace: true, align: 'right', width: '80px' },
    { id: 'region', header: 'Region', accessor: (r) => (r.data.region || '').replace(/_/g, ' ') || '—', sortable: true, width: '110px' },
  ];

  async function handleCreate() {
    if (!form.name.trim()) return;
    await create({
      title: form.name.trim(),
      data: {
        role: form.role.trim() || undefined,
        birthYear: form.birthYear.trim() || undefined,
        deathYear: form.deathYear.trim() || undefined,
        region: form.region,
        notes: form.notes.trim() || undefined,
      },
    });
    setForm({ name: '', role: '', birthYear: '', deathYear: '', region: 'global', notes: '' });
    setShowCreate(false);
  }

  async function handleDelete(id: string) {
    if (selectedId === id) setSelectedId(null);
    await remove(id);
  }

  if (isError) {
    return <ErrorState message={(error as Error)?.message || 'Could not load your figures notebook.'} onRetry={() => refetch()} />;
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-[11px] text-zinc-400">
        <UserRound className="inline h-3 w-3 mr-1 text-amber-400" />
        Personal notes on historical figures you&apos;re researching — private, saved for you, and{' '}
        <span className="text-zinc-300">not backend-validated or scored</span> (the history domain has no
        figure-analysis macro; this is a plain notebook, not a designed feature like the timeline or source
        tools below).
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search figures…"
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((s) => !s)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold"
        >
          <Plus className="w-3.5 h-3.5" /> New figure
        </button>
        <span className="text-xs text-zinc-500 ml-auto">{filtered.length} figure{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {showCreate && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name…"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="Role (e.g. philosopher)"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white sm:col-span-2" />
            <input value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} placeholder="Born"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono" />
            <input value={form.deathYear} onChange={(e) => setForm({ ...form, deathYear: e.target.value })} placeholder="Died"
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono" />
          </div>
          <select value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })}
            className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white">
            {REGIONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes…"
            className="w-full h-20 resize-none bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white" />
          <div className="flex gap-2">
            <button type="button" onClick={handleCreate} disabled={!form.name.trim()}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold disabled:opacity-40">Save</button>
            <button type="button" onClick={() => setShowCreate(false)} className="text-xs text-zinc-400 hover:text-white">Cancel</button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="table-row" columns={5} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Users className="h-6 w-6" aria-hidden="true" />}
          title="No figures noted yet."
          description="Add the first historical figure you're researching — a name, role, and dates is enough to start."
          action={{ label: 'New figure', onClick: () => setShowCreate(true) }}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <DataTable
              columns={columns}
              rows={filtered}
              getRowId={(r) => r.id}
              onRowClick={(r) => setSelectedId(r.id)}
              onRowActivate={(r) => setSelectedId(r.id)}
              selectedRowId={selectedId}
              density={tableDensity}
              zebra
              stickyHeader
              caption="Your historical figures notebook"
              emptyState={<EmptyState compact title="No matches" description="No figures match this search." />}
            />
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 space-y-3 sticky top-4 self-start">
            {selected ? (
              <>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{selected.title}</h3>
                  <button type="button" onClick={() => handleDelete(selected.id)} aria-label={`Delete ${selected.title}`}
                    className="text-rose-400 hover:text-rose-300 shrink-0"><Trash2 className="w-4 h-4" /></button>
                </div>
                {selected.data.role && <p className="text-xs text-amber-300">{selected.data.role}</p>}
                <p className="text-xs text-zinc-400 font-mono">
                  {selected.data.birthYear || '?'} – {selected.data.deathYear || 'present/unknown'}
                </p>
                {selected.data.region && <p className="text-xs text-zinc-400 capitalize">{selected.data.region.replace(/_/g, ' ')}</p>}
                <div className="border-t border-zinc-800 pt-2">
                  <label className="block text-[10px] uppercase tracking-wider text-zinc-500 mb-1" htmlFor="figure-notes">
                    Notes (autosaves on blur)
                  </label>
                  <NotesEditor
                    key={selected.id}
                    initial={selected.data.notes || ''}
                    onSave={(notes) => update(selected.id, { data: { ...selected.data, notes } })}
                  />
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-zinc-500">
                <UserRound className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p className="text-xs">Select a figure to view notes.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline autosaving notes textarea — real macro-dispatch feedback on blur. */
function NotesEditor({ initial, onSave }: { initial: string; onSave: (notes: string) => Promise<unknown> }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  async function commit() {
    if (value === initial) return;
    setState('saving');
    try {
      await onSave(value);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('idle');
    }
  }

  return (
    <div className="space-y-1">
      <textarea
        id="figure-notes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="No notes yet — click to add some."
        className="w-full h-20 resize-none bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/40"
      />
      <div className="h-3.5 flex items-center gap-1 text-[10px]">
        {state === 'saving' && <><Loader2 className="w-3 h-3 animate-spin text-zinc-500" /><span className="text-zinc-500">Saving…</span></>}
        {state === 'saved' && <><Check className="w-3 h-3 text-emerald-400" /><span className="text-emerald-400">Saved</span></>}
      </div>
    </div>
  );
}
