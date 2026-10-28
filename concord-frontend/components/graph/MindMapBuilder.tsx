'use client';

/**
 * MindMapBuilder — XMind / MindMeister-shape concept-graph builder:
 * a central topic with branch nodes and free edges, plus degree
 * metrics. Wires the graph.map-*, graph.node-*, graph.edge-* and
 * graph.map-metrics macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Workflow, Plus, Trash2, Loader2, GitBranch, Link2, Route } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { GraphMapMenu } from './GraphMapMenu';
import type { GraphFacts } from './graphMapReport';

interface GNode { id: string; label: string; notes: string; central: boolean; props?: Record<string, string | number | boolean> }
interface GEdge { id: string; from: string; to: string; label: string; type?: string }
interface GMap { id: string; title: string; description?: string; nodes: GNode[]; edges: GEdge[] }
interface MapMeta { id: string; title: string; nodeCount: number; edgeCount: number }

/**
 * NodePropsEditor — the Bloom-style typed-property inspector for one
 * node. Edits go through graph.node-update's props merge (a key set to
 * null is removed server-side); values are typed: text, number, or
 * yes/no. Nothing is saved until Save, and a server refusal is shown.
 */
function NodePropsEditor({ mapId, node, onSaved }: {
  mapId: string;
  node: GNode;
  onSaved: () => Promise<void>;
}) {
  const [rows, setRows] = useState<{ key: string; kind: 'string' | 'number' | 'boolean'; value: string }[]>(
    () => Object.entries(node.props || {}).map(([key, v]) => ({
      key,
      kind: (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string') as 'string' | 'number' | 'boolean',
      value: String(v),
    })),
  );
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    const props: Record<string, string | number | boolean | null> = {};
    // removals first: keys the node had that are no longer listed
    for (const k of Object.keys(node.props || {})) {
      if (!rows.some((r) => r.key.trim() === k)) props[k] = null;
    }
    for (const r of rows) {
      const key = r.key.trim();
      if (!key) continue;
      if (r.kind === 'number') {
        const n = Number(r.value);
        if (!Number.isFinite(n)) { setError(`"${key}" is not a number.`); return; }
        props[key] = n;
      } else if (r.kind === 'boolean') {
        props[key] = r.value === 'true';
      } else {
        props[key] = r.value;
      }
    }
    const res = await lensRun('graph', 'node-update', { mapId, nodeId: node.id, props });
    if (!res.data?.ok) { setError(res.data?.error || 'Could not save properties.'); return; }
    await onSaved();
  }

  return (
    <div className="ml-3 my-1 space-y-1 rounded border border-zinc-800 bg-zinc-950/60 p-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <input value={r.key} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
            placeholder="property" aria-label="Property name" className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-200" />
          <select value={r.kind} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, kind: e.target.value as typeof r.kind } : x)))}
            aria-label="Property type" className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-300">
            <option value="string">text</option>
            <option value="number">number</option>
            <option value="boolean">yes/no</option>
          </select>
          {r.kind === 'boolean' ? (
            <select value={r.value} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              aria-label="Property value" className="bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-300">
              <option value="true">yes</option>
              <option value="false">no</option>
            </select>
          ) : (
            <input value={r.value} onChange={(e) => setRows((p) => p.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              placeholder="value" aria-label="Property value" className="w-28 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-200" />
          )}
          <button type="button" aria-label="Remove property" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="text-rose-400"><Trash2 className="w-3 h-3" /></button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={() => setRows((p) => [...p, { key: '', kind: 'string', value: '' }])} className="text-[11px] text-zinc-400 hover:text-zinc-200">+ Add property</button>
        <button type="button" onClick={() => void save()} className="px-2 py-0.5 rounded bg-violet-600 text-[11px] text-white hover:bg-violet-500">Save properties</button>
        {error && <span role="alert" className="text-[11px] text-rose-400">{error}</span>}
      </div>
    </div>
  );
}
interface Metrics { nodeCount: number; edgeCount: number; avgDegree: number; mostConnected: { label: string; degree: number } | null; isolatedNodes: number }

