/**
 * Orthographic drawing projection unit test (no HTTP).
 * Run: node --test server/tests/conkay-assembly-drawing.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  projectMeshView,
  viewsToSvg,
  exportPartDrawing,
  buildOverallDimensions,
  resolveGdtSymbol,
} from '../lib/conkay/assembly-drawing.js';
import { partCentroid, assemblyCom } from '../lib/conkay/assembly-explode.js';

describe('conkay assembly drawing', () => {
  const positions = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
  const indices = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 0, 3, 7, 0, 7, 4, 1, 2, 6, 1, 6, 5,
  ];

  it('projects front/top/side with segments', () => {
    for (const view of ['front', 'top', 'side']) {
      const v = projectMeshView(positions, indices, view);
      assert.ok(v.edgeCount > 0);
      assert.ok(v.segments.length > 0);
      assert.equal(v.view, view);
    }
  });

  it('viewsToSvg emits FRONT/TOP/SIDE and overall dims', () => {
    const views = ['front', 'top', 'side'].map((v) => projectMeshView(positions, indices, v));
    const svg = viewsToSvg(views);
    assert.match(svg, /<svg/);
    assert.match(svg, /FRONT/);
    assert.match(svg, /TOP/);
    assert.match(svg, /SIDE/);
    assert.match(svg, /class="dim"/);
    assert.match(svg, /polygon/);
  });

  it('exportPartDrawing returns svg + views with dimensions', () => {
    const part = {
      id: 'p1',
      name: 'box',
      mesh: { positions, indices },
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    };
    const out = exportPartDrawing(part);
    assert.equal(out.ok, true);
    assert.equal(out.views.length, 3);
    assert.match(out.svg, /<svg/);
    assert.ok(out.views[0].dimensions.length >= 2);
  });

  it('buildOverallDimensions produces x+y', () => {
    const dims = buildOverallDimensions({ minU: 0, minV: 0, maxU: 2, maxV: 3 }, 'front');
    assert.equal(dims.length, 2);
    assert.equal(dims[0].value, 2);
    assert.equal(dims[1].value, 3);
  });

  it('resolveGdtSymbol maps keys', () => {
    assert.equal(resolveGdtSymbol('perpendicular'), '⊥');
    assert.equal(resolveGdtSymbol('∥'), '∥');
  });

  it('partCentroid and assemblyCom', () => {
    const a = {
      transform: { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      mesh: { positions: [0, 0, 0, 2, 0, 0, 0, 2, 0] },
    };
    const b = {
      transform: { position: { x: 10, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      mesh: { positions: [0, 0, 0, 2, 0, 0, 0, 2, 0] },
    };
    const ca = partCentroid(a);
    assert.ok(Math.abs(ca.x - 2 / 3) < 1e-9);
    const com = assemblyCom([a, b]);
    assert.ok(com.x > 0);
  });
});
