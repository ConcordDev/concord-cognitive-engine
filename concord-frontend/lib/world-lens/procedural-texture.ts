/**
 * Procedural PBR texture generator — SUBSTRATE FALLBACK (tier 3).
 *
 * This is the always-available floor under Concord's procedural-hand-
 * authored content engine. Player-produced texture DTUs from the `art`
 * lens (tier 1) and CC0 packs in public/textures/ (tier 2) override
 * the canvas synthesis here per-channel via the unified pbr-loader.
 *
 * Canvas-based synthesis of albedo / normal / roughness / AO maps for
 * 13 material kinds: stone, wood, brick, cloth, metal, leather, thatch,
 * dirt, grass, sand, cobblestone, gravel, asphalt. Each kind has a
 * distinct procedural signature so the result reads as "stylized PBR" —
 * far better than flat-colour Lambert, not AAA photoreal. Marketplace
 * canon votes + LLaVA aesthetic validation are how the engine converges
 * on better-than-this; this module is the catalog floor that never has
 * to be authored.
 *
 * 2026-07-21 — 7 of the 13 kinds (dirt, brick, grass, sand, cobblestone,
 * gravel, asphalt) are grounded in real photographed color data
 * (terrain-reference-palettes.ts, sampled from the CC-BY-4.0 terrain
 * textures at public/models/terrain/*.jpg — see CREDITS.md) instead of
 * hand-picked hex constants: `paletteFor()` returns each kind's real
 * average/shadow/highlight tones, and the pattern generators below mix
 * between them per-pixel. The (kind, seed) space was already infinite;
 * this just anchors every combination's base colors to something a
 * camera actually saw, rather than an eyeballed guess. Kinds with no
 * terrain photo counterpart (stone, wood, cloth, metal, leather, thatch)
 * keep their original hardcoded palette unchanged.
 *
 * Performance: textures are cached per (kind, seed, size); 512×512
 * default, drops to 256 on low quality.
 *
 * See: lib/world-lens/pbr-loader.ts for the tier resolution order.
 */

import type * as THREE_NS from 'three';
import { TERRAIN_REFERENCE_PALETTES, type ReferencePalette } from './terrain-reference-palettes';

export type ProceduralKind =
  | 'stone'
  | 'wood'
  | 'brick'
  | 'cloth'
  | 'metal'
  | 'leather'
  | 'thatch'
  | 'dirt'
  | 'grass'
  | 'sand'
  | 'cobblestone'
  | 'gravel'
  | 'asphalt';

/** Real-photo palette for kinds that have one; undefined for the 6
 *  original kinds with no terrain-photo counterpart. */
function paletteFor(kind: ProceduralKind): ReferencePalette | undefined {
  return TERRAIN_REFERENCE_PALETTES[kind];
}

