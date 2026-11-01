/**
 * ConKay mates v2 — kinematic solve for B given A.
 * Honesty: NOT industrial solver / OCC.
 * Run: node --test tests/conkay-assembly-mates-v2.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ensureAssemblyTables,
  createAssembly,
  addPart,
  getPart,
  undoAssembly,
  redoAssembly,
  getAssemblyHistory,
  transformPart,
} from '../lib/conkay/assembly-store.js';
import { applyMate, solveMateTransform, MATE_TYPES, eulerToMatrix, matrixToEuler, solveAlignAxisRotation } from '../lib/conkay/assembly-mates.js';

function axisDir(rot, axis) {
  const R = eulerToMatrix(rot);
  const u = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
  const col = u[0] === 1 ? 0 : u[1] === 1 ? 1 : 2;
  return [R[0][col], R[1][col], R[2][col]];
}
function assertParallel(a, b, msg) {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(Math.abs(dot) > 1 - 1e-9, `${msg}: axis dirs not parallel (dot=${dot})`);
}

describe('conkay mates v2 kinematic solve', () => {
  it('exposes distance + align_axis', () => {
    assert.ok(MATE_TYPES.includes('distance'));
    assert.ok(MATE_TYPES.includes('align_axis'));
  });

  it('solveMateTransform distance places B at A + offset*axis', () => {
    const out = solveMateTransform({
      type: 'distance',
      axis: 'x',
      offset: 2.5,
      drive: 'b',
      aPos: { x: 1, y: 2, z: 3 },
      bPos: { x: 9, y: 9, z: 9 },
    });
    assert.equal(out.ok, true);
    assert.deepEqual(out.position, { x: 3.5, y: 2, z: 3 });
  });

  it('solveMateTransform offset only moves driven axis', () => {
    const out = solveMateTransform({
      type: 'offset',
      axis: 'y',
      offset: 1,
      drive: 'b',
      aPos: { x: 0, y: 1.2, z: 0 },
      bPos: { x: 3, y: 5, z: 7 },
    });
    assert.deepEqual(out.position, { x: 3, y: 2.2, z: 7 });
  });

  it('align_axis aligns orthogonals and SOLVES orientation onto the reference axis (Q44)', () => {
    const out = solveMateTransform({
      type: 'align_axis',
      axis: 'y',
      offset: 0.5,
      drive: 'b',
      aPos: { x: 1, y: 0, z: 2 },
      bPos: { x: 9, y: 9, z: 9 },
      aRot: { x: 0, y: 0, z: 0 },
      bRot: { x: 10, y: 20, z: 30 },
    });
    assert.deepEqual(out.position, { x: 1, y: 0.5, z: 2 });
    // The old stub zeroed x/z and kept y — instead the solved Y axis
    // must end up parallel to the reference's Y axis (identity here).
    assertParallel(axisDir(out.rotation, 'y'), [0, 1, 0], 'identity ref');
  });

  it('align_axis follows a rotated reference, preserves spin-only orientations, handles opposites', () => {
    // Reference rotated 90° about Z: its X axis points along world Y.
    // An unrotated driven part must be solved to a z≈90 rotation.
    const onto = solveAlignAxisRotation({ axis: 'x', refRot: { x: 0, y: 0, z: 90 }, drivenRot: { x: 0, y: 0, z: 0 } });
    assert.ok(Math.abs(onto.z - 90) < 1e-6 && Math.abs(onto.x) < 1e-6 && Math.abs(onto.y) < 1e-6, JSON.stringify(onto));
    // Spinning about the free axis doesn't move it: already aligned → unchanged.
    const spin = solveAlignAxisRotation({ axis: 'z', refRot: { x: 0, y: 0, z: 0 }, drivenRot: { x: 0, y: 0, z: 90 } });
    assert.deepEqual(spin, { x: 0, y: 0, z: 90 });
    // Opposite axes (driven flipped 180° about X, aligning -Y to +Y) still solve.
    const opp = solveAlignAxisRotation({ axis: 'y', refRot: { x: 0, y: 0, z: 0 }, drivenRot: { x: 180, y: 0, z: 0 } });
    assertParallel(axisDir(opp, 'y'), [0, 1, 0], 'opposite');
    // Arbitrary pair, every axis: solved direction matches the reference's.
    for (const axis of ['x', 'y', 'z']) {
      const refRot = { x: 25, y: -40, z: 130 };
      const solved = solveAlignAxisRotation({ axis, refRot, drivenRot: { x: -70, y: 15, z: 55 } });
      assertParallel(axisDir(solved, axis), axisDir(refRot, axis), `axis ${axis}`);
    }
  });

  // Independent of the module's own eulerToMatrix: Unity's Quaternion.Euler(x,y,z) is qY * qX * qZ (Z applied
  // first), and a rotated direction is q * v * q^-1. The stored triples are posted unchanged as Unity
  // eulerAngles (lib/conkay/unity-bridge.ts set_transform), so this is the renderer's frame. The earlier
  // Rz·Ry·Rx solve passed the self-referential tests above yet rendered 11-85° off here.
  const qAxis = (ax, deg) => { const h = deg * Math.PI / 360, s = Math.sin(h); return { w: Math.cos(h), x: ax[0] * s, y: ax[1] * s, z: ax[2] * s }; };
  const qMul = (a, b) => ({
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  });
  const unityEuler = (r) => qMul(qMul(qAxis([0, 1, 0], r.y), qAxis([1, 0, 0], r.x)), qAxis([0, 0, 1], r.z));
  const unityRotate = (r, v) => {
    const q = unityEuler(r);
    const p = qMul(qMul(q, { w: 0, x: v[0], y: v[1], z: v[2] }), { w: q.w, x: -q.x, y: -q.y, z: -q.z });
    return [p.x, p.y, p.z];
  };
  const UNIT = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

  it('eulerToMatrix is Unity\'s Euler order (matches an independent quaternion implementation)', () => {
    for (const rot of [{ x: 25, y: -40, z: 130 }, { x: -70, y: 15, z: 55 }, { x: 90, y: 30, z: -20 }, { x: 10, y: 170, z: 3 }]) {
      for (const ax of ['x', 'y', 'z']) {
        const got = axisDir(rot, ax);
        const want = unityRotate(rot, UNIT[ax]);
        for (let i = 0; i < 3; i++) assert.ok(Math.abs(got[i] - want[i]) < 1e-9, `${JSON.stringify(rot)} ${ax}[${i}] ${got[i]} vs ${want[i]}`);
      }
    }
    // Known Unity facts: Euler(0,90,0) sends forward (0,0,1) to right (1,0,0); Euler(90,0,0) sends forward to down;
    // Euler(0,0,90) sends right to up.
    const near = (a, b) => a.every((n, i) => Math.abs(n - b[i]) < 1e-9);
    assert.ok(near(unityRotate({ x: 0, y: 90, z: 0 }, [0, 0, 1]), [1, 0, 0]));
    assert.ok(near(unityRotate({ x: 90, y: 0, z: 0 }, [0, 0, 1]), [0, -1, 0]));
    assert.ok(near(unityRotate({ x: 0, y: 0, z: 90 }, [1, 0, 0]), [0, 1, 0]));
    assert.ok(near(axisDir({ x: 0, y: 90, z: 0 }, 'z'), [1, 0, 0]));
  });

  it('align_axis result is parallel to the reference in the RENDERER frame (independent Unity check), across pairs and axes', () => {
    const pairs = [
      [{ x: 25, y: -40, z: 130 }, { x: -70, y: 15, z: 55 }],
      [{ x: 0, y: 0, z: 90 }, { x: 33, y: 0, z: 0 }],
      [{ x: -120, y: 60, z: 10 }, { x: 80, y: -75, z: 160 }],
      [{ x: 15, y: 200, z: -35 }, { x: 0, y: 0, z: 0 }],
    ];
    for (const [refRot, drivenRot] of pairs) {
      for (const axis of ['x', 'y', 'z']) {
        const solved = solveAlignAxisRotation({ axis, refRot, drivenRot });
        const a = unityRotate(solved, UNIT[axis]);
        const b = unityRotate(refRot, UNIT[axis]);
        const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        assert.ok(dot > 1 - 1e-6, `axis ${axis} ref ${JSON.stringify(refRot)} driven ${JSON.stringify(drivenRot)}: renderer-frame dot=${dot}`);
      }
    }
  });

  it('matrixToEuler round-trips in the Unity order, including gimbal (x = ±90°)', () => {
    for (const rot of [{ x: 20, y: 40, z: 60 }, { x: -50, y: 170, z: -100 }, { x: 90, y: 25, z: 0 }, { x: -90, y: -60, z: 0 }]) {
      const back = matrixToEuler(eulerToMatrix(rot));
      const a = unityRotate(back, [0.3, -0.5, 0.8]);
      const b = unityRotate(rot, [0.3, -0.5, 0.8]);
      for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-6, `${JSON.stringify(rot)} -> ${JSON.stringify(back)}`);
    }
  });

  it('applyMate drive=b moves B not A', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'mates-v2' });
    const a = addPart(db, asm.id, {
      name: 'A',
      kind: 'box',
      transform: { position: { x: 0, y: 1, z: 0 } },
      mesh: { positions: [0, 0, 0], indices: [0, 0, 0] },
    });
    const b = addPart(db, asm.id, {
      name: 'B',
      kind: 'box',
      transform: { position: { x: 5, y: 5, z: 5 } },
      mesh: { positions: [0, 0, 0], indices: [0, 0, 0] },
    });
    const out = applyMate(db, asm.id, {
      type: 'distance',
      aPartId: a.part.id,
      bPartId: b.part.id,
      axis: 'x',
      offset: 2,
      drive: 'b',
    });
    assert.equal(out.ok, true);
    assert.equal(out.drivenPartId, b.part.id);
    const a2 = getPart(db, asm.id, a.part.id);
    const b2 = getPart(db, asm.id, b.part.id);
    assert.deepEqual(a2.transform.position, { x: 0, y: 1, z: 0 });
    assert.deepEqual(b2.transform.position, { x: 2, y: 1, z: 0 });
  });
});

describe('conkay assembly undo/redo history', () => {
  it('undo restores prior parts+transforms; redo restores forward', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'hist' });
    const a = addPart(db, asm.id, {
      name: 'p1',
      kind: 'box',
      transform: { position: { x: 0, y: 0, z: 0 } },
      mesh: { positions: [0, 0, 0], indices: [0, 0, 0] },
    });
    transformPart(db, asm.id, a.part.id, { position: { x: 3, y: 0, z: 0 } });
    const mid = getPart(db, asm.id, a.part.id);
    assert.equal(mid.transform.position.x, 3);
    const hist = getAssemblyHistory(db, asm.id);
    assert.equal(hist.ok, true);
    assert.ok(hist.canUndo);
    const u = undoAssembly(db, asm.id);
    assert.equal(u.ok, true);
    const afterUndo = getPart(db, asm.id, a.part.id);
    assert.equal(afterUndo.transform.position.x, 0);
    const r = redoAssembly(db, asm.id);
    assert.equal(r.ok, true);
    const afterRedo = getPart(db, asm.id, a.part.id);
    assert.equal(afterRedo.transform.position.x, 3);
  });
});
