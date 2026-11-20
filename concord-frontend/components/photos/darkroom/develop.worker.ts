/// <reference lib="webworker" />
/**
 * The Darkroom's preview renderer. It holds the photo's preview (the server's
 * 2048px rendition, already EXIF-rotated, the same pixels the export starts
 * from) at two sizes: a small one for while a control is moving and a sharp
 * one for when it stops. Every render runs the shared pipeline
 * (lib/photos/develop.js, byte-identical to the server's), so the preview is
 * the export's own maths at a smaller size.
 */
import { develop, histogram, findHealSource, maskWeigher, normalizeEdit, outputSize, outputToSourceMatrix } from '@/lib/photos/develop';

type Proxy = { data: Uint8ClampedArray; width: number; height: number };
let fast: Proxy | null = null, sharp: Proxy | null = null, originalW = 1;

function scaleTo(bmp: ImageBitmap, edge: number): Proxy {
  const s = Math.min(1, edge / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, width: w, height: h };
}

self.onmessage = async (ev: MessageEvent) => {
  const m = ev.data;
  try {
    if (m.type === 'load') {
      const bmp = await createImageBitmap(m.blob as Blob);
      sharp = scaleTo(bmp, m.sharpEdge || 1600);
      fast = scaleTo(bmp, m.fastEdge || 720);
      originalW = Math.max(1, Number(m.originalWidth) || bmp.width);
      bmp.close();
      (self as unknown as Worker).postMessage({ type: 'loaded', key: m.key, width: sharp.width, height: sharp.height });
      return;
    }
    if (m.type === 'render') {
      const src = m.quality === 'fast' ? fast : sharp;
      if (!src) return;
      const t0 = performance.now();
      const out = develop(src, m.edit, { scale: src.width / originalW });
      const hist = histogram(out, out.width * out.height > 400_000 ? 2 : 1);
      const ms = Math.round(performance.now() - t0);
      (self as unknown as Worker).postMessage({ type: 'rendered', seq: m.seq, quality: m.quality, width: out.width, height: out.height, data: out.data, hist, ms }, [out.data.buffer]);
      return;
    }
    if (m.type === 'mask') {
      if (!fast) return;
      const e = normalizeEdit(m.edit);
      const mask = e.masks[m.index];
      if (!mask) return;
      const { width: W, height: H } = outputSize(fast.width, fast.height, e);
      const M = outputToSourceMatrix(fast.width, fast.height, e);
      const weigh = maskWeigher(mask, fast.width, fast.height);
      const a = new Uint8ClampedArray(W * H * 4);
      for (let y = 0, i = 0; y < H; y++) for (let x = 0; x < W; x++, i++) {
        const sx = (M[0] * x + M[1] * y + M[2] + 0.5) / fast.width, sy = (M[3] * x + M[4] * y + M[5] + 0.5) / fast.height;
        const w = weigh(sx, sy);
        a[i * 4] = 224; a[i * 4 + 1] = 71; a[i * 4 + 2] = 47; a[i * 4 + 3] = Math.round(w * 150);
      }
      (self as unknown as Worker).postMessage({ type: 'mask', seq: m.seq, width: W, height: H, data: a }, [a.buffer]);
      return;
    }
    if (m.type === 'heal-source') {
      if (!sharp) return;
      const r = findHealSource(sharp, m.spot);
      (self as unknown as Worker).postMessage({ type: 'heal-source', id: m.id, ...r });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', seq: m.seq, error: err instanceof Error ? err.message : String(err) });
  }
};
