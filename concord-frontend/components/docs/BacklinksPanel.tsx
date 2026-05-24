'use client';

/**
 * BacklinksPanel — wiki-style backlinks & mentions graph. Wires
 * docs.backlinks (incoming + outgoing [[mentions]] for one page) and
 * docs.mentions-graph (whole-workspace mention edges, most-linked
 * ranking). The graph is rendered as a TreeDiagram of most-linked
 * pages and the references that point at them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';

interface BacklinkPage {
  id: string;
  title: string;
  icon: string;
  mentions?: { blockId: string; snippet: string }[];
}
interface BacklinksResult {
  page: { id: string; title: string; icon: string };
  backlinks: BacklinkPage[];
  outgoingLinks: BacklinkPage[];
  backlinkCount: number;
  outgoingCount: number;
}
interface GraphNode { id: string; title: string; icon: string; backlinks: number }
interface GraphEdge { from: string; to: string }
interface GraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  edgeCount: number;
  mostLinked: GraphNode[];
}

export function BacklinksPanel({ pageId, onOpenPage }: {
  pageId: string;
  onOpenPage: (id: string) => void;
}) {
  const [bl, setBl] = useState<BacklinksResult | null>(null);
  const [graph, setGraph] = useState<GraphResult | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, g] = await Promise.all([
      lensRun('docs', 'backlinks', { pageId }),
      lensRun('docs', 'mentions-graph', {}),
    ]);
    setBl((b.data?.result as BacklinksResult) || null);
    setGraph((g.data?.result as GraphResult) || null);
    setLoading(false);
  }, [pageId]);
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <div className="flex items-center justify-center py-4 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  const tree: TreeNode[] = (graph?.mostLinked || [])
    .filter(n => n.backlinks > 0)
    .map(n => {
      const refs = (graph?.edges || []).filter(e => e.to === n.id);
      const byId = new Map((graph?.nodes || []).map(x => [x.id, x]));
      return {
        id: n.id,
        label: `${n.icon} ${n.title}`,
        detail: `${n.backlinks} backlink${n.backlinks !== 1 ? 's' : ''}`,
        tone: n.id === pageId ? 'info' : 'default',
        children: refs.map(e => {
          const src = byId.get(e.from);
          return {
            id: `${e.from}->${e.to}`,
            label: src ? `${src.icon} ${src.title}` : e.from,
            detail: 'mentions this page',
            tone: 'good',
          } as TreeNode;
        }),
      } as TreeNode;
    });

  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-1.5 text-xs font-bold text-zinc-100">
        <Link2 className="w-3.5 h-3.5" /> Backlinks &amp; mentions
      </h4>

      <section>
        <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1">
          <ArrowDownLeft className="w-3 h-3" /> Backlinks ({bl?.backlinkCount ?? 0})
        </p>
        {(bl?.backlinks?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No pages mention this page yet.</p>
        ) : (
          <div className="space-y-1">
            {bl!.backlinks.map(p => (
              <button key={p.id} onClick={() => onOpenPage(p.id)}
                className="block w-full text-left rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 hover:border-indigo-700">
                <p className="text-[11px] text-zinc-200 truncate">{p.icon} {p.title}</p>
                {p.mentions?.map(m => (
                  <p key={m.blockId} className="text-[10px] text-zinc-400 truncate">&ldquo;{m.snippet}&rdquo;</p>
                ))}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1 flex items-center gap-1">
          <ArrowUpRight className="w-3 h-3" /> Outgoing ({bl?.outgoingCount ?? 0})
        </p>
        {(bl?.outgoingLinks?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">This page mentions no other pages.</p>
        ) : (
          <div className="space-y-1">
            {bl!.outgoingLinks.map(p => (
              <button key={p.id} onClick={() => onOpenPage(p.id)}
                className="block w-full text-left rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 hover:border-indigo-700 text-[11px] text-zinc-200 truncate">
                {p.icon} {p.title}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <p className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">
          Workspace mention graph ({graph?.edgeCount ?? 0} edges)
        </p>
        {tree.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No mentions across the workspace yet.</p>
        ) : (
          <TreeDiagram root={tree} />
        )}
      </section>
    </div>
  );
}
