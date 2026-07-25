// concord-frontend/lib/world-lens/cel-shade.ts
//
// I1 — cel-shade + ink-outline. Originally written for crowd-avatar primitives
// only; as of 2026-07-25 this is the SHARED cel-shade path the art direction
// (docs/ART_STYLE_GUIDE.md) requires every asset class to run through —
// avatars, buildings, and any prop renderer that opts in — so outline weight
// and ramp-band count cannot drift per-component.
//
// Two long-standing divergences from the locked guide are fixed here; both are
// recorded in docs/ART_DIRECTION_AUDIT.md §3.4:
//
//  1. OUTLINE WIDTH WAS NOT A WIDTH. `ART_STYLE.OUTLINE_WIDTH_M` is documented
//     in METRES, but was consumed as a unitless uniform hull scale
//     (`outline.scale.setScalar(1 + OUTLINE_WIDTH_M * 3)`), which makes outline
//     thickness PROPORTIONAL TO MESH SIZE — a 2 m avatar got ~5 cm of ink and a
//     20 m building would have got ~50 cm. That is exactly the per-asset drift
//     the "one outline thickness for everything" rule exists to prevent,
//     produced by the code citing the rule. `outlineHullScale()` below now
//     solves for the per-axis local scale that grows the hull by a CONSTANT
//     world-space metre amount, given the mesh's accumulated world scale.
//
//  2. THE RAMP WAS ALWAYS GRAYSCALE. `toonRampBytes` builds a stepped GRAY
//     ramp, so a world's authored `toonGradient` (the guide's per-world palette
//     knob) could never reach a cel-shaded pixel. `toonGradientTextureFromPalette`
//     builds a real RGB ramp from a theme's 3-stop gradient, sampled at exactly
//     `ART_STYLE.RAMP_BANDS` steps.
//
// The ramp/scale computations are pure + unit-tested; the THREE wiring is thin.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { ART_STYLE } from './concordia-theme';

/**
 * Stepped grayscale ramp bytes for the toon gradient DataTexture. `steps`
 * hard bands (e.g. 3 → shadow / mid / light). Pure + testable. Returns a
 * Uint8Array of length `width` where each entry is quantised to one of `steps`
 * levels across 0..255.
 */
export function toonRampBytes(steps = ART_STYLE.RAMP_BANDS, width = 256): Uint8Array {
  const out = new Uint8Array(width);
  const s = Math.max(2, Math.floor(steps));
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);            // 0..1
    const band = Math.floor(t * s);        // 0..s-1 (s only at t===1)
    const level = Math.min(s - 1, band) / (s - 1); // 0..1 quantised
    out[i] = Math.round(level * 255);
  }
  return out;
}