export function MindMapBuilder() {
  const [maps, setMaps] = useState<MapMeta[]>([]);
  const [active, setActive] = useState<GMap | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [newMap, setNewMap] = useState('');
  const [addParent, setAddParent] = useState<Record<string, string>>({});
  const [linkFrom, setLinkFrom] = useState('');
  const [linkTo, setLinkTo] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkType, setLinkType] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathResult, setPathResult] = useState<{ found: boolean; path: string[] | null; message?: string } | null>(null);
  const [pathBusy, setPathBusy] = useState(false);
  // Rework (#1706): map rename/description, import, orphans, undo, edge edit.
  const [editMapOpen, setEditMapOpen] = useState(false);
  const [mapTitle, setMapTitle] = useState('');
  const [mapDesc, setMapDesc] = useState('');
  const [mapEditError, setMapEditError] = useState<string | null>(null);
  const [undoNote, setUndoNote] = useState<string | null>(null);
  const [orphans, setOrphans] = useState<GNode[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFmt, setImportFmt] = useState<'csv' | 'json'>('csv');
  const [importTitle, setImportTitle] = useState('');
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string; errors: { row: number; error: string }[] } | null>(null);
  const [edgeEdit, setEdgeEdit] = useState<Record<string, { label: string; type: string }>>({});
  const [propsOpen, setPropsOpen] = useState<Record<string, boolean>>({});
  const [dashboard, setDashboard] = useState<{ maps: number; totalNodes: number; totalEdges: number } | null>(null);

  const refresh = useCallback(async () => {
    const [l, d] = await Promise.all([
      lensRun('graph', 'map-list', {}),
      lensRun('graph', 'graph-dashboard', {}),
    ]);
    setMaps((l.data?.result?.maps as MapMeta[]) || []);
    if (d.data?.ok) setDashboard(d.data.result as { maps: number; totalNodes: number; totalEdges: number });
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
    setOrphans(null);
    setUndoNote(null);
    setEditMapOpen(false);
    setEdgeEdit({});
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

  // graph.edge-add / edge-delete — a manual cross-link between two existing
  // nodes, distinct from the parent→branch edge node-add creates. Real
  // macros with no prior UI: node-add only ever created a tree edge, and
  // nothing rendered/deleted an edge on its own.
  async function addCrossLink() {
    if (!active || !linkFrom || !linkTo) return;
    setLinkError(null);
    const r = await lensRun('graph', 'edge-add', { mapId: active.id, fromNodeId: linkFrom, toNodeId: linkTo, label: linkLabel.trim(), type: linkType.trim() });
    if (!r.data?.ok) { setLinkError(r.data?.error || 'Could not link.'); return; }
    setLinkFrom(''); setLinkTo(''); setLinkLabel(''); setLinkType('');
    await reload(); await refresh();
  }
  async function delEdge(edgeId: string) {
    if (!active) return;
    await lensRun('graph', 'edge-delete', { mapId: active.id, edgeId });
    await reload(); await refresh();
  }

  // graph.map-update — rename / describe the active map.
  async function saveMapEdit() {
    if (!active) return;
    setMapEditError(null);
    const r = await lensRun('graph', 'map-update', { id: active.id, title: mapTitle, description: mapDesc });
    if (!r.data?.ok) { setMapEditError(r.data?.error || 'Could not save.'); return; }
    setEditMapOpen(false);
    await reload(); await refresh();
  }

  // graph.map-undo-delete — restore the most recent node/edge deletion.
  async function undoDelete() {
    if (!active) return;
    const r = await lensRun('graph', 'map-undo-delete', { mapId: active.id });
    setUndoNote(r.data?.ok
      ? `Restored the deleted ${r.data.result?.restored === 'edge' ? 'link' : 'node'}.`
      : (r.data?.error || 'Nothing to undo.'));
    if (r.data?.ok) { await reload(); await refresh(); }
  }

  // graph.map-orphans — the unlinked-node view.
  async function toggleOrphans() {
    if (!active) return;
    if (orphans) { setOrphans(null); return; }
    const r = await lensRun('graph', 'map-orphans', { id: active.id });
    setOrphans(r.data?.ok ? ((r.data.result?.orphans as GNode[]) || []) : []);
  }

  // graph.map-import — CSV of nodes or a JSON document; per-row errors
  // come back from the server and are shown, never swallowed.
  async function runImport() {
    setImportResult(null);
    const r = await lensRun('graph', 'map-import', {
      format: importFmt, title: importTitle.trim() || undefined, content: importText,
    });
    if (!r.data?.ok) {
      setImportResult({ ok: false, text: r.data?.error || 'Import failed.', errors: (r.data as { errors?: { row: number; error: string }[] })?.errors || [] });
      return;
    }
    const res = r.data.result as { map: GMap; imported: { nodes: number; edges: number }; errors: { row: number; error: string }[] };
    setImportResult({
      ok: true,
      text: `Imported ${res.imported.nodes} nodes and ${res.imported.edges} links into "${res.map.title}".`,
      errors: res.errors || [],
    });
    setImportText('');
    await refresh();
    await open(res.map.id);
  }

  // graph.edge-update — save an edited link label/type.
  async function saveEdgeEdit(edgeId: string) {
    if (!active) return;
    const draft = edgeEdit[edgeId];
    if (!draft) return;
    const r = await lensRun('graph', 'edge-update', { mapId: active.id, edgeId, label: draft.label, type: draft.type });
    if (!r.data?.ok) { setLinkError(r.data?.error || 'Could not save the link.'); return; }
    setEdgeEdit((prev) => { const next = { ...prev }; delete next[edgeId]; return next; });
    await reload(); await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  // children of a node (tree rendering via edges)
  const findPath = async () => {
    if (!active || !pathFrom || !pathTo) return;
    setPathBusy(true);
    try {
      const r = await lensRun<{ found?: boolean; path: string[] | null; message?: string }>('graph', 'pathFind', {
        edges: active.edges.map((e) => ({ source: e.from, target: e.to })), from: pathFrom, to: pathTo, directed: false,
      });
      const res = r.data?.result;
      setPathResult(res ? { found: !!res.path, path: res.path, message: res.message } : { found: false, path: null, message: r.data?.error || 'Path search failed.' });
    } finally { setPathBusy(false); }
  };

  const childrenOf = (nodeId: string): GNode[] => {
    if (!active) return [];
    return active.edges.filter(e => e.from === nodeId).map(e => active.nodes.find(n => n.id === e.to)).filter(Boolean) as GNode[];
  };

  const graphFacts: GraphFacts = active
    ? { map: active, metrics }
    : { map: null, metrics: null };

  function NodeBranch({ node, depth }: { node: GNode; depth: number }) {
    if (!active) return null;
    const kids = childrenOf(node.id);
    return (
      <div className={cn(depth > 0 && 'ml-4 pl-3 border-l border-zinc-800')}>
        <div className="group flex items-center gap-1.5 py-0.5">
          <span className={cn('w-1.5 h-1.5 rounded-full', node.central ? 'bg-violet-400' : 'bg-zinc-500')} />
          <span className={cn('text-xs', node.central ? 'font-bold text-violet-200' : 'text-zinc-200')}>{node.label}</span>
          {node.props && Object.keys(node.props).length > 0 && (
            <span className="text-[10px] text-zinc-500">{Object.keys(node.props).length} propert{Object.keys(node.props).length === 1 ? 'y' : 'ies'}</span>
          )}
          <button type="button" aria-label={`Properties of ${node.label}`} aria-expanded={!!propsOpen[node.id]}
            onClick={() => setPropsOpen((p) => ({ ...p, [node.id]: !p[node.id] }))}
            className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-200 text-[10px]">
            Properties
          </button>
          {!node.central && (
            <button aria-label="Delete" onClick={() => delNode(node.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
          )}
        </div>
        {propsOpen[node.id] && active && (
          <NodePropsEditor mapId={active.id} node={node} onSaved={async () => { await reload(); await refresh(); }} />
        )}
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
        {dashboard && (
          <span className="ml-auto text-[10px] text-zinc-500">{dashboard.maps} map{dashboard.maps === 1 ? '' : 's'} · {dashboard.totalNodes} nodes · {dashboard.totalEdges} edges</span>
        )}
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
          {active.description && <p className="mb-2 text-[11px] text-zinc-500">{active.description}</p>}
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <button type="button" onClick={() => { setMapTitle(active.title); setMapDesc(active.description || ''); setMapEditError(null); setEditMapOpen((v) => !v); }}
              className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 hover:border-zinc-600">
              Edit map
            </button>
            <button type="button" onClick={() => void undoDelete()}
              className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 hover:border-zinc-600">
              Undo delete
            </button>
            <button type="button" onClick={() => void toggleOrphans()} aria-expanded={orphans !== null}
              className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 hover:border-zinc-600">
              {orphans !== null ? 'Hide unlinked' : 'Show unlinked nodes'}
            </button>
            <button type="button" onClick={() => setImportOpen((v) => !v)} aria-expanded={importOpen}
              className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-300 hover:border-zinc-600">
              Import
            </button>
            {undoNote && <span role="status" className="text-[11px] text-zinc-400">{undoNote}</span>}
          </div>
          {editMapOpen && (
            <div className="mb-2 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 space-y-1.5">
              <input value={mapTitle} onChange={(e) => setMapTitle(e.target.value)} aria-label="Map title"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <textarea value={mapDesc} onChange={(e) => setMapDesc(e.target.value)} aria-label="Map description" rows={2}
                placeholder="What is this map about?" className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => void saveMapEdit()} className="px-2 py-0.5 rounded bg-violet-600 text-[11px] text-white hover:bg-violet-500">Save</button>
                <button type="button" onClick={() => setEditMapOpen(false)} className="px-2 py-0.5 rounded bg-zinc-800 text-[11px] text-zinc-300">Cancel</button>
                {mapEditError && <span role="alert" className="text-[11px] text-rose-400">{mapEditError}</span>}
              </div>
            </div>
          )}
          {importOpen && (
            <div className="mb-2 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={importFmt} onChange={(e) => setImportFmt(e.target.value as 'csv' | 'json')} aria-label="Import format"
                  className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300">
                  <option value="csv">CSV — one node per row (label,notes)</option>
                  <option value="json">JSON — nodes + edges by label</option>
                </select>
                <input value={importTitle} onChange={(e) => setImportTitle(e.target.value)} placeholder="New map title" aria-label="Import map title"
                  className="w-36 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300" />
                <button type="button" onClick={() => void runImport()} disabled={!importText.trim()}
                  className="px-2 py-0.5 rounded bg-violet-600 text-[11px] text-white hover:bg-violet-500 disabled:opacity-30">
                  Import
                </button>
              </div>
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={5} aria-label="Import content"
                placeholder={importFmt === 'csv' ? 'label,notes\nAlpha,first node\nBeta,second node' : '{"nodes":[{"label":"Alpha"},{"label":"Beta"}],"edges":[{"fromLabel":"Alpha","toLabel":"Beta","label":"links"}]}'}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] font-mono text-zinc-200" />
              {importResult && (
                <div className="text-[11px]">
                  <p role="status" className={importResult.ok ? 'text-zinc-300' : 'text-rose-400'}>{importResult.text}</p>
                  {importResult.errors.length > 0 && (
                    <ul className="mt-1 space-y-0.5 text-rose-300">
                      {importResult.errors.map((er, i) => <li key={i}>Row {er.row}: {er.error}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {orphans !== null && (
            <div className="mb-2 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
              <p className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1">Unlinked nodes</p>
              {orphans.length === 0
                ? <p className="text-[11px] text-zinc-500">None — every node is linked.</p>
                : (
                  <ul className="flex flex-wrap gap-1">
                    {orphans.map((n) => <li key={n.id} className="rounded bg-zinc-800/70 px-1.5 py-0.5 text-[11px] text-zinc-300">{n.label}</li>)}
                  </ul>
                )}
            </div>
          )}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            {active.nodes.filter(n => n.central).map(c => <NodeBranch key={c.id} node={c} depth={0} />)}
          </div>

          {/* Cross-links — graph.edge-add/edge-delete, independent of the tree branches above */}
          <div className="mt-3 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
              <Link2 className="w-3 h-3" /> Cross-links
            </div>
            {active.edges.length > 0 && (
              <ul className="space-y-1 mb-2">
                {active.edges.map(e => {
                  const from = active.nodes.find(n => n.id === e.from);
                  const to = active.nodes.find(n => n.id === e.to);
                  const draft = edgeEdit[e.id];
                  return (
                    <li key={e.id} className="group flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-300">
                      <span className="text-zinc-200">{from?.label || e.from}</span>
                      <span className="text-zinc-600">→</span>
                      <span className="text-zinc-200">{to?.label || e.to}</span>
                      {e.label && <span className="text-zinc-500">({e.label})</span>}
                      {e.type && <span className="rounded bg-zinc-800 px-1 py-px text-[10px] text-zinc-400">{e.type}</span>}
                      {draft ? (
                        <>
                          <input value={draft.label} onChange={(ev) => setEdgeEdit((p) => ({ ...p, [e.id]: { ...draft, label: ev.target.value } }))}
                            aria-label="Link label" placeholder="label" className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-200" />
                          <input value={draft.type} onChange={(ev) => setEdgeEdit((p) => ({ ...p, [e.id]: { ...draft, type: ev.target.value } }))}
                            aria-label="Link type" placeholder="type" className="w-16 bg-zinc-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-zinc-200" />
                          <button type="button" onClick={() => void saveEdgeEdit(e.id)} className="text-violet-300 hover:text-violet-200">Save</button>
                          <button type="button" onClick={() => setEdgeEdit((p) => { const n = { ...p }; delete n[e.id]; return n; })} className="text-zinc-500">Cancel</button>
                        </>
                      ) : (
                        <button type="button" aria-label="Edit link" onClick={() => setEdgeEdit((p) => ({ ...p, [e.id]: { label: e.label || '', type: e.type || '' } }))}
                          className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-zinc-200 ml-1">Edit</button>
                      )}
                      <button aria-label="Delete link" onClick={() => delEdge(e.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 ml-1"><Trash2 className="w-3 h-3" /></button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <select value={linkFrom} onChange={e => setLinkFrom(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300">
                <option value="">From…</option>
                {active.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <span className="text-zinc-600 text-xs">→</span>
              <select value={linkTo} onChange={e => setLinkTo(e.target.value)} className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300">
                <option value="">To…</option>
                {active.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <input value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="label (optional)" className="w-24 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300" />
              <input value={linkType} onChange={e => setLinkType(e.target.value)} placeholder="type (optional)" aria-label="Link type" className="w-20 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300" />
              <button onClick={addCrossLink} disabled={!linkFrom || !linkTo} className="text-zinc-600 hover:text-violet-300 disabled:opacity-30" aria-label="Add cross-link"><Plus className="w-3.5 h-3.5" aria-hidden="true" /></button>
            </div>
            {linkError && <p className="mt-1 text-[10px] text-rose-400">{linkError}</p>}
          </div>

          {/* Shortest connection between any two ideas — graph.pathFind over this map's edges */}
          <div className="mt-3 bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-2 text-[11px] uppercase tracking-wide text-zinc-400">
              <Route className="w-3 h-3" /> How are these connected?
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <select aria-label="Path start" value={pathFrom} onChange={e => { setPathFrom(e.target.value); setPathResult(null); }} className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300">
                <option value="">From…</option>
                {active.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <span className="text-zinc-600 text-xs">↔</span>
              <select aria-label="Path end" value={pathTo} onChange={e => { setPathTo(e.target.value); setPathResult(null); }} className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[11px] text-zinc-300">
                <option value="">To…</option>
                {active.nodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
              </select>
              <button type="button" onClick={() => void findPath()} disabled={!pathFrom || !pathTo || pathBusy} className="px-2 py-0.5 rounded bg-violet-600/30 text-[11px] text-violet-200 transition-colors hover:bg-violet-600/50 disabled:opacity-30">
                {pathBusy ? 'Searching…' : 'Find path'}
              </button>
            </div>
            {pathResult && (pathResult.found && pathResult.path ? (
              <ol className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                {pathResult.path.map((id, i) => (
                  <li key={`${id}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-zinc-600">→</span>}
                    <span className="rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-200">{active.nodes.find(n => n.id === id)?.label || id}</span>
                  </li>
                ))}
                <li className="text-zinc-500">· {pathResult.path.length - 1} step{pathResult.path.length === 2 ? '' : 's'}</li>
              </ol>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">{pathResult.message || 'These ideas are not connected yet.'}</p>
            ))}
          </div>

          <GraphMapMenu facts={graphFacts} />
        </div>
      ) : (
        <div className="bg-zinc-900/20 border border-dashed border-zinc-800 rounded-lg flex items-center justify-center text-xs text-zinc-400 min-h-[120px]">
          Select or create a mind map.
        </div>
      )}
    </div>
  );
}
