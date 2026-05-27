/**
 * Procedural PBR texture generator.
 *
 * Canvas-based synthesis of albedo / normal / roughness / AO maps for
 * 8 material kinds: stone, wood, brick, cloth, metal, leather, thatch,
 * dirt. Each kind has a distinct procedural signature so the result
 * reads as "stylized PBR" — far better than flat-colour Lambert, not
 * AAA photoreal.
 *
 * Authored CC0 textures dropped into public/textures/<kind>/ override
 * the procedural output via the pbr-loader unified API.
 *
 * Performance: textures are cached per (kind, seed, size); 512×512
 * default, drops to 256 on low quality.
 */

import type * as THREE_NS from 'three';

export type ProceduralKind =
  | 'stone'
  | 'wood'
  | 'brick'
  | 'cloth'
  | 'metal'
  | 'leather'
  | 'thatch'
  | 'dirt';

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
      ctx.fillStyle = '#3a2520';
      ctx.fillRect(0, 0, size, size);
      const bw = 64, bh = 28;
      for (let y = 0; y < size; y += bh) {
        const row = Math.floor(y / bh);
        const xOff = row % 2 === 0 ? 0 : -bw / 2;
        for (let x = xOff; x < size; x += bw) {
          const shade = 110 + Math.floor(rng() * 40);
          const tint = Math.floor(rng() * 25);
          ctx.fillStyle = `rgb(${shade}, ${shade - 30 - tint}, ${shade - 50 - tint})`;
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
      ctx.fillStyle = '#6b5230';
      ctx.fillRect(0, 0, size, size);
      // Pebble flecks
      for (let i = 0; i < 1200; i++) {
        const x = rng() * size, y = rng() * size;
        const r = 1 + rng() * 3;
        const v = Math.floor(rng() * 50);
        ctx.fillStyle = `rgba(${60 + v}, ${50 + v}, ${30 + v / 2}, ${0.3 + rng() * 0.4})`;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
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
  if (hit) return hit;

  const albedoCanvas    = makeAlbedoCanvas(kind, seed, size);
  const intensity = { stone: 3.5, wood: 2.5, brick: 4.5, cloth: 1.5,
                       metal: 1.0, leather: 2.5, thatch: 3.5, dirt: 2.0 }[kind];
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
  return set;
}

/** Clear the cache (call after quality-preset change). */
export function clearProceduralCache(): void {
  for (const set of cache.values()) {
    try { set.albedo.dispose(); } catch { /* idempotent */ }
    try { set.normal.dispose(); } catch { /* idempotent */ }
    try { set.roughness.dispose(); } catch { /* idempotent */ }
    try { set.ao.dispose(); } catch { /* idempotent */ }
  }
  cache.clear();
}

export const _testing = { cache, makeRng };