/** Parse '#rrggbb' → [r, g, b] bytes. Tolerates a missing '#'. */
export function hexToRgbBytes(hex: string): [number, number, number] {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * RGBA bytes for a COLOURED toon ramp built from a theme's 3-stop
 * `toonGradient` [shadow, mid, highlight], sampled at `steps` hard bands.
 *
 * Pure + testable. Length is `steps * 4`. When `steps` differs from the palette
 * length the palette is sampled by nearest-band so the guide's single
 * `RAMP_BANDS` number stays authoritative regardless of palette length.
 */
export function toonPaletteRampBytes(
  palette: readonly string[],
  steps = ART_STYLE.RAMP_BANDS,
): Uint8Array {
  const s = Math.max(2, Math.floor(steps));
  const stops = (palette && palette.length ? palette : ['#000000', '#808080', '#ffffff'])
    .map(hexToRgbBytes);
  const out = new Uint8Array(s * 4);
  for (let i = 0; i < s; i++) {
    // Nearest-band sample of the palette across the ramp.
    const t = s === 1 ? 0 : i / (s - 1);
    const idx = Math.min(stops.length - 1, Math.round(t * (stops.length - 1)));
    out[i * 4]     = stops[idx][0];
    out[i * 4 + 1] = stops[idx][1];
    out[i * 4 + 2] = stops[idx][2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * The ink-outline colour the guide specifies: the palette's SHADOW band scaled
 * by `ART_STYLE.OUTLINE_DARKEN`. Returns a 0xRRGGBB number.
 *
 * This is what makes OUTLINE_DARKEN load-bearing — before 2026-07-25 the
 * constant had ZERO consumers outside its own definition, and every outline was
 * a hardcoded near-black (0x111018) regardless of world palette.
 */
export function outlineColorFromPalette(
  palette: readonly string[] | undefined,
  darken = ART_STYLE.OUTLINE_DARKEN,
): number {
  const shadow = palette && palette.length ? palette[0] : '#111018';
  const [r, g, b] = hexToRgbBytes(shadow);
  const k = Math.max(0, Math.min(1, darken));
  const q = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

/**
 * Per-axis local scale for an inverted-hull outline that is `widthM` metres
 * thick in WORLD space, independent of how big the mesh is.
 *
 * `size` is the mesh geometry's local bounding-box size; `worldScale` is the
 * accumulated scale from the scene root down to (and including) the mesh. The
 * outline is a CHILD of the mesh, so its local scale `s` yields a world size of
 * `size * worldScale * s`; solving `size*ws*s == size*ws + 2*widthM` gives the
 * factor below. Degenerate (zero-extent) axes — planes, billboards — are left
 * at 1 rather than exploding to Infinity, and the whole thing is clamped so a
 * sub-centimetre mesh can't produce a hull that swallows the scene.
 *
 * Pure + testable.
 */
export function outlineHullScale(
  size: { x: number; y: number; z: number },
  widthM: number,
  worldScale: { x: number; y: number; z: number } = { x: 1, y: 1, z: 1 },
  maxScale = 2,
): { x: number; y: number; z: number } {
  const axis = (extent: number, ws: number) => {
    const world = Math.abs(extent) * Math.abs(ws);
    if (!Number.isFinite(world) || world < 1e-6) return 1;
    return Math.min(maxScale, 1 + (2 * widthM) / world);
  };
  return {
    x: axis(size.x, worldScale.x),
    y: axis(size.y, worldScale.y),
    z: axis(size.z, worldScale.z),
  };
}

const _gradientCache = new Map<string, any>();

/** Build (and cache) the stepped GRAYSCALE gradient DataTexture. */
export function getToonGradientTexture(THREE: any, steps = ART_STYLE.RAMP_BANDS): any {
  // Cache keyed by `steps` — the previous single-slot cache silently ignored
  // the argument after the first call, so a second caller asking for a
  // different band count got the first caller's ramp.
  const key = `gray:${steps}`;
  const hit = _gradientCache.get(key);
  if (hit) return hit;
  const bytes = toonRampBytes(steps);
  const tex = new THREE.DataTexture(bytes, bytes.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // Shared + cached across every cel-shaded material — see __celShared below.
  tex.userData = { ...(tex.userData || {}), __celShared: true };
  _gradientCache.set(key, tex);
  return tex;
}

/**
 * Build (and cache) a COLOURED gradient DataTexture from a theme's 3-stop
 * `toonGradient`. This is the texture that carries a world's palette into
 * cel-shaded pixels.
 */
export function toonGradientTextureFromPalette(
  THREE: any,
  palette: readonly string[],
  steps = ART_STYLE.RAMP_BANDS,
): any {
  const key = `rgb:${steps}:${(palette || []).join(',')}`;
  const hit = _gradientCache.get(key);
  if (hit) return hit;
  const bytes = toonPaletteRampBytes(palette, steps);
  const s = bytes.length / 4;
  // MeshToonMaterial samples the gradient map along U; a 1-wide × N-tall
  // texture is the shape three's own toon example uses.
  const tex = new THREE.DataTexture(bytes, 1, s);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  // These textures are CACHED and shared by every material that asks for the
  // same palette + band count. A renderer's teardown that walks materials and
  // disposes `.gradientMap` would therefore destroy a texture still owned by
  // the cache, and the next mount would get a disposed handle back. Consumers
  // must skip disposing anything carrying this flag.
  tex.userData = { ...(tex.userData || {}), __celShared: true };
  _gradientCache.set(key, tex);
  return tex;
}

/** Test-only — drop the cached gradients. */
export function _resetCelShadeCache() { _gradientCache.clear(); }

/**
 * Convert one MeshStandardMaterial-ish material's params into the toon
 * equivalent (preserving color + emissive). Pure mapping for testability.
 */
export function toonParamsFromStandard(mat: any): { color: any; emissive: any; emissiveIntensity: number } {
  return {
    color: mat?.color,
    emissive: mat?.emissive,
    emissiveIntensity: typeof mat?.emissiveIntensity === 'number' ? mat.emissiveIntensity : 0,
  };
}

export interface CelShadeOptions {
  /**
   * Ink thickness in METRES of world space. Defaults to the one global
   * `ART_STYLE.OUTLINE_WIDTH_M`. Callers should not pass this — it exists so a
   * test can vary it.
   */
  outlineWidthM?: number;
  /**
   * The world's 3-stop `toonGradient`. When supplied the ramp is COLOURED from
   * it and the outline colour derives from its shadow band × `OUTLINE_DARKEN`.
   * Omitted → legacy grayscale ramp + the historical near-black ink, so
   * existing callers are byte-identical apart from the outline-width fix.
   */
  palette?: readonly string[];
  /** Explicit ink colour override (wins over `palette`). */
  outlineColor?: number;
  /**
   * ESCAPE HATCH, deliberately narrow: skip the outline entirely for this
   * group. Used by nothing today; kept so a future translucent/particle asset
   * can opt out without inventing a second outline implementation.
   */
  noOutline?: boolean;
}

/**
 * Cel-shade a group in place: swap each mesh's material to MeshToonMaterial
 * sharing the stepped gradient, and add an inverted-hull outline child whose
 * thickness is a constant world-space metre value. Idempotent — tagged meshes
 * are skipped on re-run.
 *
 * IMPORTANT: call this AFTER the group's final scale is set. The outline width
 * is solved against the accumulated scale from `group` down to each mesh, so a
 * `group.scale.set(...)` applied afterwards would re-introduce exactly the
 * size-proportional ink this function exists to remove.
 */
export function applyCelShade(group: any, THREE: any, opts: CelShadeOptions = {}): void {
  if (!group || !THREE) return;
  const widthM = opts.outlineWidthM ?? ART_STYLE.OUTLINE_WIDTH_M;
  const outlineColor = opts.outlineColor
    ?? (opts.palette ? outlineColorFromPalette(opts.palette) : 0x111018);
  const gradient = opts.palette
    ? toonGradientTextureFromPalette(THREE, opts.palette)
    : getToonGradientTexture(THREE);

  // Collect meshes together with the scale accumulated from `group` down to
  // them (inclusive of the root's own scale) so the outline can be solved in
  // world metres rather than in each mesh's arbitrary local units.
  const meshes: { mesh: any; worldScale: { x: number; y: number; z: number } }[] = [];
  const walk = (obj: any, acc: { x: number; y: number; z: number }) => {
    if (!obj) return;
    const s = obj.scale ?? { x: 1, y: 1, z: 1 };
    const next = { x: acc.x * (s.x ?? 1), y: acc.y * (s.y ?? 1), z: acc.z * (s.z ?? 1) };
    if (obj.isMesh && !obj.userData?.__celOutline && !obj.userData?.__celShaded) {
      meshes.push({ mesh: obj, worldScale: next });
    }
    for (const child of (obj.children || [])) walk(child, next);
  };
  walk(group, { x: 1, y: 1, z: 1 });

  for (const { mesh, worldScale } of meshes) {
    // 1) Swap to toon material, preserving color/emissive.
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (src && !src.isMeshToonMaterial) {
      const p = toonParamsFromStandard(src);
      const toon = new THREE.MeshToonMaterial({
        color: p.color ? p.color.clone() : new THREE.Color(0xffffff),
        gradientMap: gradient,
        emissive: p.emissive ? p.emissive.clone() : new THREE.Color(0x000000),
        emissiveIntensity: p.emissiveIntensity,
        // Carry the source albedo map through — dropping it turned every
        // procedurally-textured surface into a flat colour.
        map: src.map ?? null,
        transparent: !!src.transparent,
        opacity: typeof src.opacity === 'number' ? src.opacity : 1,
      });
      mesh.material = toon;
      try { src.dispose?.(); } catch { /* ok */ }
    }
    mesh.userData.__celShaded = true;

    // 2) Inverted-hull outline: same geometry, back faces, grown by a fixed
    //    number of world METRES (not a proportional scalar — see header).
    if (mesh.geometry && !opts.noOutline) {
      // InstancedMesh hulls would need per-instance matrices copied; skip them
      // rather than draw a single mis-placed outline at the origin.
      if (mesh.isInstancedMesh) continue;
      if (!mesh.geometry.boundingBox) {
        try { mesh.geometry.computeBoundingBox?.(); } catch { /* ok */ }
      }
      const bb = mesh.geometry.boundingBox;
      const size = bb
        ? { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z }
        : { x: 1, y: 1, z: 1 };
      const s = outlineHullScale(size, widthM, worldScale);
      const outlineMat = new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide });
      const outline = new THREE.Mesh(mesh.geometry, outlineMat);
      outline.scale.set(s.x, s.y, s.z);
      outline.userData.__celOutline = true;
      outline.castShadow = false;
      outline.receiveShadow = false;
      mesh.add(outline); // child → inherits the mesh transform
    }
  }
}
