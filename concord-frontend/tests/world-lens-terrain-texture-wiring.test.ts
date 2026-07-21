// Real ground textures for TerrainRenderer.tsx — source-pinning test.
// TerrainRenderer.tsx builds a real Three.js scene (chunked heightmap
// geometry, WebGLRenderer-bound materials) that jsdom can't meaningfully
// render, matching this repo's established exemption for World Lens
// components (see tests/world-lens-discharge-flash-wiring.test.ts's own
// header comment for the precedent). The pure logic (warmTerrainTextures /
// getTerrainTextureSync) has real behavioral coverage in
// tests/lib/terrain-textures.test.ts; this file source-pins that
// TerrainRenderer.tsx actually calls into it, rather than the wiring
// silently rotting unnoticed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/TerrainRenderer.tsx'),
  'utf8'
);

describe('TerrainRenderer.tsx — real ground texture wiring', () => {
  it('imports warmTerrainTextures and getTerrainTextureSync as static imports', () => {
    expect(src).toMatch(/import \{ warmTerrainTextures, getTerrainTextureSync \} from '@\/lib\/world-lens\/terrain-textures';/);
  });

  it('kicks off warming once per build, fire-and-forget (not awaited)', () => {
    expect(src).toMatch(/const terrainTexturesReady = warmTerrainTextures\(THREE\);/);
  });

  it('checks the synchronous cache when constructing each chunk material (best-effort, no blocking)', () => {
    expect(src).toMatch(/const zoneTex = getTerrainTextureSync\(zone\);/);
    expect(src).toMatch(/material\.map = zoneTex;/);
  });

  it('sets a real tiled repeat (not stretched 1x1) using a chunk-size-derived constant', () => {
    expect(src).toMatch(/const TERRAIN_TEXTURE_TILE_METERS = 4;/);
    expect(src).toMatch(/const TERRAIN_TEXTURE_REPEAT = CHUNK_SIZE \/ TERRAIN_TEXTURE_TILE_METERS;/);
    expect(src).toMatch(/zoneTex\.repeat\.set\(TERRAIN_TEXTURE_REPEAT, TERRAIN_TEXTURE_REPEAT\);/);
  });

  it('retroactively applies textures to already-built chunks once warming resolves', () => {
    const idx = src.indexOf('retroactive apply');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 1200);
    expect(block).toMatch(/terrainTexturesReady\.then\(\(\) => \{/);
    expect(block).toMatch(/if \(disposed\) return;/);
    expect(block).toMatch(/if \(!ud\?\.isTerrainChunk \|\| !ud\.zone\) continue;/);
    expect(block).toMatch(/if \(mat && !mat\.map\) \{/);
    expect(block).toMatch(/mat\.needsUpdate = true;/);
  });

  it('the retroactive sweep never overwrites a chunk that already has a map (idempotent, no redundant texture swap)', () => {
    const idx = src.indexOf('retroactive apply');
    const block = src.slice(idx, idx + 1200);
    // The `!mat.map` guard is what makes this idempotent — asserted above;
    // this test exists to make the intent explicit and catch a future
    // accidental removal of that guard specifically.
    expect(block).toMatch(/!mat\.map/);
  });

  it('vertexColors stays enabled — the real texture multiplies the existing AO/blend tint, it does not replace it', () => {
    expect(src).toMatch(/material\.vertexColors = true;/);
  });
});
