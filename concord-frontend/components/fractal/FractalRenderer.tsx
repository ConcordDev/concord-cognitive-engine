'use client';

/**
 * FractalRenderer — a real interactive escape-time fractal renderer.
 *
 * Renders Mandelbrot / Julia / Burning-Ship / Tricorn / Multibrot sets onto a
 * <canvas> with client-side escape-time computation (chunked, non-blocking).
 * Zoom / pan / iteration / palette controls. Save / load / import / export
 * presets, high-resolution image export, deep-zoom path animation, an orbit
 * inspector and a 3D Mandelbulb viewer — every backend macro is wired here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Play, Save, Download, Upload, Trash2, Crosshair, Box,
  RotateCcw, Loader2, Film, Palette, Image as ImageIcon,
} from 'lucide-react';

type FractalType = 'mandelbrot' | 'julia' | 'burning-ship' | 'tricorn' | 'multibrot';

const FRACTAL_TYPES: { id: FractalType; label: string }[] = [
  { id: 'mandelbrot', label: 'Mandelbrot' },
  { id: 'julia', label: 'Julia' },
  { id: 'burning-ship', label: 'Burning Ship' },
  { id: 'tricorn', label: 'Tricorn' },
  { id: 'multibrot', label: 'Multibrot' },
];

const PALETTE_KEYS = ['spectral', 'fire', 'ice', 'grayscale', 'psychedelic', 'forest'] as const;
type PaletteKey = (typeof PALETTE_KEYS)[number];

interface ViewState {
  type: FractalType;
  centerX: number;
  centerY: number;
  scale: number;        // world units per pixel
  maxIter: number;
  palette: PaletteKey;
  juliaRe: number;
  juliaIm: number;
  power: number;
}

interface Preset {
  id: string;
  name: string;
  config: Partial<ViewState>;
  imported?: boolean;
  createdAt?: string;
}

interface RenderRecord {
  id: string;
  type: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
  createdAt: string;
}

const DEFAULT_VIEW: ViewState = {
  type: 'mandelbrot',
  centerX: -0.5,
  centerY: 0,
  scale: 3 / 600,
  maxIter: 200,
  palette: 'spectral',
  juliaRe: -0.7,
  juliaIm: 0.27015,
  power: 2,
};

// --- escape-time iteration (shared by canvas + export) -----------------------

function escapeIter(
  type: FractalType,
  wx: number,
  wy: number,
  maxIter: number,
  power: number,
  jRe: number,
  jIm: number,
): number {
  let x: number, y: number, cRe: number, cIm: number;
  if (type === 'julia') { x = wx; y = wy; cRe = jRe; cIm = jIm; }
  else { x = 0; y = 0; cRe = wx; cIm = wy; }
  let iter = 0;
  while (x * x + y * y <= 4 && iter < maxIter) {
    let nx: number, ny: number;
    if (type === 'tricorn') { nx = x * x - y * y + cRe; ny = -2 * x * y + cIm; }
    else if (type === 'burning-ship') {
      const ax = Math.abs(x), ay = Math.abs(y);
      nx = ax * ax - ay * ay + cRe; ny = 2 * ax * ay + cIm;
    } else if (type === 'multibrot') {
      let rx = x, ry = y;
      for (let k = 1; k < power; k++) {
        const tx = rx * x - ry * y;
        ry = rx * y + ry * x;
        rx = tx;
      }
      nx = rx + cRe; ny = ry + cIm;
    } else { nx = x * x - y * y + cRe; ny = 2 * x * y + cIm; }
    x = nx; y = ny; iter++;
  }
  return iter;
}

// Map an iteration count onto an RGB triple via a sampled palette LUT.
function colorFor(iter: number, maxIter: number, lut: Uint8ClampedArray): [number, number, number] {
  if (iter >= maxIter) return [0, 0, 0];
  const steps = lut.length / 3;
  const t = Math.sqrt(iter / maxIter); // gamma-like spread for low-iter detail
  const idx = Math.min(steps - 1, Math.floor(t * steps));
  return [lut[idx * 3], lut[idx * 3 + 1], lut[idx * 3 + 2]];
}

export function FractalRenderer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderIdRef = useRef(0);
  const lutRef = useRef<Uint8ClampedArray>(new Uint8ClampedArray(0));

  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);
  const [isRendering, setIsRendering] = useState(false);
  const [renderMs, setRenderMs] = useState(0);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [renders, setRenders] = useState<RenderRecord[]>([]);
  const [presetName, setPresetName] = useState('');
  const [importText, setImportText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Orbit inspector
  const [orbit, setOrbit] = useState<{ point: number[]; iterations: number; inSet: boolean; orbit: number[][] } | null>(null);

  // Mandelbulb 3D
  const bulbCanvasRef = useRef<HTMLCanvasElement>(null);
  const [bulbBusy, setBulbBusy] = useState(false);

  // Drag-to-pan state
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  const zoomLevel = useMemo(() => 3 / (view.scale * 600), [view.scale]);

  // --- palette LUT (wires fractal.paletteFor) --------------------------------
  const refreshPalette = useCallback(async (palette: PaletteKey) => {
    const res = await lensRun('fractal', 'paletteFor', { palette, steps: 256 });
    const swatches = res.data?.result?.swatches as { rgb: number[] }[] | undefined;
    if (swatches && swatches.length) {
      const lut = new Uint8ClampedArray(swatches.length * 3);
      swatches.forEach((s, i) => {
        lut[i * 3] = s.rgb[0]; lut[i * 3 + 1] = s.rgb[1]; lut[i * 3 + 2] = s.rgb[2];
      });
      lutRef.current = lut;
    }
  }, []);

  // --- canvas render (chunked, non-blocking) ---------------------------------
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width;
    canvas.height = height;

    const lut = lutRef.current.length > 0
      ? lutRef.current
      : new Uint8ClampedArray([0, 0, 0, 255, 255, 255]);

    const { type, centerX, centerY, scale, maxIter, power, juliaRe, juliaIm } = view;
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const myId = ++renderIdRef.current;
    setIsRendering(true);
    const t0 = performance.now();

    let row = 0;
    const ROWS = 24;
    const step = () => {
      if (myId !== renderIdRef.current) return;
      const end = Math.min(row + ROWS, height);
      for (let py = row; py < end; py++) {
        const wy = centerY + (py - height / 2) * scale;
        for (let px = 0; px < width; px++) {
          const wx = centerX + (px - width / 2) * scale;
          const iter = escapeIter(type, wx, wy, maxIter, power, juliaRe, juliaIm);
          const [r, g, b] = colorFor(iter, maxIter, lut);
          const i = (py * width + px) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
      row = end;
      if (row < height) requestAnimationFrame(step);
      else { setIsRendering(false); setRenderMs(Math.round(performance.now() - t0)); }
    };
    requestAnimationFrame(step);
  }, [view]);

  // initial palette load + initial preset/render history load
  // eslint-disable-next-line react-hooks/exhaustive-deps -- run-once initial load
  useEffect(() => { void refreshPalette(view.palette);   }, []);
  useEffect(() => { void loadPresets(); void loadRenders();   }, []);

  // re-render whenever the view changes (after palette is ready)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshPalette(view.palette);
      if (!cancelled) renderCanvas();
    })();
    const idRef = renderIdRef;
    return () => { cancelled = true; idRef.current++; };
  }, [view, refreshPalette, renderCanvas]);

  // --- pointer interactions: click-zoom + drag-pan + wheel-zoom --------------
  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    return {
      wx: view.centerX + (px - canvas.width / 2) * view.scale,
      wy: view.centerY + (py - canvas.height / 2) * view.scale,
    };
  };

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragRef.current && dragRef.current.x !== e.clientX) return; // was a drag
    const { wx, wy } = toWorld(e.clientX, e.clientY);
    setView(v => ({ ...v, centerX: wx, centerY: wy, scale: v.scale / 2 }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setView(v => ({ ...v, scale: Math.min(v.scale * 2, 1) }));
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    const { wx, wy } = toWorld(e.clientX, e.clientY);
    const factor = e.deltaY < 0 ? 0.8 : 1.25;
    setView(v => ({
      ...v,
      // zoom toward the cursor
      centerX: wx + (v.centerX - wx) * factor,
      centerY: wy + (v.centerY - wy) * factor,
      scale: Math.min(v.scale * factor, 1),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, cx: view.centerX, cy: view.centerY };
  };
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragRef.current || e.buttons !== 1) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setView(v => ({
      ...v,
      centerX: dragRef.current!.cx - dx * v.scale,
      centerY: dragRef.current!.cy - dy * v.scale,
    }));
  };
  const handleMouseUp = () => { setTimeout(() => { dragRef.current = null; }, 0); };

  // --- orbit inspector (wires fractal.orbit) --------------------------------
  const inspectOrbit = useCallback(async (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { wx, wy } = toWorld(e.clientX, e.clientY);
    const res = await lensRun('fractal', 'orbit', {
      type: view.type, x: wx, y: wy, maxIter: view.maxIter,
      juliaRe: view.juliaRe, juliaIm: view.juliaIm,
    });
    if (res.data?.ok && res.data.result) setOrbit(res.data.result);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // --- preset persistence (wires save/list/delete/import/export) ------------
  async function loadPresets() {
    const res = await lensRun('fractal', 'listPresets', {});
    if (res.data?.ok) setPresets((res.data.result?.presets as Preset[]) || []);
  }
  async function loadRenders() {
    const res = await lensRun('fractal', 'listRenders', {});
    if (res.data?.ok) setRenders((res.data.result?.renders as RenderRecord[]) || []);
  }

  const savePreset = async () => {
    const name = presetName.trim() || `${view.type} ${new Date().toLocaleTimeString()}`;
    setBusy('save');
    const res = await lensRun('fractal', 'savePreset', { name, config: view });
    setBusy(null);
    if (res.data?.ok) {
      setPresetName('');
      setStatus(`Saved preset "${name}"`);
      await loadPresets();
    } else setStatus(res.data?.error || 'Save failed');
  };

  const applyPreset = (p: Preset) => {
    setView(v => ({ ...v, ...DEFAULT_VIEW, ...p.config } as ViewState));
    setStatus(`Loaded "${p.name}"`);
  };

  const deletePreset = async (id: string) => {
    setBusy(id);
    const res = await lensRun('fractal', 'deletePreset', { id });
    setBusy(null);
    if (res.data?.ok) await loadPresets();
  };

  const exportPreset = async (id: string) => {
    const res = await lensRun('fractal', 'exportPreset', { id });
    if (res.data?.ok && res.data.result?.json) {
      const blob = new Blob([res.data.result.json as string], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `fractal-preset-${id}.json`; a.click();
      URL.revokeObjectURL(url);
      setStatus('Preset exported');
    }
  };

  const importPreset = async () => {
    if (!importText.trim()) return;
    setBusy('import');
    const res = await lensRun('fractal', 'importPreset', { payload: importText.trim() });
    setBusy(null);
    if (res.data?.ok) {
      setImportText('');
      setStatus('Preset imported');
      await loadPresets();
    } else setStatus(res.data?.error || 'Import failed');
  };

  // --- high-resolution image export (wires fractal.recordRender) ------------
  const exportImage = async () => {
    setBusy('export');
    const W = 1920, H = 1080;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    if (!octx) { setBusy(null); return; }
    const lut = lutRef.current.length > 0 ? lutRef.current : new Uint8ClampedArray([0, 0, 0, 255, 255, 255]);
    const img = octx.createImageData(W, H);
    const d = img.data;
    // keep the same world-window: scale picked so the full current view fits
    const exportScale = (view.scale * 600) / Math.min(W, H);
    for (let py = 0; py < H; py++) {
      const wy = view.centerY + (py - H / 2) * exportScale;
      for (let px = 0; px < W; px++) {
        const wx = view.centerX + (px - W / 2) * exportScale;
        const iter = escapeIter(view.type, wx, wy, view.maxIter, view.power, view.juliaRe, view.juliaIm);
        const [r, g, b] = colorFor(iter, view.maxIter, lut);
        const i = (py * W + px) * 4;
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
      if (py % 200 === 0) await new Promise(r => setTimeout(r, 0)); // yield
    }
    octx.putImageData(img, 0, 0);
    const dataUrl = off.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl; a.download = `fractal-${view.type}-${Date.now()}.png`; a.click();
    await lensRun('fractal', 'recordRender', {
      type: view.type, width: W, height: H, format: 'PNG',
      config: view, dataUrlLength: dataUrl.length,
    });
    setBusy(null);
    setStatus(`Exported ${W}×${H} PNG`);
    await loadRenders();
  };

  // --- deep-zoom path animation (wires fractal.zoomPath) --------------------
  const animateZoom = async () => {
    setBusy('zoom');
    const res = await lensRun('fractal', 'zoomPath', {
      from: { centerX: DEFAULT_VIEW.centerX, centerY: DEFAULT_VIEW.centerY, scale: DEFAULT_VIEW.scale },
      to: { centerX: view.centerX, centerY: view.centerY, scale: view.scale },
      frames: 48,
    });
    const path = res.data?.result?.path as { centerX: number; centerY: number; scale: number }[] | undefined;
    if (path && path.length) {
      for (const frame of path) {
        setView(v => ({ ...v, centerX: frame.centerX, centerY: frame.centerY, scale: frame.scale }));
        await new Promise(r => setTimeout(r, 90));
      }
      setStatus(`Zoom animation: ${path.length} frames`);
    }
    setBusy(null);
  };

  // --- 3D Mandelbulb (wires fractal.mandelbulb) ----------------------------
  const renderMandelbulb = async () => {
    setBulbBusy(true);
    const res = await lensRun('fractal', 'mandelbulb', {
      power: view.power < 3 ? 8 : view.power, maxIter: 8, resolution: 64, slices: 24, bound: 1.25,
    });
    const field = res.data?.result?.field as { z: number; cells: number[][] }[] | undefined;
    const canvas = bulbCanvasRef.current;
    if (field && canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const W = canvas.width, H = canvas.height;
        ctx.fillStyle = '#05060a';
        ctx.fillRect(0, 0, W, H);
        // depth-composite the z-slices: nearer slices drawn last, brighter
        field.forEach((slice, si) => {
          const cells = slice.cells;
          const res2 = cells.length;
          const cw = W / res2, ch = H / res2;
          const depth = si / Math.max(1, field.length - 1);
          for (let iy = 0; iy < res2; iy++) {
            for (let ix = 0; ix < res2; ix++) {
              const shade = cells[iy][ix];
              if (shade < 0) continue; // outside the set
              const lum = Math.round((0.25 + 0.75 * shade) * (0.4 + 0.6 * depth) * 255);
              ctx.fillStyle = `rgb(${Math.round(lum * 0.8)},${Math.round(lum * 0.7)},${lum})`;
              ctx.fillRect(ix * cw, iy * ch, cw + 1, ch + 1);
            }
          }
        });
      }
    }
    setBulbBusy(false);
    setStatus(field ? `Mandelbulb: ${field.length} slices` : 'Mandelbulb failed');
  };

  const resetView = () => setView({ ...DEFAULT_VIEW });

  // --- UI ------------------------------------------------------------------
  const panel = 'rounded-xl border border-zinc-800 bg-zinc-950/60 p-4';
  const lbl = 'text-[10px] uppercase tracking-wider text-zinc-400';
  const inputCls = 'w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white';
  const btn = 'flex items-center justify-center gap-1.5 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-200 hover:border-fuchsia-500/50 hover:text-white disabled:opacity-40';

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        {/* canvas */}
        <div className="flex-1 space-y-2">
          <div className={panel}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Crosshair className="h-4 w-4 text-fuchsia-400" />
                <span className="text-sm font-semibold text-white">Escape-time Renderer</span>
                {isRendering && <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-400" />}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-zinc-400">
                <span>zoom {zoomLevel.toExponential(2)}×</span>
                <span>{renderMs} ms</span>
                <button onClick={resetView} className="flex items-center gap-1 text-zinc-400 hover:text-white">
                  <RotateCcw className="h-3 w-3" /> reset
                </button>
              </div>
            </div>
            <canvas
              ref={canvasRef}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onDoubleClick={inspectOrbit}
              className="w-full cursor-crosshair rounded-lg bg-black"
              style={{ height: '460px' }}
            />
            <p className="mt-1.5 text-[10px] text-zinc-400">
              click / scroll to zoom · drag to pan · right-click zoom out · double-click to inspect orbit
            </p>
          </div>

          {/* orbit inspector */}
          {orbit && (
            <div className={panel}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-white">Orbit Inspector</span>
                <span className={`text-[10px] ${orbit.inSet ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {orbit.inSet ? 'in set' : 'escaped'} · {orbit.iterations} iters
                </span>
              </div>
              <p className="font-mono text-[10px] text-zinc-400">
                c = ({orbit.point[0].toFixed(6)}, {orbit.point[1].toFixed(6)})
              </p>
              <OrbitPlot orbit={orbit.orbit} />
            </div>
          )}

          {/* 3D mandelbulb */}
          <div className={panel}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Box className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-semibold text-white">3D Mandelbulb</span>
              </div>
              <button onClick={renderMandelbulb} disabled={bulbBusy} className={btn}>
                {bulbBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Render
              </button>
            </div>
            <canvas ref={bulbCanvasRef} width={320} height={320} className="mx-auto rounded-lg bg-[#05060a]" />
            <p className="mt-1.5 text-center text-[10px] text-zinc-400">
              depth-composited z-slices with diffuse lighting (power {view.power < 3 ? 8 : view.power})
            </p>
          </div>
        </div>

        {/* controls */}
        <div className="w-full space-y-3 lg:w-72">
          <div className={panel}>
            <div className="mb-2 flex items-center gap-2">
              <Palette className="h-4 w-4 text-fuchsia-400" />
              <span className="text-sm font-semibold text-white">Parameters</span>
            </div>
            <div className="space-y-2.5">
              <div>
                <label className={lbl}>Fractal</label>
                <select
                  className={inputCls}
                  value={view.type}
                  onChange={e => setView(v => ({ ...v, type: e.target.value as FractalType }))}
                >
                  {FRACTAL_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Palette</label>
                <select
                  className={inputCls}
                  value={view.palette}
                  onChange={e => setView(v => ({ ...v, palette: e.target.value as PaletteKey }))}
                >
                  {PALETTE_KEYS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Iterations: {view.maxIter}</label>
                <input
                  type="range" min={32} max={2000} step={16}
                  value={view.maxIter}
                  onChange={e => setView(v => ({ ...v, maxIter: parseInt(e.target.value) }))}
                  className="w-full accent-fuchsia-500"
                />
              </div>
              {view.type === 'julia' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lbl}>Julia Re</label>
                    <input
                      type="number" step="0.001" className={inputCls}
                      value={view.juliaRe}
                      onChange={e => setView(v => ({ ...v, juliaRe: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                  <div>
                    <label className={lbl}>Julia Im</label>
                    <input
                      type="number" step="0.001" className={inputCls}
                      value={view.juliaIm}
                      onChange={e => setView(v => ({ ...v, juliaIm: parseFloat(e.target.value) || 0 }))}
                    />
                  </div>
                </div>
              )}
              {view.type === 'multibrot' && (
                <div>
                  <label className={lbl}>Power: {view.power}</label>
                  <input
                    type="range" min={2} max={8} step={1}
                    value={view.power}
                    onChange={e => setView(v => ({ ...v, power: parseInt(e.target.value) }))}
                    className="w-full accent-fuchsia-500"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lbl}>Center X</label>
                  <input
                    type="number" step="0.0001" className={inputCls}
                    value={view.centerX}
                    onChange={e => setView(v => ({ ...v, centerX: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
                <div>
                  <label className={lbl}>Center Y</label>
                  <input
                    type="number" step="0.0001" className={inputCls}
                    value={view.centerY}
                    onChange={e => setView(v => ({ ...v, centerY: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button onClick={animateZoom} disabled={!!busy} className={btn}>
                {busy === 'zoom' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Film className="h-3 w-3" />}
                Zoom Anim
              </button>
              <button onClick={exportImage} disabled={!!busy} className={btn}>
                {busy === 'export' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                Export PNG
              </button>
            </div>
          </div>

          {/* presets */}
          <div className={panel}>
            <span className="text-sm font-semibold text-white">Presets</span>
            <div className="mt-2 flex gap-1.5">
              <input
                className={inputCls}
                placeholder="preset name…"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
              />
              <button onClick={savePreset} disabled={busy === 'save'} className={btn}>
                {busy === 'save' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              </button>
            </div>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {presets.length === 0 && (
                <p className="py-2 text-center text-[10px] text-zinc-400">no presets yet</p>
              )}
              {presets.map(p => (
                <div key={p.id} className="flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1">
                  <button
                    onClick={() => applyPreset(p)}
                    className="flex-1 truncate text-left text-[11px] text-zinc-200 hover:text-white"
                    title={p.name}
                  >
                    {p.imported && <span className="text-cyan-400">↓ </span>}{p.name}
                    <span className="ml-1 text-[9px] text-zinc-400">{p.config.type}</span>
                  </button>
                  <button onClick={() => exportPreset(p.id)} className="text-zinc-400 hover:text-cyan-400" title="Export">
                    <Download className="h-3 w-3" />
                  </button>
                  <button onClick={() => deletePreset(p.id)} disabled={busy === p.id} className="text-zinc-400 hover:text-red-400" title="Delete">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2">
              <label className={lbl}>Import preset JSON</label>
              <textarea
                className={`${inputCls} h-14 resize-none font-mono`}
                placeholder='{"name":"...","config":{...}}'
                value={importText}
                onChange={e => setImportText(e.target.value)}
              />
              <button onClick={importPreset} disabled={busy === 'import' || !importText.trim()} className={`${btn} mt-1.5 w-full`}>
                {busy === 'import' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Import
              </button>
            </div>
          </div>

          {/* render history */}
          <div className={panel}>
            <span className="text-sm font-semibold text-white">Export History</span>
            <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
              {renders.length === 0 && (
                <p className="py-2 text-center text-[10px] text-zinc-400">no exports yet</p>
              )}
              {renders.map(r => (
                <div key={r.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[10px]">
                  <span className="text-zinc-300">{r.type} · {r.width}×{r.height}</span>
                  <span className="text-zinc-600">{r.format} · {(r.bytes / 1024).toFixed(0)}KB</span>
                </div>
              ))}
            </div>
          </div>

          {status && (
            <p className="rounded border border-fuchsia-500/20 bg-fuchsia-500/5 px-2 py-1.5 text-[10px] text-fuchsia-300">
              {status}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Small SVG plot of an escape-time orbit.
function OrbitPlot({ orbit }: { orbit: number[][] }) {
  if (!orbit || orbit.length < 2) return null;
  const xs = orbit.map(p => p[0]);
  const ys = orbit.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rx = (maxX - minX) || 1, ry = (maxY - minY) || 1;
  const W = 240, H = 120, pad = 8;
  const sx = (x: number) => pad + ((x - minX) / rx) * (W - 2 * pad);
  const sy = (y: number) => H - pad - ((y - minY) / ry) * (H - 2 * pad);
  const pts = orbit.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
  return (
    <svg width={W} height={H} className="mt-1.5 rounded bg-black">
      <polyline points={pts} fill="none" stroke="#e879f9" strokeWidth="1" opacity="0.8" />
      {orbit.map((p, i) => (
        <circle key={i} cx={sx(p[0])} cy={sy(p[1])} r={i === 0 ? 2.5 : 1.2}
          fill={i === 0 ? '#22d3ee' : '#a78bfa'} />
      ))}
    </svg>
  );
}
