'use client';

/**
 * GraphField — the Graph lens per its north-star concept
 * (docs/lens-northstar/16): "how it connects". A sparse field of real DTU
 * lattice nodes, a find-a-node search, one "+ Add node".
 *
 * Wiring (all real; an empty lattice renders an honest empty field):
 *   - nodes/links: GET /api/graph/force (graph.forceGraph over GRAPH_INDEX).
 *     Overview = the densest linked neighborhood you can see (or, with no
 *     links, a few nodes and an honest note); centered = a node plus its
 *     lineage parents/children (centerNode, depth 1)
 *   - double-click a node, or pick a search result → re-center on it
 *   - Find a node: GET /api/graph/search (same visibility-filtered index)
 *   - + Add node: POST /api/dtus, as a child of the selected node when one is
 *     selected (parents: [id]), so it appears linked in the field
 *   - Open: the DTU detail view
 * Layout is a deterministic force simulation computed once per data set
 * (no animation loop).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { cn } from '@/lib/utils';

interface RawNode { id: string; label?: string; title?: string; tier?: string }
interface RawLink { source: string; target: string; type?: string }
interface Placed { id: string; label: string; tier: string; x: number; y: number; r: number; degree: number }

const FIELD_NODES = 40;
const OVERVIEW_FETCH = 1500;
const UNLINKED_NODES = 24;
const CENTER_NODES = 40;

/**
 * Overview: the densest neighborhood, not the first N index entries. Start at
 * the highest-degree node and walk breadth-first; continue from the next hub
 * until the field is full. With no links at all, show a few nodes and say so.
 */
function pickOverview(nodes: RawNode[], links: RawLink[]): { nodes: RawNode[]; links: RawLink[]; unlinked: boolean } {
  if (links.length === 0) return { nodes: nodes.slice(0, UNLINKED_NODES), links: [], unlinked: true };
  const adj = new Map<string, string[]>();
  for (const l of links) {
    adj.set(l.source, [...(adj.get(l.source) ?? []), l.target]);
    adj.set(l.target, [...(adj.get(l.target) ?? []), l.source]);
  }
  const hubs = [...adj.keys()].sort((a, b) => (adj.get(b)!.length - adj.get(a)!.length));
  const keep = new Set<string>();
  for (const hub of hubs) {
    if (keep.size >= FIELD_NODES) break;
    if (keep.has(hub)) continue;
    const queue = [hub];
    while (queue.length && keep.size < FIELD_NODES) {
      const id = queue.shift()!;
      if (keep.has(id)) continue;
      keep.add(id);
      for (const nb of adj.get(id) ?? []) if (!keep.has(nb)) queue.push(nb);
    }
  }
  return { nodes: nodes.filter((n) => keep.has(n.id)), links: links.filter((l) => keep.has(l.source) && keep.has(l.target)), unlinked: false };
}

