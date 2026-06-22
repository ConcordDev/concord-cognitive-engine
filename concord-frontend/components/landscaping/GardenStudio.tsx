'use client';

/**
 * GardenStudio — the landscape-design surface for the landscaping lens.
 * Wires the eight buildable backlog features against server/domains/landscaping.js:
 *   1. Visual yard designer (drag-drop 2D plot canvas)
 *   2. AR / photo-overlay plant preview
 *   3. Plant identification from photo (vision brain)
 *   4. Plant-care reminders from care-log cadence
 *   5. Climate / hardiness-zone plant matching
 *   6. Cost estimate -> contractor proposal
 *   7. Maintenance calendar (per-bed seasonal tasks)
 *   8. Plant health diary (photo timeline per planting)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  LayoutGrid,
  ImageIcon,
  ScanSearch,
  BellRing,
  Globe2,
  FileSpreadsheet,
  CalendarDays,
  NotebookPen,
  Plus,
  Trash2,
  Loader2,
  Sprout,
} from 'lucide-react';

type StudioTab =
  | 'designer'
  | 'overlay'
  | 'identify'
  | 'reminders'
  | 'climate'
  | 'proposal'
  | 'calendar'
  | 'diary';

const STUDIO_TABS: { id: StudioTab; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'designer', label: 'Yard Designer', icon: LayoutGrid },
  { id: 'overlay', label: 'Photo Preview', icon: ImageIcon },
  { id: 'identify', label: 'Identify Plant', icon: ScanSearch },
  { id: 'reminders', label: 'Care Reminders', icon: BellRing },
  { id: 'climate', label: 'Climate Match', icon: Globe2 },
  { id: 'proposal', label: 'Proposal', icon: FileSpreadsheet },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'diary', label: 'Health Diary', icon: NotebookPen },
];

// ─── shared shapes ──────────────────────────────────────────────────
interface YardElement {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  widthFt: number;
  heightFt: number;
  color: string;
}
interface Layout {
  id: string;
  name: string;
  plotWidthFt: number;
  plotHeightFt: number;
  elements: YardElement[];
  elementCount?: number;
}
interface Bed {
  id: string;
  name: string;
  sizeSqft: number;
  sunExposure: string;
  soilType: string;
  plantingCount?: number;
  careCount?: number;
}

const ELEMENT_KINDS = ['bed', 'plant', 'tree', 'shrub', 'path', 'patio', 'water', 'lawn', 'fence'];
const KIND_COLORS: Record<string, string> = {
  bed: '#a16207',
  plant: '#22c55e',
  tree: '#15803d',
  shrub: '#4d7c0f',
  path: '#a8a29e',
  patio: '#78716c',
  water: '#0ea5e9',
  lawn: '#65a30d',
  fence: '#92400e',
};

const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/40';
const btnCls =
  'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50';
const cardCls = 'rounded-lg border border-zinc-800 bg-zinc-950/60 p-4';

export function GardenStudio() {
  const [tab, setTab] = useState<StudioTab>('designer');

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-emerald-500/15 pb-3">
        <Sprout className="h-5 w-5 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Garden Studio</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          design · preview · maintain
        </span>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {STUDIO_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
              tab === t.id
                ? 'bg-emerald-500/20 text-emerald-200'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'designer' && <YardDesigner />}
      {/* @modal-escape-ok: PhotoOverlay is a tab panel selected by `tab`, not a trapping modal dialog. */}
      {tab === 'overlay' && <PhotoOverlay />}
      {tab === 'identify' && <PlantIdentify />}
      {tab === 'reminders' && <CareReminders />}
      {tab === 'climate' && <ClimateMatch />}
      {tab === 'proposal' && <ProposalBuilder />}
      {tab === 'calendar' && <MaintenanceCalendar />}
      {tab === 'diary' && <HealthDiary />}
    </div>
  );
}

