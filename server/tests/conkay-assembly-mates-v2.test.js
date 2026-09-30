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
import { applyMate, solveMateTransform, MATE_TYPES } from '../lib/conkay/assembly-mates.js';

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

  it('align_axis clears twist rotations and aligns orthogonals', () => {
    const out = solveMateTransform({
      type: 'align_axis',
      axis: 'y',
      offset: 0.5,
      drive: 'b',
      aPos: { x: 1, y: 0, z: 2 },
      bPos: { x: 9, y: 9, z: 9 },
      bRot: { x: 10, y: 20, z: 30 },
    });
    assert.deepEqual(out.position, { x: 1, y: 0.5, z: 2 });
    assert.deepEqual(out.rotation, { x: 0, y: 20, z: 0 });
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
