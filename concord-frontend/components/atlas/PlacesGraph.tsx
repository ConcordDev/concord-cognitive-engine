'use client';

/**
 * PlacesGraph — force-directed knowledge graph of the user's REAL saved
 * atlas data. Nodes are saved places + lists (from the places-list /
 * lists-list macros); edges connect each list to the places it
 * contains. No mock seed data — the graph is empty until the user
 * saves places.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Network } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { GraphView, type GraphNode, type GraphEdge } from './GraphView';

interface SavedPlace {
  id: string;
  name: string;
  category: string;
}

interface SavedList {
  id: string;
  name: string;
  placeIds?: string[];
}

export function PlacesGraph() {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [placesRes, listsRes] = await Promise.all([
        lensRun<{ places: SavedPlace[] }>('atlas', 'places-list', {}),
        lensRun<{ lists: SavedList[] }>('atlas', 'lists-list', {}),
      ]);
      const places = (placesRes.data?.ok && placesRes.data.result?.places) || [];
      const lists = (listsRes.data?.ok && listsRes.data.result?.lists) || [];

      const gNodes: GraphNode[] = [
        ...places.map((p) => ({
          id: `place:${p.id}`,
          label: p.name,
          group: p.category || 'place',
          weight: 0.7,
        })),
        ...lists.map((l) => ({
          id: `list:${l.id}`,
          label: l.name,
          group: 'list',
          weight: 1.0,
        })),
      ];
      const gEdges: GraphEdge[] = [];
      for (const l of lists) {
        for (const pid of l.placeIds || []) {
          if (places.some((p) => p.id === pid)) {
            gEdges.push({ source: `list:${l.id}`, target: `place:${pid}`, kind: 'parent' });
          }
        }
      }
      setNodes(gNodes);
      setEdges(gEdges);
    } catch {
      setNodes([]);
      setEdges([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Network className="h-4 w-4 text-emerald-400" /> Saved-places graph
        </h2>
        <button
          type="button"
          onClick={refresh}
          className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="flex h-[300px] items-center justify-center text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-2 rounded border border-dashed border-zinc-800 text-center text-[11px] text-zinc-400">
          <Network className="h-6 w-6 text-zinc-700" />
          No data yet. Save places and group them into lists — they appear here as a connected graph.
        </div>
      ) : (
        <GraphView nodes={nodes} edges={edges} />
      )}
    </div>
  );
}
