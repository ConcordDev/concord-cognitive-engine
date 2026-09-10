'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { GraphCanvas, type GraphNode, type GraphEdge } from '@/components/worldmodel/GraphCanvas';
import { card, wmRun, WM_QUERY_KEYS } from '@/components/worldmodel/wm-shared';

// ─── Graph tab ──────────────────────────────────────────────────────────
export function GraphPanel() {
  const graphQ = useQuery({
    queryKey: WM_QUERY_KEYS.graph,
    queryFn: () => wmRun<{ nodes: GraphNode[]; edges: GraphEdge[] }>('graph'),
  });
  const graph = graphQ.data;
  const loading = graphQ.isLoading;
  const [selNode, setSelNode] = useState<GraphNode | null>(null);
  const [selEdge, setSelEdge] = useState<GraphEdge | null>(null);
  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-emerald-600">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-500" aria-hidden />
        <span>Loading graph…</span>
      </div>
    );
  }
  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Entity-relation graph</h3>
        <GraphCanvas
          nodes={nodes} edges={edges}
          selectedNodeId={selNode?.id}
          onSelectNode={(n) => { setSelNode(n); setSelEdge(null); }}
          onSelectEdge={(e) => { setSelEdge(e); setSelNode(null); }}
        />
        <p className="mt-2 text-[11px] text-emerald-700">
          {nodes.length} nodes · {edges.length} edges · drag nodes to reposition · node size = degree
        </p>
      </div>
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Inspector</h3>
        {!selNode && !selEdge && <p className="text-xs text-emerald-700">Click a node or edge to inspect it.</p>}
        {selNode && (
          <dl className="space-y-1.5 text-xs">
            <Row k="id" v={selNode.id} />
            <Row k="name" v={selNode.name ?? '—'} />
            <Row k="type" v={selNode.type ?? '—'} />
            <Row k="degree" v={String(selNode.degree ?? 0)} />
            {selNode.attributes && Object.entries(selNode.attributes).map(([k, v]) => (
              <Row key={k} k={`attr.${k}`} v={typeof v === 'object' ? JSON.stringify(v) : String(v)} />
            ))}
          </dl>
        )}
        {selEdge && (
          <dl className="space-y-1.5 text-xs">
            <Row k="id" v={selEdge.id} />
            <Row k="type" v={selEdge.type ?? '—'} />
            <Row k="from" v={selEdge.from} />
            <Row k="to" v={selEdge.to} />
            <Row k="weight" v={String(selEdge.weight ?? '—')} />
          </dl>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-emerald-700">{k}</dt>
      <dd className="truncate font-mono text-emerald-200">{v}</dd>
    </div>
  );
}