/** Fruchterman–Reingold style layout in a unit square, seeded by index (deterministic). */
function layout(nodes: RawNode[], links: RawLink[], centerId: string | null): Placed[] {
  const n = nodes.length;
  if (n === 0) return [];
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]));
  const E = links.map((l) => [idx.get(l.source), idx.get(l.target)]).filter((e): e is [number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);
  const deg = new Array(n).fill(0);
  for (const [a, b] of E) { deg[a]++; deg[b]++; }
  const golden = Math.PI * (3 - Math.sqrt(5));
  const px = nodes.map((_, i) => 0.5 + 0.35 * Math.sqrt((i + 0.5) / n) * Math.cos(i * golden));
  const py = nodes.map((_, i) => 0.5 + 0.35 * Math.sqrt((i + 0.5) / n) * Math.sin(i * golden));
  const k = Math.sqrt(1 / n) * 0.9;
  let t = 0.1;
  for (let it = 0; it < 260; it++) {
    const dx = new Array(n).fill(0), dy = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      let ddx = px[i] - px[j], ddy = py[i] - py[j];
      const d = Math.max(Math.hypot(ddx, ddy), 1e-3);
      const f = (k * k) / d;
      ddx /= d; ddy /= d;
      dx[i] += ddx * f; dy[i] += ddy * f; dx[j] -= ddx * f; dy[j] -= ddy * f;
    }
    for (const [a, b] of E) {
      let ddx = px[a] - px[b], ddy = py[a] - py[b];
      const d = Math.max(Math.hypot(ddx, ddy), 1e-3);
      const f = (d * d) / k;
      ddx /= d; ddy /= d;
      dx[a] -= ddx * f; dy[a] -= ddy * f; dx[b] += ddx * f; dy[b] += ddy * f;
    }
    for (let i = 0; i < n; i++) {
      // gentle pull to the middle keeps disconnected nodes on screen
      dx[i] += (0.5 - px[i]) * 0.08; dy[i] += (0.5 - py[i]) * 0.08;
      const d = Math.max(Math.hypot(dx[i], dy[i]), 1e-6);
      px[i] += (dx[i] / d) * Math.min(d, t);
      py[i] += (dy[i] / d) * Math.min(d, t);
    }
    t *= 0.985;
  }
  if (centerId && idx.has(centerId)) {
    const c = idx.get(centerId)!;
    const ox = 0.5 - px[c], oy = 0.5 - py[c];
    for (let i = 0; i < n; i++) { px[i] += ox; py[i] += oy; }
  }
  // normalise into the field so labels stay inside it
  const minX = Math.min(...px), maxX = Math.max(...px), minY = Math.min(...py), maxY = Math.max(...py);
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  const maxDeg = Math.max(1, ...deg);
  return nodes.map((nd, i) => ({
    id: nd.id,
    label: String(nd.label || nd.title || nd.id),
    tier: String(nd.tier || 'regular'),
    // right ~22% stays clear for the detail card
    x: n === 1 ? 0.42 : 0.05 + 0.72 * ((px[i] - minX) / sx),
    y: n === 1 ? 0.5 : 0.08 + 0.84 * ((py[i] - minY) / sy),
    r: 9 + 13 * Math.sqrt(deg[i] / maxDeg),
    degree: deg[i],
  }));
}

