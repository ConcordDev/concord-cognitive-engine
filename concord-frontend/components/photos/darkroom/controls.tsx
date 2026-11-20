'use client';

/**
 * The Darkroom's controls: a slider you drag, nudge with the arrow keys,
 * double-click to reset or click its number to type a value; the live
 * histogram with clipping warnings; and the tone curve you shape with points.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { curveLUT } from '@/lib/photos/develop';
import type { CurvePoint, Hist, SliderDef } from './editTypes';

export function Slider<K extends string>({ def, value, onChange, onCommit, disabled }: {
  def: SliderDef<K>; value: number; onChange: (v: number) => void; onCommit: (v: number, label: string) => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [typing, setTyping] = useState<string | null>(null);
  const live = useRef(value);
  useEffect(() => { live.current = value; }, [value]);
  const span = def.max - def.min;
  const pct = ((value - def.min) / span) * 100;
  const zeroPct = ((Math.min(def.max, Math.max(def.min, 0)) - def.min) / span) * 100;
  const fmt = def.fmt || ((v: number) => String(v));
  const snap = useCallback((v: number) => {
    const s = Math.round(v / def.step) * def.step;
    return Math.max(def.min, Math.min(def.max, Number(s.toFixed(4))));
  }, [def]);
  const label = (v: number) => `${def.label} ${fmt(v)}`;

  const fromX = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return snap(def.min + ((clientX - r.left) / r.width) * span);
  };
  const onDown = (e: React.PointerEvent) => {
    if (disabled) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setActive(true);
    const v = fromX(e.clientX);
    onChange(v);
  };
  const onMove = (e: React.PointerEvent) => { if (active) onChange(fromX(e.clientX)); };
  const onUp = () => { if (!active) return; setActive(false); onCommit(live.current, label(live.current)); };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const big = e.shiftKey ? 10 : 1;
    let v: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = snap(value + def.step * big * (def.step < 0.1 ? 5 : 1));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = snap(value - def.step * big * (def.step < 0.1 ? 5 : 1));
    if (e.key === 'Home') v = def.min;
    if (e.key === 'End') v = def.max;
    if (e.key === '0' || e.key === 'Backspace') v = snap(0);
    if (v == null) return;
    e.preventDefault(); e.stopPropagation();
    onChange(v); onCommit(v, label(v));
  };
  const reset = () => { const v = snap(0); onChange(v); onCommit(v, `${def.label} reset`); };

  return (
    <div className="grid grid-cols-[76px,1fr,46px] items-center gap-2 py-[3px]">
      <span className={`truncate text-[12px] ${value !== 0 ? 'text-[var(--dr-ink)]' : 'text-[var(--dr-ink-2)]'}`}>{def.label}</span>
      <div
        ref={ref} role="slider" tabIndex={disabled ? -1 : 0} aria-label={def.label} aria-valuemin={def.min} aria-valuemax={def.max} aria-valuenow={value} aria-valuetext={fmt(value)}
        className="dr-slider" data-active={active} data-changed={value !== 0} aria-disabled={disabled || undefined}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onDoubleClick={reset}
        data-testid={`dr-slider-${def.key}`}
      >
        {def.gradient ? <div className="dr-slider-gradient" style={{ background: def.gradient }} /> : <div className="dr-slider-track" />}
        {!def.gradient && <div className="dr-slider-fill" style={{ left: `${Math.min(zeroPct, pct)}%`, width: `${Math.abs(pct - zeroPct)}%` }} />}
        {def.min < 0 && <div className="dr-slider-tick" style={{ left: `${zeroPct}%` }} />}
        <div className="dr-slider-thumb" style={{ left: `${pct}%` }} />
      </div>
      {typing == null ? (
        <button type="button" className="dr-mono text-right text-[11.5px] text-[var(--dr-ink-2)] hover:text-[var(--dr-ink)]" onClick={() => !disabled && setTyping(String(value))} title="Type a value" aria-label={`${def.label} value ${fmt(value)}, click to type`}>{fmt(value)}</button>
      ) : (
        <input
          autoFocus className="dr-input dr-mono h-6 px-1 text-right text-[11.5px]" value={typing} aria-label={`${def.label} value`}
          onChange={(e) => setTyping(e.target.value)}
          onBlur={() => setTyping(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setTyping(null);
            if (e.key === 'Enter') { const n = Number(typing); if (Number.isFinite(n)) { const v = snap(n); onChange(v); onCommit(v, label(v)); } setTyping(null); }
          }}
        />
      )}
    </div>
  );
}

/** RGB + luminance histogram, with the clipped shadows/highlights warnings. */
export function Histogram({ hist, exif, clip, onToggleClip }: {
  hist: Hist | null; exif?: { iso?: number; fNumber?: number; shutter?: string | null; focal?: number }; clip: boolean; onToggleClip: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d'); if (!g) return;
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    if (!hist) return;
    let max = 1;
    for (const ch of [hist.r, hist.g, hist.b]) for (let i = 1; i < 255; i++) max = Math.max(max, ch[i]);
    const draw = (ch: Uint32Array, color: string) => {
      g.beginPath(); g.moveTo(0, H);
      for (let i = 0; i < 256; i++) g.lineTo((i / 255) * W, H - Math.min(1, Math.sqrt(ch[i] / max)) * (H - 2));
      g.lineTo(W, H); g.closePath(); g.fillStyle = color; g.fill();
    };
    g.globalCompositeOperation = 'lighter';
    draw(hist.r, 'rgba(220,60,50,0.55)'); draw(hist.g, 'rgba(70,190,80,0.55)'); draw(hist.b, 'rgba(60,110,230,0.55)');
    g.globalCompositeOperation = 'source-over';
  }, [hist]);
  const lowPct = hist ? (hist.clippedShadows / Math.max(1, hist.samples)) * 100 : 0;
  const highPct = hist ? (hist.clippedHighlights / Math.max(1, hist.samples)) * 100 : 0;
  return (
    <div className="dr-well relative p-1.5" data-testid="dr-histogram">
      <canvas ref={ref} width={256} height={84} className="block h-[84px] w-full" aria-label="Histogram of the developed photo" role="img" />
      <button type="button" onClick={onToggleClip} aria-pressed={clip} title="Show clipping (J)"
        className="absolute left-1.5 top-1.5 h-3 w-3" style={{ clipPath: 'polygon(0 0,100% 0,0 100%)', background: lowPct > 0.1 ? '#4c86ff' : 'var(--dr-faint)' }} aria-label={`Shadows clipped: ${lowPct.toFixed(1)}%`} />
      <button type="button" onClick={onToggleClip} aria-pressed={clip} title="Show clipping (J)"
        className="absolute right-1.5 top-1.5 h-3 w-3" style={{ clipPath: 'polygon(0 0,100% 0,100% 100%)', background: highPct > 0.1 ? '#ff4d3d' : 'var(--dr-faint)' }} aria-label={`Highlights clipped: ${highPct.toFixed(1)}%`} />
      <div className="dr-mono mt-1 flex justify-between px-0.5 text-[10.5px] text-[var(--dr-muted)]">
        <span>{exif?.iso ? `ISO ${exif.iso}` : '—'}</span>
        <span>{exif?.focal ? `${exif.focal} mm` : ''}</span>
        <span>{exif?.fNumber ? `ƒ/${exif.fNumber}` : ''}</span>
        <span>{exif?.shutter || ''}</span>
      </div>
    </div>
  );
}

