/**
 * ConKay ERP-shaped BOM — part numbers, mass/volume stubs, CSV.
 * Honesty: NOT SAP/Oracle.
 * Run: node --test tests/conkay-erp-bom.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import express from 'express';
import createConkayAssemblyRouter from '../routes/conkay-assembly.js';
import {
  ensureAssemblyTables,
  createAssembly,
  addPart,
  defaultTransform,
} from '../lib/conkay/assembly-store.js';
import { attachMaterialToPart } from '../lib/conkay/material-library.js';
import { buildErpBom, erpBomToCsv, parseVendorPriceList } from '../lib/conkay/erp-bom.js';

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
    // Q45: no price source supplied → honestly unpriced. There is no
    // stub vendor and no hard-coded $/kg estimate anymore.
    assert.equal(line.vendorId, null);
    assert.equal(line.vendorName, null);
    assert.equal(line.unitCostUsd, null);
    assert.equal(line.extendedCostUsd, null);
    assert.equal(line.costBasis, 'unpriced');
    // No price source: the rollup cost is NOT computed (null), never a fake $0.00.
    assert.equal(bom.rollup.materialCostUsd, null);
    assert.equal(bom.rollup.overheadUsd, null);
    assert.equal(bom.rollup.rollupCostUsd, null);
    assert.equal(bom.rollup.costComplete, false);
    assert.match(bom.rollup.costNote, /not computed/);
    assert.equal(bom.rollup.pricedLines, 0);
    assert.equal(bom.rollup.unpricedLines, 1);
    assert.match(bom.honesty.note, /ERP-shaped BOM export LIVE/);
    assert.match(bom.honesty.not, /SAP/);
  });

  it('prices lines from an imported vendor price list (material rate, then part number)', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'erp-priced' });
    const a = addPart(db, asm.id, {
      name: 'plate',
      kind: 'box',
      source: 'test',
      transform: defaultTransform(),
      mesh: boxMesh(),
      material: 'steel',
      meta: { intent: { width: 1, depth: 1, height: 1, material: 'steel' }, erp: { partNumber: 'PN-1' } },
    });
    attachMaterialToPart(db, asm.id, a.part.id, 'steel');

    // Material rate: unit cost = mass x rate; vendor defaults flow in.
    const byRate = buildErpBom(db, asm.id, {
      priceList: [{ material: 'steel', costPerKgUsd: 0.9, vendorId: 'V-9', vendorName: 'Real Metals Co', leadTimeDays: 21 }],
    });
    const rl = byRate.lines[0];
    assert.equal(rl.costBasis, 'vendor_price_list_rate');
    assert.ok(Math.abs(rl.unitCostUsd - rl.massKg * 0.9) < 1e-6);
    assert.equal(rl.vendorId, 'V-9');
    assert.equal(rl.leadTimeDays, 21);
    assert.equal(byRate.rollup.pricedLines, 1);
    assert.ok(byRate.rollup.rollupCostUsd > byRate.rollup.materialCostUsd, 'overhead applies on priced lines');

    // Part-number unit price beats the material rate.
    const byPart = buildErpBom(db, asm.id, {
      priceList: [
        { material: 'steel', costPerKgUsd: 0.9 },
        { partNumber: 'PN-1', unitCostUsd: 42.5 },
      ],
    });
    assert.equal(byPart.lines[0].costBasis, 'vendor_price_list');
    assert.equal(byPart.lines[0].unitCostUsd, 42.5);
  });

  it('a per-part meta.erp override still prices the line (part_override)', () => {
    const db = new Database(':memory:');
    ensureAssemblyTables(db);
    const asm = createAssembly(db, { name: 'erp-override' });
    addPart(db, asm.id, {
      name: 'plate',
      kind: 'box',
      source: 'test',
      transform: defaultTransform(),
      mesh: boxMesh(),
      material: 'steel',
      meta: { intent: { width: 1, depth: 1, height: 1, material: 'steel' }, erp: { unitCostUsd: 7.25, vendorId: 'V-OVERRIDE' } },
    });
    const bom = buildErpBom(db, asm.id);
    assert.equal(bom.lines[0].costBasis, 'part_override');
    assert.equal(bom.lines[0].unitCostUsd, 7.25);
    assert.equal(bom.lines[0].vendorId, 'V-OVERRIDE');
  });

  it('parseVendorPriceList accepts CSV text and JSON, and reports bad rows', () => {
    const csv = parseVendorPriceList('partNumber,unitCostUsd,vendorName\nPN-1,10.5,"Acme, Inc"\n,,\n');
    assert.equal(csv.rows.length, 1);
    assert.equal(csv.rows[0].vendorName, 'Acme, Inc');
    assert.equal(csv.rows[0].unitCostUsd, 10.5);
    assert.equal(csv.errors.length, 1, 'blank-priced row reported');
    const json = parseVendorPriceList('[{"material":"steel","costPerKgUsd":0.9}]');
    assert.equal(json.rows.length, 1);
    assert.equal(json.rows[0].costPerKgUsd, 0.9);
    assert.deepEqual(parseVendorPriceList(null), { rows: [], errors: [] });
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

it('a part with an unknown material has no mass, not a 1000 kg/m³ guess', async () => {
  const { estimatePartMassProps } = await import('../lib/conkay/erp-bom.js');
  const r = estimatePartMassProps({ id: 'p1', material: 'unobtainium', meta: { intent: { dims: { x: 1, y: 1, z: 1 } } } });
  assert.equal(r.massKg, null);
  assert.equal(r.densityKgM3, null);
  assert.match(r.massUnavailable, /no density/);
});

function twoPartAssembly(db) {
  ensureAssemblyTables(db);
  const asm = createAssembly(db, { name: 'erp-partial' });
  const mk = (name, material, pn) => {
    const r = addPart(db, asm.id, {
      name, kind: 'box', source: 'test', transform: defaultTransform(), mesh: boxMesh(), material,
      meta: { intent: { width: 1, depth: 1, height: 1, material }, erp: { partNumber: pn } },
    });
    attachMaterialToPart(db, asm.id, r.part.id, material);
    return r.part;
  };
  mk('plate', 'steel', 'PN-STEEL');
  mk('block', 'aluminum', 'PN-AL');
  return asm;
}

describe('ERP BOM rollup is honest when lines are unpriced', () => {
  it('no price list: rollup cost is null (not $0.00) and says why; the CSV footer leaves it blank', () => {
    const db = new Database(':memory:');
    const asm = twoPartAssembly(db);
    const bom = buildErpBom(db, asm.id);
    assert.equal(bom.rollup.rollupCostUsd, null);
    assert.equal(bom.rollup.materialCostUsd, null);
    assert.equal(bom.rollup.costComplete, false);
    assert.equal(bom.rollup.unpricedLines, 2);
    assert.match(erpBomToCsv(bom).csv, /# rollup\.rollupCostUsd,\n/);
  });

  it('partial prices: numbers cover priced lines only and are flagged partial with a count', () => {
    const db = new Database(':memory:');
    const asm = twoPartAssembly(db);
    const bom = buildErpBom(db, asm.id, { priceList: [{ partNumber: 'PN-STEEL', unitCostUsd: 10 }] });
    assert.equal(bom.rollup.pricedLines, 1);
    assert.equal(bom.rollup.unpricedLines, 1);
    assert.equal(bom.rollup.costComplete, false);
    assert.equal(bom.rollup.materialCostUsd, 10);
    assert.match(bom.rollup.costNote, /Partial: 1 of 2 line/);
  });

  it('every line priced: complete, no note', () => {
    const db = new Database(':memory:');
    const asm = twoPartAssembly(db);
    const bom = buildErpBom(db, asm.id, { priceList: [{ partNumber: 'PN-STEEL', unitCostUsd: 10 }, { partNumber: 'PN-AL', unitCostUsd: 5 }] });
    assert.equal(bom.rollup.costComplete, true);
    assert.equal(bom.rollup.costNote, null);
    assert.equal(bom.rollup.materialCostUsd, 15);
  });
});

describe('POST /api/conkay/assemblies/:id/bom/erp (price-list import is API-only)', () => {
  let server, base, db, asm;
  before(async () => {
    db = new Database(':memory:');
    asm = twoPartAssembly(db);
    const app = express();
    app.use(express.json());
    app.use('/api/conkay', createConkayAssemblyRouter({ requireAuth: (_req, _res, next) => next(), db }));
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/conkay/assemblies`;
  });
  after(async () => { await new Promise((resolve) => server.close(resolve)); });
  const post = (id, body) => fetch(`${base}/${id}/bom/erp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('prices from a posted JSON price list and from CSV text, with overheadPct', async () => {
    const res = await post(asm.id, { priceList: [{ partNumber: 'PN-STEEL', unitCostUsd: 10 }, { partNumber: 'PN-AL', unitCostUsd: 5 }], overheadPct: 0.1 });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.rollup.costComplete, true);
    assert.equal(json.rollup.materialCostUsd, 15);
    assert.ok(Math.abs(json.rollup.rollupCostUsd - 16.5) < 1e-9);
    const csv = await post(asm.id, { priceList: 'partNumber,unitCostUsd\nPN-STEEL,10\nPN-AL,5' });
    assert.equal((await csv.json()).rollup.pricedLines, 2);
  });

  it('with no price list the route returns the honest null rollup, and an unknown assembly is 404', async () => {
    const json = await (await post(asm.id, {})).json();
    assert.equal(json.rollup.rollupCostUsd, null);
    const miss = await post('does-not-exist', { priceList: [] });
    assert.equal(miss.status, 404);
  });
});
