'use client';

/**
 * KnowledgeWorkbench — the knowledge-graph navigation surface for the
 * DTU lens. Ties together the 7 backlog features:
 *   - Citation graph     (dtus.citationGraph)
 *   - Faceted search     (dtus.facets / dtus.facetedSearch)
 *   - Lineage tree       (dtus.lineageTree)
 *   - Bulk operations    (dtus.bulkOp)
 *   - Compare / merge    (dtus.compareDtus / dtus.mergeDtus)
 *   - Saved collections  (dtus.saveView / listViews / deleteView)
 *   - 4-layer editor     (dtus.getLayers / dtus.updateLayers)
 *
 * It operates over a corpus of DTU records supplied by the parent page
 * (the loaded paginated list).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { DTU } from '@/lib/api/generated-types';
import { CitationGraph, type GraphNode, type GraphEdge } from './CitationGraph';
import { FacetedSearchPanel, type DtuFilter } from './FacetedSearchPanel';
import { SavedViewsPanel } from './SavedViewsPanel';
import { LineageTreePanel, type LineageRoot } from './LineageTreePanel';
import { BulkOpsPanel } from './BulkOpsPanel';
import { CompareMergePanel, type CompareDtu } from './CompareMergePanel';
import { LayerEditor } from './LayerEditor';
import {
  Network, Filter, GitBranch, Layers, GitMerge, FileText, CheckSquare, Square,
} from 'lucide-react';

type Tab = 'graph' | 'search' | 'lineage' | 'bulk' | 'compare' | 'editor';

interface CitationGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hubs: GraphNode[];
  stats: { nodeCount: number; edgeCount: number; isolated: number; density: number };
}

type CorpusRecord = Record<string, unknown> & { id: string };

// Project the page's DTU rows into the flat shape the macros normalise.
function toCorpus(dtus: DTU[]): CorpusRecord[] {
  return dtus
    .filter((d) => !!d.id)
    .map((d) => ({
      id: d.id,
      title: d.title || d.summary || d.id,
      summary: d.summary || d.content || '',
      tier: (d.tier || 'regular').toLowerCase(),
      layer: typeof d.meta?.layer === 'string' ? (d.meta.layer as string) : 'core',
      scope: d.isGlobal ? 'public' : 'personal',
      tags: Array.isArray(d.tags) ? d.tags : [],
      quality: Math.round((d.coherence ?? 0) * 100),
      citationCount:
        typeof d.meta?.citationCount === 'number' ? (d.meta.citationCount as number) : 0,
      parents: Array.isArray(d.parents) ? d.parents : [],
      children: Array.isArray(d.children) ? d.children : [],
      cites: Array.isArray(d.parents) ? d.parents : [],
    }));
}

const TABS: { id: Tab; label: string; icon: typeof Network }[] = [
  { id: 'graph', label: 'Citation Graph', icon: Network },
  { id: 'search', label: 'Faceted Search', icon: Filter },
  { id: 'lineage', label: 'Lineage Tree', icon: GitBranch },
  { id: 'bulk', label: 'Bulk Ops', icon: Layers },
  { id: 'compare', label: 'Compare / Merge', icon: GitMerge },
  { id: 'editor', label: 'Layer Editor', icon: FileText },
];

export function KnowledgeWorkbench({
  dtus,
  onSelectDtu,
}: {
  dtus: DTU[];
  onSelectDtu?: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('graph');
  const corpus = useMemo(() => toCorpus(dtus), [dtus]);
  const byId = useMemo(() => new Map(corpus.map((d) => [d.id, d])), [corpus]);

  // Citation graph
  const [graph, setGraph] = useState<CitationGraphResult | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Multi-select (drives bulk ops + compare)
  const [selected, setSelected] = useState<string[]>([]);

  // Faceted search match set + pending filter for saved-view creation
  const [searchMatches, setSearchMatches] = useState<string[] | null>(null);
  const [pendingFilter, setPendingFilter] = useState<DtuFilter | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<DtuFilter | null>(null);

  // Single-DTU focus for lineage + editor
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (corpus.length === 0) { setGraph(null); return; }
      setGraphLoading(true);
      const res = await lensRun<CitationGraphResult>('dtus', 'citationGraph', { dtus: corpus });
      if (cancelled) return;
      setGraphLoading(false);
      if (res.data.ok && res.data.result) setGraph(res.data.result);
    })();
    return () => { cancelled = true; };
  }, [corpus]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const handleNodeSelect = useCallback(
    (id: string) => {
      setFocusId(id);
      onSelectDtu?.(id);
    },
    [onSelectDtu],
  );

  // Build the lineage root from the focused DTU + its children in the corpus.
  const lineageRoot = useMemo<LineageRoot | null>(() => {
    if (!focusId) return null;
    const seed = (id: string, depth: number): LineageRoot | null => {
      const d = byId.get(id);
      if (!d || depth > 4) return null;
      const childIds = Array.isArray(d.children) ? (d.children as string[]) : [];
      return {
        id: d.id,
        title: String(d.title || d.id),
        tier: String(d.tier || 'regular'),
        children: childIds
          .map((cid) => seed(cid, depth + 1))
          .filter((c): c is LineageRoot => c !== null),
      };
    };
    return seed(focusId, 0);
  }, [focusId, byId]);

  // Compare pair = exactly 2 selected DTUs.
  const comparePair = useMemo<[CompareDtu | null, CompareDtu | null]>(() => {
    if (selected.length !== 2) return [null, null];
    return [
      (byId.get(selected[0]) as CompareDtu) || null,
      (byId.get(selected[1]) as CompareDtu) || null,
    ];
  }, [selected, byId]);

  const applyFilter = useCallback((filter: DtuFilter) => {
    setAppliedFilter(filter);
    setTab('search');
  }, []);

  // Rows shown in the select list — narrowed by the active search match set.
  const visibleRows = useMemo(() => {
    if (searchMatches === null) return corpus;
    const set = new Set(searchMatches);
    return corpus.filter((d) => set.has(d.id));
  }, [corpus, searchMatches]);

  return (
    <section
      className="mx-auto mt-8 max-w-7xl px-4 md:px-6"
      data-lens-section="knowledge-workbench"
      aria-labelledby="kw-heading"
    >
      <header className="mb-3 flex items-baseline justify-between">
        <h2 id="kw-heading" className="text-base font-semibold text-white">
          Knowledge Workbench
        </h2>
        <span className="text-[11px] text-gray-400">
          {corpus.length} DTUs in scope · {selected.length} selected
        </span>
      </header>

      {/* Tab bar */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors ${
                tab === t.id
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'bg-lattice-surface text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* Main panel */}
        <div>
          {tab === 'graph' && (
            <CitationGraph
              result={graph}
              loading={graphLoading}
              onSelectNode={handleNodeSelect}
            />
          )}
          {tab === 'search' && (
            <FacetedSearchPanel
              key={JSON.stringify(appliedFilter)}
              corpus={corpus}
              initialFilter={appliedFilter}
              onResults={(ids, matched) =>
                setSearchMatches(matched > 0 || ids.length > 0 ? ids : null)
              }
              onSaveView={setPendingFilter}
            />
          )}
          {tab === 'lineage' && (
            <LineageTreePanel root={lineageRoot} onSelectNode={handleNodeSelect} />
          )}
          {tab === 'bulk' && (
            <BulkOpsPanel selectedIds={selected} onClear={() => setSelected([])} />
          )}
          {tab === 'compare' && (
            <CompareMergePanel
              a={comparePair[0]}
              b={comparePair[1]}
              onClear={() => setSelected([])}
            />
          )}
          {tab === 'editor' && (
            <LayerEditor dtuId={focusId} seed={focusId ? byId.get(focusId) : undefined} />
          )}
        </div>

        {/* Right rail — select list + saved collections */}
        <aside className="space-y-4">
          <SavedViewsPanel
            pendingFilter={pendingFilter}
            onClearPending={() => setPendingFilter(null)}
            onApply={applyFilter}
          />

          <div className="rounded-xl border border-lattice-border bg-lattice-deep p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <CheckSquare className="h-3.5 w-3.5 text-neon-green" /> Select DTUs
              </p>
              {selected.length > 0 && (
                <button
                  onClick={() => setSelected([])}
                  className="text-[10px] text-gray-400 hover:text-white"
                >
                  clear
                </button>
              )}
            </div>
            {visibleRows.length === 0 ? (
              <p className="text-[11px] text-gray-400">No DTUs in scope.</p>
            ) : (
              <ul className="max-h-[360px] space-y-1 overflow-auto">
                {visibleRows.slice(0, 60).map((d) => {
                  const on = selected.includes(d.id);
                  return (
                    <li key={d.id} className="flex items-center gap-2">
                      <button
                        onClick={() => toggleSelect(d.id)}
                        className="text-gray-400 hover:text-neon-green"
                        aria-label={on ? 'Deselect DTU' : 'Select DTU'}
                      >
                        {on ? (
                          <CheckSquare className="h-3.5 w-3.5 text-neon-green" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setFocusId(d.id);
                          onSelectDtu?.(d.id);
                        }}
                        className={`min-w-0 flex-1 truncate text-left text-[11px] ${
                          focusId === d.id ? 'text-neon-cyan' : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        {String(d.title || d.id)}
                      </button>
                      <span className="rounded bg-lattice-surface px-1 py-0.5 text-[9px] uppercase text-gray-400">
                        {String(d.tier || 'regular').slice(0, 3)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {selected.length === 2 && (
              <button
                onClick={() => setTab('compare')}
                className="mt-2 w-full rounded bg-neon-pink/15 py-1 text-[11px] text-neon-pink hover:bg-neon-pink/25"
              >
                Compare the 2 selected →
              </button>
            )}
            {selected.length > 0 && (
              <button
                onClick={() => setTab('bulk')}
                className="mt-1.5 w-full rounded bg-neon-green/15 py-1 text-[11px] text-neon-green hover:bg-neon-green/25"
              >
                Bulk-edit {selected.length} selected →
              </button>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
