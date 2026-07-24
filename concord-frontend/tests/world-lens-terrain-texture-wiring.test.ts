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

describe('TerrainRenderer.tsx — real ground texture, source-text pin (behavior for warmTerrainTextures/getTerrainTextureSync lives in tests/lib/terrain-textures.test.ts; this file only pins that TerrainRenderer.tsx\'s source reaches into that already-tested logic — see file header for why)', () => {
  it('the source statically imports warmTerrainTextures and getTerrainTextureSync (source-text pin)', () => {
    expect(src).toMatch(/import \{ warmTerrainTextures, getTerrainTextureSync \} from '@\/lib\/world-lens\/terrain-textures';/);
  });

  it('the source starts texture warming once per build without awaiting the promise (source-text pin, not proof of async timing)', () => {
    expect(src).toMatch(/const terrainTexturesReady = warmTerrainTextures\(THREE\);/);
  });

  it('the source reads the synchronous texture cache and assigns it onto the chunk material (source-text pin, not proof of a non-blocking read at runtime)', () => {
    expect(src).toMatch(/const zoneTex = getTerrainTextureSync\(zone\);/);
    expect(src).toMatch(/material\.map = zoneTex;/);
  });

  it('the source computes a tiled repeat from a chunk-size-derived constant, not a stretched 1x1 (source-text pin)', () => {
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

  it('the source keeps vertexColors enabled after assigning the texture map — the texture multiplies the existing AO/blend tint instead of replacing it (source-text pin)', () => {
    expect(src).toMatch(/material\.vertexColors = true;/);
  });
});
