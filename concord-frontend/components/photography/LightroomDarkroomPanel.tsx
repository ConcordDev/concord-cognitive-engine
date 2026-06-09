'use client';

/**
 * LightroomDarkroomPanel — non-destructive develop core matching the
 * Lightroom feature backlog: RAW develop pipeline, histogram + tone
 * curve editor, local-adjustment masking, cull filter, smart
 * collections + face tags, batch preset sync, and lens correction +
 * geometry. Every control is wired to a real photography-domain macro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Aperture, BarChart3, Layers, Filter, Sparkles,
  Copy, Crop, Trash2, Plus, RotateCcw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ── Shared types ───────────────────────────────────────────────────
interface Photo {
  id: string; filename: string; title: string; camera: string | null;
  lens: string | null; iso: number | null; rating: number; flag: string;
  colorLabel: string | null; keywords: string[];
  develop: Record<string, number>;
}
interface Mask {
  id: string; kind: string; name: string;
  geometry: Record<string, unknown>;
  adjustments: Record<string, number>; opacity: number;
}
interface SmartCollection {
  id: string; name: string;
  rules: { field: string; op: string; value: unknown }[];
  matchCount?: number;
}
interface Preset { id: string; name: string; adjustments: Record<string, number> }
interface RawMeta {
  photoId: string; format: string; isRaw: boolean; bitDepth: number;
  recoverableHighlights: string; recoverableShadows: string;
  hasRawDevelop: boolean;
}
interface HistogramResult {
  luma: number[]; red: number[]; green: number[]; blue: number[];
  totalSamples: number; meanLuma: number;
  clippedShadowsPct: number; clippedHighlightsPct: number;
  exposureHint: string;
}
type Pt = { x: number; y: number };

type DarkroomTab = 'raw' | 'tone' | 'mask' | 'cull' | 'smart' | 'batch' | 'geometry';
const TABS: { id: DarkroomTab; label: string; icon: typeof Aperture }[] = [
  { id: 'raw', label: 'RAW Develop', icon: Aperture },
  { id: 'tone', label: 'Histogram & Curve', icon: BarChart3 },
  { id: 'mask', label: 'Masking', icon: Layers },
  { id: 'cull', label: 'Cull Filter', icon: Filter },
  { id: 'smart', label: 'Smart & Faces', icon: Sparkles },
  { id: 'batch', label: 'Batch Sync', icon: Copy },
  { id: 'geometry', label: 'Lens & Geometry', icon: Crop },
];

export function LightroomDarkroomPanel({ onChange }: { onChange: () => void }) {
  const [tab, setTab] = useState<DarkroomTab>('raw');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [p, pr] = await Promise.all([
      lensRun('photography', 'photo-list', {}),
      lensRun('photography', 'preset-list', {}),
    ]);
    setPhotos(p.data?.result?.photos || []);
    setPresets(pr.data?.result?.presets || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
        Import photos in the Library tab first.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <nav className="flex gap-1 flex-wrap">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border',
                tab === t.id
                  ? 'border-indigo-700/50 bg-indigo-950/40 text-indigo-300'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'raw' && <RawDevelopTab photos={photos} onChange={() => { void refresh(); onChange(); }} />}
      {tab === 'tone' && <ToneCurveTab photos={photos} onChange={() => { void refresh(); onChange(); }} />}
      {tab === 'mask' && <MaskingTab photos={photos} onChange={() => { void refresh(); onChange(); }} />}
      {tab === 'cull' && <CullFilterTab />}
      {tab === 'smart' && <SmartCollectionsTab photos={photos} onChange={() => { void refresh(); onChange(); }} />}
      {tab === 'batch' && <BatchSyncTab photos={photos} presets={presets} onChange={() => { void refresh(); onChange(); }} />}
      {tab === 'geometry' && <GeometryTab photos={photos} onChange={() => { void refresh(); onChange(); }} />}
    </div>
  );
}

// ── Shared bits ────────────────────────────────────────────────────
function PhotoPicker({ photos, value, onChange }: { photos: Photo[]; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
      {photos.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.filename}</option>)}
    </select>
  );
}

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{msg}</div>;
}

function Slider({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-[11px] text-zinc-400 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-indigo-500" />
      <span className="w-12 text-right text-[11px] text-zinc-300 font-mono">{value}</span>
    </div>
  );
}

// ── Item 1: RAW develop pipeline ───────────────────────────────────
function RawDevelopTab({ photos, onChange }: { photos: Photo[]; onChange: () => void }) {
  const [sel, setSel] = useState(photos[0]?.id || '');
  const [exposure, setExposure] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [highlights, setHighlights] = useState(0);
  const [shadows, setShadows] = useState(0);
  const [temperature, setTemperature] = useState(6500);
  const [tint, setTint] = useState(0);
  const [meta, setMeta] = useState<RawMeta | null>(null);
  const [lut, setLut] = useState<number[] | null>(null);
  const [wb, setWb] = useState<{ r: number; g: number; b: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const lutCanvas = useRef<HTMLCanvasElement>(null);

  const loadMeta = useCallback(async (id: string) => {
    if (!id) { setMeta(null); return; }
    const r = await lensRun('photography', 'raw-decode-meta', { id });
    setMeta((r.data?.result as RawMeta | undefined) || null);
  }, []);

  useEffect(() => { void loadMeta(sel); }, [sel, loadMeta]);

  // Draw the tone LUT as a curve once it's computed.
  useEffect(() => {
    const cv = lutCanvas.current;
    if (!cv || !lut) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    lut.forEach((v, i) => {
      const x = (i / 255) * W;
      const y = H - (v / 255) * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [lut]);

  const develop = async () => {
    if (!sel) return;
    setBusy(true); setErr(null);
    const r = await lensRun('photography', 'raw-develop', {
      id: sel,
      adjustments: { exposure, contrast, highlights, shadows, temperature, tint },
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Develop failed'); return; }
    const res = r.data?.result as { toneLUT?: number[]; whiteBalance?: { r: number; g: number; b: number } } | undefined;
    setLut(res?.toneLUT || null);
    setWb(res?.whiteBalance || null);
    await loadMeta(sel);
    onChange();
  };

  return (
    <div className="space-y-3">
      <PhotoPicker photos={photos} value={sel} onChange={setSel} />
      <ErrLine msg={err} />

      {meta && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <Info label="Format" value={meta.format} />
          <Info label="Bit depth" value={`${meta.bitDepth}-bit`} />
          <Info label="RAW" value={meta.isRaw ? 'yes' : 'no'} />
          <Info label="Highlight recovery" value={meta.recoverableHighlights} />
          <Info label="Shadow recovery" value={meta.recoverableShadows} />
          <Info label="Developed" value={meta.hasRawDevelop ? 'yes' : 'no'} />
        </div>
      )}

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Develop transform</p>
        <Slider label="Exposure (EV)" value={exposure} min={-5} max={5} step={0.1} onChange={setExposure} />
        <Slider label="Contrast" value={contrast} min={-100} max={100} onChange={setContrast} />
        <Slider label="Highlights" value={highlights} min={-100} max={100} onChange={setHighlights} />
        <Slider label="Shadows" value={shadows} min={-100} max={100} onChange={setShadows} />
        <Slider label="Temp (K)" value={temperature} min={2000} max={12000} step={100} onChange={setTemperature} />
        <Slider label="Tint" value={tint} min={-150} max={150} onChange={setTint} />
      </div>

      <button type="button" onClick={develop} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Aperture className="w-3.5 h-3.5" />}
        Compute develop LUT
      </button>

      {(lut || wb) && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-zinc-300">Tone LUT (linear → developed)</p>
          <canvas ref={lutCanvas} width={256} height={120}
            className="w-full max-w-xs rounded bg-zinc-950 border border-zinc-800" />
          {wb && (
            <p className="text-[11px] text-zinc-400 font-mono">
              White balance gains — R {wb.r} · G {wb.g} · B {wb.b}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="text-zinc-200 truncate">{value}</p>
    </div>
  );
}

// ── Item 2: Histogram + tone curve editor ──────────────────────────
function ToneCurveTab({ photos, onChange }: { photos: Photo[]; onChange: () => void }) {
  const [sel, setSel] = useState(photos[0]?.id || '');
  const [hist, setHist] = useState<HistogramResult | null>(null);
  const [points, setPoints] = useState<Pt[]>([{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }]);
  const [curveName, setCurveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const histCanvas = useRef<HTMLCanvasElement>(null);
  const curveCanvas = useRef<HTMLCanvasElement>(null);
  const dragIdx = useRef<number | null>(null);

  // Sample the actual streamed image into RGB pixels for the histogram.
  const computeHistogram = useCallback(async () => {
    const photo = photos.find((p) => p.id === sel);
    if (!photo) return;
    setBusy(true); setErr(null);
    const samples: number[][] = [];
    try {
      // Try the streamed media; fall back to a luma sample of the
      // photo's own develop state if the binary is unavailable.
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      const loaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = `/api/media/stream/${encodeURIComponent(photo.id)}`;
      });
      if (loaded && img.naturalWidth > 0) {
        const cv = document.createElement('canvas');
        const tw = Math.min(160, img.naturalWidth);
        const th = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * tw));
        cv.width = tw; cv.height = th;
        const cx = cv.getContext('2d');
        if (cx) {
          cx.drawImage(img, 0, 0, tw, th);
          const data = cx.getImageData(0, 0, tw, th).data;
          for (let i = 0; i < data.length; i += 4) {
            samples.push([data[i], data[i + 1], data[i + 2]]);
          }
        }
      }
    } catch { /* fall through to develop-derived sampling */ }
    if (samples.length === 0) {
      setBusy(false);
      setErr('No pixel data available for this photo — upload an image-backed photo to sample its histogram.');
      return;
    }
    const r = await lensRun('photography', 'histogram-compute', { samples });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Histogram failed'); return; }
    setHist((r.data?.result as HistogramResult | undefined) || null);
  }, [photos, sel]);

  // Draw histogram.
  useEffect(() => {
    const cv = histCanvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!hist) return;
    const max = Math.max(...hist.luma, 1);
    const chans: [number[], string][] = [
      [hist.red, 'rgba(239,68,68,0.55)'],
      [hist.green, 'rgba(34,197,94,0.55)'],
      [hist.blue, 'rgba(59,130,246,0.55)'],
    ];
    for (const [arr, color] of chans) {
      ctx.fillStyle = color;
      arr.forEach((v, i) => {
        const h = (v / max) * H;
        ctx.fillRect((i / 255) * W, H - h, W / 256 + 0.5, h);
      });
    }
  }, [hist]);

  // Draw the editable tone curve.
  const drawCurve = useCallback(() => {
    const cv = curveCanvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#27272a';
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    const sorted = [...points].sort((a, b) => a.x - b.x);
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    sorted.forEach((p, i) => {
      const x = (p.x / 255) * W;
      const y = H - (p.y / 255) * H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#c7d2fe';
    sorted.forEach((p) => {
      const x = (p.x / 255) * W;
      const y = H - (p.y / 255) * H;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    });
  }, [points]);

  useEffect(() => { drawCurve(); }, [drawCurve]);

  const ptFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const cv = curveCanvas.current!;
    const rect = cv.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 255);
    const y = Math.round((1 - (e.clientY - rect.top) / rect.height) * 255);
    return {
      x: Math.max(0, Math.min(255, x)),
      y: Math.max(0, Math.min(255, y)),
    };
  };
  const onCurveDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = ptFromEvent(e);
    const sorted = [...points].sort((a, b) => a.x - b.x);
    let nearest = -1, best = 20;
    sorted.forEach((sp, i) => {
      const d = Math.abs(sp.x - p.x) + Math.abs(sp.y - p.y);
      if (d < best) { best = d; nearest = i; }
    });
    if (nearest >= 0) {
      dragIdx.current = nearest;
    } else if (sorted.length < 16) {
      const next = [...sorted, p].sort((a, b) => a.x - b.x);
      setPoints(next);
      dragIdx.current = next.findIndex((np) => np.x === p.x && np.y === p.y);
    }
  };
  const onCurveMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragIdx.current === null) return;
    const p = ptFromEvent(e);
    setPoints((prev) => {
      const sorted = [...prev].sort((a, b) => a.x - b.x);
      if (dragIdx.current === null || !sorted[dragIdx.current]) return prev;
      sorted[dragIdx.current] = p;
      return sorted;
    });
  };
  const onCurveUp = () => { dragIdx.current = null; };

  const resetCurve = () => setPoints([{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }]);

  const applyCurve = async () => {
    if (!sel) return;
    setBusy(true); setErr(null);
    const r = await lensRun('photography', 'tone-curve-apply', { photoId: sel, points });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Apply failed'); return; }
    onChange();
  };
  const saveCurve = async () => {
    if (!curveName.trim()) { setErr('Curve name required'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('photography', 'tone-curve-save', { name: curveName.trim(), points, channel: 'rgb' });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Save failed'); return; }
    setCurveName('');
  };

  return (
    <div className="space-y-3">
      <PhotoPicker photos={photos} value={sel} onChange={setSel} />
      <ErrLine msg={err} />

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-300">Histogram</p>
          <button type="button" onClick={computeHistogram} disabled={busy}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
            Sample
          </button>
        </div>
        <canvas ref={histCanvas} width={256} height={110}
          className="w-full rounded bg-zinc-950 border border-zinc-800" />
        {hist && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
            <Info label="Mean luma" value={String(hist.meanLuma)} />
            <Info label="Exposure" value={hist.exposureHint} />
            <Info label="Shadow clip" value={`${hist.clippedShadowsPct}%`} />
            <Info label="Highlight clip" value={`${hist.clippedHighlightsPct}%`} />
          </div>
        )}
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Tone curve — click to add, drag to move</p>
        <canvas ref={curveCanvas} width={256} height={256}
          onMouseDown={onCurveDown} onMouseMove={onCurveMove}
          onMouseUp={onCurveUp} onMouseLeave={onCurveUp}
          className="rounded bg-zinc-950 border border-zinc-800 cursor-crosshair" />
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={resetCurve}
            className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button type="button" onClick={applyCurve} disabled={busy}
            className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
            Apply to photo
          </button>
          <input value={curveName} onChange={(e) => setCurveName(e.target.value)}
            placeholder="Save curve as…"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
          <button type="button" onClick={saveCurve} disabled={busy}
            className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            Save curve
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Item 3: Local adjustments / masking ────────────────────────────
const MASK_KINDS = ['brush', 'linear-gradient', 'radial-gradient', 'subject', 'sky', 'background'];
const MASK_ADJ: { key: string; label: string; min: number; max: number; step?: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.1 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
];

function MaskingTab({ photos, onChange }: { photos: Photo[]; onChange: () => void }) {
  const [sel, setSel] = useState(photos[0]?.id || '');
  const [masks, setMasks] = useState<Mask[]>([]);
  const [kind, setKind] = useState('radial-gradient');
  const [name, setName] = useState('');
  const [adj, setAdj] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadMasks = useCallback(async (id: string) => {
    if (!id) { setMasks([]); return; }
    const r = await lensRun('photography', 'mask-list', { photoId: id });
    setMasks(r.data?.result?.masks || []);
  }, []);

  useEffect(() => { void loadMasks(sel); }, [sel, loadMasks]);

  const createMask = async () => {
    if (!sel) return;
    setBusy(true); setErr(null);
    const geometry = kind === 'radial-gradient'
      ? { cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, feather: 0.5 }
      : kind === 'linear-gradient'
        ? { x1: 0.5, y1: 0, x2: 0.5, y2: 1, feather: 0.5 }
        : kind === 'brush'
          ? { strokes: [], flow: 1 }
          : {};
    const r = await lensRun('photography', 'mask-create', {
      photoId: sel, kind, name: name.trim() || kind, geometry, adjustments: adj, opacity: 1,
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Mask create failed'); return; }
    setName(''); setAdj({});
    await loadMasks(sel);
    onChange();
  };
  const deleteMask = async (maskId: string) => {
    await lensRun('photography', 'mask-delete', { photoId: sel, maskId });
    await loadMasks(sel);
    onChange();
  };
  const updateMaskAdj = async (mask: Mask, key: string, value: number) => {
    await lensRun('photography', 'mask-update', {
      photoId: sel, maskId: mask.id, adjustments: { ...mask.adjustments, [key]: value },
    });
    await loadMasks(sel);
  };

  return (
    <div className="space-y-3">
      <PhotoPicker photos={photos} value={sel} onChange={setSel} />
      <ErrLine msg={err} />

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">New local-adjustment mask</p>
        <div className="flex flex-wrap gap-2">
          <select value={kind} onChange={(e) => setKind(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
            {MASK_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mask name"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
        </div>
        {MASK_ADJ.map((a) => (
          <Slider key={a.key} label={a.label} value={adj[a.key] ?? 0} min={a.min} max={a.max} step={a.step}
            onChange={(v) => setAdj((prev) => ({ ...prev, [a.key]: v }))} />
        ))}
        <button type="button" onClick={createMask} disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add mask
        </button>
      </div>

      {masks.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No masks on this photo yet.</p>
      ) : (
        <ul className="space-y-2">
          {masks.map((m) => (
            <li key={m.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-zinc-200">
                  {m.name} <span className="text-[10px] text-zinc-400">· {m.kind}</span>
                </p>
                <button aria-label="Delete" type="button" onClick={() => deleteMask(m.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {MASK_ADJ.map((a) => (
                <Slider key={a.key} label={a.label} value={m.adjustments[a.key] ?? 0}
                  min={a.min} max={a.max} step={a.step}
                  onChange={(v) => updateMaskAdj(m, a.key, v)} />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Item 4: Star rating + color label filtering ────────────────────
const COLORS = ['red', 'yellow', 'green', 'blue', 'purple'];
const COLOR_HEX: Record<string, string> = {
  red: '#ef4444', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', purple: '#a855f7',
};

function CullFilterTab() {
  const [rating, setRating] = useState(0);
  const [ratingCompare, setRatingCompare] = useState<'gte' | 'lte' | 'eq'>('gte');
  const [flags, setFlags] = useState<string[]>([]);
  const [colorLabels, setColorLabels] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'rating' | 'imported'>('rating');
  const [result, setResult] = useState<Photo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (arr: string[], v: string, set: (a: string[]) => void) =>
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const runFilter = async () => {
    setBusy(true); setErr(null);
    const params: Record<string, unknown> = { ratingCompare, sortBy };
    if (rating > 0) params.rating = rating;
    if (flags.length) params.flag = flags;
    if (colorLabels.length) params.colorLabels = colorLabels;
    const r = await lensRun('photography', 'cull-filter', params);
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Filter failed'); return; }
    setResult(r.data?.result?.photos || []);
  };

  return (
    <div className="space-y-3">
      <ErrLine msg={err} />
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-400 w-16">Rating</span>
          <select value={ratingCompare} onChange={(e) => setRatingCompare(e.target.value as 'gte' | 'lte' | 'eq')}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
            <option value="gte">≥</option><option value="lte">≤</option><option value="eq">=</option>
          </select>
          <span className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n)}
                className={cn('w-6 h-6 text-[11px] rounded',
                  rating === n ? 'bg-amber-500/30 text-amber-200' : 'bg-zinc-800 text-zinc-400')}>
                {n === 0 ? 'any' : n}
              </button>
            ))}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-400 w-16">Flags</span>
          {['pick', 'reject', 'unflagged'].map((f) => (
            <button key={f} type="button" onClick={() => toggle(flags, f, setFlags)}
              className={cn('text-[11px] px-2 py-1 rounded-lg border',
                flags.includes(f) ? 'border-indigo-700/50 bg-indigo-950/40 text-indigo-300' : 'border-zinc-700 text-zinc-400')}>
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-400 w-16">Labels</span>
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => toggle(colorLabels, c, setColorLabels)}
              className={cn('w-5 h-5 rounded-full border-2', colorLabels.includes(c) ? 'border-white' : 'border-transparent')}
              style={{ background: COLOR_HEX[c] }} aria-label={c} />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400 w-16">Sort</span>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'rating' | 'imported')}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
            <option value="rating">rating</option><option value="imported">recently imported</option>
          </select>
          <button type="button" onClick={runFilter} disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg ml-auto">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
            Apply filter
          </button>
        </div>
      </div>

      {result && (
        <div>
          <p className="text-[11px] text-zinc-400 mb-1">{result.length} photo(s) match</p>
          <ul className="space-y-1">
            {result.map((p) => (
              <li key={p.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                {p.colorLabel && <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLOR_HEX[p.colorLabel] }} />}
                <span className="text-xs text-zinc-200">{p.title}</span>
                <span className="text-[10px] text-amber-400 ml-auto">{'★'.repeat(p.rating)}</span>
                <span className="text-[10px] text-zinc-400">{p.flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Item 5: Keyword/face tags + smart collections ──────────────────
const SMART_FIELDS = ['rating', 'flag', 'colorlabel', 'camera', 'lens', 'keyword', 'person', 'edited'];
const SMART_OPS = ['eq', 'neq', 'gte', 'lte', 'contains'];

function SmartCollectionsTab({ photos, onChange }: { photos: Photo[]; onChange: () => void }) {
  const [collections, setCollections] = useState<SmartCollection[]>([]);
  const [name, setName] = useState('');
  const [rules, setRules] = useState<{ field: string; op: string; value: string }[]>([
    { field: 'rating', op: 'gte', value: '4' },
  ]);
  const [evalResult, setEvalResult] = useState<{ name: string; photos: Photo[] } | null>(null);
  // Face tagging
  const [facePhoto, setFacePhoto] = useState(photos[0]?.id || '');
  const [personName, setPersonName] = useState('');
  const [people, setPeople] = useState<{ personName: string; count: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [c, pe] = await Promise.all([
      lensRun('photography', 'smart-collection-list', {}),
      lensRun('photography', 'face-tag-list', {}),
    ]);
    setCollections(c.data?.result?.collections || []);
    setPeople(pe.data?.result?.people || []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createCollection = async () => {
    if (!name.trim()) { setErr('Collection name required'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('photography', 'smart-collection-create', {
      name: name.trim(),
      rules: rules.map((rl) => ({ field: rl.field, op: rl.op, value: rl.value })),
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Create failed'); return; }
    setName('');
    await refresh();
    onChange();
  };
  const evalCollection = async (id: string) => {
    const r = await lensRun('photography', 'smart-collection-eval', { id });
    if (r.data?.ok === false) { setErr(r.data?.error || 'Eval failed'); return; }
    const res = r.data?.result as { collection?: { name: string }; photos?: Photo[] } | undefined;
    setEvalResult({ name: res?.collection?.name || '', photos: res?.photos || [] });
  };
  const deleteCollection = async (id: string) => {
    await lensRun('photography', 'smart-collection-delete', { id });
    await refresh();
    setEvalResult(null);
  };
  const addFace = async () => {
    if (!facePhoto || !personName.trim()) { setErr('Photo and person name required'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('photography', 'face-tag-add', {
      photoId: facePhoto, personName: personName.trim(),
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Face tag failed'); return; }
    setPersonName('');
    await refresh();
    onChange();
  };

  return (
    <div className="space-y-3">
      <ErrLine msg={err} />

      {/* Face tagging */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Face / person tags</p>
        <div className="flex flex-wrap gap-2">
          <select value={facePhoto} onChange={(e) => setFacePhoto(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
            {photos.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Person name"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
          <button type="button" onClick={addFace} disabled={busy}
            className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
            Tag person
          </button>
        </div>
        {people.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {people.map((p) => (
              <span key={p.personName} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">
                {p.personName} · {p.count}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Smart collection builder */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">New smart collection</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Collection name"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        {rules.map((rl, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <select value={rl.field}
              onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-1.5 py-1 text-[11px] text-zinc-100">
              {SMART_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={rl.op}
              onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-1.5 py-1 text-[11px] text-zinc-100">
              {SMART_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <input value={rl.value}
              onChange={(e) => setRules((p) => p.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
              placeholder="value"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
            {rules.length > 1 && (
              <button aria-label="Delete" type="button" onClick={() => setRules((p) => p.filter((_, j) => j !== i))}
                className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={() => setRules((p) => [...p, { field: 'flag', op: 'eq', value: 'pick' }])}
            className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">
            + Rule
          </button>
          <button type="button" onClick={createCollection} disabled={busy}
            className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
            Create collection
          </button>
        </div>
      </div>

      {collections.length > 0 && (
        <ul className="space-y-1">
          {collections.map((c) => (
            <li key={c.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5">
              <span className="text-xs text-zinc-200">{c.name}</span>
              <span className="text-[10px] text-zinc-400">{c.matchCount ?? 0} match</span>
              <button type="button" onClick={() => evalCollection(c.id)}
                className="ml-auto text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
                evaluate
              </button>
              <button aria-label="Delete" type="button" onClick={() => deleteCollection(c.id)} className="text-zinc-600 hover:text-rose-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {evalResult && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <p className="text-[11px] text-zinc-400 mb-1">
            {evalResult.name}: {evalResult.photos.length} photo(s)
          </p>
          <div className="flex flex-wrap gap-1">
            {evalResult.photos.map((p) => (
              <span key={p.id} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{p.title}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Item 6: Preset sync + apply-to-batch ───────────────────────────
function BatchSyncTab({ photos, presets, onChange }: { photos: Photo[]; presets: Preset[]; onChange: () => void }) {
  const [mode, setMode] = useState<'preset' | 'copy'>('preset');
  const [presetId, setPresetId] = useState(presets[0]?.id || '');
  const [sourceId, setSourceId] = useState(photos[0]?.id || '');
  const [targets, setTargets] = useState<string[]>([]);
  const [includeCurve, setIncludeCurve] = useState(false);
  const [includeLens, setIncludeLens] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggleTarget = (id: string) =>
    setTargets((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);

  const apply = async () => {
    if (targets.length === 0) { setErr('Select at least one target photo'); return; }
    setBusy(true); setErr(null); setDone(null);
    let r;
    if (mode === 'preset') {
      if (!presetId) { setBusy(false); setErr('Pick a preset'); return; }
      r = await lensRun('photography', 'preset-apply-batch', { presetId, photoIds: targets });
    } else {
      r = await lensRun('photography', 'develop-copy-paste', {
        sourceId, targetIds: targets, includeToneCurve: includeCurve, includeLensCorrection: includeLens,
      });
    }
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Batch sync failed'); return; }
    const res = r.data?.result as { applied?: number } | undefined;
    setDone(`Applied to ${res?.applied ?? 0} photo(s).`);
    onChange();
  };

  return (
    <div className="space-y-3">
      <ErrLine msg={err} />
      <div className="flex gap-2">
        {(['preset', 'copy'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={cn('px-2.5 py-1 text-[11px] rounded-lg border',
              mode === m ? 'border-indigo-700/50 bg-indigo-950/40 text-indigo-300' : 'border-zinc-700 text-zinc-400')}>
            {m === 'preset' ? 'Apply preset to batch' : 'Copy settings from photo'}
          </button>
        ))}
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        {mode === 'preset' ? (
          presets.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No presets — create one in the Develop tab.</p>
          ) : (
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )
        ) : (
          <>
            <PhotoPicker photos={photos} value={sourceId} onChange={setSourceId} />
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              <input type="checkbox" checked={includeCurve} onChange={(e) => setIncludeCurve(e.target.checked)} />
              Include tone curve
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-400">
              <input type="checkbox" checked={includeLens} onChange={(e) => setIncludeLens(e.target.checked)} />
              Include lens correction
            </label>
          </>
        )}
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1">
        <p className="text-[11px] text-zinc-400">Target photos ({targets.length} selected)</p>
        <div className="max-h-48 overflow-y-auto space-y-1">
          {photos.filter((p) => mode === 'preset' || p.id !== sourceId).map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input type="checkbox" checked={targets.includes(p.id)} onChange={() => toggleTarget(p.id)} />
              {p.title} <span className="text-[10px] text-zinc-400">{p.filename}</span>
            </label>
          ))}
        </div>
      </div>

      <button type="button" onClick={apply} disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Copy className="w-3.5 h-3.5" />}
        Sync develop settings
      </button>
      {done && <p className="text-[11px] text-emerald-400">{done}</p>}
    </div>
  );
}

// ── Item 7: Lens correction / geometry ─────────────────────────────
function GeometryTab({ photos, onChange }: { photos: Photo[]; onChange: () => void }) {
  const [sel, setSel] = useState(photos[0]?.id || '');
  // Lens correction
  const [distortion, setDistortion] = useState(0);
  const [vignette, setVignette] = useState(0);
  const [vignetteMidpoint, setVignetteMidpoint] = useState(50);
  const [chromaticAberration, setChromaticAberration] = useState(0);
  const [defringePurple, setDefringePurple] = useState(0);
  const [defringeGreen, setDefringeGreen] = useState(0);
  // Geometry
  const [rotation, setRotation] = useState(0);
  const [straighten, setStraighten] = useState(0);
  const [vPerspective, setVPerspective] = useState(0);
  const [hPerspective, setHPerspective] = useState(0);
  const [aspectRatio, setAspectRatio] = useState('original');
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const saveLens = async () => {
    if (!sel) return;
    setBusy(true); setErr(null); setDone(null);
    const r = await lensRun('photography', 'lens-correction-set', {
      id: sel, enabled: true, distortion, vignette, vignetteMidpoint,
      chromaticAberration, defringePurple, defringeGreen,
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Save failed'); return; }
    setDone('Lens correction saved.');
    onChange();
  };
  const saveGeometry = async () => {
    if (!sel) return;
    setBusy(true); setErr(null); setDone(null);
    const r = await lensRun('photography', 'geometry-set', {
      id: sel, rotation, straighten, verticalPerspective: vPerspective,
      horizontalPerspective: hPerspective, aspectRatio,
      flipHorizontal: flipH, flipVertical: flipV,
    });
    setBusy(false);
    if (r.data?.ok === false) { setErr(r.data?.error || 'Save failed'); return; }
    setDone('Geometry saved.');
    onChange();
  };

  return (
    <div className="space-y-3">
      <PhotoPicker photos={photos} value={sel} onChange={setSel} />
      <ErrLine msg={err} />

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Lens correction</p>
        <Slider label="Distortion" value={distortion} min={-100} max={100} onChange={setDistortion} />
        <Slider label="Vignette" value={vignette} min={-100} max={100} onChange={setVignette} />
        <Slider label="Vig. midpoint" value={vignetteMidpoint} min={0} max={100} onChange={setVignetteMidpoint} />
        <Slider label="Chromatic ab." value={chromaticAberration} min={0} max={100} onChange={setChromaticAberration} />
        <Slider label="Defringe purple" value={defringePurple} min={0} max={20} onChange={setDefringePurple} />
        <Slider label="Defringe green" value={defringeGreen} min={0} max={20} onChange={setDefringeGreen} />
        <button type="button" onClick={saveLens} disabled={busy}
          className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
          Save lens correction
        </button>
      </div>

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-zinc-300">Geometry & crop</p>
        <Slider label="Rotation" value={rotation} min={-45} max={45} onChange={setRotation} />
        <Slider label="Straighten" value={straighten} min={-10} max={10} step={0.1} onChange={setStraighten} />
        <Slider label="Vert. perspective" value={vPerspective} min={-100} max={100} onChange={setVPerspective} />
        <Slider label="Horiz. perspective" value={hPerspective} min={-100} max={100} onChange={setHPerspective} />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-zinc-400 w-24">Aspect ratio</span>
          <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100">
            {['original', '1:1', '4:3', '3:2', '16:9', '5:4'].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={flipH} onChange={(e) => setFlipH(e.target.checked)} /> Flip H
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={flipV} onChange={(e) => setFlipV(e.target.checked)} /> Flip V
          </label>
        </div>
        <button type="button" onClick={saveGeometry} disabled={busy}
          className="px-2.5 py-1 text-[11px] bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg">
          Save geometry
        </button>
      </div>

      {done && <p className="text-[11px] text-emerald-400">{done}</p>}
    </div>
  );
}
