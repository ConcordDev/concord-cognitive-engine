/**
 * Happy-path mesh modules must not call spawnPrimitive().
 * Explicit F0 marker paths (fea-beam-to-world, Overlay Drop-marker) may.
 * Run: node --test server/tests/conkay-no-marker-happy-path.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('conkay no-marker happy path', () => {
  const happy = [
    'concord-frontend/lib/conkay/assembly-to-world.ts',
    'concord-frontend/lib/conkay/nlp-design-to-world.ts',
    'concord-frontend/lib/conkay/part-mesh-to-world.ts',
    'concord-frontend/lib/conkay/evo-glb-to-world.ts',
  ];

  for (const rel of happy) {
    it(`${rel} does not call spawnPrimitive (mesh cmds only)`, () => {
      const src = read(rel);
      // Honesty comments may mention spawn_primitive; call sites must not exist.
      assert.equal(/spawnPrimitive\s*\(/.test(src), false, `${rel} must not call spawnPrimitive()`);
      assert.match(src, /apply_mesh|applyMesh|load_glb|loadGlb|set_transform|setTransform/);
    });
  }

  it('Overlay executeMacro does not auto-spawn markers', () => {
    const src = read('concord-frontend/components/conkay/ConKayOverlay.tsx');
    assert.match(src, /No automatic spawn_primitive/);
    assert.match(src, /Drop marker in world \(F0 cube via spawn_primitive/);
    assert.match(src, /Build in world: free-text NLP → partMesh\/FEA → apply_mesh/);
    assert.match(src, /Unity apply_mesh\/set_transform/);
    assert.equal(src.includes('optional F0 marker when WebGL present'), false);
  });

  it('fea-beam-to-world remains explicit proxy-only path', () => {
    const src = read('concord-frontend/lib/conkay/fea-beam-to-world.ts');
    assert.match(src, /spawn_primitive/);
    assert.match(src, /spawn_primitive_proxy/);
  });
});