// ─── Feature 1 — Visual yard designer ───────────────────────────────
function YardDesigner() {
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newW, setNewW] = useState('');
  const [newH, setNewH] = useState('');
  const [elements, setElements] = useState<YardElement[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [palette, setPalette] = useState('plant');
  const canvasRef = useRef<HTMLDivElement>(null);

  const active = layouts.find((l) => l.id === activeId) || null;

  const loadLayouts = useCallback(async () => {
    setErr(null);
    const r = await lensRun<{ layouts: Layout[] }>('landscaping', 'layout-list', {});
    if (r.data.ok && r.data.result) setLayouts(r.data.result.layouts);
    else setErr(r.data.error || 'failed to load layouts');
  }, []);

  useEffect(() => {
    loadLayouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) {
      setElements(active.elements.map((e) => ({ ...e })));
      setDirty(false);
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const createLayout = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    const r = await lensRun<{ layout: Layout }>('landscaping', 'layout-create', {
      name: newName.trim(),
      plotWidthFt: newW ? Number(newW) : 40,
      plotHeightFt: newH ? Number(newH) : 30,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setNewName('');
      setNewW('');
      setNewH('');
      await loadLayouts();
      setActiveId(r.data.result.layout.id);
    } else setErr(r.data.error || 'create failed');
  };

  const deleteLayout = async (id: string) => {
    await lensRun('landscaping', 'layout-delete', { id });
    if (activeId === id) setActiveId(null);
    await loadLayouts();
  };

  const addElement = () => {
    if (!active) return;
    const el: YardElement = {
      id: `el_${Date.now().toString(36)}`,
      kind: palette,
      label: palette,
      x: Math.round(active.plotWidthFt / 2),
      y: Math.round(active.plotHeightFt / 2),
      widthFt: palette === 'tree' ? 8 : palette === 'lawn' || palette === 'patio' ? 12 : 3,
      heightFt: palette === 'tree' ? 8 : palette === 'lawn' || palette === 'patio' ? 10 : 3,
      color: KIND_COLORS[palette] || '#22c55e',
    };
    setElements((prev) => [...prev, el]);
    setDirty(true);
  };

  const removeElement = (id: string) => {
    setElements((prev) => prev.filter((e) => e.id !== id));
    setDirty(true);
  };

  const onCanvasDrop = (clientX: number, clientY: number) => {
    if (!active || !dragId || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const fx = ((clientX - rect.left) / rect.width) * active.plotWidthFt;
    const fy = ((clientY - rect.top) / rect.height) * active.plotHeightFt;
    setElements((prev) =>
      prev.map((e) =>
        e.id === dragId
          ? {
              ...e,
              x: Math.max(0, Math.min(active.plotWidthFt, Math.round(fx * 10) / 10)),
              y: Math.max(0, Math.min(active.plotHeightFt, Math.round(fy * 10) / 10)),
            }
          : e,
      ),
    );
    setDirty(true);
    setDragId(null);
  };

  const saveElements = async () => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun<{ layout: Layout }>('landscaping', 'layout-save-elements', {
      layoutId: active.id,
      elements,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setElements(r.data.result.layout.elements);
      setDirty(false);
      await loadLayouts();
    } else setErr(r.data.error || 'save failed');
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Layout name</label>
          <input
            className={inputCls}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Front yard redesign"
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Width ft</label>
          <input
            type="number"
            className={inputCls}
            value={newW}
            onChange={(e) => setNewW(e.target.value)}
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Height ft</label>
          <input
            type="number"
            className={inputCls}
            value={newH}
            onChange={(e) => setNewH(e.target.value)}
          />
        </div>
        <button onClick={createLayout} disabled={!newName.trim() || busy} className={btnCls}>
          <Plus className="h-3.5 w-3.5" /> New Layout
        </button>
      </div>

      {layouts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {layouts.map((l) => (
            <div
              key={l.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                activeId === l.id
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-zinc-800 text-zinc-400'
              }`}
            >
              <button onClick={() => setActiveId(l.id)}>
                {l.name} <span className="text-zinc-600">({l.elementCount ?? 0})</span>
              </button>
              <button onClick={() => deleteLayout(l.id)} aria-label="Delete layout">
                <Trash2 className="h-3 w-3 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className={`${inputCls} w-auto`}
              value={palette}
              onChange={(e) => setPalette(e.target.value)}
            >
              {ELEMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button onClick={addElement} className={btnCls}>
              <Plus className="h-3.5 w-3.5" /> Add element
            </button>
            <button onClick={saveElements} disabled={busy || !dirty} className={btnCls}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {dirty ? 'Save layout' : 'Saved'}
            </button>
            <span className="text-[11px] text-zinc-400">
              {active.plotWidthFt} × {active.plotHeightFt} ft · drag elements to place
            </span>
          </div>

          <div
            ref={canvasRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onCanvasDrop(e.clientX, e.clientY);
            }}
            className="relative w-full overflow-hidden rounded-lg border border-emerald-500/20 bg-[repeating-linear-gradient(0deg,#0c1410,#0c1410_19px,#16241c_20px),repeating-linear-gradient(90deg,#0c1410,#0c1410_19px,#16241c_20px)]"
            style={{ aspectRatio: `${active.plotWidthFt} / ${active.plotHeightFt}` }}
          >
            {elements.map((el) => (
              <div
                key={el.id}
                draggable
                onDragStart={() => setDragId(el.id)}
                title={`${el.label} (${el.kind})`}
                className="absolute flex cursor-move items-center justify-center rounded text-[9px] font-medium text-white/90"
                style={{
                  left: `${(el.x / active.plotWidthFt) * 100}%`,
                  top: `${(el.y / active.plotHeightFt) * 100}%`,
                  width: `${(el.widthFt / active.plotWidthFt) * 100}%`,
                  height: `${(el.heightFt / active.plotHeightFt) * 100}%`,
                  background: `${el.color}cc`,
                  border: `1px solid ${el.color}`,
                  transform: 'translate(-50%, -50%)',
                  borderRadius: el.kind === 'tree' || el.kind === 'plant' || el.kind === 'shrub' ? '50%' : '3px',
                }}
              >
                {el.label}
              </div>
            ))}
            {elements.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-400">
                Add elements then drag them onto the plot
              </div>
            )}
          </div>

          {elements.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {elements.map((el) => (
                <div
                  key={el.id}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]"
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: el.color }}
                    />
                    <input
                      className="w-20 bg-transparent text-white outline-none"
                      value={el.label}
                      onChange={(e) => {
                        setElements((prev) =>
                          prev.map((x) => (x.id === el.id ? { ...x, label: e.target.value } : x)),
                        );
                        setDirty(true);
                      }}
                    />
                  </span>
                  <button onClick={() => removeElement(el.id)} aria-label="Remove element">
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Feature 2 — AR / photo-overlay preview ─────────────────────────
interface Placement {
  id: string;
  plant: string;
  imageUrl: string;
  xPct: number;
  yPct: number;
  scalePct: number;
}
interface Overlay {
  id: string;
  name: string;
  photoUrl?: string;
  placements: Placement[];
  placementCount?: number;
}

function PhotoOverlay() {
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const active = overlays.find((o) => o.id === activeId) || null;

  const load = useCallback(async () => {
    const r = await lensRun<{ overlays: Overlay[] }>('landscaping', 'overlay-list', {});
    if (r.data.ok && r.data.result) setOverlays(r.data.result.overlays);
    else setErr(r.data.error || 'failed to load overlays');
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (active) {
      setPlacements(active.placements.map((p) => ({ ...p })));
      setDirty(false);
    }
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      setBusy(true);
      setErr(null);
      const r = await lensRun<{ overlay: Overlay }>('landscaping', 'overlay-create', {
        name: name.trim() || file.name,
        photoUrl: reader.result as string,
      });
      setBusy(false);
      if (r.data.ok && r.data.result) {
        setName('');
        await load();
        setActiveId(r.data.result.overlay.id);
      } else setErr(r.data.error || 'upload failed');
    };
    reader.readAsDataURL(file);
  };

  const addPlacement = () => {
    setPlacements((prev) => [
      ...prev,
      {
        id: `pl_${Date.now().toString(36)}`,
        plant: 'New plant',
        imageUrl: '',
        xPct: 50,
        yPct: 60,
        scalePct: 100,
      },
    ]);
    setDirty(true);
  };

  const onStageClick = (e: React.MouseEvent, id: string) => {
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    setPlacements((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, xPct: Math.max(0, Math.min(100, xPct)), yPct: Math.max(0, Math.min(100, yPct)) }
          : p,
      ),
    );
    setDirty(true);
  };

  const savePlacements = async () => {
    if (!active) return;
    setBusy(true);
    const r = await lensRun<{ overlay: Overlay }>('landscaping', 'overlay-place', {
      overlayId: active.id,
      placements,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setDirty(false);
      await load();
    } else setErr(r.data.error || 'save failed');
  };

  const deleteOverlay = async (id: string) => {
    await lensRun('landscaping', 'overlay-delete', { id });
    if (activeId === id) setActiveId(null);
    await load();
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Preview name</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Backyard preview"
          />
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0])}
        />
        <button onClick={() => fileRef.current?.click()} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
          Upload yard photo
        </button>
      </div>

      {overlays.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {overlays.map((o) => (
            <div
              key={o.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                activeId === o.id
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                  : 'border-zinc-800 text-zinc-400'
              }`}
            >
              <button onClick={() => setActiveId(o.id)}>
                {o.name} <span className="text-zinc-600">({o.placementCount ?? 0})</span>
              </button>
              <button onClick={() => deleteOverlay(o.id)} aria-label="Delete overlay">
                <Trash2 className="h-3 w-3 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      )}

      {active && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={addPlacement} className={btnCls}>
              <Plus className="h-3.5 w-3.5" /> Add plant
            </button>
            <button onClick={savePlacements} disabled={busy || !dirty} className={btnCls}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {dirty ? 'Save preview' : 'Saved'}
            </button>
            <span className="text-[11px] text-zinc-400">
              Click the photo to position the selected plant
            </span>
          </div>

          <div
            ref={stageRef}
            className="relative w-full overflow-hidden rounded-lg border border-emerald-500/20 bg-zinc-900"
            style={{ aspectRatio: '16 / 10' }}
          >
            {active.photoUrl && (
              // photoUrl is a user-supplied data URL; next/image cannot optimise it
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={active.photoUrl} alt="Yard" className="h-full w-full object-cover" />
            )}
            {placements.map((p) => (
              <button
                key={p.id}
                onClick={(e) => onStageClick(e as unknown as React.MouseEvent, p.id)}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
              >
                {p.imageUrl ? (
                  // imageUrl comes from external plant DB; allowlist-free render
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={p.imageUrl}
                    alt={p.plant}
                    style={{ width: `${p.scalePct * 0.6}px` }}
                    className="rounded-full border-2 border-emerald-400/60 object-cover"
                  />
                ) : (
                  <span
                    className="flex items-center justify-center rounded-full border-2 border-emerald-400/60 bg-emerald-600/70 text-[9px] text-white"
                    style={{
                      width: `${p.scalePct * 0.5}px`,
                      height: `${p.scalePct * 0.5}px`,
                    }}
                  >
                    {p.plant.slice(0, 6)}
                  </span>
                )}
              </button>
            ))}
          </div>

          {placements.length > 0 && (
            <div className="space-y-1.5">
              {placements.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px]"
                >
                  <input
                    className="w-32 rounded bg-zinc-900 px-1.5 py-1 text-white outline-none"
                    value={p.plant}
                    onChange={(e) => {
                      setPlacements((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, plant: e.target.value } : x)),
                      );
                      setDirty(true);
                    }}
                  />
                  <input
                    className="flex-1 rounded bg-zinc-900 px-1.5 py-1 text-white outline-none"
                    placeholder="Plant image URL (optional)"
                    value={p.imageUrl}
                    onChange={(e) => {
                      setPlacements((prev) =>
                        prev.map((x) => (x.id === p.id ? { ...x, imageUrl: e.target.value } : x)),
                      );
                      setDirty(true);
                    }}
                  />
                  <label className="flex items-center gap-1 text-zinc-400">
                    size
                    <input
                      type="range"
                      min={20}
                      max={250}
                      value={p.scalePct}
                      onChange={(e) => {
                        setPlacements((prev) =>
                          prev.map((x) =>
                            x.id === p.id ? { ...x, scalePct: Number(e.target.value) } : x,
                          ),
                        );
                        setDirty(true);
                      }}
                    />
                  </label>
                  <button
                    onClick={() => {
                      setPlacements((prev) => prev.filter((x) => x.id !== p.id));
                      setDirty(true);
                    }}
                    aria-label="Remove placement"
                  >
                    <Trash2 className="h-3 w-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Feature 3 — Plant identification from photo ────────────────────
function PlantIdentify() {
  const [identification, setIdentification] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const identify = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setPreview(dataUrl);
      setBusy(true);
      setErr(null);
      setIdentification(null);
      const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
      const r = await lensRun<{ identification: string }>('landscaping', 'identify-plant', {
        imageB64: b64,
      });
      setBusy(false);
      if (r.data.ok && r.data.result) setIdentification(r.data.result.identification);
      else setErr(r.data.error || 'identification failed');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => identify(e.target.files?.[0])}
      />
      <button onClick={() => fileRef.current?.click()} disabled={busy} className={btnCls}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
        Identify plant from photo
      </button>
      <p className="text-[11px] text-zinc-400">
        Vision brain identifies species, plant type, and visible health issues.
      </p>
      {preview && (
        <div className="relative h-48 w-48 overflow-hidden rounded-lg border border-zinc-800">
          <Image src={preview} alt="Plant" fill className="object-cover" unoptimized />
        </div>
      )}
      {identification && (
        <div className={cardCls}>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400">Identification</p>
          <p className="whitespace-pre-wrap text-sm text-zinc-200">{identification}</p>
        </div>
      )}
    </div>
  );
}

// ─── Feature 4 — Plant-care reminders ───────────────────────────────
interface Reminder {
  bedId: string;
  bedName: string;
  kind: string;
  cadenceDays: number;
  lastDone: string;
  dueDate: string;
  daysUntil: number;
  overdue: boolean;
}

function CareReminders() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [overdue, setOverdue] = useState(0);
  const [horizon, setHorizon] = useState('14');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    const r = await lensRun<{ reminders: Reminder[]; overdueCount: number }>(
      'landscaping',
      'care-reminders',
      { horizonDays: Number(horizon) || 14 },
    );
    setBusy(false);
    setLoaded(true);
    if (r.data.ok && r.data.result) {
      setReminders(r.data.result.reminders);
      setOverdue(r.data.result.overdueCount);
    } else setErr(r.data.error || 'failed to load reminders');
  }, [horizon]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="w-32">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Horizon days</label>
          <input
            type="number"
            className={inputCls}
            value={horizon}
            onChange={(e) => setHorizon(e.target.value)}
          />
        </div>
        <button onClick={load} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
          Refresh
        </button>
        {loaded && (
          <span className="text-[11px] text-zinc-400">
            {reminders.length} due · {overdue} overdue
          </span>
        )}
      </div>
      {loaded && reminders.length === 0 && !err && (
        <p className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
          No care due in this horizon. Reminders derive from care-log cadence — log care events on
          your beds first.
        </p>
      )}
      <div className="space-y-1.5">
        {reminders.map((rm, i) => (
          <div
            key={`${rm.bedId}-${rm.kind}-${i}`}
            className={`flex items-center justify-between rounded border px-3 py-2 text-xs ${
              rm.overdue
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-zinc-800 bg-zinc-950'
            }`}
          >
            <div>
              <span className="font-medium text-white">{rm.bedName}</span>
              <span className="ml-2 text-emerald-300 capitalize">{rm.kind.replace('_', ' ')}</span>
              <span className="ml-2 text-zinc-400">every {rm.cadenceDays}d</span>
            </div>
            <div className="text-right">
              <div className={rm.overdue ? 'text-red-300' : 'text-zinc-300'}>
                {rm.overdue ? `${Math.abs(rm.daysUntil)}d overdue` : `due in ${rm.daysUntil}d`}
              </div>
              <div className="text-[10px] text-zinc-400">
                last {rm.lastDone} · due {rm.dueDate}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Feature 5 — Climate / hardiness-zone matching ──────────────────
interface ClimateResult {
  hardinessZone: number;
  coldestForecastC: number;
  hottestForecastC: number;
  avgMinC: number;
  recommendations: { name: string; type: string; zoneRange: string }[];
}

function ClimateMatch() {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [result, setResult] = useState<ClimateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setErr('geolocation unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(4));
        setLon(pos.coords.longitude.toFixed(4));
      },
      () => setErr('location permission denied'),
    );
  };

  const run = async () => {
    setBusy(true);
    setErr(null);
    setResult(null);
    const r = await lensRun<ClimateResult>('landscaping', 'climate-match', {
      lat: Number(lat),
      lon: Number(lon),
    });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data.error || 'climate lookup failed');
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-32">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Latitude</label>
          <input className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} />
        </div>
        <div className="w-32">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Longitude</label>
          <input className={inputCls} value={lon} onChange={(e) => setLon(e.target.value)} />
        </div>
        <button onClick={useMyLocation} className={btnCls}>
          <Globe2 className="h-3.5 w-3.5" /> Use my location
        </button>
        <button onClick={run} disabled={busy || !lat || !lon} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Match plants
        </button>
      </div>
      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Hardiness zone" value={`Zone ${result.hardinessZone}`} />
            <Stat label="Coldest" value={`${result.coldestForecastC}°C`} />
            <Stat label="Hottest" value={`${result.hottestForecastC}°C`} />
            <Stat label="Avg min" value={`${result.avgMinC}°C`} />
          </div>
          <div className={cardCls}>
            <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">
              Zone-suitable plants ({result.recommendations.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.recommendations.map((p) => (
                <span
                  key={p.name}
                  className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-200"
                >
                  {p.name}
                  <span className="ml-1 text-zinc-400">
                    {p.type} · z{p.zoneRange}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Feature 6 — Cost estimate -> proposal ──────────────────────────
interface LineItem {
  description: string;
  category: string;
  unit: string;
  quantity: string;
  unitCost: string;
}
interface ProposalResult {
  subtotal: number;
  overhead: number;
  margin: number;
  tax: number;
  total: number;
  proposalMarkdown: string;
}

function ProposalBuilder() {
  const [client, setClient] = useState('');
  const [project, setProject] = useState('');
  const [overheadPct, setOverheadPct] = useState('15');
  const [marginPct, setMarginPct] = useState('20');
  const [taxPct, setTaxPct] = useState('0');
  const [items, setItems] = useState<LineItem[]>([
    { description: '', category: 'labor', unit: 'hr', quantity: '1', unitCost: '' },
  ]);
  const [result, setResult] = useState<ProposalResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, patch: Partial<LineItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  const build = async () => {
    const valid = items.filter((it) => it.description.trim() && it.unitCost);
    if (!valid.length) {
      setErr('add at least one line item with a description and unit cost');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lensRun<ProposalResult>('landscaping', 'proposal-build', {
      client: client.trim(),
      project: project.trim(),
      overheadPct: Number(overheadPct) || 0,
      marginPct: Number(marginPct) || 0,
      taxPct: Number(taxPct) || 0,
      lineItems: valid.map((it) => ({
        description: it.description,
        category: it.category,
        unit: it.unit,
        quantity: Number(it.quantity) || 1,
        unitCost: Number(it.unitCost) || 0,
      })),
    });
    setBusy(false);
    if (r.data.ok && r.data.result) setResult(r.data.result);
    else setErr(r.data.error || 'proposal build failed');
  };

  const exportProposal = () => {
    if (!result) return;
    const blob = new Blob([result.proposalMarkdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proposal-${(client || 'client').replace(/\s+/g, '-').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <input
          className={inputCls}
          placeholder="Client name"
          value={client}
          onChange={(e) => setClient(e.target.value)}
        />
        <input
          className={inputCls}
          placeholder="Project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex flex-wrap items-center gap-1.5">
            <input
              className={`${inputCls} flex-1 min-w-[140px]`}
              placeholder="Description"
              value={it.description}
              onChange={(e) => setItem(i, { description: e.target.value })}
            />
            <select
              className={`${inputCls} w-24`}
              value={it.category}
              onChange={(e) => setItem(i, { category: e.target.value })}
            >
              {['labor', 'materials', 'equipment', 'subcontract', 'permit'].map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className={`${inputCls} w-16`}
              placeholder="Unit"
              value={it.unit}
              onChange={(e) => setItem(i, { unit: e.target.value })}
            />
            <input
              type="number"
              className={`${inputCls} w-20`}
              placeholder="Qty"
              value={it.quantity}
              onChange={(e) => setItem(i, { quantity: e.target.value })}
            />
            <input
              type="number"
              className={`${inputCls} w-24`}
              placeholder="Unit $"
              value={it.unitCost}
              onChange={(e) => setItem(i, { unitCost: e.target.value })}
            />
            <button
              onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== i))}
              aria-label="Remove line item"
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setItems((prev) => [
              ...prev,
              { description: '', category: 'labor', unit: 'hr', quantity: '1', unitCost: '' },
            ])
          }
          className={btnCls}
        >
          <Plus className="h-3.5 w-3.5" /> Add line item
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Overhead %</label>
          <input
            type="number"
            className={inputCls}
            value={overheadPct}
            onChange={(e) => setOverheadPct(e.target.value)}
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Margin %</label>
          <input
            type="number"
            className={inputCls}
            value={marginPct}
            onChange={(e) => setMarginPct(e.target.value)}
          />
        </div>
        <div className="w-24">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Tax %</label>
          <input
            type="number"
            className={inputCls}
            value={taxPct}
            onChange={(e) => setTaxPct(e.target.value)}
          />
        </div>
        <button onClick={build} disabled={busy} className={btnCls}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
          Build proposal
        </button>
      </div>
      {result && (
        <div className={cardCls}>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Stat label="Subtotal" value={`$${result.subtotal.toLocaleString()}`} />
            <Stat label="Overhead" value={`$${result.overhead.toLocaleString()}`} />
            <Stat label="Margin" value={`$${result.margin.toLocaleString()}`} />
            <Stat label="Tax" value={`$${result.tax.toLocaleString()}`} />
            <Stat label="Total" value={`$${result.total.toLocaleString()}`} accent />
          </div>
          <button onClick={exportProposal} className={btnCls}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> Export proposal (.md)
          </button>
          <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 text-[11px] text-zinc-300">
            {result.proposalMarkdown}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Feature 7 — Maintenance calendar ───────────────────────────────
interface CalMonth {
  monthIndex: number;
  month: string;
  tasks: string[];
}

function MaintenanceCalendar() {
  const [beds, setBeds] = useState<Bed[]>([]);
  const [bedId, setBedId] = useState('');
  const [months, setMonths] = useState<CalMonth[]>([]);
  const [title, setTitle] = useState('Whole-yard schedule');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBeds = useCallback(async () => {
    const r = await lensRun<{ beds: Bed[] }>('landscaping', 'bed-list', {});
    if (r.data.ok && r.data.result) setBeds(r.data.result.beds);
  }, []);

  const loadCalendar = useCallback(async (id: string) => {
    setBusy(true);
    setErr(null);
    const r = await lensRun<{
      months?: CalMonth[];
      generic?: CalMonth[];
      bedName?: string;
    }>('landscaping', 'maintenance-calendar', id ? { bedId: id } : {});
    setBusy(false);
    if (r.data.ok && r.data.result) {
      const res = r.data.result;
      setMonths(res.months || res.generic || []);
      setTitle(res.bedName ? `${res.bedName} schedule` : 'Whole-yard schedule');
    } else setErr(r.data.error || 'calendar load failed');
  }, []);

  useEffect(() => {
    loadBeds();
    loadCalendar('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="w-56">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Scope</label>
          <select
            className={inputCls}
            value={bedId}
            onChange={(e) => {
              setBedId(e.target.value);
              loadCalendar(e.target.value);
            }}
          >
            <option value="">Whole yard</option>
            {beds.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.sunExposure})
              </option>
            ))}
          </select>
        </div>
        {busy && <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />}
      </div>
      <p className="text-xs font-medium text-emerald-300">{title}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {months.map((m) => (
          <div key={m.monthIndex} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
            <p className="mb-1.5 text-xs font-semibold text-white">{m.month}</p>
            <ul className="space-y-0.5">
              {m.tasks.map((t, i) => (
                <li key={i} className="flex gap-1 text-[10px] text-zinc-400">
                  <span className="text-emerald-500">•</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Feature 8 — Plant health diary ─────────────────────────────────
interface DiaryEntry {
  id: string;
  plant: string;
  bedId: string;
  date: string;
  health: string;
  heightCm: number | null;
  notes: string;
  hasPhoto?: boolean;
}

const HEALTH_TONE: Record<string, TimelineEvent['tone']> = {
  thriving: 'good',
  healthy: 'good',
  stressed: 'warn',
  declining: 'bad',
  lost: 'bad',
};

function HealthDiary() {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [plants, setPlants] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [fPlant, setFPlant] = useState('');
  const [fDate, setFDate] = useState('');
  const [fHealth, setFHealth] = useState('healthy');
  const [fHeight, setFHeight] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fPhoto, setFPhoto] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (plant: string) => {
    setBusy(true);
    setErr(null);
    const r = await lensRun<{ entries: DiaryEntry[]; plants: string[] }>(
      'landscaping',
      'diary-timeline',
      plant ? { plant } : {},
    );
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setEntries(r.data.result.entries);
      setPlants(r.data.result.plants);
    } else setErr(r.data.error || 'diary load failed');
  }, []);

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFPhoto(reader.result as string);
    reader.readAsDataURL(file);
  };

  const addEntry = async () => {
    if (!fPlant.trim()) {
      setErr('plant name required');
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await lensRun('landscaping', 'diary-add', {
      plant: fPlant.trim(),
      date: fDate || undefined,
      health: fHealth,
      heightCm: fHeight ? Number(fHeight) : undefined,
      notes: fNotes,
      photoUrl: fPhoto || undefined,
    });
    setBusy(false);
    if (r.data.ok) {
      setFPlant('');
      setFDate('');
      setFHeight('');
      setFNotes('');
      setFPhoto('');
      await load(filter);
    } else setErr(r.data.error || 'add failed');
  };

  const removeEntry = async (id: string) => {
    await lensRun('landscaping', 'diary-delete', { id });
    await load(filter);
  };

  const timeline: TimelineEvent[] = entries.map((e) => ({
    id: e.id,
    label: `${e.plant} — ${e.health}`,
    time: e.date,
    tone: HEALTH_TONE[e.health] || 'default',
    detail: `${e.heightCm ? `${e.heightCm}cm · ` : ''}${e.notes || ''}`,
  }));

  return (
    <div className="space-y-3">
      {err && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}
      <div className={cardCls}>
        <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">Log diary entry</p>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputCls} w-40`}
            placeholder="Plant name"
            value={fPlant}
            onChange={(e) => setFPlant(e.target.value)}
          />
          <input
            type="date"
            className={`${inputCls} w-40`}
            value={fDate}
            onChange={(e) => setFDate(e.target.value)}
          />
          <select
            className={`${inputCls} w-32`}
            value={fHealth}
            onChange={(e) => setFHealth(e.target.value)}
          >
            {['thriving', 'healthy', 'stressed', 'declining', 'lost'].map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
          <input
            type="number"
            className={`${inputCls} w-28`}
            placeholder="Height cm"
            value={fHeight}
            onChange={(e) => setFHeight(e.target.value)}
          />
          <input
            className={`${inputCls} flex-1 min-w-[160px]`}
            placeholder="Notes"
            value={fNotes}
            onChange={(e) => setFNotes(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPhoto(e.target.files?.[0])}
          />
          <button onClick={() => fileRef.current?.click()} className={btnCls}>
            <ImageIcon className="h-3.5 w-3.5" /> {fPhoto ? 'Photo ✓' : 'Photo'}
          </button>
          <button onClick={addEntry} disabled={busy || !fPlant.trim()} className={btnCls}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add entry
          </button>
        </div>
      </div>

      {plants.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">Filter:</span>
          <button
            onClick={() => {
              setFilter('');
              load('');
            }}
            className={`rounded px-2 py-0.5 text-[11px] ${
              filter === '' ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400'
            }`}
          >
            all
          </button>
          {plants.map((p) => (
            <button
              key={p}
              onClick={() => {
                setFilter(p);
                load(p);
              }}
              className={`rounded px-2 py-0.5 text-[11px] ${
                filter === p ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {timeline.length > 0 && (
        <div className={cardCls}>
          <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">
            Health timeline
          </p>
          <TimelineView events={timeline} />
        </div>
      )}

      <div className="space-y-1.5">
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs"
          >
            <div>
              <span className="font-medium text-white">{e.plant}</span>
              <span className="ml-2 capitalize text-emerald-300">{e.health}</span>
              {e.heightCm ? <span className="ml-2 text-zinc-400">{e.heightCm}cm</span> : null}
              {e.hasPhoto ? <span className="ml-2 text-zinc-600">📷</span> : null}
              <span className="ml-2 text-zinc-600">{e.date}</span>
              {e.notes && <p className="mt-0.5 text-[11px] text-zinc-400">{e.notes}</p>}
            </div>
            <button onClick={() => removeEntry(e.id)} aria-label="Delete diary entry">
              <Trash2 className="h-3.5 w-3.5 text-red-400" />
            </button>
          </div>
        ))}
        {entries.length === 0 && !busy && (
          <p className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
            No diary entries yet. Log one above to start a photo timeline per planting.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── shared sub-component ───────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${accent ? 'text-emerald-300' : 'text-zinc-200'}`}>
        {value}
      </div>
    </div>
  );
}
