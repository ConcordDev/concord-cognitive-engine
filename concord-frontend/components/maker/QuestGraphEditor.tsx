'use client';

/**
 * QuestGraphEditor — branching quest authoring as a draggable node
 * graph. Backed by `app-maker` quest graph macros (questGraph*, questNode*,
 * questEdge*, questGraphValidate).
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Wand2, Plus, Trash2, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';

interface QNode { id: string; kind: string; title: string; body: string; x: number; y: number; reward?: string }
interface QEdge { id: string; from: string; to: string; label?: string }
interface Graph { id: string; title: string; nodes: QNode[]; edges: QEdge[] }
interface GraphMeta { id: string; title: string; nodeCount: number; edgeCount: number }
interface Issue { severity: string; type: string; nodeId?: string; title?: string }

const KINDS = ['start', 'step', 'choice', 'reward', 'ending'];
const KIND_COLOR: Record<string, string> = {
  start: '#10b981', step: '#06b6d4', choice: '#f59e0b', reward: '#a855f7', ending: '#f43f5e',
};

export function QuestGraphEditor() {
  const [graphs, setGraphs] = useState<GraphMeta[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  const refreshList = useCallback(async () => {
    const r = await lensRun('app-maker', 'questGraphList', {});
    if (r.data?.ok) setGraphs(r.data.result?.graphs ?? []);
  }, []);

  useEffect(() => { void refreshList(); }, [refreshList]);

  async function loadGraph(id: string) {
    const r = await lensRun('app-maker', 'questGraphGet', { graphId: id });
    if (r.data?.ok) { setGraph(r.data.result?.graph ?? null); setIssues(null); setSelected(null); }
  }

  async function createGraph() {
    setBusy(true);
    const r = await lensRun('app-maker', 'questGraphCreate', { title: 'New Quest' });
    setBusy(false);
    if (r.data?.ok) { await refreshList(); await loadGraph(r.data.result?.graph?.id); }
  }

  async function deleteGraph(id: string) {
    const r = await lensRun('app-maker', 'questGraphDelete', { graphId: id });
    if (r.data?.ok) { if (graph?.id === id) setGraph(null); await refreshList(); }
  }

  async function addNode(kind: string) {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questNodeSave', {
      graphId: graph.id,
      node: { kind, title: kind, body: '', x: 60 + Math.random() * 360, y: 60 + Math.random() * 220 },
    });
    if (r.data?.ok) setGraph({ ...graph, nodes: r.data.result?.nodes ?? graph.nodes });
  }

  async function saveNode(node: QNode) {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questNodeSave', { graphId: graph.id, node });
    if (r.data?.ok) setGraph({ ...graph, nodes: r.data.result?.nodes ?? graph.nodes });
  }

  async function deleteNode(id: string) {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questNodeDelete', { graphId: graph.id, nodeId: id });
    if (r.data?.ok) {
      setGraph({ ...graph, nodes: r.data.result?.nodes ?? graph.nodes, edges: r.data.result?.edges ?? graph.edges });
      setSelected(null);
    }
  }

  async function addEdge(from: string, to: string) {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questEdgeAdd', { graphId: graph.id, from, to });
    if (r.data?.ok) setGraph({ ...graph, edges: r.data.result?.edges ?? graph.edges });
  }

  async function deleteEdge(id: string) {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questEdgeDelete', { graphId: graph.id, edgeId: id });
    if (r.data?.ok) setGraph({ ...graph, edges: r.data.result?.edges ?? graph.edges });
  }

  async function validate() {
    if (!graph) return;
    const r = await lensRun('app-maker', 'questGraphValidate', { graphId: graph.id });
    if (r.data?.ok) setIssues(r.data.result?.issues ?? []);
  }

  function nodeClick(id: string) {
    if (linkFrom && linkFrom !== id) { void addEdge(linkFrom, id); setLinkFrom(null); }
    else { setSelected(id); }
  }

  function onPointerDown(e: React.PointerEvent, n: QNode) {
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDrag({ id: n.id, dx: e.clientX - rect.left - n.x, dy: e.clientY - rect.top - n.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag || !graph) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - drag.dx));
    const y = Math.max(0, Math.round(e.clientY - rect.top - drag.dy));
    setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === drag.id ? { ...n, x, y } : n)) });
  }
  function onPointerUp() {
    if (drag && graph) {
      const n = graph.nodes.find((x) => x.id === drag.id);
      if (n) void saveNode(n);
    }
    setDrag(null);
  }

  const sel = graph?.nodes.find((n) => n.id === selected) ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[200px_1fr_240px]">
      {/* Graph list */}
      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-pink-500">Quest graphs</h4>
          <button onClick={createGraph} disabled={busy} className="text-pink-400 hover:text-pink-200">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
        <ul className="space-y-1">
          {graphs.map((g) => (
            <li key={g.id} className="flex items-center gap-1">
              <button
                onClick={() => loadGraph(g.id)}
                className={`flex-1 truncate rounded px-1.5 py-1 text-left text-[11px] ${
                  graph?.id === g.id ? 'bg-pink-700/50 text-pink-100' : 'text-pink-400 hover:text-pink-200'
                }`}
              >
                {g.title} <span className="text-pink-700">· {g.nodeCount}n</span>
              </button>
              <button aria-label="Delete" onClick={() => deleteGraph(g.id)} className="text-rose-500 hover:text-rose-300">
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
          {!graphs.length && <li className="text-[11px] text-pink-700">No quest graphs.</li>}
        </ul>
      </aside>

      {/* Canvas */}
      <div>
        {!graph && <p className="rounded border border-pink-900/30 bg-pink-950/10 px-4 py-8 text-center text-xs text-pink-600">Select or create a quest graph.</p>}
        {graph && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  onClick={() => addNode(k)}
                  className="rounded border px-1.5 py-1 text-[10px] capitalize"
                  style={{ borderColor: KIND_COLOR[k], color: KIND_COLOR[k] }}
                >
                  + {k}
                </button>
              ))}
              <button
                onClick={validate}
                className="ml-auto inline-flex items-center gap-1 rounded border border-pink-700/50 px-2 py-1 text-[11px] text-pink-300 hover:bg-pink-900/30"
              >
                <ShieldCheck className="h-3 w-3" /> Validate
              </button>
            </div>
            <div
              className="relative h-[400px] overflow-hidden rounded-lg border border-pink-900/40 bg-[#020617]"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <svg className="pointer-events-none absolute inset-0 h-full w-full">
                {graph.edges.map((e) => {
                  const a = graph.nodes.find((n) => n.id === e.from);
                  const b = graph.nodes.find((n) => n.id === e.to);
                  if (!a || !b) return null;
                  return (
                    <g key={e.id}>
                      <line x1={a.x + 70} y1={a.y + 22} x2={b.x + 70} y2={b.y + 22}
                        stroke="#be185d" strokeWidth={1.5} markerEnd="url(#qarrow)" />
                    </g>
                  );
                })}
                <defs>
                  <marker id="qarrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#be185d" />
                  </marker>
                </defs>
              </svg>
              {graph.nodes.map((n) => (
                <div
                  key={n.id}
                  onPointerDown={(e) => onPointerDown(e, n)}
                  onClick={() => nodeClick(n.id)}
                  className={`absolute w-[140px] cursor-move rounded-md border-2 px-2 py-1.5 text-[10px] ${
                    selected === n.id ? 'ring-2 ring-pink-300' : ''
                  } ${linkFrom === n.id ? 'ring-2 ring-amber-400' : ''}`}
                  style={{ left: n.x, top: n.y, borderColor: KIND_COLOR[n.kind] ?? '#888', background: '#0f172a' }} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                  <div className="font-semibold text-pink-100">{n.title}</div>
                  <div className="capitalize text-pink-600">{n.kind}</div>
                </div>
              ))}
            </div>
            {linkFrom && <p className="mt-1 text-[10px] text-amber-400">Click a target node to draw an edge — or click the source again to cancel.</p>}
            {issues && (
              <div className="mt-2 rounded border border-pink-900/40 bg-pink-950/10 p-2 text-[11px]">
                {issues.length === 0 ? (
                  <p className="text-emerald-400">No structural issues.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {issues.map((iss, i) => (
                      <li key={i} className="flex items-center gap-1">
                        <AlertTriangle className={`h-3 w-3 ${iss.severity === 'error' ? 'text-rose-400' : iss.severity === 'warning' ? 'text-amber-400' : 'text-sky-400'}`} />
                        <span className="text-pink-300">{iss.type.replace(/_/g, ' ')}{iss.title ? `: ${iss.title}` : ''}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Node inspector */}
      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2.5 text-[11px]">
        <h4 className="mb-2 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-pink-500">
          <Wand2 className="h-3 w-3" /> Node
        </h4>
        {!sel && <p className="text-pink-700">Select a node to edit it.</p>}
        {sel && (
          <div className="space-y-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Title</span>
              <input
                value={sel.title}
                onChange={(e) => setGraph(graph ? { ...graph, nodes: graph.nodes.map((n) => (n.id === sel.id ? { ...n, title: e.target.value } : n)) } : graph)}
                onBlur={() => saveNode(sel)}
                className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Body</span>
              <textarea
                value={sel.body}
                onChange={(e) => setGraph(graph ? { ...graph, nodes: graph.nodes.map((n) => (n.id === sel.id ? { ...n, body: e.target.value } : n)) } : graph)}
                onBlur={() => saveNode(sel)}
                className="h-16 w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
              />
            </label>
            {(sel.kind === 'reward' || sel.kind === 'ending') && (
              <label className="block">
                <span className="mb-0.5 block text-[10px] uppercase text-pink-700">Reward</span>
                <input
                  value={sel.reward ?? ''}
                  onChange={(e) => setGraph(graph ? { ...graph, nodes: graph.nodes.map((n) => (n.id === sel.id ? { ...n, reward: e.target.value } : n)) } : graph)}
                  onBlur={() => saveNode(sel)}
                  className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
                />
              </label>
            )}
            <div className="flex gap-1.5">
              <button onClick={() => setLinkFrom(sel.id)} className="flex-1 rounded bg-amber-700/40 px-2 py-1 text-[10px] text-amber-200 hover:bg-amber-600/50">
                Draw edge →
              </button>
              {sel.kind !== 'start' && (
                <button aria-label="Delete" onClick={() => deleteNode(sel.id)} className="rounded bg-rose-900/40 px-2 py-1 text-rose-300 hover:bg-rose-800/50">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            {graph && graph.edges.filter((e) => e.from === sel.id).length > 0 && (
              <div className="border-t border-pink-900/40 pt-1.5">
                <div className="mb-1 text-[10px] uppercase text-pink-700">Outgoing</div>
                {graph.edges.filter((e) => e.from === sel.id).map((e) => {
                  const tgt = graph.nodes.find((n) => n.id === e.to);
                  return (
                    <div key={e.id} className="flex items-center gap-1 text-[10px]">
                      <span className="text-pink-300">→ {tgt?.title ?? '?'}</span>
                      <button aria-label="Delete" onClick={() => deleteEdge(e.id)} className="ml-auto text-rose-400 hover:text-rose-300">
                        <Trash2 className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
