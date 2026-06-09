'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * OneLineDiagram — build an electrical one-line / circuit map as a node
 * tree (utility &rarr; meter &rarr; main panel &rarr; subpanels / loads). Renders via
 * the shared TreeDiagram viz. Persists via electrical.diagram* macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Network, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, type TreeNode } from '@/components/viz';

interface DiagramNode { id: string; kind: string; label: string; rating: string; parentId: string | null }
interface Diagram { id: string; name: string; nodes: DiagramNode[]; edges: Array<{ from: string; to: string }> }

const KINDS = [
  { value: 'utility', label: 'Utility supply' },
  { value: 'meter', label: 'Meter' },
  { value: 'main_panel', label: 'Main panel' },
  { value: 'subpanel', label: 'Subpanel' },
  { value: 'transformer', label: 'Transformer' },
  { value: 'disconnect', label: 'Disconnect' },
  { value: 'circuit', label: 'Circuit' },
  { value: 'load', label: 'Load' },
  { value: 'generator', label: 'Generator' },
  { value: 'ground', label: 'Grounding electrode' },
];
const TONE: Record<string, TreeNode['tone']> = {
  utility: 'info', meter: 'default', main_panel: 'warn', subpanel: 'warn',
  transformer: 'info', disconnect: 'bad', circuit: 'default', load: 'good',
  generator: 'info', ground: 'good',
};

function buildTree(nodes: DiagramNode[]): TreeNode[] {
  const byParent = new Map<string | null, DiagramNode[]>();
  for (const n of nodes) {
    const key = n.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(n);
  }
  const toTree = (n: DiagramNode): TreeNode => ({
    id: n.id,
    label: n.label,
    detail: `${n.kind.replace('_', ' ')}${n.rating ? ` · ${n.rating}` : ''}`,
    tone: TONE[n.kind] || 'default',
    children: (byParent.get(n.id) || []).map(toTree),
  });
  return (byParent.get(null) || []).map(toTree);
}

export function OneLineDiagram() {
  const [diagrams, setDiagrams] = useState<Diagram[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [node, setNode] = useState({ kind: 'utility', label: '', rating: '', parentId: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun<{ diagrams: Diagram[] }>('electrical', 'diagramList', {});
    const list = r.data.result?.diagrams || [];
    setDiagrams(list);
    if (list.length && !activeId) setActiveId(list[0].id);
  }, [activeId]);

  useEffect(() => { refresh(); }, []);

  const active = diagrams.find((d) => d.id === activeId) || null;

  const createDiagram = useMutation({
    mutationFn: async () => {
      const r = await lensRun<Diagram>('electrical', 'diagramCreate', { name: newName || 'One-Line Diagram' });
      await refresh();
      if (r.data.result) setActiveId(r.data.result.id);
      setNewName('');
    },
  });

  const addNode = useMutation({
    mutationFn: async () => {
      if (!activeId) return;
      await lensRun('electrical', 'diagramAddNode', {
        diagramId: activeId,
        kind: node.kind,
        label: node.label || node.kind,
        rating: node.rating,
        parentId: node.parentId || undefined,
      });
      setNode({ kind: node.kind, label: '', rating: '', parentId: node.parentId });
      await refresh();
    },
  });

  const removeNode = useMutation({
    mutationFn: async (nodeId: string) => {
      if (!activeId) return;
      await lensRun('electrical', 'diagramRemoveNode', { diagramId: activeId, nodeId });
      await refresh();
    },
  });

  const deleteDiagram = useMutation({
    mutationFn: async (diagramId: string) => {
      await lensRun('electrical', 'diagramDelete', { diagramId });
      setActiveId(null);
      await refresh();
    },
  });

  return (
    <div className="overflow-hidden rounded-xl border border-cyan-500/20 bg-gradient-to-br from-zinc-950 via-cyan-950/10 to-zinc-950">
      <header className="flex items-center justify-between border-b border-cyan-500/20 bg-zinc-900/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">One-line diagram</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.diagram*</span>
        </div>
        <div className="flex gap-1.5">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Diagram name" className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
          <button type="button" onClick={() => createDiagram.mutate()} disabled={createDiagram.isPending} className="inline-flex items-center gap-1 rounded bg-cyan-500 px-2 py-1 text-xs font-semibold text-black hover:bg-cyan-400 disabled:opacity-50">
            {createDiagram.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Plus className="h-3 w-3" />New</>}
          </button>
        </div>
      </header>

      <div className="p-4 space-y-3">
        {diagrams.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {diagrams.map((d) => (
              <button key={d.id} type="button" onClick={() => setActiveId(d.id)} className={`rounded px-2.5 py-1 text-xs ${activeId === d.id ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40' : 'border border-zinc-800 text-zinc-400 hover:text-white'}`}>
                {d.name} <span className="font-mono text-[10px] text-zinc-400">{d.nodes.length}</span>
              </button>
            ))}
          </div>
        )}

        {diagrams.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No diagrams yet. Name one and add a utility supply node to begin.</div>}

        {active && (
          <>
            <TreeDiagram root={buildTree(active.nodes)} />

            {/* add-node form */}
            <div className="grid grid-cols-[120px_1fr_72px_1fr_64px] gap-1.5 rounded-lg border border-cyan-500/15 bg-zinc-950/40 p-2">
              <select value={node.kind} onChange={(e) => setNode({ ...node, kind: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white">
                {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <input value={node.label} onChange={(e) => setNode({ ...node, label: e.target.value })} placeholder="Label" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white" />
              <input value={node.rating} onChange={(e) => setNode({ ...node, rating: e.target.value })} placeholder="200A" className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white font-mono" />
              <select value={node.parentId} onChange={(e) => setNode({ ...node, parentId: e.target.value })} className="rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-[11px] text-white">
                <option value="">— no parent (root) —</option>
                {active.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <button type="button" onClick={() => addNode.mutate()} disabled={addNode.isPending} className="rounded bg-cyan-500 px-2 py-1 text-[11px] font-semibold text-black hover:bg-cyan-400 disabled:opacity-50">
                {addNode.isPending ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : 'Add node'}
              </button>
            </div>

            {/* node list with delete */}
            {active.nodes.length > 0 && (
              <div className="space-y-1">
                {active.nodes.map((n) => (
                  <div key={n.id} className="flex items-center justify-between rounded border border-cyan-500/10 bg-zinc-950/40 px-2 py-1 text-[10px]">
                    <span className="text-zinc-200">{n.label} <span className="text-zinc-400">· {n.kind.replace('_', ' ')}{n.rating ? ` · ${n.rating}` : ''}</span></span>
                    <button aria-label="Delete" type="button" onClick={() => removeNode.mutate(n.id)} className="text-zinc-600 hover:text-rose-300"><Trash2 className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}

            <button type="button" onClick={() => deleteDiagram.mutate(active.id)} className="text-[10px] text-zinc-400 hover:text-rose-400">Delete this diagram</button>
          </>
        )}
      </div>
    </div>
  );
}