function rgbStr([r, g, b]: readonly [number, number, number], a = 1): string {
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Linearly interpolate between two real-photo tones (0 = dark, 1 = light). */
function lerpTone(pal: ReferencePalette, t: number): [number, number, number] {
  const c = t < 0.5
    ? [pal.dark, pal.avg, t * 2] as const
    : [pal.avg, pal.light, (t - 0.5) * 2] as const;
  const [a, b, f] = c;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export interface PBRTextureSet {
  albedo:    THREE_NS.Texture;
  normal:    THREE_NS.Texture;
  roughness: THREE_NS.Texture;
  ao:        THREE_NS.Texture;
}

export interface ProceduralOptions {
  kind:   ProceduralKind;
  seed?:  number;
  size?:  number;
}

const cache = new Map<string, PBRTextureSet>();

/**
 * Safety-net LRU cap (runtime-health-capability-map.md #5, follow-up).
 * The primary fix for the unbounded-leak finding is disposing this cache on
 * world unmount (see ConcordiaScene.tsx); this cap is a cheap belt-and-
 * braces bound for a very long single session that never leaves the world
 * lens. `Map` preserves insertion order, so a get-then-reinsert on hit
 * ("touch") plus evicting the oldest entry on overflow gives a standard
 * LRU without a separate linked-list structure. Each entry is 4 CanvasTexture
 * objects (default 512x512 RGBA canvases, ~1MB each) — 300 entries bounds
 * the cache at roughly the texture memory of a few hundred concurrently
 * visible buildings' worth of wall/roof materials, well above what any
 * single district renders at once.
 */
const MAX_CACHE_ENTRIES = 300;

function disposeSet(set: PBRTextureSet): void {
  try { set.albedo.dispose(); } catch { /* idempotent */ }
  try { set.normal.dispose(); } catch { /* idempotent */ }
  try { set.roughness.dispose(); } catch { /* idempotent */ }
  try { set.ao.dispose(); } catch { /* idempotent */ }
}

/** Deterministic 32-bit hash → [0, 1). */
function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

function makeCanvas(size: number): HTMLCanvasElement {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    return c;
  }
  // SSR / test fallback
  return { width: size, height: size, getContext: () => null } as unknown as HTMLCanvasElement;
}

function makeAlbedoCanvas(kind: ProceduralKind, seed: number, size: number): HTMLCanvasElement {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const rng = makeRng(seed);

  switch (kind) {
    case 'stone': {
      ctx.fillStyle = '#7a7b78';
      ctx.fillRect(0, 0, size, size);
      // Voronoi-like cell speckle
      for (let i = 0; i < 800; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 1.5 + rng() * 5;
        const g = 80 + Math.floor(rng() * 70);
        ctx.fillStyle = `rgba(${g}, ${g}, ${g - 5}, 0.6)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // Dark crack lines
      ctx.strokeStyle = 'rgba(40, 40, 38, 0.5)';
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        let x = rng() * size, y = rng() * size;
        ctx.moveTo(x, y);
        for (let k = 0; k < 12; k++) {
          x += (rng() - 0.5) * 30;
          y += (rng() - 0.5) * 30;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      break;
    }
    case 'wood': {
      // Wood grain — long stripes along U
      for (let y = 0; y < size; y++) {
        const noise = Math.sin(y * 0.04 + rng() * 0.1) * 12;
        const shade = 75 + noise + (rng() - 0.5) * 8;
        ctx.fillStyle = `rgb(${Math.floor(110 + shade * 0.4)}, ${Math.floor(78 + shade * 0.3)}, ${Math.floor(48 + shade * 0.2)})`;
        ctx.fillRect(0, y, size, 1);
      }
      // Knots
      for (let i = 0; i < 3; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 6 + rng() * 10;
        const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(50, 30, 12, 0.85)');
        grad.addColorStop(0.6, 'rgba(70, 45, 22, 0.55)');
        grad.addColorStop(1, 'rgba(70, 45, 22, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'brick': {
      // Real-photo-grounded (Material-Brick.jpg, a genuine ground-level
      // running-bond surface — see terrain-reference-palettes.ts). Mortar
      // fill uses the dark tone; each brick's shade is picked between the
      // photo's avg and light tones so the row pattern reads as real
      // fired-clay variation, not a single flat hue.
      const pal = paletteFor('brick');
      ctx.fillStyle = pal ? rgbStr(pal.dark) : '#3a2520';
      ctx.fillRect(0, 0, size, size);
      const bw = 64, bh = 28;
      for (let y = 0; y < size; y += bh) {
        const row = Math.floor(y / bh);
        const xOff = row % 2 === 0 ? 0 : -bw / 2;
        for (let x = xOff; x < size; x += bw) {
          if (pal) {
            ctx.fillStyle = rgbStr(lerpTone(pal, 0.45 + rng() * 0.45));
          } else {
            const shade = 110 + Math.floor(rng() * 40);
            const tint = Math.floor(rng() * 25);
            ctx.fillStyle = `rgb(${shade}, ${shade - 30 - tint}, ${shade - 50 - tint})`;
          }
          ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4);
        }
      }
      break;
    }
    case 'cloth': {
      // Linen / cotton weave
      ctx.fillStyle = '#c9c2b3';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(80, 70, 55, 0.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i < size; i += 4) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
      }
      // Slight colour modulation
      for (let i = 0; i < 200; i++) {
        const x = rng() * size, y = rng() * size;
        ctx.fillStyle = `rgba(${130 + Math.floor(rng() * 30)}, ${120 + Math.floor(rng() * 30)}, ${110 + Math.floor(rng() * 25)}, 0.4)`;
        ctx.fillRect(x, y, 2, 2);
      }
      break;
    }
    case 'metal': {
      ctx.fillStyle = '#8b8e94';
      ctx.fillRect(0, 0, size, size);
      // Brushed lines
      ctx.strokeStyle = 'rgba(60, 65, 72, 0.25)';
      ctx.lineWidth = 1;
      for (let y = 0; y < size; y += 2) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + (rng() - 0.5) * 4);
        ctx.stroke();
      }
      // Speckle scratches
      for (let i = 0; i < 80; i++) {
        const x = rng() * size, y = rng() * size;
        const dx = (rng() - 0.5) * 20, dy = (rng() - 0.5) * 10;
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.05 + rng() * 0.1})`;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
      }
      break;
    }
    case 'leather': {
      ctx.fillStyle = '#5a3a26';
      ctx.fillRect(0, 0, size, size);
      // Crinkle pattern via overlapping radial cells
      for (let i = 0; i < 600; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 3 + rng() * 6;
        const dark = Math.floor(rng() * 25);
        ctx.fillStyle = `rgba(${70 - dark}, ${50 - dark}, ${30 - dark}, 0.4)`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'thatch': {
      ctx.fillStyle = '#7d6235';
      ctx.fillRect(0, 0, size, size);
      // Strands of straw
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 600; i++) {
        const x = rng() * size, y = rng() * size;
        const len = 8 + rng() * 30;
        const angle = (rng() - 0.5) * 0.6;
        const shade = 100 + Math.floor(rng() * 50);
        ctx.strokeStyle = `rgba(${shade}, ${shade - 20}, ${shade - 60}, 0.7)`;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
      }
      break;
    }
    case 'dirt': {
      // Real-photo-grounded (Material-Mud.jpg — a cracked, weathered dirt
      // surface). Base fill uses the real average tone; the pebble flecks
      // below mix toward the real dark/light extremes instead of an
      // arbitrary `+v` brightening.
      const pal = paletteFor('dirt');
      ctx.fillStyle = pal ? rgbStr(pal.avg) : '#6b5230';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1200; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 1 + rng() * 3;
        const alpha = 0.3 + rng() * 0.4;
        if (pal) {
          ctx.fillStyle = rgbStr(lerpTone(pal, rng()), alpha);
        } else {
          const v = Math.floor(rng() * 50);
          ctx.fillStyle = `rgba(${60 + v}, ${50 + v}, ${30 + v / 2}, ${alpha})`;
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'grass': {
      // Real-photo-grounded (Material-Grass.jpg). Base fill at the real
      // average green; thousands of short blade-like strokes mix between
      // the real dark (soil showing through) and light (sunlit tip) tones
      // — reads as individual grass blades, not a flat green wash.
      const pal = paletteFor('grass')!;
      ctx.fillStyle = rgbStr(pal.avg);
      ctx.fillRect(0, 0, size, size);
      ctx.lineWidth = 1;
      for (let i = 0; i < 2200; i++) {
        const x = rng() * size, y = rng() * size;
        const len = 2 + rng() * 5;
        const angle = -Math.PI / 2 + (rng() - 0.5) * 0.9; // mostly upright blades
        ctx.strokeStyle = rgbStr(lerpTone(pal, rng()), 0.7);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
        ctx.stroke();
      }
      // Occasional bare-earth patches (the real photo shows some).
      for (let i = 0; i < 15; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 3 + rng() * 8;
        ctx.fillStyle = rgbStr(lerpTone(pal, 0.15 + rng() * 0.15), 0.5);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'sand': {
      // Real-photo-grounded (Material-Sand.jpg — wind-rippled dune sand).
      // Fine grain speckle plus a few broad low-frequency ripple bands
      // (sinusoidal lightness modulation) to echo the photo's dune shadows.
      const pal = paletteFor('sand')!;
      for (let y = 0; y < size; y++) {
        const ripple = Math.sin(y * 0.025 + rng() * 0.05) * 0.5 + 0.5; // 0..1
        ctx.fillStyle = rgbStr(lerpTone(pal, 0.4 + ripple * 0.35));
        ctx.fillRect(0, y, size, 1);
      }
      for (let i = 0; i < 2500; i++) {
        const x = rng() * size, y = rng() * size;
        ctx.fillStyle = rgbStr(lerpTone(pal, rng()), 0.25);
        ctx.fillRect(x, y, 1, 1);
      }
      break;
    }
    case 'cobblestone': {
      // Real-photo-grounded (Material-Cobblestone.jpg — irregular stone
      // paving). Distinct from 'stone' (small speckle): larger polygon-ish
      // cells with dark mortar/grout seams between them, matching the
      // photo's individually-shaped paving stones.
      const pal = paletteFor('cobblestone')!;
      ctx.fillStyle = rgbStr(pal.dark);
      ctx.fillRect(0, 0, size, size); // grout base shows through the seams
      const cellSize = size / 7;
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 7; gx++) {
          const jitterX = (rng() - 0.5) * cellSize * 0.3;
          const jitterY = (rng() - 0.5) * cellSize * 0.3;
          const cx = gx * cellSize + cellSize / 2 + jitterX;
          const cy = gy * cellSize + cellSize / 2 + jitterY;
          const r = cellSize * (0.38 + rng() * 0.12);
          ctx.fillStyle = rgbStr(lerpTone(pal, 0.45 + rng() * 0.5));
          ctx.beginPath();
          const sides = 5 + Math.floor(rng() * 3);
          for (let s = 0; s <= sides; s++) {
            const a = (s / sides) * Math.PI * 2;
            const rr = r * (0.85 + rng() * 0.3);
            const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
            if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
      }
      break;
    }
    case 'gravel': {
      // Real-photo-grounded (Material-Ground.jpg — pebbly rocky-dirt
      // aggregate; the closest real match available, see CREDITS.md).
      // Dense small irregular pebble scatter, finer and more numerous than
      // cobblestone's larger paving cells.
      const pal = paletteFor('gravel')!;
      ctx.fillStyle = rgbStr(lerpTone(pal, 0.3));
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1800; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 1.5 + rng() * 4;
        ctx.fillStyle = rgbStr(lerpTone(pal, rng()), 0.55 + rng() * 0.3);
        ctx.beginPath();
        const sides = 4 + Math.floor(rng() * 3);
        for (let s = 0; s <= sides; s++) {
          const a = (s / sides) * Math.PI * 2;
          const rr = r * (0.7 + rng() * 0.6);
          const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
          if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'asphalt': {
      // Real-photo-grounded (Material-Asphalt.jpg — fine stippled tarmac,
      // slightly blue-cast in the source photo, kept faithfully rather
      // than color-corrected). Mostly flat with a very fine dense stipple —
      // no large-scale pattern, matching the photo's uniform bumpy texture.
      const pal = paletteFor('asphalt')!;
      ctx.fillStyle = rgbStr(pal.avg);
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 4000; i++) {
        const x = rng() * size, y = rng() * size;
        ctx.fillStyle = rgbStr(lerpTone(pal, rng()), 0.2 + rng() * 0.2);
        ctx.fillRect(x, y, 1, 1);
      }
      break;
    }
  }
  return canvas;
}

function makeNormalCanvas(albedo: HTMLCanvasElement, intensity: number): HTMLCanvasElement {
  const size = albedo.width;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const srcCtx = albedo.getContext('2d');
  if (!ctx || !srcCtx) return canvas;
  // Build a height map from albedo luminance, then derive normals via
  // central-differences. Output as RGB tangent-space normal.
  let img: ImageData;
  try {
    img = srcCtx.getImageData(0, 0, size, size);
  } catch {
    return canvas;
  }
  const data = img.data;
  const heights = new Float32Array(size * size);
  for (let i = 0, h = 0; i < data.length; i += 4, h++) {
    heights[h] = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
  }
  const out = ctx.createImageData(size, size);
  const outData = out.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const l = heights[i - 1] ?? heights[i];
      const r = heights[i + 1] ?? heights[i];
      const u = heights[i - size] ?? heights[i];
      const d = heights[i + size] ?? heights[i];
      const dx = (l - r) * intensity;
      const dy = (u - d) * intensity;
      const nx = dx, ny = dy, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      outData[i * 4]     = Math.floor((nx / len * 0.5 + 0.5) * 255);
      outData[i * 4 + 1] = Math.floor((ny / len * 0.5 + 0.5) * 255);
      outData[i * 4 + 2] = Math.floor((nz / len * 0.5 + 0.5) * 255);
      outData[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

function makeRoughnessCanvas(kind: ProceduralKind, size: number, seed: number): HTMLCanvasElement {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const baseRoughness = {
    stone: 0.85, wood: 0.78, brick: 0.92, cloth: 0.95,
    metal: 0.25, leather: 0.55, thatch: 0.95, dirt: 0.95,
    grass: 0.9, sand: 0.85, cobblestone: 0.88, gravel: 0.9, asphalt: 0.82,
  }[kind];
  const rng = makeRng(seed);
  const base = Math.floor(baseRoughness * 255);
  ctx.fillStyle = `rgb(${base}, ${base}, ${base})`;
  ctx.fillRect(0, 0, size, size);
  // Modulation
  for (let i = 0; i < 400; i++) {
    const x = rng() * size, y = rng() * size;
    const r = 3 + rng() * 10;
    const off = (rng() - 0.5) * 60;
    const v = Math.max(0, Math.min(255, base + off));
    ctx.fillStyle = `rgba(${v}, ${v}, ${v}, 0.4)`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return canvas;
}

function makeAOCanvas(albedo: HTMLCanvasElement): HTMLCanvasElement {
  const size = albedo.width;
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const srcCtx = albedo.getContext('2d');
  if (!ctx || !srcCtx) return canvas;
  // AO = local-occlusion approximation via blurred luminance inverse.
  let img: ImageData;
  try { img = srcCtx.getImageData(0, 0, size, size); } catch { return canvas; }
  const data = img.data;
  const lumi = new Float32Array(size * size);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    lumi[p] = (data[i] + data[i + 1] + data[i + 2]) / (3 * 255);
  }
  // 3-tap blur to smooth AO
  const out = ctx.createImageData(size, size);
  const outData = out.data;
  const radius = 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0; let count = 0;
      for (let oy = -radius; oy <= radius; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= size) continue;
        for (let ox = -radius; ox <= radius; ox++) {
          const xx = x + ox;
          if (xx < 0 || xx >= size) continue;
          sum += lumi[yy * size + xx];
          count++;
        }
      }
      const avg = sum / count;
      // Darker pixels = more occluded
      const aoVal = Math.floor((0.6 + avg * 0.4) * 255);
      const i = (y * size + x) * 4;
      outData[i] = outData[i + 1] = outData[i + 2] = aoVal;
      outData[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * Generate a procedural PBR texture set. Cached per (kind, seed, size).
 */
export function makePBR(
  THREE: typeof THREE_NS,
  opts: ProceduralOptions,
): PBRTextureSet {
  const kind = opts.kind;
  const seed = opts.seed ?? 0x1357;
  const size = opts.size ?? 512;
  const cacheKey = `${kind}::${seed}::${size}`;
  const hit = cache.get(cacheKey);
  if (hit) {
    // Touch: move to the MRU (most-recently-used) end so LRU eviction
    // below evicts genuinely cold entries first.
    cache.delete(cacheKey);
    cache.set(cacheKey, hit);
    return hit;
  }

  const albedoCanvas    = makeAlbedoCanvas(kind, seed, size);
  const intensity = { stone: 3.5, wood: 2.5, brick: 4.5, cloth: 1.5,
                       metal: 1.0, leather: 2.5, thatch: 3.5, dirt: 2.0,
                       grass: 2.0, sand: 1.0, cobblestone: 4.0, gravel: 3.0, asphalt: 1.0 }[kind];
  const normalCanvas    = makeNormalCanvas(albedoCanvas, intensity);
  const roughnessCanvas = makeRoughnessCanvas(kind, size, seed);
  const aoCanvas        = makeAOCanvas(albedoCanvas);

  const albedo    = new THREE.CanvasTexture(albedoCanvas);    albedo.needsUpdate = true;
  const normal    = new THREE.CanvasTexture(normalCanvas);    normal.needsUpdate = true;
  const roughness = new THREE.CanvasTexture(roughnessCanvas); roughness.needsUpdate = true;
  const ao        = new THREE.CanvasTexture(aoCanvas);        ao.needsUpdate = true;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  ao.wrapS = ao.wrapT = THREE.RepeatWrapping;

  const set: PBRTextureSet = { albedo, normal, roughness, ao };
  cache.set(cacheKey, set);

  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      const oldest = cache.get(oldestKey);
      if (oldest) disposeSet(oldest);
      cache.delete(oldestKey);
    }
  }

  return set;
}

/** Clear the cache (call after quality-preset change, or on world unmount). */
export function clearProceduralCache(): void {
  for (const set of cache.values()) disposeSet(set);
  cache.clear();
}

export const _testing = { cache, makeRng };
