'use client';

/**
 * The sky. Every star is a DTU the viewer may see, drawn at its chart
 * position, sized and lit by its magnitude (real links + citations) and
 * coloured by its spectral class (its shelf). Constellation figures are the
 * real links among a community's stars; bridges between constellations are
 * fainter. Your own charts and a plotted route draw over the top.
 *
 * The telescope: scroll or pinch to zoom about the pointer, drag to pan,
 * arrow keys / + / − from the keyboard, click a star to open its card.
 * Pointing the telescope at a star eases the view there (only on request).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { coords, type Constellation, type SkyLine, type Star } from './gx';

export interface SkyHandle { pointAt: (id: string) => void; reset: () => void }
interface Overlay { lines: [string, string][]; colour: string; dashed?: boolean; width?: number }
interface View { s: number; tx: number; ty: number }

const radiusFor = (mag: number, zoom: number) => Math.max(1.8, (7.4 - mag) * 1.5) * Math.min(2.2, 0.8 + zoom * 0.22);

export const SkyChart = forwardRef<SkyHandle, {
  stars: Star[]; lines: SkyLine[]; constellations: Constellation[];
  selectedId: string | null; onSelect: (id: string | null) => void;
  overlays?: Overlay[]; highlight?: Set<string>; showFigures: boolean; showGrid: boolean; showNames: boolean;
}>(function SkyChart({ stars, lines, constellations, selectedId, onSelect, overlays = [], highlight, showFigures, showGrid, showNames }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [hover, setHover] = useState<{ star: Star; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);
  const pinch = useRef<Map<number, { x: number; y: number }>>(new Map());

  const byId = useMemo(() => new Map(stars.map((s) => [s.id, s])), [stars]);
  // Canvas text can't read CSS variables: resolve the atlas and mono faces once.
  const fonts = useRef({ atlas: 'Georgia, serif', mono: 'monospace' });
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const cs = getComputedStyle(el);
    const atlas = cs.getPropertyValue('--sk-font-atlas').trim(); const mono = cs.getPropertyValue('--sk-font-mono').trim();
    fonts.current = { atlas: atlas ? `${atlas}, Georgia, serif` : 'Georgia, serif', mono: mono ? `${mono}, monospace` : 'monospace' };
  }, []);
  const span = Math.max(size.w, size.h);
  // world (0..1) → screen
  const toScreen = useCallback((x: number, y: number, v: View = view) => ({
    x: (size.w - span) / 2 + x * span * v.s + v.tx,
    y: (size.h - span) / 2 + y * span * v.s + v.ty,
  }), [size, span, view]);

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // ── draw ──
  useEffect(() => {
    const cv = canvas.current; const c = cv?.getContext('2d');
    if (!cv || !c) return;
    const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
    cv.width = Math.round(size.w * dpr); cv.height = Math.round(size.h * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size.w, size.h);

    if (showGrid) {
      c.strokeStyle = 'rgba(120,150,220,0.13)'; c.lineWidth = 1;
      c.font = `10px ${fonts.current.mono}`; c.fillStyle = 'rgba(160,180,230,0.45)';
      for (let h = 0; h <= 24; h += 2) {
        const p = toScreen(h / 24, 0); const q = toScreen(h / 24, 1);
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
        if (h < 24) c.fillText(`${h}h`, p.x + 3, Math.max(12, p.y + 12));
      }
      for (let d = -90; d <= 90; d += 30) {
        const yy = (90 - d) / 180; const p = toScreen(0, yy); const q = toScreen(1, yy);
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
        c.fillText(`${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}°`, Math.max(4, p.x + 3), p.y - 3);
      }
    }

    if (showFigures) {
      for (const l of lines) {
        const a = byId.get(l.a); const b = byId.get(l.b);
        if (!a || !b) continue;
        const p = toScreen(a.x, a.y); const q = toScreen(b.x, b.y);
        c.strokeStyle = l.within ? 'rgba(216,183,102,0.42)' : 'rgba(216,183,102,0.13)';
        c.lineWidth = l.within ? 1 : 0.8;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
      }
    }
    for (const o of overlays) {
      c.strokeStyle = o.colour; c.lineWidth = o.width || 2; c.setLineDash(o.dashed ? [6, 5] : []);
      for (const [ia, ib] of o.lines) {
        const a = byId.get(ia); const b = byId.get(ib);
        if (!a || !b) continue;
        const p = toScreen(a.x, a.y); const q = toScreen(b.x, b.y);
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
      }
      c.setLineDash([]);
    }

    // faintest first so bright stars sit on top
    const order = [...stars].sort((a, b) => b.magnitude - a.magnitude);
    for (const s of order) {
      const p = toScreen(s.x, s.y);
      if (p.x < -20 || p.y < -20 || p.x > size.w + 20 || p.y > size.h + 20) continue;
      const r = radiusFor(s.magnitude, view.s);
      const dim = highlight && highlight.size && !highlight.has(s.id) ? 0.28 : 1;
      if (s.magnitude < 6) {
        // a halo that grows with brightness
        const halo = r * (2.4 + Math.max(0, 6 - s.magnitude) * 0.5);
        const a = Math.round(Math.min(0.55, 0.12 + (6 - s.magnitude) * 0.09) * dim * 255).toString(16).padStart(2, '0');
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, halo);
        g.addColorStop(0, `${s.colour}${a}`); g.addColorStop(1, `${s.colour}00`);
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, halo, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = dim; c.fillStyle = s.colour;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
      if (s.id === selectedId) {
        c.strokeStyle = '#f0d48b'; c.lineWidth = 1.5;
        c.beginPath(); c.arc(p.x, p.y, r + 6, 0, Math.PI * 2); c.stroke();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.beginPath(); c.moveTo(p.x + dx * (r + 9), p.y + dy * (r + 9)); c.lineTo(p.x + dx * (r + 15), p.y + dy * (r + 15)); c.stroke(); }
      }
    }

    if (showNames) {
      // star names: the brightest, more as you zoom in
      c.font = `italic 13px ${fonts.current.atlas}`; c.fillStyle = 'rgba(233,227,208,0.82)';
      // the ten brightest on this sky are always named; zooming in names more
      const ranked = [...stars].sort((a, b) => a.magnitude - b.magnitude);
      const cutoff = (ranked[Math.min(ranked.length - 1, 9)]?.magnitude ?? 6) + (view.s - 1) * 0.9;
      // brightest first; a label that would overlap one already set is left off
      const taken: { x: number; y: number; w: number; h: number }[] = [];
      const order2 = [...stars].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : a.magnitude - b.magnitude));
      for (const s of order2) {
        if (s.magnitude > cutoff && s.id !== selectedId) continue;
        const p = toScreen(s.x, s.y);
        if (p.x < 0 || p.y < 0 || p.x > size.w || p.y > size.h) continue;
        const text = s.title.length > 34 ? `${s.title.slice(0, 33)}…` : s.title;
        const box = { x: p.x + radiusFor(s.magnitude, view.s) + 5, y: p.y - 9, w: c.measureText(text).width, h: 14 };
        if (taken.some((t) => box.x < t.x + t.w && box.x + box.w > t.x && box.y < t.y + t.h && box.y + box.h > t.y)) continue;
        taken.push(box);
        c.fillText(text, box.x, p.y + 4);
      }
      // constellation names at their centre, spaced capitals like an atlas
      c.font = `14px ${fonts.current.atlas}`; c.fillStyle = 'rgba(216,183,102,0.75)'; c.textAlign = 'center';
      for (const k of constellations) {
        const members = stars.filter((s) => s.constellation === k.id);
        if (members.length < 3) continue;
        const cx = members.reduce((a, s) => a + s.x, 0) / members.length; const cy = Math.min(...members.map((s) => s.y));
        const p = toScreen(cx, cy);
        const name = (k.name.length > 26 ? `${k.name.slice(0, 25)}…` : k.name).toUpperCase().split('').join(' ');
        c.fillText(name, p.x, p.y - 16);
      }
      c.textAlign = 'start';
    }
  }, [stars, lines, constellations, overlays, highlight, selectedId, showFigures, showGrid, showNames, size, view, byId, toScreen]);

  // ── the telescope ──
  const hit = (mx: number, my: number): Star | null => {
    let best: Star | null = null; let bestD = Infinity;
    for (const s of stars) {
      const p = toScreen(s.x, s.y); const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      const reach = Math.max(14, radiusFor(s.magnitude, view.s) + 6);
      if (d <= reach * reach && d < bestD) { best = s; bestD = d; }
    }
    return best;
  };
  const zoomAt = (mx: number, my: number, factor: number) => setView((v) => {
    const s = Math.max(0.6, Math.min(24, v.s * factor)); const k = s / v.s;
    return { s, tx: mx - (mx - v.tx - (size.w - span) / 2) * k - (size.w - span) / 2, ty: my - (my - v.ty - (size.h - span) / 2) * k - (size.h - span) / 2 };
  });
  const local = (e: { clientX: number; clientY: number }) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  useEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); };
    cv.addEventListener('wheel', onWheel, { passive: false });
    return () => cv.removeEventListener('wheel', onWheel);
  });

  const easeTo = useCallback((target: View) => {
    const from = view; const t0 = performance.now(); const dur = 450;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur); const e = 1 - (1 - k) ** 3;
      setView({ s: from.s + (target.s - from.s) * e, tx: from.tx + (target.tx - from.tx) * e, ty: from.ty + (target.ty - from.ty) * e });
      if (k < 1) requestAnimationFrame(step);
    };
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setView(target);
    else requestAnimationFrame(step);
  }, [view]);
  useImperativeHandle(ref, () => ({
    pointAt: (id: string) => {
      const s = byId.get(id); if (!s) return;
      const zoom = Math.max(view.s, 2.6);
      easeTo({ s: zoom, tx: size.w / 2 - ((size.w - span) / 2 + s.x * span * zoom), ty: size.h / 2 - ((size.h - span) / 2 + s.y * span * zoom) });
    },
    reset: () => easeTo({ s: 1, tx: 0, ty: 0 }),
  }), [byId, view.s, size, span, easeTo]);

  return (
    <div ref={wrap} className="relative h-full w-full" data-testid="sk-sky">
      <canvas
        ref={canvas}
        className="sk-canvas"
        role="img"
        aria-label={`Star chart: ${stars.length} stars in ${constellations.length} constellations. Drag to pan, scroll to zoom, arrow keys to move, Enter on the list to open a star.`}
        tabIndex={0}
        onKeyDown={(e) => {
          const step = 40;
          if (e.key === 'ArrowLeft') setView((v) => ({ ...v, tx: v.tx + step }));
          else if (e.key === 'ArrowRight') setView((v) => ({ ...v, tx: v.tx - step }));
          else if (e.key === 'ArrowUp') setView((v) => ({ ...v, ty: v.ty + step }));
          else if (e.key === 'ArrowDown') setView((v) => ({ ...v, ty: v.ty - step }));
          else if (e.key === '+' || e.key === '=') zoomAt(size.w / 2, size.h / 2, 1.25);
          else if (e.key === '-') zoomAt(size.w / 2, size.h / 2, 0.8);
          else if (e.key === 'Escape') onSelect(null);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
          pinch.current.set(e.pointerId, local(e));
          drag.current = { ...local(e), tx: view.tx, ty: view.ty, moved: false };
        }}
        onPointerMove={(e) => {
          const p = local(e);
          if (pinch.current.size === 2 && pinch.current.has(e.pointerId)) {
            const pts = [...pinch.current.values()]; const before = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            pinch.current.set(e.pointerId, p);
            const now = [...pinch.current.values()]; const after = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
            if (before > 0) zoomAt((now[0].x + now[1].x) / 2, (now[0].y + now[1].y) / 2, after / before);
            return;
          }
          if (drag.current) {
            const dx = p.x - drag.current.x; const dy = p.y - drag.current.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true;
            if (drag.current.moved) setView((v) => ({ ...v, tx: drag.current!.tx + dx, ty: drag.current!.ty + dy }));
            return;
          }
          const s = hit(p.x, p.y);
          setHover(s ? { star: s, x: p.x, y: p.y } : null);
        }}
        onPointerUp={(e) => {
          pinch.current.delete(e.pointerId);
          const d = drag.current; drag.current = null;
          if (d && !d.moved) { const p = local(e); onSelect(hit(p.x, p.y)?.id || null); }
        }}
        onPointerLeave={() => { setHover(null); }}
      />
      {hover && (
        <div className="sk-tip" style={{ left: hover.x, top: hover.y }}>
          <span className="sk-atlas italic">{hover.star.title}</span>
          <span className="sk-mono ml-2 text-[11px] text-[var(--sk-muted)]">m {hover.star.magnitude.toFixed(1)} · {hover.star.spectral} · {coords(hover.star.x, hover.star.y)}</span>
        </div>
      )}
    </div>
  );
});
