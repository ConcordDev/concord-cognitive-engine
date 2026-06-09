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

export function CanvasBuilder() {
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

  // ── canvas CRUD ───────────────────────────────────────────────────────────
  const createCanvas = useCallback(async () => {
    const name = window.prompt('New lens name?');
    if (!name?.trim()) return;
    setBusy(true);
    const d = await call<{ canvas: Canvas }>('canvasCreate', { name: name.trim() });
    setBusy(false);
    if (d.ok && d.result) {
      await loadCanvases();
      await openCanvas(d.result.canvas.id);
      flash('ok', `Created "${d.result.canvas.name}"`);
    } else flash('err', d.error || 'create failed');
  }, [loadCanvases, openCanvas, flash]);

  const deleteCanvas = useCallback(async (cid: string) => {
    if (!window.confirm('Delete this lens?')) return;
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
    const kind = window.prompt('Binding kind — "macro" or "rest"?', 'macro');
    if (!kind) return;
    const name = window.prompt('Binding name?');
    if (!name?.trim()) return;
    let input: Record<string, unknown>;
    if (kind === 'rest') {
      const url = window.prompt('REST URL (https://…)?');
      if (!url) return;
      input = { kind: 'rest', name: name.trim(), url };
    } else {
      const domain = window.prompt('Macro domain? (e.g. weather)');
      const macro = window.prompt('Macro name? (e.g. forecast)');
      if (!domain || !macro) return;
      input = { kind: 'macro', name: name.trim(), domain, macro };
    }
    const d = await call('bindingCreate', input);
    if (d.ok) { await loadBindings(); flash('ok', 'Binding created'); }
    else flash('err', d.error || 'binding failed');
  }, [loadBindings, flash]);

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
  const createWiring = useCallback(async (sourceWidgetId: string) => {
    if (!activeId) return;
    const domain = window.prompt('Action — macro domain?');
    const macro = window.prompt('Action — macro name?');
    if (!domain || !macro) return;
    const refresh = window.prompt('Refresh which widget id after? (optional)') || '';
    const d = await call('wiringCreate', {
      canvasId: activeId, sourceWidgetId, event: 'click',
      action: { kind: 'macro', domain, macro },
      refreshWidgetId: refresh || undefined,
    });
    if (d.ok) { await loadWirings(activeId); flash('ok', 'Action wired'); }
    else flash('err', d.error || 'wiring failed');
  }, [activeId, loadWirings, flash]);

  const deleteWiring = useCallback(async (id: string) => {
    if (!activeId) return;
    const d = await call('wiringDelete', { wiringId: id });
    if (d.ok) { await loadWirings(activeId); flash('ok', 'Wiring removed'); }
  }, [activeId, loadWirings, flash]);

  // ── publish / unpublish ───────────────────────────────────────────────────
  const publishCanvas = useCallback(async () => {
    if (!activeId) return;
    if (dirty) { flash('err', 'Save the layout before publishing'); return; }
    const navLabel = window.prompt('Nav label?', active?.name) || active?.name;
    const d = await call('publish', { canvasId: activeId, navLabel });
    if (d.ok) { await loadPublished(); flash('ok', 'Published to navigation'); }
    else flash('err', d.error || 'publish failed');
  }, [activeId, dirty, active, loadPublished, flash]);

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
          <button onClick={createCanvas} disabled={busy}
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

      <div className="grid grid-cols-12 gap-4">
        {/* ── Canvas list ──────────────────────────────────────────────────── */}
        <div className="col-span-12 lg:col-span-2 panel p-3 space-y-2">
          <p className="text-xs uppercase tracking-wider text-gray-400">Canvases</p>
          {canvases.length === 0 && <p className="text-xs text-gray-400">No canvases yet.</p>}
          {canvases.map((c) => (
            <div key={c.id}
              className={`group flex items-center justify-between rounded px-2 py-1.5 text-sm cursor-pointer ${
                activeId === c.id ? 'bg-neon-purple/20 border border-neon-purple/40' : 'hover:bg-white/5'}`}
              onClick={() => openCanvas(c.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <span className="truncate flex items-center gap-1">
                {isPublished(c.id) && <Rocket className="w-3 h-3 text-emerald-400 shrink-0" />}
                {c.name}
              </span>
              <button aria-label="Delete" onClick={(e) => { e.stopPropagation(); deleteCanvas(c.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
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
                  <button onClick={publishCanvas}
                    className="btn-neon purple text-xs flex items-center gap-1">
                    <Rocket className="w-3 h-3" /> Publish
                  </button>
                </div>
              )}
            </div>

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
                          : 'border-lattice-edge bg-lattice-deep hover:border-neon-purple/40'}`} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1 truncate">
                          {def?.icon} {String(w.props.title || w.props.label || def?.label || w.type)}
                        </span>
                        <button onClick={(e) => { e.stopPropagation(); removeWidget(w.id); }}
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
                <button onClick={() => setPreview(null)} className="text-gray-600 hover:text-white">
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
                {sel.type === 'button' && (
                  <button onClick={() => createWiring(sel.id)}
                    className="btn-neon text-xs w-full flex items-center justify-center gap-1 mt-1">
                    <Zap className="w-3 h-3" /> Wire click action
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Data sources */}
          <div className="panel p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-gray-400">Data Sources</p>
              <button aria-label="Add" onClick={createBinding} className="text-neon-purple hover:text-white">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
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
              <Rocket className="w-3.5 h-3.5" /> In Navigation
            </p>
            {published.length === 0 && <p className="text-xs text-gray-400">Nothing published.</p>}
            {published.map((p) => (
              <div key={String(p.canvasId)} className="group flex items-center justify-between text-xs py-1">
                <span className="truncate">{String(p.icon)} {String(p.navLabel)}
                  <span className="text-gray-600"> /{String(p.slug)}</span>
                </span>
                <button onClick={() => unpublishCanvas(String(p.canvasId))}
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
