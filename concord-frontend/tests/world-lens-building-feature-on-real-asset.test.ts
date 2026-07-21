// UGC-rendering-fidelity audit (2026-07-21) — BuildingRenderer3D.tsx is a
// Three.js/DOM-heavy component (its building-mesh construction runs inside
// an async effect closure, not a standalone exported function), so this is
// a source-pinning regression test per this repo's established pattern
// (see tests/world-lens-ranged-combat-wiring.test.ts's own header comment).
//
// Finding: a player-authored building (game-design.building-publish) only
// ever chooses an archetype (5 values) + an optional iconic `feature`
// (dome/spire/colonnade/belfry, 4 values) + a bounding box — no material or
// structural choice. When a real sourced GLB exists for the chosen
// archetype (public/models/building/{tavern,archive,market}.glb), the
// real-asset-first branch loaded it and rescaled it to the DTU's declared
// dimensions, but NEVER read `feature` at all — every building of the same
// archetype rendered as the exact same mesh regardless of what landmark the
// player actually chose. The procedural fallback path already read
// `feature` correctly via addIconicFeature(); this wires the same call into
// the real-asset branch too, deriving its `scale` param from the GLB's own
// measured height (size.y / 8, since addIconicFeature's geometry AND
// roofline position both assume an ~8-unit-tall base building at scale=1 —
// passing a fixed scale=1 would size the feature for an 8-unit building
// while positioning it on the real GLB's own roofline, producing a
// toy-sized dome on a much taller real building). Verified numerically
// against the real tavern.glb (scratch script, not committed): with
// scale=size.y/8, the feature's roofTop (8*scale) landed at Y=1.63 against
// the GLB's own measured roofline of Y=1.55 — a ~5%-of-height gap, not a
// floating/buried mesh.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/BuildingRenderer3D.tsx'),
  'utf8',
);

describe('BuildingRenderer3D.tsx — iconic feature composited onto real-asset buildings', () => {
  it('hoists feature + factionVisual above the real-asset branch so both branches share one computation', () => {
    const realAssetIdx = src.indexOf('Real-asset-first: try a real GLB');
    const featureDeclIdx = src.indexOf('const feature = ');
    expect(featureDeclIdx).toBeGreaterThan(-1);
    expect(realAssetIdx).toBeGreaterThan(-1);
    expect(featureDeclIdx).toBeLessThan(realAssetIdx);
  });

  it('composites addIconicFeature onto the loaded real GLB when the DTU has a feature, after measuring its bounding box but before the group-wide rescale', () => {
    const sizeIdx = src.indexOf('const size = box.getSize(new THREE.Vector3());');
    expect(sizeIdx).toBeGreaterThan(-1);
    const scaleSetIdx = src.indexOf('cloned.scale.set(dtu.dimensions.width / size.x');
    expect(scaleSetIdx).toBeGreaterThan(sizeIdx);
    const block = src.slice(sizeIdx, scaleSetIdx);
    expect(block).toMatch(/if \(feature && size\.y > 0\) \{/);
    expect(block).toMatch(/const \{ addIconicFeature \} = await import\('@\/lib\/world-lens\/procedural-buildings'\);/);
  });

  it('derives the feature scale from the real GLB\'s own measured height (size.y / 8), not a fixed scale — so the feature\'s own geometry proportions match the building instead of assuming the procedural archetypes\' fixed 8-unit base height', () => {
    const idx = src.indexOf('addIconicFeature(THREE, cloned, feature,');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(idx, idx + 80)).toMatch(/addIconicFeature\(THREE, cloned, feature, size\.y \/ 8, roofMat, trimMat\);/);
  });

  it('builds roofMat/trimMat from the same faction-visual colors the procedural path uses, falling back to a neutral stone/trim palette', () => {
    const idx = src.indexOf('const roofMat = new THREE.MeshStandardMaterial({');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    expect(block).toMatch(/factionVisual\?\.secondary_color \?\? '#8a7a68'/);
    expect(block).toMatch(/factionVisual\?\.accent_color \?\? '#5c5044'/);
  });

  it('never lets a feature-compositing failure block the real asset from rendering — wrapped in its own try/catch, separate from the outer real-asset lookup catch', () => {
    const idx = src.indexOf('if (feature && size.y > 0) {');
    const block = src.slice(idx, idx + 800);
    expect(block).toMatch(/\} catch \(featErr\) \{/);
    expect(block).toMatch(/console\.warn\('\[BuildingRenderer3D\] iconic-feature compositing failed, real asset still renders', featErr\);/);
  });
});
