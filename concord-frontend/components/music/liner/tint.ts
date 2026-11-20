/**
 * The page tint is the cover's measured average colour (a 16×16 downscale),
 * lifted toward mid-lightness so text on the wash stays readable. Without a
 * cover there is no tint: the page uses the neutral paper token.
 */

import { useEffect, useState } from 'react';

const cache = new Map<string, string>();
export const NEUTRAL_TINT = '190, 180, 165';

export function liftTint(r: number, g: number, b: number): string {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Pull very dark or very pale covers toward the middle so the wash is visible but calm.
  const target = Math.max(80, Math.min(190, lum));
  const k = lum > 0 ? target / lum : 1;
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `${c(r)}, ${c(g)}, ${c(b)}`;
}

export function useCoverTint(url: string | null | undefined): string {
  const [tint, setTint] = useState<string>(() => (url && cache.get(url)) || NEUTRAL_TINT);
  useEffect(() => {
    if (!url) { setTint(NEUTRAL_TINT); return; }
    const hit = cache.get(url);
    if (hit) { setTint(hit); return; }
    let cancelled = false;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16; canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 16, 16);
        const d = ctx.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
        if (!n) return;
        const t = liftTint(r / n, g / n, b / n);
        cache.set(url, t);
        if (!cancelled) setTint(t);
      } catch { /* a tainted or undecodable image keeps the neutral paper */ }
    };
    img.src = url;
    return () => { cancelled = true; };
  }, [url]);
  return tint;
}
