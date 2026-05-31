// Track 2 — KTX2/Basis texture loading. Pins the pure helpers the PBR + GLTF
// loaders now route through: KTX2 url detection, the transcoder path, the
// uniform sampling defaults, and that .ktx2 with no renderer registered falls
// back through TextureLoader (today's behaviour — no regression before any
// .ktx2 asset exists).
//
// Run: npx vitest run tests/texture-loader.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { isKtx2Url, basisTranscoderPath, applyTextureDefaults, loadTexture, _testing } from '../lib/world-lens/texture-loader';

const RepeatWrapping = 1000;
// Minimal THREE stand-in: a TextureLoader that succeeds for any url + the
// wrap constant. No WebGL.
function makeFakeThree(succeed = true) {
  return {
    RepeatWrapping,
    TextureLoader: class {
      load(url: string, onLoad: (t: unknown) => void, _p: unknown, onErr: () => void) {
        if (succeed) onLoad({ wrapS: 0, wrapT: 0, anisotropy: 1, needsUpdate: false, url });
        else onErr();
      }
    },
  } as never;
}

describe('isKtx2Url', () => {
  it('detects .ktx2 (with query/hash) and rejects raster', () => {
    expect(isKtx2Url('/textures/stone/color.ktx2')).toBe(true);
    expect(isKtx2Url('/t/color.KTX2?v=3')).toBe(true);
    expect(isKtx2Url('/t/color.png')).toBe(false);
    expect(isKtx2Url('')).toBe(false);
  });
});

describe('basisTranscoderPath', () => {
  it('mirrors the /draco/ convention', () => {
    expect(basisTranscoderPath()).toBe('/basis/');
  });
});

describe('applyTextureDefaults', () => {
  it('sets repeat wrap + mipmaps + anisotropy', () => {
    const THREE = makeFakeThree();
    const tex: Record<string, unknown> = { anisotropy: 1 };
    applyTextureDefaults(THREE, tex as never, 16);
    expect(tex.wrapS).toBe(RepeatWrapping);
    expect(tex.wrapT).toBe(RepeatWrapping);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.anisotropy).toBe(16);
    expect(tex.needsUpdate).toBe(true);
  });

  it('respects an explicit generateMipmaps=false (compressed mip chain)', () => {
    const tex: Record<string, unknown> = { generateMipmaps: false };
    applyTextureDefaults(makeFakeThree(), tex as never);
    expect(tex.generateMipmaps).toBe(false);
  });
});

describe('loadTexture', () => {
  beforeEach(() => _testing.reset());

  it('loads a raster through TextureLoader with defaults applied', async () => {
    const tex = await loadTexture(makeFakeThree(true), '/t/color.png') as Record<string, unknown> | null;
    expect(tex).not.toBeNull();
    expect(tex!.wrapS).toBe(RepeatWrapping);
  });

  it('falls back to TextureLoader for .ktx2 when no renderer is registered', async () => {
    expect(_testing.hasRenderer).toBe(false);
    // No renderer → KTX2 path skipped, raster loader still resolves the url.
    const tex = await loadTexture(makeFakeThree(true), '/t/color.ktx2');
    expect(tex).not.toBeNull();
  });

  it('resolves null when the underlying loader errors', async () => {
    const tex = await loadTexture(makeFakeThree(false), '/t/missing.png');
    expect(tex).toBeNull();
  });
});
