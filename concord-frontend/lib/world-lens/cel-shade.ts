// concord-frontend/lib/world-lens/cel-shade.ts
//
// I1 — cel-shade + ink-outline for crowd-avatar primitives. Buildings already
// use a toon gradient; avatars were flat MeshStandardMaterial. This converts an
// avatar group's meshes to MeshToonMaterial (banded lighting) sharing one
// stepped gradient ramp, and adds a back-side inverted-hull black outline so
// the crowd reads as illustrated rather than plasticky.
//
// The ramp byte computation is pure + unit-tested; the THREE wiring is thin.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Stepped grayscale ramp bytes for the toon gradient DataTexture. `steps`
 * hard bands (e.g. 3 → shadow / mid / light). Pure + testable. Returns a
 * Uint8Array of length `width` where each entry is quantised to one of `steps`
 * levels across 0..255.
 */
export function toonRampBytes(steps = 3, width = 256): Uint8Array {
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

let _gradientCache: any = null;

/** Build (and cache) the stepped gradient DataTexture for MeshToonMaterial. */
export function getToonGradientTexture(THREE: any, steps = 3): any {
  if (_gradientCache) return _gradientCache;
  const bytes = toonRampBytes(steps);
  const tex = new THREE.DataTexture(bytes, bytes.length, 1, THREE.RedFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  _gradientCache = tex;
  return tex;
}

/** Test-only — drop the cached gradient. */
export function _resetCelShadeCache() { _gradientCache = null; }

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

/**
 * Cel-shade an avatar group in place: swap each mesh's material to
 * MeshToonMaterial sharing the stepped gradient, and add an inverted-hull
 * black outline child. Idempotent — tagged meshes are skipped on re-run.
 */
export function applyCelShade(group: any, THREE: any, opts: { outlineScale?: number; outlineColor?: number } = {}): void {
  if (!group || !THREE) return;
  const outlineScale = opts.outlineScale ?? 1.06;
  const outlineColor = opts.outlineColor ?? 0x111018;
  const gradient = getToonGradientTexture(THREE);

  const meshes: any[] = [];
  group.traverse((obj: any) => {
    if (obj?.isMesh && !obj.userData?.__celOutline && !obj.userData?.__celShaded) meshes.push(obj);
  });

  for (const mesh of meshes) {
    // 1) Swap to toon material, preserving color/emissive.
    const src = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (src && !src.isMeshToonMaterial) {
      const p = toonParamsFromStandard(src);
      const toon = new THREE.MeshToonMaterial({
        color: p.color ? p.color.clone() : new THREE.Color(0xffffff),
        gradientMap: gradient,
        emissive: p.emissive ? p.emissive.clone() : new THREE.Color(0x000000),
        emissiveIntensity: p.emissiveIntensity,
      });
      mesh.material = toon;
      try { src.dispose?.(); } catch { /* ok */ }
    }
    mesh.userData.__celShaded = true;

    // 2) Inverted-hull outline: same geometry, back faces, scaled out slightly.
    if (mesh.geometry) {
      const outlineMat = new THREE.MeshBasicMaterial({ color: outlineColor, side: THREE.BackSide });
      const outline = new THREE.Mesh(mesh.geometry, outlineMat);
      outline.scale.setScalar(outlineScale);
      outline.userData.__celOutline = true;
      outline.castShadow = false;
      outline.receiveShadow = false;
      mesh.add(outline); // child → inherits the mesh transform
    }
  }
}
