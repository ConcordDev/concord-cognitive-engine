'use client';

/**
 * GdNarrativePanel — Twine-shape branching narrative. Nodes are story
 * beats (start / scene / choice / ending); links carry choice labels.
 * The panel surfaces a reachability analysis of the whole graph.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, GitBranch, ArrowRight, Flag, Square } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Node { id: string; title: string; kind: string; body: string }
interface Link { id: string; fromId: string; toId: string; label: string }
interface Graph {
  totalNodes: number; totalLinks: number; starts: number; endings: number;
  orphans: string[]; unreachable: string[]; maxDepth: number;
  avgChoicesPerNode: number; replayValue: string; health: string;
}

const KINDS = ['start', 'scene', 'choice', 'ending'];
const KIND_COLOR: Record<string, string> = {
  start: 'text-emerald-400', scene: 'text-sky-400', choice: 'text-amber-400', ending: 'text-rose-400',
};

export function GdNarrativePanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', kind: 'scene', body: '' });
  const [linkDraft, setLinkDraft] = useState<Record<string, { toId: string; label: string }>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [n, g] = await Promise.all([
      lensRun('game-design', 'narrative-node-list', { gameId }),
      lensRun('game-design', 'narrative-graph', { gameId }),
    ]);
    setNodes(n.data?.result?.nodes || []);
    setLinks(n.data?.result?.links || []);
    setGraph((g.data?.result?.totalNodes ? g.data.result : null) as Graph | null);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addNode = async () => {
    if (!form.title.trim()) { setError('Node title is required.'); return; }
    const r = await lensRun('game-design', 'narrative-node-create', {
      gameId, title: form.title.trim(), kind: form.kind, body: form.body.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', kind: 'scene', body: '' });
    setError(null);
    await refresh();
  };

  const updateNode = async (id: string, patch: Partial<Node>) => {
    setNodes(nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    await lensRun('game-design', 'narrative-node-update', { id, ...patch });
  };

  const delNode = async (id: string) => {
    await lensRun('game-design', 'narrative-node-delete', { id });
    await refresh();
  };

  const addLink = async (fromId: string) => {
    const d = linkDraft[fromId];
    if (!d?.toId) return;
    const r = await lensRun('game-design', 'narrative-link-add', { fromId, toId: d.toId, label: d.label?.trim() || '' });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setLinkDraft({ ...linkDraft, [fromId]: { toId: '', label: '' } });
    setError(null);
    await refresh();
  };

  const delLink = async (id: string) => {
    await lensRun('game-design', 'narrative-link-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.title || '—';

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Node title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" onClick={addNode}
            className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Node
          </button>
        </div>
        <input placeholder="Beat text (optional)" value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </section>

      {graph && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <GraphStat label="Nodes" value={graph.totalNodes} />
          <GraphStat label="Links" value={graph.totalLinks} />
          <GraphStat label="Endings" value={graph.endings} />
          <GraphStat label="Max depth" value={graph.maxDepth} />
          <GraphStat label="Avg choices" value={graph.avgChoicesPerNode} />
          <GraphStat label="Replay" value={graph.replayValue} />
        </div>
      )}
      {graph && (
        <p className={cn('text-[11px] px-1',
          graph.unreachable.length === 0 && graph.orphans.length === 0 ? 'text-emerald-400' : 'text-amber-400')}>
          {graph.health}
          {graph.unreachable.length > 0 && ` · unreachable: ${graph.unreachable.join(', ')}`}
        </p>
      )}

      {nodes.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No narrative nodes yet.</p>
      ) : (
        <ul className="space-y-2">
          {nodes.map((n) => {
            const outgoing = links.filter((l) => l.fromId === n.id);
            const d = linkDraft[n.id] || { toId: '', label: '' };
            const isOpen = expanded === n.id;
            return (
              <li key={n.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {n.kind === 'start' ? <Flag className="w-4 h-4 text-emerald-400 shrink-0" />
                    : n.kind === 'ending' ? <Square className="w-4 h-4 text-rose-400 shrink-0" />
                      : <GitBranch className="w-4 h-4 text-zinc-400 shrink-0" />}
                  <button type="button" onClick={() => setExpanded(isOpen ? null : n.id)} className="flex-1 text-left">
                    <span className="text-sm font-semibold text-zinc-100">{n.title}</span>
                    <span className={cn('ml-2 text-[10px] uppercase', KIND_COLOR[n.kind])}>{n.kind}</span>
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => delNode(n.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {n.body && <p className="text-[11px] text-zinc-400">{n.body}</p>}

                {outgoing.length > 0 && (
                  <ul className="space-y-1">
                    {outgoing.map((l) => (
                      <li key={l.id} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                        <ArrowRight className="w-3 h-3 text-lime-400 shrink-0" />
                        <span className="text-amber-300">{l.label}</span>
                        <span className="text-zinc-400">→</span>
                        <span className="flex-1 truncate">{titleOf(l.toId)}</span>
                        <button aria-label="Delete" type="button" onClick={() => delLink(l.id)} className="text-zinc-600 hover:text-rose-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {isOpen && (
                  <div className="space-y-2 pt-1 border-t border-zinc-800">
                    <select value={n.kind} onChange={(e) => updateNode(n.id, { kind: e.target.value })}
                      className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 capitalize">
                      {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <textarea value={n.body} onChange={(e) => updateNode(n.id, { body: e.target.value })}
                      placeholder="Beat text" rows={2}
                      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[11px] text-zinc-200 resize-y" />
                    <div className="flex items-center gap-1.5">
                      <input placeholder="Choice label" value={d.label}
                        onChange={(e) => setLinkDraft({ ...linkDraft, [n.id]: { ...d, label: e.target.value } })}
                        className="w-32 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                      <select value={d.toId} onChange={(e) => setLinkDraft({ ...linkDraft, [n.id]: { ...d, toId: e.target.value } })}
                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
                        <option value="">Link to…</option>
                        {nodes.filter((t) => t.id !== n.id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                      </select>
                      <button type="button" onClick={() => addLink(n.id)}
                        className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">+ Link</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GraphStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-sm font-bold text-zinc-100 capitalize">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
