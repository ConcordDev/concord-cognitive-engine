'use client';

/**
 * WhiteboardCollabPanel — surfaces the collaboration backlog:
 * frames + presentation mode, connectors with auto-routing, embeds,
 * raster (PNG/SVG/PDF) export planning, and reactions / live cursors.
 *
 * Every value here is real: frames/connectors/embeds are persisted
 * through the whiteboard domain macros and reflect the live board.
 * No seed/demo data — empty states say "no data yet".
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Frame, Link2, Globe, Image as ImageIcon, FileText, Video, Presentation,
  Plus, Trash2, Loader2, Download, Smile, Users, ChevronLeft, ChevronRight, X, LogOut, ExternalLink, BarChart2,
  Pencil, Check, Eye,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';
import type { Shape } from './WhiteboardCanvas';
import type { LivePresence, LiveReaction } from '@/hooks/useWhiteboardCollab';

interface FrameRec { id: string; label: string; x: number; y: number; w: number; h: number; order: number; memberIds: string[] }
interface ConnRoute { waypoints: Array<{ x: number; y: number }>; length: number }
interface ConnectorRec { id: string; fromId: string; toId: string; label: string; style: string; color: string; unresolved: boolean; route: ConnRoute | null }
interface EmbedRec { id: string; url: string; kind: 'image' | 'video' | 'document' | 'link'; title: string; description: string; previewImage?: string; x: number; y: number; w: number; h: number }
interface SlideRec { index: number; frameId: string; title: string; camera: { x: number; y: number; width: number; height: number }; memberIds: string[] }
interface PresenceRec { userId: string; name: string; color: string; x: number; y: number }
export interface SharedBoardRec { id: string; title: string; ownerId: string; participants: string[]; participantCount: number; elementCount: number; createdAt: string; updatedAt: string }

type CollabTab = 'frames' | 'connectors' | 'embeds' | 'export' | 'shared' | 'live';

const REACTION_EMOJI = ['👍', '❤️', '🎉', '🔥', '😂', '👀', '💡', '✅', '❓', '🚀'];
const EMBED_ICON: Record<EmbedRec['kind'], React.ComponentType<{ className?: string }>> = {
  image: ImageIcon, video: Video, document: FileText, link: Globe,
};

export function WhiteboardCollabPanel({
  boardId, shapes, livePresence, lastPeerReaction, onOpenShared,
}: {
  boardId: string | null;
  shapes: Shape[];
  livePresence?: Record<string, LivePresence>;
  lastPeerReaction?: LiveReaction | null;
  /** Open a shared board (by id) in the canvas. Omit if the host doesn't support it. */
  onOpenShared?: (id: string, title: string) => void;
}) {
  const [tab, setTab] = useState<CollabTab>('frames');

  // "Shared" is the entry point for browsing/joining boards other people
  // shared with you — it works with no board open (that's often *why*
  // you're here). Every other tab operates on the currently-open board.
  if (!boardId && tab !== 'shared') {
    return (
      <div className="p-3">
        <div className="text-xs text-gray-400 italic mb-2">Open a board to use frames, connectors, embeds and live collaboration.</div>
        <button onClick={() => setTab('shared')} className="px-2 py-1 text-[11px] rounded border border-sky-500/30 text-sky-200 hover:bg-sky-500/10">
          Browse shared boards
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <nav className="flex items-center gap-1 px-2 py-2 border-b border-white/10 overflow-x-auto">
        {([
          { id: 'frames', label: 'Frames' },
          { id: 'connectors', label: 'Connectors' },
          { id: 'embeds', label: 'Embeds' },
          { id: 'export', label: 'Export' },
          { id: 'shared', label: 'Shared' },
          { id: 'live', label: 'Live' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn(
            'px-2 py-1 text-[11px] rounded whitespace-nowrap',
            tab === t.id ? 'bg-sky-500/15 text-sky-200 border border-sky-500/30' : 'text-gray-400 hover:text-white border border-transparent',
          )}>{t.label}</button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {tab === 'frames' && boardId && <FramesTab boardId={boardId} />}
        {tab === 'connectors' && boardId && <ConnectorsTab boardId={boardId} shapes={shapes} />}
        {tab === 'embeds' && boardId && <EmbedsTab boardId={boardId} />}
        {tab === 'export' && boardId && <ExportTab boardId={boardId} />}
        {tab === 'shared' && <SharedTab activeBoardId={boardId} onOpenShared={onOpenShared} />}
        {tab === 'live' && boardId && <LiveTab boardId={boardId} livePresence={livePresence} lastPeerReaction={lastPeerReaction} />}
      </div>
    </div>
  );
}

/* ── Frames + presentation mode ──────────────────────────────────── */
function FramesTab({ boardId }: { boardId: string }) {
  const [frames, setFrames] = useState<FrameRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [slides, setSlides] = useState<SlideRec[] | null>(null);
  const [presentIdx, setPresentIdx] = useState(0);
  // whiteboard.frame-update was previously UNSURFACED — create/delete had a
  // UI, rename/resize didn't. Inline edit, same row, matching the Delete
  // button's placement/style.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editW, setEditW] = useState(0);
  const [editH, setEditH] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'frame-list', input: { boardId } });
      if (r.data?.ok) setFrames((r.data.result?.frames || []) as FrameRec[]);
    } finally { setLoading(false); }
  }, [boardId]);

  useEffect(() => { void refresh(); setSlides(null); }, [refresh]);

  async function createFrame() {
    if (!label.trim()) return;
    const offset = frames.length * 60;
    const r = await lensRun({ domain: 'whiteboard', action: 'frame-create', input: {
      boardId, label: label.trim(), x: 40 + offset, y: 40 + offset, w: 600, h: 400,
    } });
    if (r.data?.ok) { setLabel(''); await refresh(); }
  }
  async function deleteFrame(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'frame-delete', input: { boardId, id } });
    if (r.data?.ok) await refresh();
  }
  function startEditFrame(f: FrameRec) {
    setEditingId(f.id); setEditLabel(f.label); setEditW(f.w); setEditH(f.h);
  }
  async function saveFrameEdit(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'frame-update', input: {
      boardId, id, label: editLabel.trim() || undefined, w: editW, h: editH,
    } });
    if (r.data?.ok) { setEditingId(null); await refresh(); }
  }
  async function buildPresentation() {
    const r = await lensRun({ domain: 'whiteboard', action: 'presentation-build', input: { boardId } });
    if (r.data?.ok) { setSlides((r.data.result?.slides || []) as SlideRec[]); setPresentIdx(0); }
  }

  if (slides && slides.length > 0) {
    const s = slides[presentIdx];
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-sky-300 tabular-nums">Presentation · slide {presentIdx + 1}/{slides.length}</span>
          <button aria-label="Close" onClick={() => setSlides(null)} className="text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="rounded border border-sky-500/30 bg-sky-500/[0.05] p-3">
          <div className="font-semibold text-sky-100 text-sm">{s.title}</div>
          <div className="text-[10px] text-sky-200/70 font-mono mt-1">
            <span className="tabular-nums">camera {Math.round(s.camera.width)}×{Math.round(s.camera.height)} · {s.memberIds.length} element{s.memberIds.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPresentIdx(i => Math.max(0, i - 1))} disabled={presentIdx === 0}
            className="px-2 py-1 rounded border border-white/15 text-gray-300 disabled:opacity-40 inline-flex items-center gap-1">
            <ChevronLeft className="w-3 h-3" />Prev
          </button>
          <button onClick={() => setPresentIdx(i => Math.min(slides.length - 1, i + 1))} disabled={presentIdx === slides.length - 1}
            className="px-2 py-1 rounded border border-white/15 text-gray-300 disabled:opacity-40 inline-flex items-center gap-1">
            Next<ChevronRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-gray-400">Frames carve a large board into named regions. Elements whose centre falls inside a frame become its members.</p>
      <div className="flex items-center gap-1">
        <input value={label} onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void createFrame(); }}
          placeholder="Frame name…"
          className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={createFrame} disabled={!label.trim()}
          className="px-2 py-1.5 text-xs rounded bg-sky-500 text-white font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Add
        </button>
      </div>
      {loading ? (
        <div className="space-y-1" aria-busy="true">
          <Skeleton variant="block" height={34} />
          <Skeleton variant="block" height={34} />
        </div>
      ) : frames.length === 0 ? (
        <div className="text-gray-400 italic">No frames yet.</div>
      ) : (
        <ul className="space-y-1">
          {frames.map(f => (
            <li key={f.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
              {editingId === f.id ? (
                <div className="flex items-center gap-1">
                  <Frame className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                  <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void saveFrameEdit(f.id); if (e.key === 'Escape') setEditingId(null); }}
                    placeholder="Frame name…" autoFocus
                    className="flex-1 min-w-0 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
                  <input type="number" value={editW} onChange={e => setEditW(Number(e.target.value))}
                    className="w-14 px-1 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" title="Width" />
                  <span className="text-gray-500">×</span>
                  <input type="number" value={editH} onChange={e => setEditH(Number(e.target.value))}
                    className="w-14 px-1 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" title="Height" />
                  <button aria-label="Save" onClick={() => saveFrameEdit(f.id)} className="p-0.5 text-emerald-300 hover:bg-emerald-500/20 rounded"><Check className="w-3.5 h-3.5" /></button>
                  <button aria-label="Cancel" onClick={() => setEditingId(null)} className="p-0.5 text-gray-400 hover:bg-white/10 rounded"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Frame className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-white">{f.label}</div>
                    <div className="text-[10px] text-gray-400 font-mono tabular-nums">{f.memberIds.length} member{f.memberIds.length === 1 ? '' : 's'} · {Math.round(f.w)}×{Math.round(f.h)}</div>
                  </div>
                  <button aria-label="Edit" onClick={() => startEditFrame(f)} className="p-0.5 text-sky-300 hover:bg-sky-500/20 rounded"><Pencil className="w-3 h-3" /></button>
                  <button aria-label="Delete" onClick={() => deleteFrame(f.id)} className="p-0.5 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button onClick={buildPresentation} disabled={frames.length === 0}
        className="w-full px-3 py-1.5 text-xs rounded border border-sky-500/30 text-sky-200 hover:bg-sky-500/10 disabled:opacity-40 inline-flex items-center justify-center gap-1">
        <Presentation className="w-3 h-3" />Present frames as slides
      </button>
    </div>
  );
}

/* ── Connectors with auto-routing ────────────────────────────────── */
function ConnectorsTab({ boardId, shapes }: { boardId: string; shapes: Shape[] }) {
  const [connectors, setConnectors] = useState<ConnectorRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'connector-list', input: { boardId } });
      if (r.data?.ok) setConnectors((r.data.result?.connectors || []) as ConnectorRec[]);
    } finally { setLoading(false); }
  }, [boardId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const shapeLabel = useCallback((id: string) => {
    const s = shapes.find(sh => sh.id === id);
    return s ? (s.text?.slice(0, 24) || `${s.kind} ${id.slice(-4)}`) : id.slice(-6);
  }, [shapes]);

  async function createConnector() {
    setError(null);
    const r = await lensRun({ domain: 'whiteboard', action: 'connector-create', input: { boardId, fromId, toId, label: label.trim() } });
    if (r.data?.ok) { setFromId(''); setToId(''); setLabel(''); await refresh(); }
    else setError(r.data?.error || 'failed');
  }
  async function deleteConnector(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'connector-delete', input: { boardId, id } });
    if (r.data?.ok) await refresh();
  }

  return (
    <div className="space-y-2">
      <p className="text-gray-400">Bind two shapes — the server auto-routes an orthogonal (elbow) path between their nearest edges.</p>
      {shapes.length < 2 ? (
        <div className="text-gray-400 italic">Need at least 2 shapes on the board to connect.</div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <select value={fromId} onChange={e => setFromId(e.target.value)} className="flex-1 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">From shape…</option>
              {shapes.map(s => <option key={s.id} value={s.id}>{shapeLabel(s.id)}</option>)}
            </select>
            <select value={toId} onChange={e => setToId(e.target.value)} className="flex-1 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white">
              <option value="">To shape…</option>
              {shapes.map(s => <option key={s.id} value={s.id}>{shapeLabel(s.id)}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)…"
              className="flex-1 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={createConnector} disabled={!fromId || !toId}
              className="px-2 py-1 text-[11px] rounded bg-sky-500 text-white font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Connect
            </button>
          </div>
        </div>
      )}
      {error && <div className="text-rose-300 text-[11px]">{error}</div>}
      {loading ? (
        <div className="space-y-1" aria-busy="true">
          <Skeleton variant="block" height={34} />
          <Skeleton variant="block" height={34} />
        </div>
      ) : connectors.length === 0 ? (
        <div className="text-gray-400 italic">No connectors yet.</div>
      ) : (
        <ul className="space-y-1">
          {connectors.map(c => (
            <li key={c.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5 flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: c.color }} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-white">{shapeLabel(c.fromId)} → {shapeLabel(c.toId)}</div>
                <div className="text-[10px] text-gray-400 font-mono tabular-nums">
                  {c.label && <span className="text-sky-300">{c.label} · </span>}
                  {c.unresolved ? <span className="text-amber-300">endpoint missing</span> : `route ${c.route?.length ?? 0}px · ${c.route?.waypoints.length ?? 0} waypoints`}
                </div>
              </div>
              <button aria-label="Delete" onClick={() => deleteConnector(c.id)} className="p-0.5 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Embeds ──────────────────────────────────────────────────────── */
function EmbedsTab({ boardId }: { boardId: string }) {
  const [embeds, setEmbeds] = useState<EmbedRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // whiteboard.embed-update was previously UNSURFACED — add/delete had a UI,
  // editing didn't. The macro only accepts x/y/w/h/title (not url — an
  // embed's source URL is set once at embed-add time), so the real editable
  // field here is the display title. Inline rename, same row as Delete.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // whiteboard.vision was previously UNSURFACED — real backend (LLaVA/Qwen2.5-VL
  // via server/lib/vision-inference.js) with no upload/analyze affordance calling
  // it. Image embeds are the existing "image element pin" the vision macro needs;
  // "Analyze" reuses that pin instead of inventing a new upload flow. Per-embed
  // state (not a single shared slot) so analyzing one image doesn't clobber
  // another's in-flight result.
  const [vision, setVision] = useState<Record<string, { loading: boolean; content?: string; error?: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'embed-list', input: { boardId } });
      if (r.data?.ok) setEmbeds((r.data.result?.embeds || []) as EmbedRec[]);
    } finally { setLoading(false); }
  }, [boardId]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addEmbed() {
    if (!url.trim()) return;
    setAdding(true); setError(null);
    try {
      const offset = embeds.length * 40;
      const r = await lensRun({ domain: 'whiteboard', action: 'embed-add', input: { boardId, url: url.trim(), x: 40 + offset, y: 40 + offset } });
      if (r.data?.ok) { setUrl(''); await refresh(); }
      else setError(r.data?.error || 'failed');
    } finally { setAdding(false); }
  }
  async function deleteEmbed(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'embed-delete', input: { boardId, id } });
    if (r.data?.ok) await refresh();
  }
  function startEditEmbed(e: EmbedRec) {
    setEditingId(e.id); setEditTitle(e.title || '');
  }
  async function saveEmbedEdit(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'embed-update', input: { boardId, id, title: editTitle.trim() } });
    if (r.data?.ok) { setEditingId(null); await refresh(); }
  }
  async function analyzeEmbed(e: EmbedRec) {
    setVision(prev => ({ ...prev, [e.id]: { loading: true } }));
    const r = await lensRun({ domain: 'whiteboard', action: 'vision', input: { imageUrl: e.url } });
    if (r.data?.ok) {
      const content = String((r.data.result as { content?: string } | null)?.content || '').trim();
      setVision(prev => ({ ...prev, [e.id]: { loading: false, content: content || '(vision model returned no description)' } }));
    } else {
      // Honest failure — never fabricate a description when the brain is unreachable or blocked.
      setVision(prev => ({ ...prev, [e.id]: { loading: false, error: r.data?.error || 'analysis failed' } }));
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-gray-400">Drop an image, video, document or link URL onto the canvas. Link embeds are enriched with page title and description.</p>
      <div className="flex items-center gap-1">
        <input value={url} onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void addEmbed(); }}
          placeholder="https://…"
          className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={addEmbed} disabled={!url.trim() || adding}
          className="px-2 py-1.5 text-xs rounded bg-sky-500 text-white font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center gap-1">
          {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Add
        </button>
      </div>
      {error && <div className="text-rose-300 text-[11px]">{error}</div>}
      {loading ? (
        <div className="space-y-1" aria-busy="true">
          <Skeleton variant="block" height={34} />
          <Skeleton variant="block" height={34} />
        </div>
      ) : embeds.length === 0 ? (
        <div className="text-gray-400 italic">No embeds yet.</div>
      ) : (
        <ul className="space-y-1">
          {embeds.map(e => {
            const Icon = EMBED_ICON[e.kind];
            return (
              <li key={e.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
                {editingId === e.id ? (
                  <div className="flex items-center gap-1">
                    <Icon className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                    <input value={editTitle} onChange={ev => setEditTitle(ev.target.value)}
                      onKeyDown={ev => { if (ev.key === 'Enter') void saveEmbedEdit(e.id); if (ev.key === 'Escape') setEditingId(null); }}
                      placeholder="Embed title…" autoFocus
                      className="flex-1 min-w-0 px-1.5 py-1 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
                    <button aria-label="Save" onClick={() => saveEmbedEdit(e.id)} className="p-0.5 text-emerald-300 hover:bg-emerald-500/20 rounded"><Check className="w-3.5 h-3.5" /></button>
                    <button aria-label="Cancel" onClick={() => setEditingId(null)} className="p-0.5 text-gray-400 hover:bg-white/10 rounded"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <a href={e.url} target="_blank" rel="noreferrer" className="truncate text-white hover:text-sky-300 block">{e.title || e.url}</a>
                      {e.description && <div className="text-[10px] text-gray-400 truncate">{e.description}</div>}
                      <div className="text-[10px] text-gray-400 font-mono uppercase">{e.kind}</div>
                    </div>
                    {e.kind === 'image' && (
                      <button aria-label="Analyze" title="Analyze image with the vision model" onClick={() => analyzeEmbed(e)}
                        disabled={vision[e.id]?.loading}
                        className="p-0.5 text-violet-300 hover:bg-violet-500/20 rounded disabled:opacity-40">
                        {vision[e.id]?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      </button>
                    )}
                    <button aria-label="Edit" onClick={() => startEditEmbed(e)} className="p-0.5 text-sky-300 hover:bg-sky-500/20 rounded"><Pencil className="w-3 h-3" /></button>
                    <button aria-label="Delete" onClick={() => deleteEmbed(e.id)} className="p-0.5 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
                  </div>
                )}
                {vision[e.id] && !vision[e.id].loading && (
                  vision[e.id].error ? (
                    <div className="mt-1.5 rounded border border-rose-500/30 bg-rose-500/[0.04] p-1.5 text-[11px] text-rose-300">
                      Analysis failed: {vision[e.id].error}
                    </div>
                  ) : (
                    <div className="mt-1.5 rounded border border-violet-500/30 bg-violet-500/[0.04] p-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-violet-300 mb-1">Vision analysis</div>
                      <div className="text-[11px] text-violet-100 whitespace-pre-wrap">{vision[e.id].content}</div>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ── S16: the export plan becomes a file ──────────────────────────
   SVG is the exact render, with the plan embedded as <metadata>
   (the export's receipt). PNG rasterizes that SVG at the plan's
   pixel size and carries the plan in a tEXt chunk. PDF wraps the
   raster on a single page sized to the content bounds, with the
   plan in its info dictionary. */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function wrapLines(text: string, maxChars: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}
function shapeToSvg(s: Shape, all: Shape[]): string {
  const color = s.color || '#7dd3fc';
  const w = s.w || (s.kind === 'sticky' ? 120 : s.kind === 'embed' ? 200 : s.kind === 'frame' ? 240 : 40);
  const h = s.h || (s.kind === 'sticky' ? 80 : s.kind === 'embed' ? 120 : s.kind === 'frame' ? 180 : 30);
  if (s.kind === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="2"/>`;
  if (s.kind === 'sticky') {
    const lines = wrapLines(s.text || '', Math.max(4, Math.floor((w - 16) / 7.5)));
    const tspans = lines.map((ln, i) => `<tspan x="${s.x + 8}" dy="${i === 0 ? 0 : 18}">${escXml(ln)}</tspan>`).join('');
    return `<rect x="${s.x}" y="${s.y}" width="${w}" height="${h}" fill="${s.color || '#fef08a'}"/><text x="${s.x + 8}" y="${s.y + 20}" font-family="system-ui, sans-serif" font-size="14" fill="#1a1a1a">${tspans}</text>`;
  }
  if (s.kind === 'stroke') {
    if (!s.points || s.points.length < 2) return '';
    const pts = s.points.map((p) => `${p.x},${p.y}`).join(' ');
    return `<polyline points="${pts}" fill="none" stroke="${s.color || '#fff'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (s.kind === 'frame') {
    return `<rect x="${s.x}" y="${s.y}" width="${w}" height="${h}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${s.x + 4}" y="${s.y - 6}" font-family="system-ui, sans-serif" font-size="12" fill="${color}">${escXml(s.label || s.text || 'Frame')}</text>`;
  }
  if (s.kind === 'connector') {
    const from = all.find((e) => e.id === s.fromId);
    const to = all.find((e) => e.id === s.toId);
    if (!from || !to) return '';
    const c = (e: Shape) => ({ x: e.x + (e.w || (e.kind === 'sticky' ? 120 : 40)) / 2, y: e.y + (e.h || (e.kind === 'sticky' ? 80 : 30)) / 2 });
    const a = c(from), b = c(to);
    const ang = Math.atan2(b.y - a.y, b.x - a.x), ah = 9;
    const p1 = `${b.x - ah * Math.cos(ang - Math.PI / 7)},${b.y - ah * Math.sin(ang - Math.PI / 7)}`;
    const p2 = `${b.x - ah * Math.cos(ang + Math.PI / 7)},${b.y - ah * Math.sin(ang + Math.PI / 7)}`;
    const label = s.label ? `<text x="${(a.x + b.x) / 2 + 4}" y="${(a.y + b.y) / 2 - 4}" font-family="system-ui, sans-serif" font-size="11" fill="#cbd5e1">${escXml(s.label)}</text>` : '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="2"/><polygon points="${b.x},${b.y} ${p1} ${p2}" fill="${color}"/>${label}`;
  }
  if (s.kind === 'embed') {
    const url = s.url ? `<text x="${s.x + 8}" y="${s.y + 38}" font-family="system-ui, sans-serif" font-size="10" fill="#94a3b8">${escXml(s.url.slice(0, 60))}</text>` : '';
    return `<rect x="${s.x}" y="${s.y}" width="${w}" height="${h}" fill="rgba(30,41,59,0.85)" stroke="${color}" stroke-width="1.5"/><text x="${s.x + 8}" y="${s.y + 20}" font-family="system-ui, sans-serif" font-size="12" fill="#7dd3fc">${escXml('🔗 ' + (s.label || 'Embed'))}</text>${url}`;
  }
  return '';
}
function buildExportSvg(shapes: Shape[], plan: RasterPlan): string {
  const b = plan.bounds!;
  const ordered = [...shapes].sort((x, y) => (x.kind === 'frame' ? 0 : x.kind === 'connector' ? 1 : 2) - (y.kind === 'frame' ? 0 : y.kind === 'connector' ? 1 : 2));
  const body = ordered.map((s) => shapeToSvg(s, shapes)).join('');
  const receipt = escXml(JSON.stringify({ format: plan.format, scale: plan.scale, bounds: plan.bounds, pixelDimensions: plan.pixelDimensions, elementCount: plan.elementCount }));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.width}" height="${b.height}" viewBox="${b.x} ${b.y} ${b.width} ${b.height}"><metadata>${receipt}</metadata><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#0b0f14"/>${body}</svg>`;
}
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function pngWithReceipt(pngBlob: Blob, receiptJson: string): Promise<Blob> {
  const buf = new Uint8Array(await pngBlob.arrayBuffer());
  const keyword = new TextEncoder().encode('Comment');
  const value = new TextEncoder().encode(receiptJson);
  const data = new Uint8Array(keyword.length + 1 + value.length);
  data.set(keyword, 0); data.set(value, keyword.length + 1);
  const type = new TextEncoder().encode('tEXt');
  const chunk = new Uint8Array(12 + data.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, data.length);
  chunk.set(type, 4); chunk.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(type, 0); crcInput.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcInput));
  // Insert after IHDR (8-byte signature + 25-byte IHDR chunk).
  const out = new Uint8Array(buf.length + chunk.length);
  out.set(buf.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(buf.subarray(33), 33 + chunk.length);
  return new Blob([out.buffer as ArrayBuffer], { type: 'image/png' });
}
function buildPdf(jpeg: Uint8Array, imgW: number, imgH: number, pageW: number, pageH: number, plan: RasterPlan): Blob {
  const enc = new TextEncoder();
  const parts: Array<Uint8Array | string> = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (p: Uint8Array | string) => { const bytes = typeof p === 'string' ? enc.encode(p) : p; parts.push(bytes); size += bytes.length; };
  const startObj = (n: number) => { offsets[n] = size; push(`${n} 0 obj\n`); };
  push('%PDF-1.4\n');
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2); push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  startObj(3); push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  startObj(4); push(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg); push('\nendstream\nendobj\n');
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  startObj(5); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  const receipt = `Whiteboard export — format ${plan.format} @ ${plan.scale}x, bounds ${plan.bounds?.width}x${plan.bounds?.height}, elements ${plan.elementCount}`;
  startObj(6); push(`<< /Title (Concord Whiteboard export) /Subject (${receipt.replace(/([()\\])/g, '\\$1')}) >>\nendobj\n`);
  const xrefAt = size;
  let xref = `xref\n0 7\n0000000000 65535 f \n`;
  for (let n = 1; n <= 6; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return new Blob(parts.map((p) => (typeof p === 'string' ? enc.encode(p) : p)) as BlobPart[], { type: 'application/pdf' });
}

/* ── Raster export plan ──────────────────────────────────────────── */
interface RasterPlan {
  format: string; scale: number; empty?: boolean; message?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  pixelDimensions?: { width: number; height: number };
  elementCount?: number; pages?: Array<{ index: number }>; warnings?: string[];
}
function ExportTab({ boardId }: { boardId: string }) {
  const [format, setFormat] = useState<'png' | 'svg' | 'pdf'>('png');
  const [scale, setScale] = useState(2);
  const [plan, setPlan] = useState<RasterPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  async function computePlan() {
    setLoading(true); setPlan(null);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'export-raster-plan', input: { boardId, format, scale } });
      if (r.data?.ok) setPlan(r.data.result as RasterPlan);
    } finally { setLoading(false); }
  }


  async function downloadWithPlan() {
    if (!plan || !plan.bounds || !plan.pixelDimensions) return;
    setDownloading(true);
    setDlError(null);
    try {
      const loaded = await lensRun({ domain: 'whiteboard', action: 'board-load', input: { id: boardId } });
      const shapes = (loaded.data?.result?.board?.scene?.elements || []) as Shape[];
      if (shapes.length === 0) { setDlError('The board is empty — nothing to download.'); return; }
      const svg = buildExportSvg(shapes, plan);
      const save = (blob: Blob, ext: string) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `whiteboard-export.${ext}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      };
      if (plan.format === 'svg') {
        save(new Blob([svg], { type: 'image/svg+xml' }), 'svg');
        return;
      }
      // Rasterize the SVG at the plan's exact pixel size.
      const img = new Image();
      const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('render failed'));
        img.src = svgUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width = plan.pixelDimensions.width;
      canvas.height = plan.pixelDimensions.height;
      const cctx = canvas.getContext('2d');
      if (!cctx) { setDlError('Canvas is unavailable in this browser.'); return; }
      cctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(svgUrl);
      if (plan.format === 'png') {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob) { setDlError('PNG render failed.'); return; }
        const receipt = JSON.stringify({ format: plan.format, scale: plan.scale, bounds: plan.bounds, pixelDimensions: plan.pixelDimensions, elementCount: plan.elementCount });
        save(await pngWithReceipt(blob, receipt), 'png');
        return;
      }
      // PDF: single page sized to the content bounds (the plan's
      // page tiling stays plan information; the file is the whole
      // board on one page at the planned scale).
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const jpeg = Uint8Array.from(atob(dataUrl.split(',')[1]), (ch) => ch.charCodeAt(0));
      save(buildPdf(jpeg, canvas.width, canvas.height, plan.bounds.width, plan.bounds.height, plan), 'pdf');
    } catch (e) {
      console.error('[Board] export download', e);
      setDlError('Download failed — the render could not be produced.');
    } finally { setDownloading(false); }
  }

  return (
    <div className="space-y-2">
      <p className="text-gray-400">Compute a deterministic render plan — tight content bounds, DPI scaling, and (for PDF) page tiling — so a raster export is identical across clients.</p>
      <div className="flex items-center gap-1">
        <select value={format} onChange={e => setFormat(e.target.value as typeof format)} className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="png">PNG</option>
          <option value="svg">SVG</option>
          <option value="pdf">PDF</option>
        </select>
        <select value={scale} onChange={e => setScale(Number(e.target.value))} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          {[1, 2, 3, 4].map(s => <option key={s} value={s}>{s}× scale</option>)}
        </select>
      </div>
      <button onClick={computePlan} disabled={loading}
        className="w-full px-3 py-1.5 text-xs rounded bg-sky-500 text-white font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}Compute export plan
      </button>
      {plan?.empty && <div className="text-gray-400 italic">{plan.message}</div>}
      {plan && !plan.empty && plan.bounds && plan.pixelDimensions && (
        <div className="rounded border border-sky-500/30 bg-sky-500/[0.04] p-2 space-y-1 font-mono text-[11px] text-sky-100">
          <div>format: <span className="text-sky-300">{plan.format.toUpperCase()}</span> @ {plan.scale}×</div>
          <div>content bounds: {plan.bounds.width}×{plan.bounds.height}</div>
          <div className="tabular-nums">raster size: {plan.pixelDimensions.width}×{plan.pixelDimensions.height}px</div>
          <div className="tabular-nums">elements: {plan.elementCount}</div>
          {plan.pages && <div>pdf pages: {plan.pages.length}</div>}
          {plan.warnings && plan.warnings.length > 0 && (
            <div className="text-amber-300">{plan.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
          )}
        </div>
      )}
      {plan && !plan.empty && plan.bounds && plan.pixelDimensions && (
        <div className="space-y-1">
          <button onClick={downloadWithPlan} disabled={downloading}
            className="w-full px-3 py-1.5 text-xs rounded bg-emerald-500 text-white font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
            {downloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}Download {plan.format.toUpperCase()} @ {plan.scale}× with this plan
          </button>
          {dlError && <p className="text-[11px] text-rose-300" role="status">{dlError}</p>}
        </div>
      )}
    </div>
  );
}

/* ── Shared boards — browse boards you're a participant of, open one ── */
function SharedTab({ activeBoardId, onOpenShared }: { activeBoardId: string | null; onOpenShared?: (id: string, title: string) => void }) {
  const [boards, setBoards] = useState<SharedBoardRec[]>([]);
  const [loading, setLoading] = useState(true);
  const [tally, setTally] = useState<{ boardId: string; rows: Array<{ elementId: string; count: number }>; total: number } | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'shared-list', input: {} });
      if (r.data?.ok) setBoards((r.data.result?.boards || []) as SharedBoardRec[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function leave(id: string) {
    setLeavingId(id);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'leave-shared', input: { id } });
      if (r.data?.ok) await refresh();
    } finally { setLeavingId(null); }
  }

  async function showTally(id: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'shared-vote-tally', input: { id } });
    if (r.data?.ok) {
      const result = r.data.result as { tally?: Array<{ elementId: string; count: number }>; total?: number };
      setTally({ boardId: id, rows: result.tally || [], total: result.total || 0 });
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-gray-400">Boards someone shared with you, or that you promoted from a private board via the session workbench's Share action. Opening one joins its live room — edits broadcast to every participant in real time.</p>
      {loading ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton variant="block" height={46} />
          <Skeleton variant="block" height={46} />
        </div>
      ) : boards.length === 0 ? (
        <div className="text-gray-400 italic">No shared boards yet. Save a board, then use the session workbench's Share action to invite others.</div>
      ) : (
        <ul className="space-y-1.5">
          {boards.map(b => (
            <li key={b.id} className={cn('rounded border bg-black/30 p-2', activeBoardId === b.id ? 'border-sky-500/40' : 'border-white/10')}>
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-sky-300 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-white">{b.title}{activeBoardId === b.id && <span className="text-sky-300 text-[9px] ml-1.5 uppercase">open</span>}</div>
                  <div className="text-[10px] text-gray-400 font-mono tabular-nums">{b.participantCount} participant{b.participantCount === 1 ? '' : 's'} · {b.elementCount} elements · updated {new Date(b.updatedAt).toLocaleDateString()}</div>
                </div>
                <button
                  onClick={() => onOpenShared?.(b.id, b.title)}
                  disabled={!onOpenShared || activeBoardId === b.id}
                  className="p-1 text-sky-300 hover:bg-sky-500/15 rounded disabled:opacity-30"
                  title="Open in canvas"
                ><ExternalLink className="w-3.5 h-3.5" /></button>
                <button onClick={() => showTally(b.id)} className="p-1 text-gray-400 hover:text-amber-300 hover:bg-amber-500/10 rounded" title="Vote tally">
                  <BarChart2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => leave(b.id)} disabled={leavingId === b.id} className="p-1 text-gray-400 hover:text-rose-300 hover:bg-rose-500/10 rounded disabled:opacity-40" title="Leave">
                  {leavingId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}
                </button>
              </div>
              {tally?.boardId === b.id && (
                <div className="mt-1.5 pt-1.5 border-t border-white/10 text-[10px] text-amber-200">
                  {tally.total === 0 ? <span className="text-gray-400 italic">No votes cast yet.</span> : (
                    <ul className="space-y-0.5">
                      {tally.rows.map(row => (
                        <li key={row.elementId} className="flex justify-between font-mono">
                          <span className="text-gray-400 truncate">{row.elementId.slice(0, 16)}</span>
                          <span className="tabular-nums">{row.count} vote{row.count === 1 ? '' : 's'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Reactions / live cursors ────────────────────────────────────── */
function LiveTab({
  boardId, livePresence, lastPeerReaction,
}: {
  boardId: string;
  livePresence?: Record<string, LivePresence>;
  lastPeerReaction?: LiveReaction | null;
}) {
  const [presence, setPresence] = useState<PresenceRec[]>([]);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [lastReaction, setLastReaction] = useState<string | null>(null);
  const [lastReactionFrom, setLastReactionFrom] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun({ domain: 'whiteboard', action: 'presence-list', input: { boardId } });
    if (r.data?.ok) {
      setPresence((r.data.result?.participants || []) as PresenceRec[]);
      setSelfId((r.data.result?.selfId as string) || null);
    }
  }, [boardId]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 10000);
    return () => clearInterval(poll);
  }, [refresh]);

  // Dead-event-listener fix (verification-audit campaign): merge pushed
  // presence updates on top of the 10s poll so the list updates instantly
  // once another participant's cursor pings (see useWhiteboardCollab's
  // presence-ping heartbeat), instead of only ever reflecting a stale poll.
  useEffect(() => {
    if (!livePresence) return;
    setPresence((prev) => {
      const byId = new Map(prev.map((p) => [p.userId, p]));
      for (const p of Object.values(livePresence)) {
        byId.set(p.userId, { userId: p.userId, name: p.name, color: p.color, x: p.x, y: p.y });
      }
      return Array.from(byId.values());
    });
  }, [livePresence]);

  // Surface reactions broadcast by OTHER participants — previously only the
  // sender ever saw their own "Sent 😀" confirmation.
  useEffect(() => {
    if (!lastPeerReaction) return;
    setLastReaction(lastPeerReaction.emoji);
    setLastReactionFrom(lastPeerReaction.authorId === selfId ? null : lastPeerReaction.authorName);
  }, [lastPeerReaction, selfId]);

  async function sendReaction(emoji: string) {
    const r = await lensRun({ domain: 'whiteboard', action: 'reaction-send', input: { boardId, emoji, x: 0, y: 0 } });
    if (r.data?.ok) { setLastReaction(emoji); setLastReactionFrom(null); }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-sky-300 mb-1 flex items-center gap-1"><Smile className="w-3 h-3" />Reactions</div>
        <p className="text-gray-400 mb-1">Broadcast an emoji burst to everyone on the board.</p>
        <div className="flex flex-wrap gap-1">
          {REACTION_EMOJI.map(e => (
            <button key={e} onClick={() => sendReaction(e)} className="w-8 h-8 rounded border border-white/10 bg-black/30 hover:bg-sky-500/15 text-base">
              {e}
            </button>
          ))}
        </div>
        {lastReaction && (
          <div className="text-[10px] text-gray-400 mt-1">
            {lastReactionFrom ? `${lastReactionFrom} sent ${lastReaction}` : `Sent ${lastReaction}`}
          </div>
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-sky-300 mb-1 flex items-center gap-1"><Users className="w-3 h-3" />Live cursors</div>
        {presence.length === 0 ? (
          <div className="text-gray-400 italic">No active collaborators yet.</div>
        ) : (
          <ul className="space-y-1">
            {presence.map(p => (
              <li key={p.userId} className="rounded border border-white/10 bg-black/30 px-2 py-1.5 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="flex-1 truncate text-white">{p.name}{p.userId === selfId && <span className="text-gray-400"> (you)</span>}</span>
                <span className="text-[10px] text-gray-400 font-mono tabular-nums">{Math.round(p.x)}, {Math.round(p.y)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WhiteboardCollabPanel;
