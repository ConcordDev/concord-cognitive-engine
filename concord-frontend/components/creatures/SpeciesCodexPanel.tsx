'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { BookOpen, Loader2, AlertCircle, Waves, Search } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { CreaturePortraitThumb } from '@/components/creatures/CreaturePortraitThumb';
import type { SpeciesRecord, TaxonomyLookup } from './types';

export function SpeciesCodexPanel() {
  const [codex, setCodex] = useState<SpeciesRecord[]>([]);
  const [codexLoading, setCodexLoading] = useState(true);
  const [codexError, setCodexError] = useState<string | null>(null);
  const [codexQuery, setCodexQuery] = useState('');
  const [taxQuery, setTaxQuery] = useState('');
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxResult, setTaxResult] = useState<{ id: string; taxonomy: TaxonomyLookup } | { id: string; error: string } | null>(null);
  const codexSearchRef = useRef<HTMLInputElement>(null);

  const refreshCodex = useCallback(async () => {
    setCodexLoading(true);
    setCodexError(null);
    try {
      const r = await lensRun('creatures', 'species', {});
      const result = r?.data?.result as { ok?: boolean; species?: SpeciesRecord[] } | null;
      if (r?.data?.ok && result?.ok !== false) {
        setCodex(result?.species || []);
      } else {
        throw new Error(r?.data?.error || 'Failed to load species codex');
      }
    } catch (e) {
      setCodexError(e instanceof Error ? e.message : 'Failed to load species codex');
    } finally {
      setCodexLoading(false);
    }
  }, []);

  useEffect(() => { refreshCodex(); }, [refreshCodex]);

  useLensCommand(
    [{ id: 'focus-codex-search', keys: '/', description: 'Search species codex', category: 'navigation', action: () => codexSearchRef.current?.focus() }],
    { lensId: 'creatures' },
  );

  const filteredCodex = useMemo(() => {
    const q = codexQuery.trim().toLowerCase();
    if (!q) return codex;
    return codex.filter((s) =>
      s.species_id.toLowerCase().includes(q) ||
      s.clade.toLowerCase().includes(q) ||
      s.topology.toLowerCase().includes(q) ||
      s.diet.toLowerCase().includes(q)
    );
  }, [codex, codexQuery]);

  const lookupTaxonomy = async () => {
    const id = taxQuery.trim();
    if (!id) return;
    setTaxLoading(true);
    setTaxResult(null);
    try {
      const r = await lensRun('creatures', 'taxonomy', { species_id: id });
      const result = r?.data?.result as { ok?: boolean; taxonomy?: TaxonomyLookup } | null;
      if (r?.data?.ok && result?.ok !== false && result?.taxonomy) {
        setTaxResult({ id, taxonomy: result.taxonomy });
      } else {
        setTaxResult({ id, error: r?.data?.error || 'no match' });
      }
    } catch (e) {
      setTaxResult({ id, error: e instanceof Error ? e.message : 'lookup failed' });
    } finally {
      setTaxLoading(false);
    }
  };

  const codexColumns: DataTableColumn<SpeciesRecord>[] = [
    { id: 'portrait', header: '', align: 'left', sortable: false, accessor: (s) => <CreaturePortraitThumb speciesId={s.species_id} size={28} /> },
    { id: 'species_id', header: 'Species', accessor: (s) => s.species_id, sortable: true, monospace: true },
    { id: 'clade', header: 'Clade', accessor: (s) => s.clade, sortable: true },
    { id: 'topology', header: 'Rig topology', accessor: (s) => s.topology, sortable: true },
    { id: 'diet', header: 'Diet', accessor: (s) => s.diet, sortable: true },
    {
      id: 'aquatic', header: 'Habitat', align: 'right', sortable: true,
      sortValue: (s) => (s.aquatic ? 1 : 0),
      accessor: (s) => s.aquatic
        ? <span className="inline-flex items-center gap-1 text-cyan-300"><Waves size={11} aria-hidden /> aquatic</span>
        : <span className="text-zinc-500">terrestrial</span>,
    },
  ];

  return (
    <section aria-label="Species codex" className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-200">
          <BookOpen size={14} aria-hidden /> Species codex
          <span className="text-[10px] font-normal text-zinc-500">the authored taxonomy library — {codex.length} species</span>
        </h3>
        <div className="relative">
          <Search size={11} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" aria-hidden />
          <label className="sr-only" htmlFor="codex-search">Search species codex</label>
          <input id="codex-search" ref={codexSearchRef} value={codexQuery} onChange={(e) => setCodexQuery(e.target.value)}
            placeholder="filter by species, clade, topology, diet…  ·  / focuses"
            className="w-64 rounded border border-zinc-700 bg-zinc-950 py-1 pl-6 pr-2 text-[11px] text-zinc-100" />
        </div>
      </div>

      {codexLoading ? (
        <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-4 text-xs text-zinc-400" role="status" aria-live="polite">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Loading species codex…
        </div>
      ) : codexError ? (
        <div className="rounded border border-red-500/30 bg-red-500/[0.06] p-4 text-xs" role="alert">
          <div className="mb-2 flex items-center gap-2 text-red-300"><AlertCircle size={14} aria-hidden /> Couldn’t load the codex.</div>
          <p className="mb-3 text-zinc-400">{codexError}</p>
          <button onClick={refreshCodex} className="rounded bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30">Retry</button>
        </div>
      ) : (
        <DataTable<SpeciesRecord>
          columns={codexColumns}
          rows={filteredCodex}
          getRowId={(s) => s.species_id}
          defaultSort={{ columnId: 'species_id', direction: 'asc' }}
          density="compact"
          maxHeight="360px"
          emptyState={<span className="text-xs text-zinc-500">No species match &ldquo;{codexQuery}&rdquo;.</span>}
        />
      )}

      <div className="mt-3 border-t border-zinc-800 pt-3">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500" htmlFor="codex-tax-lookup">
          Look up a hybrid or unlisted species id
        </label>
        <div className="flex gap-2">
          <input id="codex-tax-lookup" value={taxQuery} onChange={(e) => setTaxQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookupTaxonomy(); }}
            placeholder="e.g. a bred hybrid's species_id"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100" />
          <button onClick={lookupTaxonomy} disabled={taxLoading || !taxQuery.trim()}
            className="rounded bg-zinc-800 px-3 py-1 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50">
            {taxLoading ? <Loader2 className="inline animate-spin" size={11} aria-hidden /> : 'Resolve'}
          </button>
        </div>
        {taxResult && (
          <div className="mt-2 text-xs" role="status" aria-live="polite">
            {'taxonomy' in taxResult ? (
              <span className="text-emerald-300">
                ✓ <span className="font-mono">{taxResult.id}</span> · {taxResult.taxonomy.clade} · {taxResult.taxonomy.topology} · {taxResult.taxonomy.diet}
              </span>
            ) : (
              <span className="text-red-300">× {taxResult.id}: {taxResult.error}</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
