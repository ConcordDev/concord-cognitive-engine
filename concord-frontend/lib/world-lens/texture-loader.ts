/**
 * KTX2 / Basis-aware texture loader (Track 2 — rendering perf).
 *
 * Standalone textures (the PBR loader's authored / CC0 / lens-DTU channels)
 * went straight through THREE.TextureLoader — fine for PNG/JPG, but it can't
 * decode the GPU-compressed KTX2/Basis format that keeps VRAM + bandwidth
 * honest on mobile. This routes `.ktx2` URLs through a lazily-built KTX2Loader
 * (transcoder at /basis/, mirroring the /draco/ convention in asset-loader) and
 * everything else through TextureLoader, applying mipmaps + anisotropy + repeat
 * wrap uniformly. Graceful: if the transcoder binaries aren't shipped or no
 * renderer was registered, KTX2 decode fails and the caller's per-channel
 * fallback still fires — exactly today's behaviour for the (current) PNG/JPG
 * assets, so nothing regresses before any .ktx2 asset exists.
 */

import type * as THREE_NS from 'three';

/** Transcoder asset path — drop basis_transcoder.{js,wasm} here to enable KTX2. */
export function basisTranscoderPath(): string {
  return '/basis/';
}

/** Pure: does this URL point at a KTX2/Basis-compressed texture? */
export function isKtx2Url(url: string): boolean {
  if (!url) return false;
  const clean = url.split('?')[0].split('#')[0];
  return /\.ktx2$/i.test(clean);
}

/**
 * Pure: apply the standard sampling defaults to a freshly-loaded texture
 * (repeat wrap, mipmaps, max anisotropy). Tolerant of partial fakes for tests.
 */
export function applyTextureDefaults(
  THREE: typeof THREE_NS,
  tex: { wrapS?: unknown; wrapT?: unknown; generateMipmaps?: boolean; anisotropy?: number; minFilter?: unknown; needsUpdate?: boolean },
  maxAnisotropy = 8,
): void {
  try {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    // KTX2 textures arrive with their own (possibly absent) mip chain; only ask
    // the runtime to generate mips for uncompressed textures.
    if (tex.generateMipmaps !== false) tex.generateMipmaps = true;
    if (typeof tex.anisotropy === 'number') tex.anisotropy = Math.max(1, maxAnisotropy);
    tex.needsUpdate = true;
  } catch { /* defaults are best-effort */ }
}

// A renderer is required for KTX2Loader.detectSupport(). ConcordiaScene
// registers its WebGLRenderer once on scene init so we don't have to thread it
// through every texture call site.
let _renderer: unknown | null = null;
let _ktx2Loader: { load: (...a: unknown[]) => void } | null = null;
let _ktx2Tried = false;

/** Called once by ConcordiaScene with its WebGLRenderer to enable KTX2 decode. */
export function registerRendererForKtx2(renderer: unknown): void {
  _renderer = renderer;
  // A new renderer invalidates a previously-built loader's support detection.
  _ktx2Loader = null;
  _ktx2Tried = false;
}

/**
 * Returns the shared KTX2Loader (built lazily from the registered renderer) so
 * the GLTF loader can decode KTX2-textured GLBs. Null when unavailable. Exported
 * for asset-loader; mirrors the Draco attach.
 */
export async function getKtx2LoaderForGltf(THREE: typeof THREE_NS): Promise<unknown | null> {
  return getKtx2Loader(THREE);
}

async function getKtx2Loader(THREE: typeof THREE_NS): Promise<{ load: (...a: unknown[]) => void } | null> {
  if (_ktx2Loader) return _ktx2Loader;
  if (_ktx2Tried || !_renderer) return null;
  _ktx2Tried = true;
  try {
    const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
    const loader = new KTX2Loader();
    (loader as { setTranscoderPath: (p: string) => unknown }).setTranscoderPath(basisTranscoderPath());
    (loader as { detectSupport: (r: unknown) => unknown }).detectSupport(_renderer);
    _ktx2Loader = loader as unknown as { load: (...a: unknown[]) => void };
    void THREE;
    return _ktx2Loader;
  } catch {
    return null; // transcoder/addon unavailable → caller falls back
  }
}

/**
 * Load a texture, routing `.ktx2` through KTX2Loader when available and
 * everything else through TextureLoader. Returns null on failure so the caller's
 * per-channel fallback fires. `maxAnisotropy` lets the caller pass the
 * renderer's capability when it has it.
 */
export async function loadTexture(
  THREE: typeof THREE_NS,
  url: string,
  opts: { maxAnisotropy?: number } = {},
): Promise<THREE_NS.Texture | null> {
  const ax = opts.maxAnisotropy ?? 8;
  if (isKtx2Url(url)) {
    const k = await getKtx2Loader(THREE);
    if (k) {
      const tex = await new Promise<THREE_NS.Texture | null>((resolve) => {
        try {
          k.load(url, (t: unknown) => resolve(t as THREE_NS.Texture), undefined, () => resolve(null));
        } catch { resolve(null); }
      });
      if (tex) { applyTextureDefaults(THREE, tex as never, ax); return tex; }
      // KTX2 decode failed — fall through to the standard loader (in case the
      // server also serves a transcoded-on-the-fly raster at the same URL).
    }
  }
  return new Promise<THREE_NS.Texture | null>((resolve) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => { applyTextureDefaults(THREE, tex as never, ax); resolve(tex); },
      undefined,
      () => resolve(null),
    );
  });
}

export const _testing = {
  reset() { _renderer = null; _ktx2Loader = null; _ktx2Tried = false; },
  get hasRenderer() { return _renderer !== null; },
};
