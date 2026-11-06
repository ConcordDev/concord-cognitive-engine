'use client';

/**
 * LatticePanel — cross-domain resonance lattice + GraphML/CSV/JSON export.
 * Extracted from literary/page.tsx consolidation.
 */

import { useCallback, useEffect, useState } from 'react';
import { GraphView, type GraphNode, type GraphEdge } from '@/components/atlas/GraphView';
import { lensRun } from '@/lib/api/client';
import { Download, Network } from 'lucide-react';
import { graphToGraphML, graphToCSV, downloadBlob } from '@/components/literary/literary-shared';

interface ProvenanceInfo {
  title?: string;
  author?: string;
  license?: string;
  gutenbergId?: string;
  chunkCount?: number;
}

export function LatticePanel() {
  const [lattice, setLattice] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [provenance, setProvenance] = useState<ProvenanceInfo | null>(null);

  useEffect(() => {
    setLoading(true);
    // scope: "literary" — the graph is THIS corpus's passages and the DTUs
    // they bridge/cite, not the platform's whole citation history rendered
    // under this lens's name (the "236 nodes over 0 works" defect).
    lensRun<{ ok: boolean; nodes: GraphNode[]; edges: GraphEdge[] }>('literary', 'resonance_graph', { limit: 120, scope: 'literary' })
      .then((r) => {
        const g = r.data?.result;
        if (g?.nodes?.length) setLattice({ nodes: g.nodes, edges: g.edges || [] });
      })
      .catch((e) => console.warn('[literary] resonance_graph load failed:', e))
      .finally(() => setLoading(false));
  }, []);

  // A node opens to what it is: its provenance when it is a literary passage,
  // its title + home lens when it is a bridge target from elsewhere.
  useEffect(() => {
    if (!selected) { setProvenance(null); return; }
    let live = true;
    lensRun<{ ok: boolean; provenance?: ProvenanceInfo }>('literary', 'provenance', { dtuId: selected.id })
      .then((r) => { if (live) setProvenance(r.data?.result?.ok ? (r.data.result.provenance ?? null) : null); })
      .catch(() => { if (live) setProvenance(null); });
    return () => { live = false; };
  }, [selected]);

  const selectedConnections = selected
    ? lattice.edges.filter((e) => e.source === selected.id || e.target === selected.id).length
    : 0;

  const exportGraph = useCallback((fmt: 'graphml' | 'csv' | 'json') => {
    const g = lattice;
    if (!g.nodes.length) return;
    if (fmt === 'graphml') downloadBlob(graphToGraphML(g.nodes, g.edges), 'literary-resonance.graphml', 'application/graphml+xml');
    else if (fmt === 'csv') downloadBlob(graphToCSV(g.edges), 'literary-resonance.csv', 'text/csv');
    else downloadBlob(JSON.stringify({ nodes: g.nodes, edges: g.edges }, null, 2), 'literary-resonance.json', 'application/json');
  }, [lattice]);

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading resonance lattice…</p>;
  }

  if (lattice.nodes.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
        <Network className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
        <p className="text-sm text-zinc-400">No resonance bridges yet.</p>
        <p className="text-xs text-zinc-500 mt-1">Search and annotate passages to grow the lattice.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <h3 className="flex items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800 text-sm font-semibold text-zinc-300">
        <span className="flex items-center gap-2">
          <Network className="w-4 h-4 text-amber-300" aria-hidden="true" /> Resonance lattice
          <span className="text-[11px] text-zinc-500 font-normal">— {lattice.nodes.length} nodes · {lattice.edges.length} bridges + citations, anchored on this corpus</span>
        </span>
        <span className="flex items-center gap-1 text-xs font-normal text-zinc-400">
          <Download className="w-3 h-3 text-zinc-500" />
          <button type="button" onClick={() => exportGraph('graphml')} className="hover:text-violet-300 underline">GraphML</button>
          <button type="button" onClick={() => exportGraph('csv')} className="hover:text-violet-300 underline">CSV</button>
          <button type="button" onClick={() => exportGraph('json')} className="hover:text-violet-300 underline">JSON</button>
        </span>
      </h3>
      <GraphView
        nodes={lattice.nodes}
        edges={lattice.edges}
        focusedId={selected?.id}
        onNodeClick={(n) => setSelected(n)}
        className="w-full h-80"
      />
      {selected && (
        <div className="border-t border-zinc-800 px-4 py-3 text-xs space-y-1" data-testid="lattice-node-detail">
          <p className="text-sm text-zinc-100 font-medium">{selected.label || selected.id}</p>
          <p className="text-zinc-400">
            {provenance
              ? <>Literary passage{provenance.author ? <> · {provenance.author}</> : ''}
                  {provenance.license ? <> · license {provenance.license}</> : ''}
                  {provenance.gutenbergId ? <> · Gutenberg #{provenance.gutenbergId}</> : ''}</>
              : <>A DTU this corpus bridges to{selected.group ? <> · from the {selected.group} lens</> : ''}</>}
            {' · '}{selectedConnections} connection{selectedConnections === 1 ? '' : 's'} in this graph
          </p>
        </div>
      )}
    </div>
  );
}
