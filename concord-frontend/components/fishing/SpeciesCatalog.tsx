'use client';

// components/fishing/SpeciesCatalog.tsx
//
// Species browser for the fishing hub. Two real macros drive this:
//   - `fishing.catalog` (the full authored pool for the world) backs the
//     "All" chip.
//   - `fishing.species` (biome-scoped) is called with the SAME string as a
//     subBiome — `listFishForWorld`'s filter matches `f.biome === biome ||
//     f.subBiome === biome`, so picking "River" genuinely re-queries the
//     backend rather than filtering the already-fetched array client-side.
// The parent owns fetching; this component is presentational + emits the
// biome selection and row-activation events.

import { Fish } from 'lucide-react';
import { DataTable, Skeleton, EmptyState, ErrorState } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { RARITY_COLORS, type FishSpecies } from './types';

interface BiomeFacet {
  id: string;
  label: string;
  count: number;
}

interface SpeciesCatalogProps {
  species: FishSpecies[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  facets: BiomeFacet[];
  activeBiome: string | null;
  onSelectBiome: (biome: string | null) => void;
  onSelectFish: (fish: FishSpecies) => void;
  density: 'compact' | 'comfortable';
}

export function SpeciesCatalog({
  species,
  loading,
  error,
  onRetry,
  facets,
  activeBiome,
  onSelectBiome,
  onSelectFish,
  density,
}: SpeciesCatalogProps) {
  const columns: DataTableColumn<FishSpecies>[] = [
    {
      id: 'name',
      header: 'Species',
      accessor: (f) => (
        <div className="flex items-center gap-2">
          <Fish className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" />
          <span className="text-gray-100">{f.name}</span>
        </div>
      ),
      sortValue: (f) => f.name,
      sortable: true,
    },
    {
      id: 'subBiome',
      header: 'Waters',
      accessor: (f) => <span className="text-gray-400 capitalize">{f.subBiome || f.biome || '—'}</span>,
      sortValue: (f) => f.subBiome || f.biome || '',
      sortable: true,
    },
    {
      id: 'mass',
      header: 'Mass',
      accessor: (f) => (f.mass != null ? `${f.mass} kg` : '—'),
      sortValue: (f) => f.mass ?? 0,
      sortable: true,
      align: 'right',
      monospace: true,
    },
    {
      id: 'rarity',
      header: 'Rarity',
      accessor: (f) => (
        <span
          className={cn(
            'inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize',
            RARITY_COLORS[f.rarity] || 'text-zinc-400 bg-zinc-800 border-zinc-700',
          )}
        >
          {f.rarity}
        </span>
      ),
      sortValue: (f) => f.rarity,
      sortable: true,
    },
    {
      id: 'abilities',
      header: 'Behavior',
      accessor: (f) => (
        <div className="flex flex-wrap gap-1">
          {(f.abilities || []).slice(0, 3).map((a) => (
            <span key={a} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
              {a}
            </span>
          ))}
          {(!f.abilities || f.abilities.length === 0) && <span className="text-gray-600">—</span>}
        </div>
      ),
    },
  ];

  return (
    <section className={ds.panel} aria-label="Fish catalog">
      <div className={cn(ds.sectionHeader, 'mb-3')}>
        <h2 className={ds.heading3}>Species catalog</h2>
        <span className={ds.textMuted}>
          {loading ? 'Loading…' : `${species.length} shown`}
        </span>
      </div>

      {/* Biome chips — each one is a REAL fishing.species(biome) query, not a
          client-side filter; "All" reads from the already-fetched fishing.catalog. */}
      {facets.length > 0 && (
        <div role="tablist" aria-label="Filter by waters" className="mb-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            role="tab"
            aria-selected={activeBiome === null}
            onClick={() => onSelectBiome(null)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              ds.focusRing,
              activeBiome === null
                ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                : 'border-lattice-border text-gray-400 hover:border-white/20 hover:text-white',
            )}
          >
            All
          </button>
          {facets.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={activeBiome === f.id}
              onClick={() => onSelectBiome(f.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors',
                ds.focusRing,
                activeBiome === f.id
                  ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                  : 'border-lattice-border text-gray-400 hover:border-white/20 hover:text-white',
              )}
            >
              {f.label} · {f.count}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="space-y-1" aria-hidden="true">
          <Skeleton variant="table-row" columns={5} />
          <Skeleton variant="table-row" columns={5} />
          <Skeleton variant="table-row" columns={5} />
        </div>
      )}

      {!loading && error && (
        <ErrorState message={error} onRetry={onRetry} variant="inline" />
      )}

      {!loading && !error && species.length === 0 && (
        <EmptyState
          icon={<Fish className="h-5 w-5" aria-hidden="true" />}
          title="No fish authored for these waters yet."
          description="This world's fauna file has no entries for this filter. Try a different biome, or check back after more content is authored."
          compact
        />
      )}

      {!loading && !error && species.length > 0 && (
        <DataTable
          columns={columns}
          rows={species}
          getRowId={(f) => f.id}
          onRowClick={(f) => onSelectFish(f)}
          onRowActivate={(f) => onSelectFish(f)}
          density={density}
          caption="Fish species catalog"
        />
      )}
    </section>
  );
}
