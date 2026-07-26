'use client';

/**
 * PlacesGraph — force-directed knowledge graph of the user's REAL saved
 * atlas data. Nodes are saved places + lists (from the places-list /
 * lists-list macros); edges connect each list to the places it
 * contains. No mock seed data — the graph is empty until the user
 * saves places.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { Loader2, Network, MapPin, ListChecks } from 'lucide-react';
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
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [placesRes, listsRes] = await Promise.all([
        lensRun<{ places: SavedPlace[] }>('atlas', 'places-list', {}),
        lensRun<{ lists: SavedList[] }>('atlas', 'lists-list', {}),
      ]);
      const places = (placesRes.data?.ok && placesRes.data.result?.places) || [];
      const lists = (listsRes.data?.ok && listsRes.data.result?.lists) || [];
      setPlaces(places);
      setLists(lists);

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

  // Clear a stale selection whenever the graph is rebuilt (e.g. a manual
  // Refresh, or a place/list being deleted elsewhere in the atlas lens).
  useEffect(() => { setSelected(null); }, [nodes]);

  // Real detail for whatever node was last clicked — a place shows its
  // category + which of the user's lists contain it; a list shows its
  // member place names. Derived entirely from already-fetched data, never
  // a second round-trip.
  const selectedDetail = useMemo(() => {
    if (!selected) return null;
    if (selected.id.startsWith('place:')) {
      const placeId = selected.id.slice('place:'.length);
      const place = places.find((p) => p.id === placeId);
      if (!place) return null;
      const memberLists = lists.filter((l) => (l.placeIds || []).includes(placeId));
      return { kind: 'place' as const, place, memberLists };
    }
    if (selected.id.startsWith('list:')) {
      const listId = selected.id.slice('list:'.length);
      const list = lists.find((l) => l.id === listId);
      if (!list) return null;
      const members = places.filter((p) => (list.placeIds || []).includes(p.id));
      return { kind: 'list' as const, list, members };
    }
    return null;
  }, [selected, places, lists]);

  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-void/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Network className="h-4 w-4 text-emerald-400" /> Saved-places graph
        </h2>
        <button
          type="button"
          onClick={refresh}
          className="rounded bg-lattice-elevated px-2 py-1 text-[10px] text-gray-300 hover:bg-lattice-elevated"
        >
          Refresh
        </button>
      </div>
      {loading ? (
        <div className="flex h-[300px] items-center justify-center text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex h-[300px] flex-col items-center justify-center gap-2 rounded border border-dashed border-lattice-border text-center text-[11px] text-gray-400">
          <Network className="h-6 w-6 text-gray-700" />
          No data yet. Save places and group them into lists — they appear here as a connected graph.
        </div>
      ) : (
        <>
          <GraphView nodes={nodes} edges={edges} onNodeClick={setSelected} focusedId={selected?.id} />
          {selectedDetail?.kind === 'place' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-lattice-border bg-lattice-surface p-3 text-xs">
              <MapPin className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <div>
                <div className="font-medium text-white">{selectedDetail.place.name}</div>
                <div className="text-gray-400">{selectedDetail.place.category || 'uncategorized'}</div>
                {selectedDetail.memberLists.length > 0 ? (
                  <div className="mt-1 text-gray-500">
                    In {selectedDetail.memberLists.length} list{selectedDetail.memberLists.length === 1 ? '' : 's'}: {selectedDetail.memberLists.map((l) => l.name).join(', ')}
                  </div>
                ) : (
                  <div className="mt-1 text-gray-600">Not in any list yet.</div>
                )}
              </div>
            </div>
          )}
          {selectedDetail?.kind === 'list' && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-lattice-border bg-lattice-surface p-3 text-xs">
              <ListChecks className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <div>
                <div className="font-medium text-white">{selectedDetail.list.name}</div>
                <div className="mt-1 text-gray-500">
                  {selectedDetail.members.length === 0
                    ? 'No places in this list yet.'
                    : `${selectedDetail.members.length} place${selectedDetail.members.length === 1 ? '' : 's'}: ${selectedDetail.members.map((p) => p.name).join(', ')}`}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