const RING: Record<string, string> = { hyper: '#2dd4bf', mega: '#a78bfa' };
const short = (s: string, n = 26) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function GraphField() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const qc = useQueryClient();
  const [centerId, setCenterId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [linkToSelected, setLinkToSelected] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 560 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const graphQ = useQuery({
    queryKey: ['graph-field', centerId],
    queryFn: async () => {
      const r = await apiHelpers.graph.force(centerId ? { centerNode: centerId, depth: 1, maxNodes: CENTER_NODES } : { maxNodes: OVERVIEW_FETCH });
      const d = r.data as { ok?: boolean; error?: string; nodes?: RawNode[]; links?: RawLink[] };
      if (d.ok === false) throw new Error(d.error || 'Could not load the graph');
      const nodes = d.nodes ?? [], links = d.links ?? [];
      return centerId ? { nodes, links, unlinked: false } : pickOverview(nodes, links);
    },
    staleTime: 30_000,
  });

  const searchQ = useQuery({
    queryKey: ['graph-field-search', debouncedQ],
    queryFn: async () => {
      const r = await apiHelpers.graph.search(debouncedQ, 8);
      return ((r.data as { results?: { id: string; title?: string; tier?: string }[] }).results ?? []);
    },
    enabled: debouncedQ.length >= 2,
  });

  const placed = useMemo(
    () => layout(graphQ.data?.nodes ?? [], graphQ.data?.links ?? [], centerId),
    [graphQ.data, centerId],
  );
  const byId = useMemo(() => new Map(placed.map((p) => [p.id, p])), [placed]);
  const links = useMemo(
    () => (graphQ.data?.links ?? []).filter((l) => byId.has(l.source) && byId.has(l.target) && l.source !== l.target),
    [graphQ.data, byId],
  );
  const focus = hoverId ?? selectedId;
  const neighbors = useMemo(() => {
    const s = new Set<string>();
    if (!focus) return s;
    for (const l of links) { if (l.source === focus) s.add(l.target); if (l.target === focus) s.add(l.source); }
    return s;
  }, [links, focus]);
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const recenter = (id: string) => { setCenterId(id); setSelectedId(id); setQ(''); };

  const addNode = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setSaving(true);
    setErr(null);
    try {
      const parents = selected && linkToSelected ? [selected.id] : undefined;
      const r = await apiHelpers.dtus.create(withContentLicense({ title, content: title, tags: ['graph-created'], parents }, 'knowledge', ['private']));
      const d = r.data as { ok?: boolean; error?: string; dtu?: { id?: string }; id?: string };
      if (d.ok === false) throw new Error(d.error || 'Could not add the node');
      setNewTitle('');
      setAdding(false);
      await qc.invalidateQueries({ queryKey: ['graph-field'] });
      const newId = d.dtu?.id ?? d.id;
      if (parents && selected) setCenterId(selected.id);
      else if (newId) setCenterId(newId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add the node');
    } finally {
      setSaving(false);
    }
  };

  const toX = (p: Placed) => p.x * size.w;
  const toY = (p: Placed) => p.y * size.h;

  return (
    <div className="relative flex h-[calc(100vh-3rem)] min-h-[560px] flex-col px-8 pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] text-zinc-500">
            Graph
            {centerId && (
              <>
                {' · '}
                <button type="button" onClick={() => { setCenterId(null); setSelectedId(null); }} className="text-zinc-400 hover:text-zinc-100">
                  Back to overview
                </button>
              </>
            )}
          </p>
          <h1 className="font-vault text-[2.75rem] leading-tight text-zinc-100">{who ? `How it connects, ${who}` : 'How it connects'}</h1>
        </div>
      </div>
      {err && <p className="mt-2 text-[13px] text-rose-300" role="alert">{err}</p>}

      <div ref={boxRef} className="relative mt-2 min-h-0 flex-1" onClick={() => setSelectedId(null)} onKeyDown={(e) => { if (e.key === 'Escape') setSelectedId(null); }}>
        {graphQ.isLoading ? (
          <p className="absolute inset-0 flex items-center justify-center text-[14px] text-zinc-600">Reading the lattice…</p>
        ) : graphQ.isError ? (
          <p className="absolute inset-0 flex items-center justify-center text-[14px] text-zinc-400">
            Couldn’t load the graph.&nbsp;
            <button type="button" className="text-teal-300 hover:underline" onClick={(e) => { e.stopPropagation(); graphQ.refetch(); }}>Retry</button>
          </p>
        ) : placed.length === 0 ? (
          <p className="absolute inset-0 flex items-center justify-center text-[14px] text-zinc-500">
            The lattice has no nodes yet. Add one to start.
          </p>
        ) : (
          <svg width={size.w} height={size.h} className="absolute inset-0 select-none" role="img" aria-label={`Graph of ${placed.length} nodes`}>
            {links.map((l, i) => {
              const a = byId.get(l.source)!, b = byId.get(l.target)!;
              const lit = focus && (l.source === focus || l.target === focus);
              return (
                <line
                  key={`${l.source}-${l.target}-${i}`}
                  x1={toX(a)} y1={toY(a)} x2={toX(b)} y2={toY(b)}
                  stroke={l.type === 'parent' || l.type === 'child' ? '#8b7fd6' : '#2dd4bf'}
                  strokeOpacity={focus ? (lit ? 0.75 : 0.08) : 0.32}
                  strokeWidth={lit ? 1.4 : 1}
                />
              );
            })}
            {placed.map((p) => {
              const dim = focus && p.id !== focus && !neighbors.has(p.id);
              const showLabel = p.id === focus || neighbors.has(p.id) || p.r > 14 || placed.length <= 48;
              return (
                <g
                  key={p.id}
                  transform={`translate(${toX(p)},${toY(p)})`}
                  className="cursor-pointer"
                  opacity={dim ? 0.25 : 1}
                  onMouseEnter={() => setHoverId(p.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); }}
                  onDoubleClick={(e) => { e.stopPropagation(); recenter(p.id); }}
                  role="button"
                  tabIndex={0}
                  aria-label={p.label}
                  onKeyDown={(e) => { if (e.key === 'Enter') recenter(p.id); if (e.key === ' ') { e.preventDefault(); setSelectedId(p.id); } }}
                >
                  <circle r={p.r} fill="#141418" stroke={RING[p.tier] ?? '#52525b'} strokeWidth={p.id === selectedId ? 2.5 : 1.5} />
                  {showLabel && (
                    <text
                      y={p.r + 15}
                      textAnchor="middle"
                      className={p.id === focus || neighbors.has(p.id) || p.r > 14 ? 'fill-zinc-100 text-[12px]' : 'fill-zinc-500 text-[11px]'}
                      style={{ paintOrder: 'stroke', stroke: '#0b0b0d', strokeWidth: 3 }}
                    >
                      {short(p.label)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {graphQ.data?.unlinked && placed.length > 0 && !selected && (
          <p className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 text-[13px] text-zinc-500">
            Nothing you can see is linked yet. Select a node and add one under it to start a thread.
          </p>
        )}

        {selected && (
          <div className="absolute right-0 top-0 w-72 rounded-2xl border border-white/[0.08] bg-[#121214]/95 p-4 backdrop-blur" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape') setSelectedId(null); }}>
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[14px] leading-snug text-zinc-100">{selected.label}</p>
              <button type="button" onClick={() => setSelectedId(null)} className="text-zinc-500 hover:text-zinc-200" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-1 text-[12px] capitalize text-zinc-500">{selected.tier} · {selected.degree} link{selected.degree === 1 ? '' : 's'} here</p>
            <div className="mt-3 flex gap-2 text-[13px]">
              <button type="button" onClick={() => setOpenId(selected.id)} className="rounded-full border border-white/10 px-3 py-1 text-zinc-200 hover:border-white/25">Open</button>
              {selected.id !== centerId && (
                <button type="button" onClick={() => recenter(selected.id)} className="rounded-full border border-white/10 px-3 py-1 text-zinc-200 hover:border-white/25">Center here</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Find a node */}
      <div className="relative mb-8 mt-3 w-[340px]">
        {debouncedQ.length >= 2 && (searchQ.data?.length ?? 0) > 0 && (
          <ul className="absolute bottom-full mb-2 w-full rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
            {searchQ.data!.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => recenter(d.id)} className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50">
                  <span className="flex-1 truncate">{d.title || d.id}</span>
                  {d.tier && <span className="pl-2 text-[11px] text-zinc-600">{d.tier}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {debouncedQ.length >= 2 && searchQ.isSuccess && searchQ.data.length === 0 && (
          <p className="absolute bottom-full mb-2 px-3 text-[13px] text-zinc-500">No node matches “{debouncedQ}”.</p>
        )}
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); if (e.key === 'Enter' && searchQ.data?.[0]) recenter(searchQ.data[0].id); }}
          placeholder="Find a node…"
          aria-label="Find a node"
          className="w-full rounded-full border border-white/[0.08] bg-white/[0.03] py-3 pl-11 pr-4 text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:border-white/20 focus:outline-none"
        />
      </div>

      {adding && (
        <div className="fixed bottom-28 right-8 z-30 w-[360px] rounded-2xl border border-white/10 bg-[#141414] p-4 shadow-2xl" role="dialog" aria-label="Add node">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addNode(); if (e.key === 'Escape') setAdding(false); }}
            placeholder="Node title"
            aria-label="Node title"
            className="w-full bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
          {selected && (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-zinc-400">
              <input type="checkbox" checked={linkToSelected} onChange={(e) => setLinkToSelected(e.target.checked)} className="accent-teal-400" />
              Link under “{short(selected.label, 30)}”
            </label>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-full px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200">Cancel</button>
            <button type="button" onClick={addNode} disabled={!newTitle.trim() || saving} className="rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black hover:bg-teal-300 disabled:opacity-50">
              {saving ? 'Adding…' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className={cn('fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300')}
      >
        <Plus className="h-4 w-4" />
        Add node
      </button>

      {openId && <DTUDetailView dtuId={openId} onClose={() => setOpenId(null)} onNavigate={(id) => setOpenId(id)} />}
    </div>
  );
}

export default GraphField;
