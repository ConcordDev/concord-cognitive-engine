// engineering-bom-model-rollup.test.js
//
// FIX-engineering-009: after adding nodes/members and saving parts,
// the BOM action returned only its "add items" guidance — it never
// looked at the model or the parts store. With no explicit items it
// now derives lines from both: members grouped by section with
// quantities and total length, saved parts one line each. Explicit
// items keep the original behavior byte-for-byte, and a user with
// neither model nor parts still gets the guidance message.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import registerEngineeringActions from '../domains/engineering.js';

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, data = {}, params = {}) {
  const fn = ACTIONS.get(`engineering.${name}`);
  if (!fn) throw new Error(`engineering.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctx = { actor: { userId: 'bom_user' }, userId: 'bom_user' };
const other = { actor: { userId: 'bom_other' }, userId: 'bom_other' };

const MODEL = {
  nodes: [
    { id: 'N1', x: 0, y: 0, z: 0 },
    { id: 'N2', x: 3, y: 0, z: 0 },
    { id: 'N3', x: 6, y: 0, z: 0 },
    { id: 'N4', x: 6, y: 4, z: 0 },
  ],
  members: [
    { id: 'M1', nodeI: 'N1', nodeJ: 'N2', area: 0.01, momentI: 1e-5, elasticModulus: 2e11, material: 'steel' },
    { id: 'M2', nodeI: 'N2', nodeJ: 'N3', area: 0.01, momentI: 1e-5, elasticModulus: 2e11, material: 'steel' },
    { id: 'M3', nodeI: 'N3', nodeJ: 'N4', area: 0.02, momentI: 2e-5, elasticModulus: 2e11, material: 'steel' },
  ],
  loads: [],
  supports: [{ nodeId: 'N1', type: 'fixed' }],
};

describe('engineering BOM derives from the model and saved parts (FIX-engineering-009)', () => {
  it('rolls up members by section and lists saved parts', () => {
    assert.equal(call('model-save', ctx, {}, { model: MODEL }).ok, true);
    assert.equal(call('savePart', ctx, { name: 'Bracket', kind: 'box', params: { w: 1, h: 1, d: 1 } }).ok, true);
    const r = call('bom', ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalLineItems, 3); // 2 member groups + 1 part
    assert.equal(r.result.totalParts, 4); // 2 + 1 members + 1 part
    assert.deepEqual(r.result.derivedFrom, { modelMemberGroups: 2, savedParts: 1 });
    const steel = r.result.bom.find((b) => b.partNumber.includes('A=0.01'));
    assert.equal(steel.quantity, 2);
    assert.match(steel.description, /total length 6/);
    assert.ok(r.result.bom.some((b) => b.partNumber === 'Bracket'));
  });

  it('a user with no model and no parts still gets the guidance message', () => {
    const r = call('bom', other);
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add BOM items/);
  });

  it('explicit items keep the original behavior and carry no derivedFrom', () => {
    call('model-save', ctx, {}, { model: MODEL });
    const r = call('bom', ctx, {}, { items: [{ partNumber: 'X1', quantity: 2, unitCost: 5 }] });
    assert.equal(r.result.totalLineItems, 1);
    assert.equal(r.result.totalCost, 10);
    assert.equal(r.result.derivedFrom, undefined);
  });
});
