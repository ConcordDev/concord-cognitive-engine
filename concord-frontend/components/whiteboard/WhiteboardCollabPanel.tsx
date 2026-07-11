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
  Pencil, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
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
          <span className="text-[10px] uppercase tracking-wider text-sky-300">Presentation · slide {presentIdx + 1}/{slides.length}</span>
          <button aria-label="Close" onClick={() => setSlides(null)} className="text-gray-400 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        </div>
        <div className="rounded border border-sky-500/30 bg-sky-500/[0.05] p-3">
          <div className="font-semibold text-sky-100 text-sm">{s.title}</div>
          <div className="text-[10px] text-sky-200/70 font-mono mt-1">
            camera {Math.round(s.camera.width)}×{Math.round(s.camera.height)} · {s.memberIds.length} element{s.memberIds.length === 1 ? '' : 's'}
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
        <div className="text-gray-400"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading frames…</div>
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
                    <div className="text-[10px] text-gray-400 font-mono">{f.memberIds.length} member{f.memberIds.length === 1 ? '' : 's'} · {Math.round(f.w)}×{Math.round(f.h)}</div>
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
        <div className="text-gray-400"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading connectors…</div>
      ) : connectors.length === 0 ? (
        <div className="text-gray-400 italic">No connectors yet.</div>
      ) : (
        <ul className="space-y-1">
          {connectors.map(c => (
            <li key={c.id} className="rounded border border-white/10 bg-black/30 px-2 py-1.5 flex items-center gap-2">
              <Link2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: c.color }} />
              <div className="flex-1 min-w-0">
                <div className="truncate text-white">{shapeLabel(c.fromId)} → {shapeLabel(c.toId)}</div>
                <div className="text-[10px] text-gray-400 font-mono">
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
        <div className="text-gray-400"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading embeds…</div>
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
                    <button aria-label="Edit" onClick={() => startEditEmbed(e)} className="p-0.5 text-sky-300 hover:bg-sky-500/20 rounded"><Pencil className="w-3 h-3" /></button>
                    <button aria-label="Delete" onClick={() => deleteEmbed(e.id)} className="p-0.5 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
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

  async function computePlan() {
    setLoading(true); setPlan(null);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'export-raster-plan', input: { boardId, format, scale } });
      if (r.data?.ok) setPlan(r.data.result as RasterPlan);
    } finally { setLoading(false); }
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
          <div>raster size: {plan.pixelDimensions.width}×{plan.pixelDimensions.height}px</div>
          <div>elements: {plan.elementCount}</div>
          {plan.pages && <div>pdf pages: {plan.pages.length}</div>}
          {plan.warnings && plan.warnings.length > 0 && (
            <div className="text-amber-300">{plan.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}</div>
          )}
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
        <div className="text-gray-400"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Loading…</div>
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
                  <div className="text-[10px] text-gray-400 font-mono">{b.participantCount} participant{b.participantCount === 1 ? '' : 's'} · {b.elementCount} elements · updated {new Date(b.updatedAt).toLocaleDateString()}</div>
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
                          <span>{row.count} vote{row.count === 1 ? '' : 's'}</span>
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
                <span className="text-[10px] text-gray-400 font-mono">{Math.round(p.x)}, {Math.round(p.y)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default WhiteboardCollabPanel;
