'use client';

/**
 * CanvasBuilder — the real no-code lens builder surface for the custom lens.
 *
 * Exercises every server/domains/custom.js builder macro:
 *   palette · canvasList/Create/Get/Save/Delete · bindingList/Create/Delete/Test
 *   previewRender · publish/unpublish/publishedList · exportCanvas/importCanvas
 *   wiringList/Create/Delete
 *
 * No JSON editing — drag widgets from a palette onto a grid, bind data
 * sources, wire button-click actions, live-preview, publish, import/export.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Plus, Trash2, Save, Eye, Upload, Download, Rocket, Link2, Zap,
  Loader2, RefreshCw, X, CheckCircle2, AlertTriangle, MousePointer2,
} from 'lucide-react';
import { activateOnEnterOrSpace } from '@/lib/a11y/editable-target';

const DOMAIN = 'custom';

interface PaletteComp {
  type: string; label: string; icon: string; description: string;
  props: { key: string; type: string; default: unknown }[]; binds: boolean;
}
interface Widget {
  id: string; type: string; x: number; y: number; w: number; h: number;
  props: Record<string, unknown>; bindingId: string | null;
}
interface Canvas {
  id: string; name: string; description: string; layout: string;
  widgets: Widget[]; createdAt: string; updatedAt: string;
}
interface Binding {
  id: string; name: string; kind: string;
  target: Record<string, unknown>; resultPath: string; createdAt: string;
}
interface Wiring {
  id: string; canvasId: string; sourceWidgetId: string; event: string;
  action: { kind: string; domain: string | null; macro: string | null; input: Record<string, unknown> };
  refreshWidgetId: string | null; createdAt: string;
}
interface PreviewWidget {
  id: string; type: string; label: string; icon: string;
  x: number; y: number; w: number; h: number;
  props: Record<string, unknown>;
  binding: { id: string; name: string; kind: string } | null;
  issues: string[]; renderable: boolean;
}

async function call<T = Record<string, unknown>>(name: string, input: Record<string, unknown> = {}) {
  const r = await lensRun<T>(DOMAIN, name, input);
  return r.data;
}

export interface CanvasBuilderStats {
  canvasCount: number;
  publishedCount: number;
  bindingCount: number;
  paletteCount: number;
}

export function CanvasBuilder({ onStatsChange }: { onStatsChange?: (s: CanvasBuilderStats) => void } = {}) {
  const [palette, setPalette] = useState<PaletteComp[]>([]);
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [wirings, setWirings] = useState<Wiring[]>([]);
  const [published, setPublished] = useState<Record<string, unknown>[]>([]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selectedWidget, setSelectedWidget] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const [preview, setPreview] = useState<{ widgets: PreviewWidget[]; issues: string[] } | null>(null);
  // In-page forms replace every native dialog this surface used to open
  // (window.prompt / window.confirm are invisible to whole classes of
  // clients — the create/binding/wiring controls read as dead there).
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showBindingForm, setShowBindingForm] = useState(false);
  const [bindingDraft, setBindingDraft] = useState({ kind: 'macro', name: '', domain: '', macro: '', url: '', resultPath: '' });
  const [wiringDraft, setWiringDraft] = useState<{ widgetId: string; domain: string; macro: string; refreshWidgetId: string } | null>(null);
  const [publishLabel, setPublishLabel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = canvases.find((c) => c.id === activeId) || null;

  const flash = useCallback((kind: 'ok' | 'err', msg: string) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 3200);
  }, []);

  // ── loaders ───────────────────────────────────────────────────────────────
  const loadCanvases = useCallback(async () => {
    const d = await call<{ canvases: Canvas[] }>('canvasList');
    if (d.ok && d.result) setCanvases(d.result.canvases);
  }, []);
  const loadBindings = useCallback(async () => {
    const d = await call<{ bindings: Binding[] }>('bindingList');
    if (d.ok && d.result) setBindings(d.result.bindings);
  }, []);
  const loadWirings = useCallback(async (cid: string) => {
    const d = await call<{ wirings: Wiring[] }>('wiringList', { canvasId: cid });
    if (d.ok && d.result) setWirings(d.result.wirings);
  }, []);
  const loadPublished = useCallback(async () => {
    const d = await call<{ published: Record<string, unknown>[] }>('publishedList');
    if (d.ok && d.result) setPublished(d.result.published);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await call<{ components: PaletteComp[] }>('palette');
      if (p.ok && p.result) setPalette(p.result.components);
      await loadCanvases();
      await loadBindings();
      await loadPublished();
    })();
  }, [loadCanvases, loadBindings, loadPublished]);

  // Report real, live counts up to the page for its header stat tiles —
  // avoids a second disconnected fetch of the same lists.
  useEffect(() => {
    onStatsChange?.({
      canvasCount: canvases.length,
      publishedCount: published.length,
      bindingCount: bindings.length,
      paletteCount: palette.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvases.length, published.length, bindings.length, palette.length]);

  // open a canvas into the editor
  const openCanvas = useCallback(async (cid: string) => {
    const d = await call<{ canvas: Canvas }>('canvasGet', { canvasId: cid });
    if (d.ok && d.result) {
      setActiveId(cid);
      setWidgets(d.result.canvas.widgets || []);
      setSelectedWidget(null);
      setPreview(null);
      setDirty(false);
      await loadWirings(cid);
    }
  }, [loadWirings]);

  // The page's "New canvas" CTA and the N shortcut ask for the create
  // dialog through this event (the builder owns the form).
  useEffect(() => {
    const open = () => setShowCreate(true);
    window.addEventListener('concord:custom-new-canvas', open);
    return () => window.removeEventListener('concord:custom-new-canvas', open);
  }, []);

  // ── canvas CRUD ───────────────────────────────────────────────────────────
  const createCanvas = useCallback(async () => {
    const name = newName.trim();
    if (!name) { flash('err', 'Name the lens first'); return; }
    setBusy(true);
    const d = await call<{ canvas: Canvas }>('canvasCreate', { name });
    setBusy(false);
    if (d.ok && d.result) {
      setShowCreate(false);
      setNewName('');
      await loadCanvases();
      await openCanvas(d.result.canvas.id);
      flash('ok', `Created "${d.result.canvas.name}"`);
    } else flash('err', d.error || 'create failed');
  }, [newName, loadCanvases, openCanvas, flash]);

  const deleteCanvas = useCallback(async (cid: string) => {
    setConfirmDeleteId(null);
    const d = await call('canvasDelete', { canvasId: cid });
    if (d.ok) {
      if (activeId === cid) { setActiveId(null); setWidgets([]); }
      await loadCanvases();
      await loadPublished();
      flash('ok', 'Deleted');
    } else flash('err', d.error || 'delete failed');
  }, [activeId, loadCanvases, loadPublished, flash]);

  const saveCanvas = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    const d = await call<{ canvas: Canvas }>('canvasSave', { canvasId: activeId, widgets });
    setBusy(false);
    if (d.ok) { setDirty(false); await loadCanvases(); flash('ok', 'Layout saved'); }
    else flash('err', d.error || 'save failed');
  }, [activeId, widgets, loadCanvases, flash]);

  // ── widget canvas ops ─────────────────────────────────────────────────────
  const addWidget = useCallback((type: string) => {
    const comp = palette.find((c) => c.type === type);
    const props: Record<string, unknown> = {};
    for (const p of comp?.props || []) props[p.key] = p.default;
    // grid placement: next free cell across a 12-wide grid
    const cols = 12;
    const used = widgets.reduce((m, w) => m + w.w * w.h, 0);
    const w: Widget = {
      id: `wg_local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type, x: (used * 4) % cols, y: Math.floor((used * 4) / cols) * 3,
      w: 4, h: 3, props, bindingId: null,
    };
    setWidgets((ws) => [...ws, w]);
    setSelectedWidget(w.id);
    setDirty(true);
  }, [palette, widgets]);

  const removeWidget = useCallback((id: string) => {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
    if (selectedWidget === id) setSelectedWidget(null);
    setDirty(true);
  }, [selectedWidget]);

  const updateWidgetProp = useCallback((id: string, key: string, value: unknown) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, props: { ...w.props, [key]: value } } : w)));
    setDirty(true);
  }, []);

  const setWidgetBinding = useCallback((id: string, bindingId: string | null) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, bindingId } : w)));
    setDirty(true);
  }, []);

  const moveWidget = useCallback((id: string, dx: number, dy: number) => {
    setWidgets((ws) => ws.map((w) => (w.id === id
      ? { ...w, x: Math.max(0, w.x + dx), y: Math.max(0, w.y + dy) }
      : w)));
    setDirty(true);
  }, []);

  const resizeWidget = useCallback((id: string, dw: number, dh: number) => {
    setWidgets((ws) => ws.map((w) => (w.id === id
      ? { ...w, w: Math.max(1, w.w + dw), h: Math.max(1, w.h + dh) }
      : w)));
    setDirty(true);
  }, []);

  // ── live preview ──────────────────────────────────────────────────────────
  const runPreview = useCallback(async () => {
    if (!activeId) return;
    setBusy(true);
    // preview the in-editor draft (unsaved) so changes show immediately
    const d = await call<{ widgets: PreviewWidget[]; issues: string[] }>('previewRender', {
      draft: { widgets },
    });
    setBusy(false);
    if (d.ok && d.result) setPreview({ widgets: d.result.widgets, issues: d.result.issues });
    else flash('err', d.error || 'preview failed');
  }, [activeId, widgets, flash]);

  // ── data-source bindings ──────────────────────────────────────────────────
  const createBinding = useCallback(async () => {
    const name = bindingDraft.name.trim();
    if (!name) { flash('err', 'Name the data source first'); return; }
    let input: Record<string, unknown>;
    if (bindingDraft.kind === 'rest') {
      const url = bindingDraft.url.trim();
      if (!url) { flash('err', 'A REST source needs its URL'); return; }
      input = { kind: 'rest', name, url };
    } else {
      const domain = bindingDraft.domain.trim();
      const macro = bindingDraft.macro.trim();
      if (!domain || !macro) { flash('err', 'A macro source needs a domain and a macro name'); return; }
      input = { kind: 'macro', name, domain, macro };
    }
    if (bindingDraft.resultPath.trim()) input.resultPath = bindingDraft.resultPath.trim();
    const d = await call('bindingCreate', input);
    if (d.ok) {
      setShowBindingForm(false);
      setBindingDraft({ kind: 'macro', name: '', domain: '', macro: '', url: '', resultPath: '' });
      await loadBindings();
      flash('ok', 'Binding created');
    }
    else flash('err', d.error || 'binding failed');
  }, [bindingDraft, loadBindings, flash]);

  const deleteBinding = useCallback(async (id: string) => {
    const d = await call('bindingDelete', { bindingId: id });
    if (d.ok) { await loadBindings(); flash('ok', 'Binding removed'); }
  }, [loadBindings, flash]);

  const testBinding = useCallback(async (id: string) => {
    setBusy(true);
    const d = await call<{ tested: boolean; rowCount?: number; fields?: string[]; message?: string }>(
      'bindingTest', { bindingId: id });
    setBusy(false);
    if (d.ok && d.result) {
      flash('ok', d.result.tested
        ? `OK — ${d.result.rowCount} rows, fields: ${(d.result.fields || []).join(', ')}`
        : d.result.message || 'macro binding resolves at run time');
    } else flash('err', d.error || 'binding unreachable');
  }, [flash]);

  // ── event/action wiring ───────────────────────────────────────────────────
  const createWiring = useCallback(async () => {
    if (!activeId || !wiringDraft) return;
    const domain = wiringDraft.domain.trim();
    const macro = wiringDraft.macro.trim();
    if (!domain || !macro) { flash('err', 'An action needs a macro domain and name'); return; }
    const d = await call('wiringCreate', {
      canvasId: activeId, sourceWidgetId: wiringDraft.widgetId, event: 'click',
      action: { kind: 'macro', domain, macro },
      refreshWidgetId: wiringDraft.refreshWidgetId || undefined,
    });
    if (d.ok) { setWiringDraft(null); await loadWirings(activeId); flash('ok', 'Action wired'); }
    else flash('err', d.error || 'wiring failed');
  }, [activeId, wiringDraft, loadWirings, flash]);

  const deleteWiring = useCallback(async (id: string) => {
    if (!activeId) return;
    const d = await call('wiringDelete', { wiringId: id });
    if (d.ok) { await loadWirings(activeId); flash('ok', 'Wiring removed'); }
  }, [activeId, loadWirings, flash]);

  // ── publish / unpublish ───────────────────────────────────────────────────
  const publishCanvas = useCallback(async () => {
    if (!activeId || publishLabel === null) return;
    const navLabel = publishLabel.trim() || active?.name;
    const d = await call('publish', { canvasId: activeId, navLabel });
    if (d.ok) { setPublishLabel(null); await loadPublished(); flash('ok', 'Marked published (listed under Published lenses here)'); }
    else flash('err', d.error || 'publish failed');
  }, [activeId, publishLabel, active, loadPublished, flash]);

  const beginPublish = useCallback(() => {
    if (!activeId) return;
    if (dirty) { flash('err', 'Save the layout before publishing'); return; }
    setPublishLabel(active?.name || '');
  }, [activeId, dirty, active, flash]);

  const unpublishCanvas = useCallback(async (cid: string) => {
    const d = await call('unpublish', { canvasId: cid });
    if (d.ok) { await loadPublished(); flash('ok', 'Unpublished'); }
  }, [loadPublished, flash]);

  // ── import / export ───────────────────────────────────────────────────────
  const exportCanvas = useCallback(async () => {
    if (!activeId) return;
    const d = await call<{ definition: unknown; filename: string }>('exportCanvas', { canvasId: activeId });
    if (d.ok && d.result) {
      const blob = new Blob([JSON.stringify(d.result.definition, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = d.result.filename; a.click();
      URL.revokeObjectURL(url);
      flash('ok', `Exported ${d.result.filename}`);
    } else flash('err', d.error || 'export failed');
  }, [activeId, flash]);

  const importCanvas = useCallback(async (file: File) => {
    try {
      const text = await file.text();
      const definition = JSON.parse(text);
      const d = await call<{ canvas: Canvas; importedWidgets: number }>('importCanvas', { definition });
      if (d.ok && d.result) {
        await loadCanvases();
        await loadBindings();
        await openCanvas(d.result.canvas.id);
        flash('ok', `Imported "${d.result.canvas.name}" (${d.result.importedWidgets} widgets)`);
      } else flash('err', d.error || 'import failed');
    } catch {
      flash('err', 'Invalid lens definition file');
    }
  }, [loadCanvases, loadBindings, openCanvas, flash]);

  const sel = widgets.find((w) => w.id === selectedWidget) || null;
  const selDef = sel ? palette.find((c) => c.type === sel.type) : null;
  const isPublished = (cid: string) => published.some((p) => p.canvasId === cid);

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg px-4 py-2 text-sm shadow-lg ${
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
          {toast.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold flex items-center gap-2 text-neon-purple">
          <MousePointer2 className="w-4 h-4" /> Visual Lens Builder
        </h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCreate(true)} disabled={busy}
            className="btn-neon purple text-sm flex items-center gap-1">
            <Plus className="w-3.5 h-3.5" /> New Lens
          </button>
          <button onClick={() => fileRef.current?.click()}
            className="btn-neon text-sm flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCanvas(f); e.target.value = ''; }} />
        </div>
      </div>

      {showCreate && (
        <div className="panel p-3 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-400" htmlFor="custom-new-canvas-name">New lens name</label>
          <input id="custom-new-canvas-name" autoFocus value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createCanvas(); } }}
            placeholder="e.g. Shift board"
            className="input-lattice text-sm flex-1 min-w-[200px]" />
          <button onClick={createCanvas} disabled={busy || !newName.trim()}
            className="btn-neon purple text-sm disabled:opacity-40">Create lens</button>
          <button onClick={() => { setShowCreate(false); setNewName(''); }}
            className="btn-neon text-sm">Cancel</button>
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* ── Canvas list ──────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-2 panel p-3 space-y-2">
          <p className="text-xs uppercase tracking-wider text-gray-400">Canvases</p>
          {canvases.length === 0 && <p className="text-xs text-gray-400">No canvases yet.</p>}
          {canvases.map((c) => (
            <div key={c.id}
              className={`group rounded px-2 py-1.5 text-sm ${
                activeId === c.id ? 'bg-neon-purple/20 border border-neon-purple/40' : 'hover:bg-white/5'}`}>
              <div className="flex items-center justify-between cursor-pointer"
                onClick={() => openCanvas(c.id)} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
                <span className="truncate flex items-center gap-1">
                  {isPublished(c.id) && <Rocket className="w-3 h-3 text-emerald-400 shrink-0" />}
                  {c.name}
                </span>
                <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {confirmDeleteId === c.id && (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                  <span className="text-red-300">Delete “{c.name}”?</span>
                  <button onClick={() => deleteCanvas(c.id)} className="rounded bg-red-500/20 px-1.5 py-0.5 text-red-200 hover:bg-red-500/30">Delete</button>
                  <button onClick={() => setConfirmDeleteId(null)} className="rounded bg-white/5 px-1.5 py-0.5 text-gray-300 hover:bg-white/10">Keep</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ── Palette + canvas editor ──────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-7 space-y-4">
          {/* Component palette */}
          <div className="panel p-3">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Component Palette</p>
            <div className="flex flex-wrap gap-2">
              {palette.map((c) => (
                <button key={c.type}
                  onClick={() => active ? addWidget(c.type) : flash('err', 'Open a canvas first')}
                  title={c.description}
                  className="flex items-center gap-1.5 rounded-lg border border-lattice-edge bg-lattice-deep px-2.5 py-1.5 text-xs hover:border-neon-purple/50 hover:bg-neon-purple/10">
                  <span>{c.icon}</span>{c.label}
                  {c.binds && <Link2 className="w-3 h-3 text-gray-600" />}
                </button>
              ))}
            </div>
          </div>

          {/* Widget canvas */}
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-gray-400">
                {active ? `${active.name} — ${widgets.length} widgets` : 'Canvas'}
              </p>
              {active && (
                <div className="flex items-center gap-1.5">
                  <button onClick={saveCanvas} disabled={busy || !dirty}
                    className="btn-neon text-xs flex items-center gap-1 disabled:opacity-40">
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {dirty ? 'Save*' : 'Saved'}
                  </button>
                  <button onClick={runPreview} disabled={busy}
                    className="btn-neon text-xs flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Preview
                  </button>
                  <button onClick={exportCanvas}
                    className="btn-neon text-xs flex items-center gap-1">
                    <Download className="w-3 h-3" /> Export
                  </button>
                  <button onClick={beginPublish}
                    className="btn-neon purple text-xs flex items-center gap-1">
                    <Rocket className="w-3 h-3" /> Publish
                  </button>
                </div>
              )}
            </div>

            {active && publishLabel !== null && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-lattice-edge bg-lattice-deep p-2">
                <label className="text-xs text-gray-400" htmlFor="custom-publish-label">Published label</label>
                <input id="custom-publish-label" value={publishLabel}
                  onChange={(e) => setPublishLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); publishCanvas(); } }}
                  className="input-lattice text-xs flex-1 min-w-[160px]" />
                <span className="text-[10px] text-gray-500">Recorded under Published lenses here — not added to the main sidebar.</span>
                <button onClick={publishCanvas} className="btn-neon purple text-xs">Publish</button>
                <button onClick={() => setPublishLabel(null)} className="btn-neon text-xs">Cancel</button>
              </div>
            )}

            {!active ? (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm">
                Select or create a canvas to start building.
              </div>
            ) : widgets.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-gray-600 text-sm border border-dashed border-lattice-edge rounded-lg">
                Click a palette component to place your first widget.
              </div>
            ) : (
              <div className="grid grid-cols-12 gap-2 auto-rows-[2.4rem]">
                {widgets.map((w) => {
                  const def = palette.find((c) => c.type === w.type);
                  const bound = bindings.find((b) => b.id === w.bindingId);
                  return (
                    <div key={w.id}
                      onClick={() => setSelectedWidget(w.id)}
                      style={{ gridColumn: `span ${Math.min(12, w.w)}`, gridRow: `span ${w.h}` }}
                      className={`relative rounded-lg border p-2 cursor-pointer overflow-hidden ${
                        selectedWidget === w.id
                          ? 'border-neon-cyan ring-1 ring-neon-cyan bg-neon-cyan/5'
                          : 'border-lattice-edge bg-lattice-deep hover:border-neon-purple/40'}`} role="button" tabIndex={0} onKeyDown={activateOnEnterOrSpace}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 truncate">
                          {def?.icon} {String(w.props.title || w.props.label || def?.label || w.type)}
                        </span>
                        <button aria-label="Remove widget" onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }}
                          className="text-gray-600 hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {w.type} · {w.w}×{w.h}
                        {def?.binds && (bound
                          ? <span className="text-emerald-500"> · {bound.name}</span>
                          : <span className="text-amber-500"> · unbound</span>)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live preview */}
          {preview && (
            <div className="panel p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" /> Live Preview
                </p>
                <button aria-label="Close preview" onClick={() => setPreview(null)} className="text-gray-600 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {preview.issues.length > 0 && (
                <div className="mb-2 rounded bg-amber-500/10 border border-amber-500/30 p-2 text-[11px] text-amber-400">
                  {preview.issues.map((iss, i) => <div key={i}>⚠ {iss}</div>)}
                </div>
              )}
              <div className="grid grid-cols-12 gap-2 auto-rows-[2.4rem]">
                {preview.widgets.map((pw) => (
                  <div key={pw.id}
                    style={{ gridColumn: `span ${Math.min(12, pw.w)}`, gridRow: `span ${Math.max(2, pw.h)}` }}
                    className={`rounded-lg border p-2 ${
                      pw.renderable ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
                    <p className="text-xs flex items-center gap-1">{pw.icon} {String(pw.props.title || pw.label)}</p>
                    {pw.type === 'metric' && (
                      <p className="text-2xl font-bold text-neon-cyan mt-1">
                        — <span className="text-xs text-gray-400">{String(pw.props.unit || '')}</span>
                      </p>
                    )}
                    {pw.type === 'chart' && (
                      <ChartKit kind={(pw.props.chartKind as 'line' | 'bar' | 'area' | 'scatter') || 'bar'}
                        height={70}
                        data={[{ label: 'A', value: 4 }, { label: 'B', value: 7 }, { label: 'C', value: 5 }]}
                        xKey={String(pw.props.xKey || 'label')}
                        series={[{ key: String(pw.props.yKey || 'value') }]}
                        showLegend={false} showGrid={false} />
                    )}
                    {pw.type === 'table' && (
                      <p className="text-[10px] text-gray-400 mt-1">
                        cols: {(pw.props.columns as string[] || []).join(', ')}
                      </p>
                    )}
                    {pw.type === 'text' && (
                      <p className="text-[10px] text-gray-400 mt-1">{String(pw.props.content || '')}</p>
                    )}
                    <p className="text-[9px] text-gray-400 mt-1">
                      {pw.binding ? `← ${pw.binding.name}` : pw.renderable ? 'static' : pw.issues.join('; ')}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Inspector: props / binding / wiring ──────────────────────────── */}
        <div className="col-span-12 lg:col-span-3 space-y-4">
          {/* Property panel */}
          <div className="panel p-3">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Properties</p>
            {!sel ? (
              <p className="text-xs text-gray-400">Select a widget to edit its props.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-400">{selDef?.icon} {selDef?.label} · {sel.id.slice(-6)}</p>
                {(selDef?.props || []).map((p) => {
                  const val = sel.props[p.key];
                  const isEnum = p.type.startsWith('enum:');
                  if (isEnum) {
                    const opts = p.type.replace('enum:', '').split('|');
                    return (
                      <label key={p.key} className="block text-xs">
                        <span className="text-gray-400">{p.key}</span>
                        <select value={String(val ?? '')}
                          onChange={(e) => updateWidgetProp(sel.id, p.key, e.target.value)}
                          className="input-lattice w-full mt-0.5 text-xs">
                          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </label>
                    );
                  }
                  if (p.type === 'number') {
                    return (
                      <label key={p.key} className="block text-xs">
                        <span className="text-gray-400">{p.key}</span>
                        <input type="number" value={Number(val ?? 0)}
                          onChange={(e) => updateWidgetProp(sel.id, p.key, Number(e.target.value))}
                          className="input-lattice w-full mt-0.5 text-xs" />
                      </label>
                    );
                  }
                  if (p.type === 'string[]' || p.type === 'field[]') {
                    return (
                      <label key={p.key} className="block text-xs">
                        <span className="text-gray-400">{p.key} (comma-sep)</span>
                        <input type="text"
                          value={Array.isArray(val) ? val.map((x) => typeof x === 'object' ? JSON.stringify(x) : x).join(',') : String(val ?? '')}
                          onChange={(e) => updateWidgetProp(sel.id, p.key, e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                          className="input-lattice w-full mt-0.5 text-xs" />
                      </label>
                    );
                  }
                  return (
                    <label key={p.key} className="block text-xs">
                      <span className="text-gray-400">{p.key}</span>
                      <input type="text" value={String(val ?? '')}
                        onChange={(e) => updateWidgetProp(sel.id, p.key, e.target.value)}
                        className="input-lattice w-full mt-0.5 text-xs" />
                    </label>
                  );
                })}

                {/* size controls */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="text-[10px] text-gray-400">size</span>
                  <button onClick={() => resizeWidget(sel.id, -1, 0)} className="btn-neon text-[10px] px-1.5">W-</button>
                  <button onClick={() => resizeWidget(sel.id, 1, 0)} className="btn-neon text-[10px] px-1.5">W+</button>
                  <button onClick={() => resizeWidget(sel.id, 0, -1)} className="btn-neon text-[10px] px-1.5">H-</button>
                  <button onClick={() => resizeWidget(sel.id, 0, 1)} className="btn-neon text-[10px] px-1.5">H+</button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-400">move</span>
                  <button onClick={() => moveWidget(sel.id, -1, 0)} className="btn-neon text-[10px] px-1.5">←</button>
                  <button onClick={() => moveWidget(sel.id, 1, 0)} className="btn-neon text-[10px] px-1.5">→</button>
                  <button onClick={() => moveWidget(sel.id, 0, -1)} className="btn-neon text-[10px] px-1.5">↑</button>
                  <button onClick={() => moveWidget(sel.id, 0, 1)} className="btn-neon text-[10px] px-1.5">↓</button>
                </div>

                {/* data-source binding */}
                {selDef?.binds && (
                  <label className="block text-xs pt-1">
                    <span className="text-gray-400">data source</span>
                    <select value={sel.bindingId || ''}
                      onChange={(e) => setWidgetBinding(sel.id, e.target.value || null)}
                      className="input-lattice w-full mt-0.5 text-xs">
                      <option value="">— none —</option>
                      {bindings.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.kind})</option>)}
                    </select>
                  </label>
                )}

                {/* event wiring for buttons */}
                {sel.type === 'button' && wiringDraft?.widgetId !== sel.id && (
                  <button onClick={() => setWiringDraft({ widgetId: sel.id, domain: '', macro: '', refreshWidgetId: '' })}
                    className="btn-neon text-xs w-full flex items-center justify-center gap-1 mt-1">
                    <Zap className="w-3 h-3" /> Wire click action
                  </button>
                )}
                {sel.type === 'button' && wiringDraft?.widgetId === sel.id && (
                  <div className="mt-1 space-y-1.5 rounded border border-lattice-edge bg-lattice-deep p-2">
                    <label className="block text-xs">
                      <span className="text-gray-400">action macro domain</span>
                      <input type="text" value={wiringDraft.domain} placeholder="e.g. productivity"
                        onChange={(e) => setWiringDraft((d) => (d ? { ...d, domain: e.target.value } : d))}
                        className="input-lattice w-full mt-0.5 text-xs" />
                    </label>
                    <label className="block text-xs">
                      <span className="text-gray-400">action macro name</span>
                      <input type="text" value={wiringDraft.macro} placeholder="e.g. task-add"
                        onChange={(e) => setWiringDraft((d) => (d ? { ...d, macro: e.target.value } : d))}
                        className="input-lattice w-full mt-0.5 text-xs" />
                    </label>
                    <label className="block text-xs">
                      <span className="text-gray-400">refresh after (optional)</span>
                      <select value={wiringDraft.refreshWidgetId}
                        onChange={(e) => setWiringDraft((d) => (d ? { ...d, refreshWidgetId: e.target.value } : d))}
                        className="input-lattice w-full mt-0.5 text-xs">
                        <option value="">— none —</option>
                        {widgets.filter((w) => w.id !== sel.id).map((w) => {
                          const wd = palette.find((c) => c.type === w.type);
                          return <option key={w.id} value={w.id}>{String(w.props.title || w.props.label || wd?.label || w.type)}</option>;
                        })}
                      </select>
                    </label>
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button onClick={createWiring} className="btn-neon purple text-xs">Wire action</button>
                      <button onClick={() => setWiringDraft(null)} className="btn-neon text-xs">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Data sources */}
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-gray-400">Data Sources</p>
              <button aria-label="Add" onClick={() => setShowBindingForm((s) => !s)} className="text-neon-purple hover:text-white">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {showBindingForm && (
              <div className="mb-2 space-y-1.5 rounded border border-lattice-edge bg-lattice-deep p-2">
                <label className="block text-xs">
                  <span className="text-gray-400">kind</span>
                  <select value={bindingDraft.kind}
                    onChange={(e) => setBindingDraft((d) => ({ ...d, kind: e.target.value }))}
                    className="input-lattice w-full mt-0.5 text-xs">
                    <option value="macro">macro</option>
                    <option value="rest">rest</option>
                  </select>
                </label>
                <label className="block text-xs">
                  <span className="text-gray-400">name</span>
                  <input type="text" value={bindingDraft.name} placeholder="e.g. Weather forecast"
                    onChange={(e) => setBindingDraft((d) => ({ ...d, name: e.target.value }))}
                    className="input-lattice w-full mt-0.5 text-xs" />
                </label>
                {bindingDraft.kind === 'macro' ? (
                  <>
                    <label className="block text-xs">
                      <span className="text-gray-400">macro domain</span>
                      <input type="text" value={bindingDraft.domain} placeholder="e.g. weather"
                        onChange={(e) => setBindingDraft((d) => ({ ...d, domain: e.target.value }))}
                        className="input-lattice w-full mt-0.5 text-xs" />
                    </label>
                    <label className="block text-xs">
                      <span className="text-gray-400">macro name</span>
                      <input type="text" value={bindingDraft.macro} placeholder="e.g. forecast"
                        onChange={(e) => setBindingDraft((d) => ({ ...d, macro: e.target.value }))}
                        className="input-lattice w-full mt-0.5 text-xs" />
                    </label>
                  </>
                ) : (
                  <label className="block text-xs">
                    <span className="text-gray-400">REST URL</span>
                    <input type="text" value={bindingDraft.url} placeholder="https://…"
                      onChange={(e) => setBindingDraft((d) => ({ ...d, url: e.target.value }))}
                      className="input-lattice w-full mt-0.5 text-xs" />
                  </label>
                )}
                <label className="block text-xs">
                  <span className="text-gray-400">result path (optional)</span>
                  <input type="text" value={bindingDraft.resultPath}
                    onChange={(e) => setBindingDraft((d) => ({ ...d, resultPath: e.target.value }))}
                    className="input-lattice w-full mt-0.5 text-xs" />
                </label>
                <div className="flex items-center gap-1.5 pt-0.5">
                  <button onClick={createBinding} className="btn-neon purple text-xs">Create binding</button>
                  <button onClick={() => setShowBindingForm(false)} className="btn-neon text-xs">Cancel</button>
                </div>
              </div>
            )}
            {bindings.length === 0 && <p className="text-xs text-gray-400">No bindings yet.</p>}
            {bindings.map((b) => (
              <div key={b.id} className="group flex items-center justify-between text-xs py-1">
                <span className="truncate">
                  <Link2 className="w-3 h-3 inline mr-1 text-gray-600" />{b.name}
                  <span className="text-gray-600"> · {b.kind}</span>
                </span>
                <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button aria-label="Refresh" onClick={() => testBinding(b.id)} className="text-gray-400 hover:text-neon-cyan">
                    <RefreshCw className="w-3 h-3" />
                  </button>
                  <button aria-label="Delete" onClick={() => deleteBinding(b.id)} className="text-gray-400 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              </div>
            ))}
          </div>

          {/* Event wirings */}
          {active && (
            <div className="panel p-3">
              <p className="text-xs uppercase tracking-wider text-gray-400 mb-2">Event Wirings</p>
              {wirings.length === 0 && <p className="text-xs text-gray-400">No wirings on this canvas.</p>}
              {wirings.map((wr) => (
                <div key={wr.id} className="group flex items-center justify-between text-xs py-1">
                  <span className="truncate">
                    <Zap className="w-3 h-3 inline mr-1 text-amber-500" />
                    {wr.event} → {wr.action.domain}.{wr.action.macro}
                    {wr.refreshWidgetId && <span className="text-gray-600"> ↻</span>}
                  </span>
                  <button aria-label="Delete" onClick={() => deleteWiring(wr.id)}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Published lenses */}
          <div className="panel p-3">
            <p className="text-xs uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
              <Rocket className="w-3.5 h-3.5" /> Published lenses
            </p>
            {published.length === 0 && <p className="text-xs text-gray-400">Nothing published. Publishing records the lens here; it does not add an entry to the main sidebar.</p>}
            {published.map((p) => (
              <div key={String(p.canvasId)} className="group flex items-center justify-between text-xs py-1">
                <span className="truncate">{String(p.icon)} {String(p.navLabel)}
                  <span className="text-gray-600"> /{String(p.slug)}</span>
                </span>
                <button aria-label="Unpublish canvas" onClick={() => unpublishCanvas(String(p.canvasId))}
                  className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
