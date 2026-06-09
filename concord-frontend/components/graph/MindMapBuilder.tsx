'use client';

/**
 * MindMapBuilder — XMind / MindMeister-shape concept-graph builder:
 * a central topic with branch nodes and free edges, plus degree
 * metrics. Wires the graph.map-*, graph.node-*, graph.edge-* and
 * graph.map-metrics macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Workflow, Plus, Trash2, Loader2, GitBranch } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GNode { id: string; label: string; notes: string; central: boolean }
interface GEdge { id: string; from: string; to: string; label: string }
interface GMap { id: string; title: string; nodes: GNode[]; edges: GEdge[] }
interface MapMeta { id: string; title: string; nodeCount: number; edgeCount: number }
interface Metrics { nodeCount: number; edgeCount: number; avgDegree: number; mostConnected: { label: string; degree: number } | null; isolatedNodes: number }

export function MindMapBuilder() {
  const [maps, setMaps] = useState<MapMeta[]>([]);
  const [active, setActive] = useState<GMap | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMap, setNewMap] = useState('');
  const [addParent, setAddParent] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const r = await lensRun('graph', 'map-list', {});
    setMaps((r.data?.result?.maps as MapMeta[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = useCallback(async (id: string) => {
    const [d, m] = await Promise.all([
      lensRun('graph', 'map-detail', { id }),
      lensRun('graph', 'map-metrics', { id }),
    ]);
    if (d.data?.ok) setActive(d.data.result?.map as GMap);
    setMetrics((m.data?.result as Metrics) || null);
  }, []);
  async function reload() { if (active) await open(active.id); }

  async function createMap() {
    if (!newMap.trim()) return;
    const r = await lensRun('graph', 'map-create', { title: newMap.trim() });
    setNewMap('');
    await refresh();
    if (r.data?.ok) await open(r.data.result?.map.id);
  }
  async function deleteMap(id: string) {
    if (!confirm('Delete this map?')) return;
    await lensRun('graph', 'map-delete', { id });
    if (active?.id === id) { setActive(null); setMetrics(null); }
    await refresh();
  }
  async function addNode(parentId: string) {
    const label = (addParent[parentId] || '').trim();
    if (!active || !label) return;
    await lensRun('graph', 'node-add', { mapId: active.id, label, parentId });
    setAddParent({ ...addParent, [parentId]: '' });
    await reload(); await refresh();
  }
  async function delNode(nodeId: string) {
    if (!active) return;
    const r = await lensRun('graph', 'node-delete', { mapId: active.id, nodeId });
    if (!r.data?.ok) alert(r.data?.error || 'Cannot delete.');
    await reload(); await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  // children of a node (tree rendering via edges)
  const childrenOf = (nodeId: string): GNode[] => {
    if (!active) return [];
    return active.edges.filter(e => e.from === nodeId).map(e => active.nodes.find(n => n.id === e.to)).filter(Boolean) as GNode[];
  };

  function NodeBranch({ node, depth }: { node: GNode; depth: number }) {
    if (!active) return null;
    const kids = childrenOf(node.id);
    return (
      <div className={cn(depth > 0 && 'ml-4 pl-3 border-l border-zinc-800')}>
        <div className="group flex items-center gap-1.5 py-0.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', node.central ? 'bg-violet-400' : 'bg-zinc-500')} />
          <span className={cn('text-xs', node.central ? 'font-bold text-violet-200' : 'text-zinc-200')}>{node.label}</span>
          {!node.central && (
            <button aria-label="Delete" onClick={() => delNode(node.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          )}
        </div>
        {kids.map(k => <NodeBranch key={k.id} node={k} depth={depth + 1} />)}
        <div className="flex gap-1 ml-3 my-0.5">
          <input value={addParent[node.id] || ''} onChange={e => setAddParent({ ...addParent, [node.id]: e.target.value })}
            onKeyDown={e => { if (e.key === 'Enter') void addNode(node.id); }}
            placeholder="+ branch" className="w-32 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300" />
          <button aria-label="Branch" onClick={() => addNode(node.id)} className="text-zinc-600 hover:text-violet-300"><GitBranch className="w-3 h-3" /></button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Workflow className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Mind Map Builder</h3>
        <span className="text-[11px] text-zinc-400">XMind shape</span>
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {maps.map(m => (
          <span key={m.id} className="group inline-flex items-center gap-1">
            <button onClick={() => open(m.id)}
              className={cn('px-2.5 py-1 text-xs rounded-lg border', active?.id === m.id ? 'bg-violet-600/15 border-violet-700/50 text-violet-200' : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700')}>
              {m.title} <span className="text-zinc-600">{m.nodeCount}</span>
            </button>
            <button aria-label="Delete" onClick={() => deleteMap(m.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          </span>
        ))}
        <input value={newMap} onChange={e => setNewMap(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createMap(); }}
          placeholder="New map" className="w-28 bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-200" />
        <button aria-label="Add" onClick={createMap} className="px-2 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white"><Plus className="w-3.5 h-3.5" /></button>
      </div>

      {active ? (
        <div>
          {metrics && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-[11px] text-zinc-400">
              <span>{metrics.nodeCount} nodes</span>
              <span>{metrics.edgeCount} edges</span>
              <span>avg degree {metrics.avgDegree}</span>
              {metrics.mostConnected && <span>hub: <strong className="text-violet-300">{metrics.mostConnected.label}</strong> ({metrics.mostConnected.degree})</span>}
            </div>
          )}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            {active.nodes.filter(n => n.central).map(c => <NodeBranch key={c.id} node={c} depth={0} />)}
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
          Select or create a mind map.
        </div>
      )}
    </div>
  );
}
