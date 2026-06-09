'use client';

/**
 * VisualEditor — drag-and-drop component canvas for the maker no-code
 * builder. Backed by the `app-maker` macro domain (editor.*, data.*).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Plus, Trash2, Eye, Link2, Unlink, Save } from 'lucide-react';

interface PaletteEntry { type: string; label: string; category: string; w: number; h: number }
interface CanvasElement {
  id: string; type: string; x: number; y: number; w: number; h: number;
  props?: Record<string, unknown>;
  binding?: { kind: string; refId: string; label: string; query?: string };
}
interface PageMeta { id: string; name: string; route: string }
interface DataTable { id: string; name: string; fields: { name: string; type: string }[] }
interface Connector { id: string; name: string; kind: string }

export function VisualEditor({
  projectId,
  pages,
  tables,
  connectors,
  onPreview,
  onPagesChanged,
}: {
  projectId: string;
  pages: PageMeta[];
  tables: DataTable[];
  connectors: Connector[];
  onPreview: (pageId: string) => void;
  onPagesChanged: () => void;
}) {
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [activePage, setActivePage] = useState<string>(pages[0]?.id ?? '');
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    lensRun('app-maker', 'editorPalette', {}).then((r) => {
      if (r.data?.ok && r.data.result?.palette) setPalette(r.data.result.palette);
    });
  }, []);

  useEffect(() => {
    if (pages.length && !pages.some((p) => p.id === activePage)) setActivePage(pages[0].id);
  }, [pages, activePage]);

  const loadPage = useCallback(async (pageId: string) => {
    if (!pageId) return;
    setLoading(true);
    const r = await lensRun('app-maker', 'previewRender', { projectId, pageId });
    setLoading(false);
    // previewRender returns page meta only; fetch full project for elements
    const proj = await lensRun('app-maker', 'projectGet', { projectId });
    if (proj.data?.ok) {
      const page = proj.data.result?.project?.pages?.find((p: PageMeta) => p.id === pageId);
      setElements(page?.elements ?? []);
    }
    setDirty(false);
    void r;
  }, [projectId]);

  useEffect(() => { if (activePage) void loadPage(activePage); }, [activePage, loadPage]);

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  function addElement(entry: PaletteEntry) {
    const el: CanvasElement = {
      id: `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: entry.type, x: 40, y: 40, w: entry.w, h: entry.h,
      props: { label: entry.label },
    };
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
    setDirty(true);
  }

  function updateElement(id: string, patch: Partial<CanvasElement>) {
    setElements((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setDirty(true);
  }

  function updateProp(id: string, key: string, value: unknown) {
    setElements((prev) =>
      prev.map((e) => (e.id === id ? { ...e, props: { ...(e.props ?? {}), [key]: value } } : e)),
    );
    setDirty(true);
  }

  function removeElement(id: string) {
    setElements((prev) => prev.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    const r = await lensRun('app-maker', 'editorSavePage', {
      projectId, pageId: activePage, elements,
    });
    setSaving(false);
    if (r.data?.ok) setDirty(false);
  }

  async function addPage() {
    const r = await lensRun('app-maker', 'editorAddPage', { projectId });
    if (r.data?.ok) { onPagesChanged(); setActivePage(r.data.result?.page?.id ?? activePage); }
  }

  async function bind(elementId: string, kind: 'table' | 'connector', refId: string) {
    const r = await lensRun('app-maker', 'dataBindElement', {
      projectId, pageId: activePage, elementId, source: { kind, refId },
    });
    if (r.data?.ok) updateElement(elementId, { binding: r.data.result?.binding });
  }
  async function unbind(elementId: string) {
    const r = await lensRun('app-maker', 'dataUnbindElement', { projectId, pageId: activePage, elementId });
    if (r.data?.ok) setElements((prev) => prev.map((e) => (e.id === elementId ? { ...e, binding: undefined } : e)));
  }

  // Pointer drag on the canvas.
  function onPointerDown(e: React.PointerEvent, el: CanvasElement) {
    setSelectedId(el.id);
    const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    setDrag({ id: el.id, dx: e.clientX - rect.left - el.x, dy: e.clientY - rect.top - el.y });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.round(e.clientX - rect.left - drag.dx));
    const y = Math.max(0, Math.round(e.clientY - rect.top - drag.dy));
    updateElement(drag.id, { x, y });
  }
  function onPointerUp() { setDrag(null); }

  const grouped = useMemo(() => {
    const g: Record<string, PaletteEntry[]> = {};
    for (const p of palette) { (g[p.category] ??= []).push(p); }
    return g;
  }, [palette]);

  return (
    <div className="grid gap-3 lg:grid-cols-[180px_1fr_240px]">
      {/* Palette */}
      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-pink-500">Components</h4>
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="mb-2">
            <div className="mb-1 text-[10px] uppercase text-pink-700">{cat}</div>
            <div className="flex flex-wrap gap-1">
              {items.map((it) => (
                <button
                  key={it.type}
                  onClick={() => addElement(it)}
                  className="rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[10px] text-pink-200 hover:border-pink-500"
                >
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {!palette.length && <Loader2 className="h-3 w-3 animate-spin text-pink-600" />}
      </aside>

      {/* Canvas */}
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setActivePage(p.id)}
              className={`rounded px-2 py-1 text-[11px] ${
                activePage === p.id ? 'bg-pink-700/50 text-pink-100' : 'bg-pink-950/30 text-pink-500 hover:text-pink-300'
              }`}
            >
              {p.name}
            </button>
          ))}
          <button onClick={addPage} className="inline-flex items-center gap-1 rounded bg-pink-950/30 px-2 py-1 text-[11px] text-pink-400 hover:text-pink-200">
            <Plus className="h-3 w-3" /> Page
          </button>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="inline-flex items-center gap-1 rounded bg-pink-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-pink-500 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} {dirty ? 'Save' : 'Saved'}
            </button>
            <button
              onClick={() => onPreview(activePage)}
              className="inline-flex items-center gap-1 rounded border border-pink-700/50 px-2.5 py-1 text-[11px] text-pink-300 hover:bg-pink-900/30"
            >
              <Eye className="h-3 w-3" /> Preview
            </button>
          </div>
        </div>
        <div
          className="relative h-[440px] overflow-hidden rounded-lg border border-pink-900/40 bg-[#020617]"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ backgroundImage: 'radial-gradient(circle, #1e293b 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          {loading && <Loader2 className="absolute left-3 top-3 h-4 w-4 animate-spin text-pink-500" />}
          {!loading && elements.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-xs text-pink-700">
              Click a component on the left to drop it on the canvas.
            </p>
          )}
          {elements.map((el) => (
            <div
              key={el.id}
              onPointerDown={(e) => onPointerDown(e, el)}
              className={`absolute cursor-move select-none rounded border text-[11px] ${
                selectedId === el.id ? 'border-pink-400 ring-1 ring-pink-400' : 'border-pink-800/50'
              }`}
              style={{ left: el.x, top: el.y, width: el.w, height: el.h, background: '#0f172a' }}
            >
              <div className="flex h-full items-center justify-center px-1.5 text-pink-200">
                <span className="truncate">{String(el.props?.label ?? el.props?.text ?? el.type)}</span>
              </div>
              {el.binding && (
                <span className="absolute -top-2 -right-1 rounded bg-emerald-700/80 px-1 text-[8px] text-white">
                  ⛁ {el.binding.label}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Property inspector */}
      <aside className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-2.5 text-[11px]">
        <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-pink-500">Inspector</h4>
        {!selected && <p className="text-pink-700">Select an element to edit its properties.</p>}
        {selected && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-pink-300">{selected.type}</span>
              <button aria-label="Delete" onClick={() => removeElement(selected.id)} className="text-rose-400 hover:text-rose-300">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <Field label="Label">
              <input
                value={String(selected.props?.label ?? '')}
                onChange={(e) => updateProp(selected.id, 'label', e.target.value)}
                className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
              />
            </Field>
            <div className="grid grid-cols-2 gap-1.5">
              {(['x', 'y', 'w', 'h'] as const).map((k) => (
                <Field key={k} label={k.toUpperCase()}>
                  <input
                    type="number"
                    value={selected[k]}
                    onChange={(e) => updateElement(selected.id, { [k]: Number(e.target.value) })}
                    className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
                  />
                </Field>
              ))}
            </div>
            <div className="border-t border-pink-900/40 pt-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] uppercase text-pink-600">
                <Link2 className="h-3 w-3" /> Data binding
              </div>
              {selected.binding ? (
                <div className="flex items-center justify-between rounded bg-emerald-950/30 px-1.5 py-1 text-emerald-300">
                  <span className="truncate">{selected.binding.kind}: {selected.binding.label}</span>
                  <button aria-label="Unlink" onClick={() => unbind(selected.id)} className="text-emerald-400 hover:text-emerald-200">
                    <Unlink className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const [kind, refId] = e.target.value.split('::');
                    if (kind && refId) void bind(selected.id, kind as 'table' | 'connector', refId);
                  }}
                  className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-pink-100"
                >
                  <option value="">Bind to data source…</option>
                  {tables.length > 0 && (
                    <optgroup label="Tables">
                      {tables.map((t) => <option key={t.id} value={`table::${t.id}`}>{t.name}</option>)}
                    </optgroup>
                  )}
                  {connectors.length > 0 && (
                    <optgroup label="Connectors">
                      {connectors.map((c) => <option key={c.id} value={`connector::${c.id}`}>{c.name}</option>)}
                    </optgroup>
                  )}
                </select>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] uppercase text-pink-700">{label}</span>
      {children}
    </label>
  );
}
