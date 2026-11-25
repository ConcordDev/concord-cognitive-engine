/**
 * How a drawing is put on paper — one implementation shared by the light
 * table, the exporter and the share page, so what you draw, what you export
 * and what people watch are the same strokes drawn the same way.
 */

export interface Stroke {
  tool: string; color: string; size: number; opacity: number; points: number[][];
  widths?: number[]; pressureSize?: number;
}
export interface FLayer {
  id: string; name: string; visible: boolean; opacity: number; strokes: Stroke[];
  type?: 'paintable' | 'reference'; isReference?: boolean; imageRef?: string;
}
export interface FrameSheet { action?: string; dialogue?: string; camera?: string }
export interface Frame { id: string; exposure: number; layers: FLayer[]; strokes?: Stroke[]; sheet?: FrameSheet }
export interface AudioTrack { id: string; name: string; url: string | null; mediaId?: string | null; src?: string | null; startSec: number; durationSec?: number | null; waveform?: number[] }
export interface Anim {
  id: string; title: string; width: number; height: number; fps: number; background: string;
  frames: Frame[]; audio?: AudioTrack[]; thumbnail?: string | null;
}

/** A frame's visible paintable strokes (tolerates legacy single-layer frames). */
export function visibleStrokes(frame: Frame | undefined): Stroke[] {
  if (!frame) return [];
  if (Array.isArray(frame.layers) && frame.layers.length) {
    return frame.layers.filter((l) => l.visible && l.type !== 'reference').flatMap((l) => l.strokes || []);
  }
  return frame.strokes || [];
}

/**
 * One stroke. `tint` redraws it in another colour (the onion skin's blue and
 * red pencil); `alpha` scales its own opacity. Variable-width strokes (from
 * pressure) are drawn segment by segment at their recorded widths.
 */
export function drawStroke(c: CanvasRenderingContext2D, st: Stroke, alpha = 1, tint?: string) {
  const pts = st.points;
  if (!pts?.length) return;
  c.save();
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = tint || st.color;
  c.fillStyle = tint || st.color;
  c.globalAlpha = Math.max(0, Math.min(1, (st.opacity ?? 1) * alpha));
  c.globalCompositeOperation = st.tool === 'eraser' && !tint ? 'destination-out' : 'source-over';
  if (st.tool === 'eraser' && tint) { c.restore(); return; } // erasers leave no ghost
  if (pts.length === 1) {
    c.beginPath();
    c.arc(pts[0][0], pts[0][1], Math.max(0.5, st.size / 2), 0, Math.PI * 2);
    c.fill();
  } else if (Array.isArray(st.widths) && st.widths.length === pts.length) {
    for (let i = 1; i < pts.length; i++) {
      c.lineWidth = Math.max(0.5, st.widths[i]);
      c.beginPath();
      c.moveTo(pts[i - 1][0], pts[i - 1][1]);
      c.lineTo(pts[i][0], pts[i][1]);
      c.stroke();
    }
  } else {
    c.lineWidth = st.size;
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      c.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    c.stroke();
  }
  c.restore();
}

/**
 * A whole drawing onto a canvas: paper colour, reference underlays (only when
 * asked: the light table shows them, an export does not), then each visible
 * layer at its own opacity. Erasers cut within their layer only.
 */
export function drawFrame(
  c: CanvasRenderingContext2D, frame: Frame | undefined, background: string,
  opts: { scale?: number; refImage?: (ref: string) => HTMLImageElement | null; withReference?: boolean } = {},
) {
  const { width, height } = c.canvas;
  const scale = opts.scale ?? 1;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'source-over';
  c.fillStyle = background || '#ffffff';
  c.fillRect(0, 0, width, height);
  c.restore();
  if (!frame) return;
  const layers = Array.isArray(frame.layers) && frame.layers.length ? frame.layers : [{ id: 'legacy', name: '', visible: true, opacity: 1, strokes: frame.strokes || [] } as FLayer];
  for (const l of layers) {
    if (!l.visible) continue;
    if (l.type === 'reference') {
      if (!opts.withReference || !l.imageRef || !opts.refImage) continue;
      const img = opts.refImage(l.imageRef);
      if (img && img.complete && img.naturalWidth > 0) {
        c.save(); c.globalAlpha = l.opacity; c.drawImage(img, 0, 0, width, height); c.restore();
      }
      continue;
    }
    if (!l.strokes?.length) continue;
    // Each layer on its own sheet so an eraser only cuts its own layer.
    const sheet = document.createElement('canvas');
    sheet.width = width; sheet.height = height;
    const sc = sheet.getContext('2d');
    if (!sc) continue;
    sc.scale(scale, scale);
    for (const st of l.strokes) drawStroke(sc, st, 1);
    c.save(); c.globalAlpha = l.opacity ?? 1; c.drawImage(sheet, 0, 0); c.restore();
  }
}

/** Film frames in order: drawing index for each frame (a drawing held N frames appears N times). */
export function filmSequence(frames: Frame[]): number[] {
  const seq: number[] = [];
  frames.forEach((f, i) => { const n = Math.max(1, Math.round(f.exposure || 1)); for (let k = 0; k < n; k++) seq.push(i); });
  return seq;
}