/** The tone curve: click to add a point, drag to move, double-click a point to remove it. */
export function ToneCurve({ points, channel, onChange, onCommit }: {
  points: CurvePoint[]; channel: 'rgb' | 'r' | 'g' | 'b'; onChange: (p: CurvePoint[]) => void; onCommit: (p: CurvePoint[]) => void;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const live = useRef(points);
  useEffect(() => { live.current = points; }, [points]);
  const S = 220;
  const color = channel === 'r' ? '#e0574d' : channel === 'g' ? '#5dbb67' : channel === 'b' ? '#5a8de8' : '#e9e9ea';
  const lut = curveLUT(points, 128);
  const path = Array.from(lut).map((y, i) => `${i ? 'L' : 'M'}${((i / 127) * S).toFixed(1)},${((1 - y) * S).toFixed(1)}`).join(' ');
  const at = (e: React.PointerEvent): CurvePoint => {
    const r = ref.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))];
  };
  const onDown = (e: React.PointerEvent) => {
    const [x, y] = at(e);
    const near = points.findIndex(([px, py]) => Math.hypot(px - x, py - y) < 0.05);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (near >= 0) { setDrag(near); return; }
    if (points.length >= 16) return;
    const next = [...points, [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
    onChange(next);
    setDrag(next.findIndex((p) => p[0] === x));
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag == null) return;
    const [x, y] = at(e);
    const next = points.map((p) => [...p] as CurvePoint);
    const lo = drag === 0 ? 0 : next[drag - 1][0] + 0.01, hi = drag === next.length - 1 ? 1 : next[drag + 1][0] - 0.01;
    next[drag] = [drag === 0 ? Math.min(x, 0.3) : drag === next.length - 1 ? Math.max(x, 0.7) : Math.max(lo, Math.min(hi, x)), y];
    onChange(next);
  };
  const onUp = () => { if (drag != null) { setDrag(null); onCommit(live.current); } };
  const remove = (i: number) => { if (i === 0 || i === points.length - 1) return; const next = points.filter((_, j) => j !== i); onChange(next); onCommit(next); };
  return (
    <svg ref={ref} viewBox={`0 0 ${S} ${S}`} className="dr-well block aspect-square w-full touch-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      role="img" aria-label={`Tone curve (${channel}) with ${points.length} points`} data-testid="dr-curve">
      {[0.25, 0.5, 0.75].map((g) => <g key={g} stroke="var(--dr-rule)" strokeWidth={1}><line x1={g * S} y1={0} x2={g * S} y2={S} /><line x1={0} y1={g * S} x2={S} y2={g * S} /></g>)}
      <line x1={0} y1={S} x2={S} y2={0} stroke="var(--dr-faint)" strokeDasharray="3 4" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.75} />
      {points.map(([x, y], i) => (
        <circle key={i} cx={x * S} cy={(1 - y) * S} r={drag === i ? 6 : 4.5} fill={drag === i ? color : 'var(--dr-panel)'} stroke={color} strokeWidth={1.5} onDoubleClick={() => remove(i)} style={{ cursor: 'grab' }} />
      ))}
    </svg>
  );
}
