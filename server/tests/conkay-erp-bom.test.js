/**
 * ConKay ERP-shaped BOM — part numbers, mass/volume stubs, CSV.
 * Honesty: NOT SAP/Oracle.
 * Run: node --test tests/conkay-erp-bom.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  ensureAssemblyTables,
  createAssembly,
  addPart,
  defaultTransform,
} from '../lib/conkay/assembly-store.js';
import { attachMaterialToPart } from '../lib/conkay/material-library.js';
import { buildErpBom, erpBomToCsv } from '../lib/conkay/erp-bom.js';

function boxMesh() {
  // unit cube
  const positions = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0,
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    2, 6, 7, 2, 7, 3,
    0, 3, 7, 0, 7, 4,
    1, 5, 6, 1, 6, 2,
  ];
  return {
    positions,
    indices,
    kind: 'box',
    vertexCount: 8,
    triangleCount: 12,
  };
}

describe('conkay ERP-shaped BOM', () => {
  it('buildErpBom adds partNumber/revision/mass/vendor/rollup', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'erp-bom-test' });
    const a = addPart(db, asm.id, {
      name: 'plate-a',
      kind: 'box',
      source: 'test',
      transform: defaultTransform(),
      mesh: boxMesh(),
      material: 'steel',
      meta: { intent: { width: 1, depth: 1, height: 1, material: 'steel' } },
    });
    assert.equal(a.ok, true);
    attachMaterialToPart(db, asm.id, a.part.id, 'steel');

    const bom = buildErpBom(db, asm.id);
    assert.equal(bom.ok, true);
    assert.equal(bom.schema, 'conkay.erp-bom.v1');
    assert.equal(bom.totalParts, 1);
    assert.equal(bom.lines.length, 1);
    const line = bom.lines[0];
    assert.match(line.partNumber, /^CK-/);
    assert.equal(line.revision, 'A');
    assert.equal(line.qty, 1);
    assert.equal(line.material, 'steel');
    assert.ok(line.massKg != null && line.massKg > 0);
    assert.ok(line.volumeM3 != null && line.volumeM3 > 0);
    assert.equal(line.vendorId, 'STUB-VENDOR');
    assert.ok(line.unitCostUsd != null && line.unitCostUsd > 0);
    assert.ok(bom.rollup.rollupCostUsd > bom.rollup.materialCostUsd);
    assert.match(bom.honesty.note, /ERP-shaped BOM export LIVE/);
    assert.match(bom.honesty.not, /SAP/);
  });

  it('erpBomToCsv emits header + line + rollup comments', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'erp-csv' });
    addPart(db, asm.id, {
      name: 'cyl',
      kind: 'cylinder',
      source: 'test',
      transform: defaultTransform(),
      mesh: boxMesh(),
      material: 'aluminum',
      meta: { intent: { radius: 0.5, height: 2, material: 'aluminum' }, erp: { partNumber: 'PN-99', revision: 'B' } },
    });
    const bom = buildErpBom(db, asm.id);
    const csv = erpBomToCsv(bom);
    assert.equal(csv.ok, true);
    assert.match(csv.csv, /^partNumber,/);
    assert.match(csv.csv, /PN-99/);
    assert.match(csv.csv, /# rollup.rollupCostUsd/);
    assert.match(csv.filename, /\.csv$/);
  });
});
