'use client';

/**
 * The photo on its mid-grey surround, with the tools drawn over it. Every
 * point a person touches is turned into the photo's own coordinates through
 * the pipeline's geometry (outputToSourceNorm / sourceNormToOutput), so a
 * spot or mask stays on the same part of the picture through any later crop
 * or rotation — and lands on the export exactly where it was put.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { outputSize, outputToSourceNorm, sourceNormToOutput } from '@/lib/photos/develop';
import type { Edit, Mask, Spot } from './editTypes';

export type Tool = 'none' | 'crop' | 'spot' | 'radial' | 'linear' | 'brush';
export interface BrushSettings { size: number; feather: number; flow: number; erase: boolean }

interface Props {
  image: ImageData | null;
  edit: Edit;                 // the edit as stored
  shown: Edit;                // the edit being drawn (crop tool shows the whole frame)
  srcW: number; srcH: number; // the original's size (only its shape matters)
  tool: Tool;
  cropAspect: number | null;
  selectedMask: number | null;
  selectedSpot: number | null;
  spotMode: 'heal' | 'clone';
  spotSize: number;
  brush: BrushSettings;
  overlay: ImageData | null;
  clip: boolean;
  zoom: 'fit' | '1:1';
  onEdit: (e: Edit, final: boolean, label: string) => void;
  onSelectMask: (i: number | null) => void;
  onSelectSpot: (i: number | null) => void;
  onSpotPlaced: (index: number, spot: Spot) => void;
  status: string;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function Viewer(p: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const clipCanvas = useRef<HTMLCanvasElement>(null);
  const overlayCanvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<null | { kind: string; start: [number, number]; startEdit: Edit; extra?: unknown }>(null);
  const [horizon, setHorizon] = useState<null | [number, number, number, number]>(null);

  useEffect(() => { if (p.zoom === 'fit') setPan({ x: 0, y: 0 }); }, [p.zoom]);
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Display size: fit the frame into the room, or 1:1 with the preview's pixels.
  const out = outputSize(p.srcW, p.srcH, p.shown);
  const imgW = p.image?.width || out.width, imgH = p.image?.height || out.height;
  const fit = Math.max(0.05, Math.min((box.w - 48) / imgW, (box.h - 48) / imgH));
  const k = p.zoom === '1:1' ? 1 : fit;
  const dispW = Math.max(1, imgW * k), dispH = Math.max(1, imgH * k);

  useEffect(() => {
    const c = canvas.current; if (!c || !p.image) return;
    c.width = p.image.width; c.height = p.image.height;
    c.getContext('2d')?.putImageData(p.image, 0, 0);
    const cc = clipCanvas.current;
    if (cc) {
      cc.width = p.image.width; cc.height = p.image.height;
      const g = cc.getContext('2d');
      if (g) {
        g.clearRect(0, 0, cc.width, cc.height);
        if (p.clip) {
          const d = p.image.data, o = g.createImageData(cc.width, cc.height);
          for (let i = 0; i < d.length; i += 4) {
            const hi = d[i] >= 254 && d[i + 1] >= 254 && d[i + 2] >= 254, lo = d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1;
            if (hi) { o.data[i] = 255; o.data[i + 1] = 40; o.data[i + 2] = 30; o.data[i + 3] = 220; }
            else if (lo) { o.data[i] = 40; o.data[i + 1] = 110; o.data[i + 2] = 255; o.data[i + 3] = 220; }
          }
          g.putImageData(o, 0, 0);
        }
      }
    }
  }, [p.image, p.clip]);
  useEffect(() => {
    const c = overlayCanvas.current; if (!c) return;
    if (!p.overlay) { c.width = 1; c.height = 1; c.getContext('2d')?.clearRect(0, 0, 1, 1); return; }
    c.width = p.overlay.width; c.height = p.overlay.height;
    c.getContext('2d')?.putImageData(p.overlay, 0, 0);
  }, [p.overlay]);

  // Coordinates: u,v in [0,1] across the shown frame ⇄ source-normalized x,y.
  const toSrc = useCallback((u: number, v: number) => outputToSourceNorm(p.srcW, p.srcH, p.shown, u, v), [p.srcW, p.srcH, p.shown]);
  const toOut = useCallback((x: number, y: number) => sourceNormToOutput(p.srcW, p.srcH, p.shown, x, y), [p.srcW, p.srcH, p.shown]);
  const md = Math.min(p.srcW, p.srcH);
  const uvOf = (e: React.PointerEvent): [number, number] => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  /** Display pixels per source pixel (for drawing radii). */
  const pxPerSrc = useMemo(() => {
    const [a0, b0] = sourceNormToOutput(p.srcW, p.srcH, p.shown, 0.5, 0.5);
    const [a1, b1] = sourceNormToOutput(p.srcW, p.srcH, p.shown, 0.5 + 100 / p.srcW, 0.5);
    return Math.hypot((a1 - a0) * dispW, (b1 - b0) * dispH) / 100;
  }, [p.srcW, p.srcH, p.shown, dispW, dispH]);

  const setEdit = (fn: (e: Edit) => void, final: boolean, label: string) => {
    const next: Edit = JSON.parse(JSON.stringify(drag.current?.startEdit || p.edit));
    fn(next);
    p.onEdit(next, final, label);
  };

  // ── pointer handling per tool ──
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    const handle = target.getAttribute('data-h');
    const [u, v] = uvOf(e);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const startEdit = JSON.parse(JSON.stringify(p.edit)) as Edit;
    if (p.tool === 'none' && p.zoom === '1:1') { drag.current = { kind: 'pan', start: [e.clientX, e.clientY], startEdit, extra: pan }; return; }
    if (p.tool === 'crop') {
      if (e.altKey || handle === 'horizon') { drag.current = { kind: 'horizon', start: [u, v], startEdit }; setHorizon([u, v, u, v]); return; }
      drag.current = { kind: handle || 'crop-new', start: [u, v], startEdit };
      return;
    }
    if (p.tool === 'spot') {
      if (handle?.startsWith('spot-')) {
        const [, idx, which] = handle.split('-');
        p.onSelectSpot(Number(idx));
        drag.current = { kind: `spotmove-${idx}-${which}`, start: [u, v], startEdit };
        return;
      }
      const [x, y] = toSrc(u, v);
      const spot: Spot = { x: clamp(x, 0, 1), y: clamp(y, 0, 1), r: p.spotSize, sx: clamp(x + p.spotSize * 2.5 * (md / p.srcW), 0, 1), sy: clamp(y, 0, 1), mode: p.spotMode, feather: 0.5 };
      const next = JSON.parse(JSON.stringify(p.edit)) as Edit;
      next.spots.push(spot);
      p.onEdit(next, true, p.spotMode === 'heal' ? 'Spot heal' : 'Spot clone');
      p.onSpotPlaced(next.spots.length - 1, spot);
      return;
    }
    if (p.tool === 'radial' || p.tool === 'linear' || p.tool === 'brush') {
      if (handle?.startsWith('mask-')) { drag.current = { kind: handle, start: [u, v], startEdit }; return; }
      const [x, y] = toSrc(u, v);
      if (p.tool === 'brush' && p.selectedMask != null && p.edit.masks[p.selectedMask]?.kind === 'brush') {
        const next = JSON.parse(JSON.stringify(p.edit)) as Edit;
        next.masks[p.selectedMask].brush!.strokes.push({ pts: [[x, y]], size: p.brush.size, feather: p.brush.feather, flow: p.brush.flow, erase: p.brush.erase });
        drag.current = { kind: 'brush', start: [u, v], startEdit: next };
        p.onEdit(next, false, p.brush.erase ? 'Brush erase' : 'Brush');
        return;
      }
      const next = JSON.parse(JSON.stringify(p.edit)) as Edit;
      const id = `m${Date.now().toString(36)}`;
      const base: Mask = { id, name: '', kind: p.tool, invert: false, amount: 1, adj: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, temperature: 0, tint: 0, saturation: 0, clarity: 0 } };
      if (p.tool === 'radial') base.radial = { cx: x, cy: y, rx: 0.01, ry: 0.01, angle: 0, feather: 0.5 };
      if (p.tool === 'linear') base.linear = { x1: x, y1: y, x2: x, y2: y };
      if (p.tool === 'brush') base.brush = { strokes: [{ pts: [[x, y]], size: p.brush.size, feather: p.brush.feather, flow: p.brush.flow, erase: false }] };
      base.name = p.tool === 'radial' ? 'Radial' : p.tool === 'linear' ? 'Linear' : 'Brush';
      next.masks.push(base);
      p.onSelectMask(next.masks.length - 1);
      drag.current = { kind: `draw-${p.tool}`, start: [u, v], startEdit: next, extra: next.masks.length - 1 };
      p.onEdit(next, false, `New ${base.name.toLowerCase()} mask`);
    }
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current; if (!d) return;
    const [u, v] = uvOf(e);
    if (d.kind === 'pan') { const o = d.extra as { x: number; y: number }; setPan({ x: o.x + e.clientX - d.start[0], y: o.y + e.clientY - d.start[1] }); return; }
    if (d.kind === 'horizon') { setHorizon([d.start[0], d.start[1], u, v]); return; }
    if (p.tool === 'crop') { setEdit((ed) => applyCropDrag(ed, d.kind, d.start, [u, v], p.cropAspect, p.srcW, p.srcH), false, 'Crop'); return; }
    if (d.kind.startsWith('spotmove-')) {
      const [, idx, which] = d.kind.split('-');
      const [x, y] = toSrc(u, v);
      setEdit((ed) => { const s = ed.spots[Number(idx)]; if (!s) return; if (which === 'dst') { s.x = clamp(x, 0, 1); s.y = clamp(y, 0, 1); } else { s.sx = clamp(x, 0, 1); s.sy = clamp(y, 0, 1); } }, false, 'Move spot');
      return;
    }
    const [x, y] = toSrc(u, v);
    if (d.kind === 'brush') {
      // A stroke grows point by point: add to the drag's own copy, then show it.
      const s = d.startEdit.masks[p.selectedMask!]?.brush?.strokes.at(-1);
      const last = s?.pts.at(-1);
      if (s && (!last || Math.hypot((x - last[0]) * p.srcW, (y - last[1]) * p.srcH) > Math.max(1, s.size * md * 0.15))) s.pts.push([x, y]);
      p.onEdit(JSON.parse(JSON.stringify(d.startEdit)), false, 'Brush');
      return;
    }
    if (d.kind.startsWith('draw-') || d.kind.startsWith('mask-')) {
      const idx = d.kind.startsWith('draw-') ? (d.extra as number) : p.selectedMask!;
      const [sx0, sy0] = toSrc(d.start[0], d.start[1]);
      setEdit((ed) => {
        const m = ed.masks[idx]; if (!m) return;
        if (m.kind === 'radial' && m.radial) {
          if (d.kind === 'mask-center') { const o = d.startEdit.masks[idx].radial!; m.radial.cx = o.cx + (x - sx0); m.radial.cy = o.cy + (y - sy0); }
          else { m.radial.rx = clamp(Math.abs(x - m.radial.cx), 0.005, 2); m.radial.ry = d.kind === 'mask-rx' ? m.radial.ry : clamp(Math.abs(y - m.radial.cy), 0.005, 2); if (d.kind === 'mask-ry') m.radial.rx = d.startEdit.masks[idx].radial!.rx; if (e.shiftKey && d.kind.startsWith('draw-')) { const r = Math.max(m.radial.rx * p.srcW, m.radial.ry * p.srcH); m.radial.rx = r / p.srcW; m.radial.ry = r / p.srcH; } }
        }
        if (m.kind === 'linear' && m.linear) {
          if (d.kind === 'mask-p1') { m.linear.x1 = x; m.linear.y1 = y; }
          else if (d.kind === 'mask-mid') { const o = d.startEdit.masks[idx].linear!; m.linear.x1 = o.x1 + (x - sx0); m.linear.y1 = o.y1 + (y - sy0); m.linear.x2 = o.x2 + (x - sx0); m.linear.y2 = o.y2 + (y - sy0); }
          else { m.linear.x2 = x; m.linear.y2 = y; }
        }
      }, false, 'Shape mask');
    }
  };

  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') return;
    if (d.kind === 'horizon' && horizon) {
      const [u1, v1, u2, v2] = horizon;
      setHorizon(null);
      const dx = (u2 - u1) * dispW, dy = (v2 - v1) * dispH;
      if (Math.hypot(dx, dy) < 12) return;
      let a = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (a > 90) a -= 180; if (a < -90) a += 180;
      if (Math.abs(a) > 45) a = a > 0 ? a - 90 : a + 90; // a near-vertical line straightens a vertical
      const next = JSON.parse(JSON.stringify(p.edit)) as Edit;
      next.geometry.angle = clamp(Math.round((next.geometry.angle - a) * 100) / 100, -45, 45);
      p.onEdit(next, true, `Straighten ${next.geometry.angle.toFixed(2)}°`);
      return;
    }
    if (d.kind === 'brush') { p.onEdit(JSON.parse(JSON.stringify(d.startEdit)), true, p.brush.erase ? 'Brush erase' : 'Brush stroke'); return; }
    const label = p.tool === 'crop' ? 'Crop' : d.kind.startsWith('spotmove') ? 'Move spot' : d.kind === 'brush' ? 'Brush stroke' : d.kind.startsWith('draw-') ? `New ${p.tool} mask` : 'Shape mask';
    p.onEdit(p.edit, true, label);
  };

  // ── what to draw over the photo ──
  const crop = p.edit.geometry.crop;
  const spotsDrawn = p.tool === 'spot' ? p.edit.spots.map((s, i) => {
    const [u, v] = toOut(s.x, s.y), [su, sv] = toOut(s.sx, s.sy);
    return { i, u, v, su, sv, r: s.r * md * pxPerSrc, mode: s.mode };
  }) : [];
  const mask = p.selectedMask != null ? p.edit.masks[p.selectedMask] : null;
  const ellipse = mask?.kind === 'radial' && mask.radial ? Array.from({ length: 49 }, (_, k) => {
    const t = (k / 48) * Math.PI * 2, a = (mask.radial!.angle * Math.PI) / 180;
    const ex = Math.cos(t) * mask.radial!.rx, ey = Math.sin(t) * mask.radial!.ry;
    const [u, v] = toOut(mask.radial!.cx + ex * Math.cos(a) - (ey * Math.sin(a) * p.srcH) / p.srcW, mask.radial!.cy + (ex * Math.sin(a) * p.srcW) / p.srcH + ey * Math.cos(a));
    return `${(u * dispW).toFixed(1)},${(v * dispH).toFixed(1)}`;
  }).join(' ') : null;
  const linearLines = mask?.kind === 'linear' && mask.linear ? (() => {
    const L = mask.linear!;
    const pts = [[L.x1, L.y1], [(L.x1 + L.x2) / 2, (L.y1 + L.y2) / 2], [L.x2, L.y2]].map(([x, y]) => toOut(x, y));
    const [a, , c] = pts;
    const dx = (c[0] - a[0]) * dispW, dy = (c[1] - a[1]) * dispH, len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * Math.max(dispW, dispH) * 1.5, ny = (dx / len) * Math.max(dispW, dispH) * 1.5;
    return pts.map(([u, v], k) => ({ k, x: u * dispW, y: v * dispH, x1: u * dispW - nx, y1: v * dispH - ny, x2: u * dispW + nx, y2: v * dispH + ny }));
  })() : null;
  const radialHandles = mask?.kind === 'radial' && mask.radial ? (() => {
    const c = toOut(mask.radial!.cx, mask.radial!.cy), rx = toOut(mask.radial!.cx + mask.radial!.rx, mask.radial!.cy), ry = toOut(mask.radial!.cx, mask.radial!.cy + mask.radial!.ry);
    return { c, rx, ry };
  })() : null;

  const cursor = p.tool === 'none' ? (p.zoom === '1:1' ? 'grab' : 'default') : p.tool === 'brush' ? 'none' : 'crosshair';
  const [hover, setHover] = useState<[number, number] | null>(null);

  return (
    <div ref={wrap} className="dr-canvas-wrap relative h-full w-full overflow-hidden" data-testid="dr-viewer">
      <div className="absolute left-1/2 top-1/2" style={{ width: dispW, height: dispH, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))` }}>
        {p.image ? (
          <canvas ref={canvas} className="dr-canvas block h-full w-full" aria-label="The photo, developed" role="img" data-testid="dr-canvas" />
        ) : (
          <div className="dr-skeleton h-full w-full" role="status" aria-label={p.status} />
        )}
        <canvas ref={clipCanvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
        <canvas ref={overlayCanvas} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />
        <svg className="absolute inset-0 h-full w-full overflow-visible" width={dispW} height={dispH}
          onPointerDown={onDown} onPointerMove={(e) => { const [u, v] = uvOf(e); setHover([u, v]); onMove(e); }} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}
          style={{ cursor, touchAction: 'none' }} data-testid="dr-overlay" aria-label="Photo tools layer">
          {p.tool === 'crop' && (
            <g>
              <path fillRule="evenodd" fill="rgba(0,0,0,0.55)" d={`M0,0H${dispW}V${dispH}H0Z M${crop.x * dispW},${crop.y * dispH}h${crop.w * dispW}v${crop.h * dispH}h${-crop.w * dispW}Z`} pointerEvents="none" />
              <rect data-h="crop-move" x={crop.x * dispW} y={crop.y * dispH} width={crop.w * dispW} height={crop.h * dispH} fill="transparent" stroke="#fff" strokeWidth={1} style={{ cursor: 'move' }} />
              {[1, 2].map((k) => <g key={k} stroke="rgba(255,255,255,0.35)" pointerEvents="none"><line x1={(crop.x + (crop.w * k) / 3) * dispW} y1={crop.y * dispH} x2={(crop.x + (crop.w * k) / 3) * dispW} y2={(crop.y + crop.h) * dispH} /><line x1={crop.x * dispW} y1={(crop.y + (crop.h * k) / 3) * dispH} x2={(crop.x + crop.w) * dispW} y2={(crop.y + (crop.h * k) / 3) * dispH} /></g>)}
              {(['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as const).map((h) => {
                const x = crop.x + (h.includes('w') ? 0 : h.includes('e') ? crop.w : crop.w / 2), y = crop.y + (h.includes('n') ? 0 : h.includes('s') ? crop.h : crop.h / 2);
                return <rect key={h} data-h={`crop-${h}`} x={x * dispW - 6} y={y * dispH - 6} width={12} height={12} fill="#fff" stroke="#000" strokeWidth={1} style={{ cursor: `${h}-resize` }} />;
              })}
              {horizon && <line x1={horizon[0] * dispW} y1={horizon[1] * dispH} x2={horizon[2] * dispW} y2={horizon[3] * dispH} stroke="var(--dr-safe)" strokeWidth={2} pointerEvents="none" />}
            </g>
          )}
          {spotsDrawn.map((s) => (
            <g key={s.i}>
              <line x1={s.u * dispW} y1={s.v * dispH} x2={s.su * dispW} y2={s.sv * dispH} stroke="rgba(255,255,255,0.6)" strokeDasharray="3 3" pointerEvents="none" />
              <circle data-h={`spot-${s.i}-src`} cx={s.su * dispW} cy={s.sv * dispH} r={Math.max(4, s.r)} fill="transparent" stroke="#fff" strokeDasharray="4 3" strokeWidth={1.25} style={{ cursor: 'move' }} />
              <circle data-h={`spot-${s.i}-dst`} cx={s.u * dispW} cy={s.v * dispH} r={Math.max(4, s.r)} fill="rgba(255,255,255,0.06)" stroke={p.selectedSpot === s.i ? 'var(--dr-safe)' : '#fff'} strokeWidth={p.selectedSpot === s.i ? 2 : 1.25} style={{ cursor: 'move' }} />
            </g>
          ))}
          {ellipse && <polyline points={ellipse} fill="none" stroke="#fff" strokeWidth={1.25} pointerEvents="none" />}
          {radialHandles && (
            <g>
              <circle data-h="mask-center" cx={radialHandles.c[0] * dispW} cy={radialHandles.c[1] * dispH} r={6} fill="var(--dr-safe)" stroke="#fff" style={{ cursor: 'move' }} />
              <circle data-h="mask-rx" cx={radialHandles.rx[0] * dispW} cy={radialHandles.rx[1] * dispH} r={5} fill="#fff" stroke="#000" style={{ cursor: 'ew-resize' }} />
              <circle data-h="mask-ry" cx={radialHandles.ry[0] * dispW} cy={radialHandles.ry[1] * dispH} r={5} fill="#fff" stroke="#000" style={{ cursor: 'ns-resize' }} />
            </g>
          )}
          {linearLines && linearLines.map((l) => (
            <g key={l.k}>
              <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.k === 1 ? 'rgba(255,255,255,0.5)' : '#fff'} strokeWidth={l.k === 1 ? 1 : 1.25} strokeDasharray={l.k === 1 ? '5 4' : undefined} pointerEvents="none" />
              <circle data-h={l.k === 0 ? 'mask-p1' : l.k === 1 ? 'mask-mid' : 'mask-p2'} cx={l.x} cy={l.y} r={l.k === 1 ? 6 : 5} fill={l.k === 1 ? 'var(--dr-safe)' : '#fff'} stroke="#000" style={{ cursor: 'move' }} />
            </g>
          ))}
          {p.tool === 'brush' && hover && <circle cx={hover[0] * dispW} cy={hover[1] * dispH} r={Math.max(2, p.brush.size * md * pxPerSrc)} fill="none" stroke={p.brush.erase ? '#7fb3ff' : '#fff'} strokeWidth={1.25} pointerEvents="none" />}
          {p.tool === 'spot' && hover && <circle cx={hover[0] * dispW} cy={hover[1] * dispH} r={Math.max(3, p.spotSize * md * pxPerSrc)} fill="none" stroke="#fff" strokeWidth={1} pointerEvents="none" />}
        </svg>
      </div>
    </div>
  );
}

/** Move or resize the crop rectangle (frame-normalized), keeping the chosen aspect. */
function applyCropDrag(ed: Edit, kind: string, start: [number, number], now: [number, number], aspect: number | null, srcW: number, srcH: number) {
  const s = ed.geometry.crop;
  const dx = now[0] - start[0], dy = now[1] - start[1];
  const o = { ...s };
  const [fw, fh] = ed.geometry.orient === 90 || ed.geometry.orient === 270 ? [srcH, srcW] : [srcW, srcH];
  const ratio = aspect === -1 ? fw / fh : aspect; // in pixels
  let x = o.x, y = o.y, w = o.w, h = o.h;
  if (kind === 'crop-move') { x = clamp(o.x + dx, 0, 1 - o.w); y = clamp(o.y + dy, 0, 1 - o.h); }
  else if (kind === 'crop-new') {
    x = Math.min(start[0], now[0]); y = Math.min(start[1], now[1]); w = Math.abs(dx); h = Math.abs(dy);
  } else {
    const h_ = kind.slice(5);
    if (h_.includes('w')) { x = clamp(o.x + dx, 0, o.x + o.w - 0.02); w = o.x + o.w - x; }
    if (h_.includes('e')) { w = clamp(o.w + dx, 0.02, 1 - o.x); }
    if (h_.includes('n')) { y = clamp(o.y + dy, 0, o.y + o.h - 0.02); h = o.y + o.h - y; }
    if (h_.includes('s')) { h = clamp(o.h + dy, 0.02, 1 - o.y); }
  }
  if (ratio && ratio > 0 && kind !== 'crop-move') {
    // w·fw / (h·fh) = ratio  →  keep the width, fit the height (then fit the frame).
    h = (w * fw) / (ratio * fh);
    if (y + h > 1) { h = 1 - y; w = (h * ratio * fh) / fw; }
    if (x + w > 1) { w = 1 - x; h = (w * fw) / (ratio * fh); }
  }
  ed.geometry.crop = { x: clamp(x, 0, 0.98), y: clamp(y, 0, 0.98), w: clamp(w, 0.02, 1), h: clamp(h, 0.02, 1) };
}
