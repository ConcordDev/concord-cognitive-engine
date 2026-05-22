'use client';

/**
 * FacetedSearchPanel — knowledge-base style faceted filter sidebar.
 * Wired to `dtus.facets` (bucket counts) and `dtus.facetedSearch`
 * (filtered subset). The parent feeds the loaded corpus; this panel
 * owns the filter state and reports matches back up.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Filter, Loader2, Save, RotateCcw } from 'lucide-react';

export interface DtuFilter {
  query?: string;
  layers?: string[];
  tiers?: string[];
  scopes?: string[];
  tags?: string[];
  minQuality?: number;
  maxQuality?: number;
}

interface FacetBucket {
  value: string;
  count: number;
}

interface FacetsResult {
  total: number;
  facets: {
    layer: FacetBucket[];
    tier: FacetBucket[];
    scope: FacetBucket[];
    quality: FacetBucket[];
    tag: FacetBucket[];
  };
}

interface CorpusDtu extends Record<string, unknown> {
  id: string;
}

export function FacetedSearchPanel({
  corpus,
  initialFilter,
  onResults,
  onSaveView,
}: {
  corpus: CorpusDtu[];
  initialFilter?: DtuFilter | null;
  onResults: (ids: string[], matched: number) => void;
  onSaveView?: (filter: DtuFilter) => void;
}) {
  const [facets, setFacets] = useState<FacetsResult | null>(null);
  const [filter, setFilter] = useState<DtuFilter>(initialFilter || {});
  const [loading, setLoading] = useState(false);
  const [matched, setMatched] = useState<number | null>(null);

  // Recompute facet buckets whenever the corpus changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (corpus.length === 0) { setFacets(null); return; }
      const res = await lensRun<FacetsResult>('dtus', 'facets', { dtus: corpus });
      if (!cancelled && res.data.ok && res.data.result) setFacets(res.data.result);
    })();
    return () => { cancelled = true; };
  }, [corpus]);

  const runSearch = useCallback(
    async (f: DtuFilter) => {
      if (corpus.length === 0) { onResults([], 0); setMatched(0); return; }
      setLoading(true);
      const res = await lensRun<{ matched: number; results: CorpusDtu[] }>(
        'dtus',
        'facetedSearch',
        { dtus: corpus, filter: f },
      );
      setLoading(false);
      if (res.data.ok && res.data.result) {
        onResults(res.data.result.results.map((d) => d.id), res.data.result.matched);
        setMatched(res.data.result.matched);
      }
    },
    [corpus, onResults],
  );

  const toggle = useCallback(
    (key: 'layers' | 'tiers' | 'scopes' | 'tags', value: string) => {
      setFilter((prev) => {
        const set = new Set(prev[key] || []);
        if (set.has(value)) set.delete(value);
        else set.add(value);
        const next = { ...prev, [key]: [...set] };
        runSearch(next);
        return next;
      });
    },
    [runSearch],
  );

  // Apply an inbound initialFilter once on mount (e.g. from a saved view).
  useEffect(() => {
    if (initialFilter && Object.keys(initialFilter).length > 0) {
      runSearch(initialFilter);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = useCallback(() => {
    setFilter({});
    setMatched(null);
    onResults([], 0);
  }, [onResults]);

  const hasActiveFilter =
    !!filter.query ||
    !!(filter.layers?.length) ||
    !!(filter.tiers?.length) ||
    !!(filter.scopes?.length) ||
    !!(filter.tags?.length) ||
    filter.minQuality !== undefined;

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="h-4 w-4 text-neon-cyan" /> Faceted Search
        </h3>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-neon-cyan" />}
          {hasActiveFilter && (
            <button
              onClick={reset}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
          )}
        </div>
      </div>

      {matched !== null && (
        <p className="text-xs text-neon-cyan">
          {matched} of {facets?.total ?? corpus.length} DTUs match
        </p>
      )}

      {/* Text query */}
      <input
        type="text"
        value={filter.query || ''}
        onChange={(e) => {
          const next = { ...filter, query: e.target.value };
          setFilter(next);
          runSearch(next);
        }}
        placeholder="Filter text…"
        className="w-full rounded-lg border border-lattice-border bg-lattice-surface px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none"
      />

      {/* Quality range */}
      <div>
        <label className="text-[11px] text-gray-400">
          Min quality: {filter.minQuality ?? 0}
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={filter.minQuality ?? 0}
          onChange={(e) => {
            const next = { ...filter, minQuality: Number(e.target.value) };
            setFilter(next);
            runSearch(next);
          }}
          className="w-full accent-neon-cyan"
        />
      </div>

      {facets && (
        <>
          <FacetGroup
            title="Tier"
            buckets={facets.facets.tier}
            selected={filter.tiers || []}
            onToggle={(v) => toggle('tiers', v)}
          />
          <FacetGroup
            title="Layer"
            buckets={facets.facets.layer}
            selected={filter.layers || []}
            onToggle={(v) => toggle('layers', v)}
          />
          <FacetGroup
            title="Scope"
            buckets={facets.facets.scope}
            selected={filter.scopes || []}
            onToggle={(v) => toggle('scopes', v)}
          />
          <FacetGroup
            title="Tags"
            buckets={facets.facets.tag.slice(0, 16)}
            selected={filter.tags || []}
            onToggle={(v) => toggle('tags', v)}
          />
        </>
      )}

      {onSaveView && hasActiveFilter && (
        <button
          onClick={() => onSaveView(filter)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neon-purple/30 bg-neon-purple/10 py-1.5 text-xs text-neon-purple hover:bg-neon-purple/20"
        >
          <Save className="h-3.5 w-3.5" /> Save as smart collection
        </button>
      )}
    </div>
  );
}

function FacetGroup({
  title,
  buckets,
  selected,
  onToggle,
}: {
  title: string;
  buckets: FacetBucket[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  if (buckets.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase text-gray-500">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {buckets.map((b) => {
          const on = selected.includes(b.value);
          return (
            <button
              key={b.value}
              onClick={() => onToggle(b.value)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                on
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'bg-lattice-surface text-gray-400 hover:text-white'
              }`}
            >
              <span className="capitalize">{b.value}</span>
              <span className="text-gray-600">{b.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
