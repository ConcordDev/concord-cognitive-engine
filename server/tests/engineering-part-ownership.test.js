// ConKay saved models (engineering.savePart) are per-account.
// Account B must not delete or rename A's part: the handler returns
// status 403 with an error that starts with "forbidden", and
// httpErrorFromLensAction turns that into HTTP 403. A's list is unchanged.
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import registerEngineeringActions from '../domains/engineering.js';
import { httpErrorFromLensAction } from '../lib/lens-action-http.js';

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function run(action, input, ctx) {
  const fn = ACTIONS.get(`engineering.${action}`);
  if (!fn) throw new Error(`engineering.${action} not registered`);
  return fn(ctx, { id: null, data: input, meta: {} }, input);
}

const A = { actor: { userId: 'acct_a' }, userId: 'acct_a' };
const B = { actor: { userId: 'acct_b' }, userId: 'acct_b' };

const BEAM = {
  kind: 'i-beam',
  designType: 'i-beam',
  params: { length: 1.2, height: 0.3, flangeWidth: 0.15, flangeThickness: 0.015, webThickness: 0.009 },
  results: { maxStressMPa: 86.1, maxDeflectionMm: 0.344, utilization: 0.249, pass: true, jobId: 'sim_1' },
  solverVersion: 'fea-solver@5.0.0',
};

before(() => {
  globalThis._concordSTATE = {};
  registerEngineeringActions(register);
});
beforeEach(() => {
  globalThis._concordSTATE = {};
});

describe('engineering parts — names', () => {
  it('defaults an unnamed save to the design type and suffixes the next one', () => {
    const beam = run('savePart', { kind: 'i-beam', params: BEAM.params }, A);
    assert.equal(beam.ok, true);
    assert.equal(beam.result.part.name, 'I-beam');
    assert.equal(beam.result.part.designType, 'i-beam');

    const bracket = run('savePart', { kind: 'box', params: { width: 0.05, height: 0.04, length: 0.2 } }, A);
    assert.equal(bracket.result.part.name, 'Bracket');
    assert.equal(bracket.result.part.kind, 'box');

    const plainBeam = run('savePart', { kind: 'beam', params: { width: 0.1, height: 0.2, length: 1 } }, A);
    assert.equal(plainBeam.result.part.name, 'Beam');

    const again = run('savePart', { kind: 'box', name: 'Bracket', params: { width: 0.05, height: 0.04, length: 0.2 } }, A);
    assert.equal(again.result.part.name, 'Bracket 2');

    // The old workspace placeholder is not stored as the model name.
    const placeholder = run('savePart', { kind: 'i-beam', name: 'I-beam study', params: BEAM.params }, A);
    assert.equal(placeholder.result.part.name, 'I-beam 2');
  });

  it('keeps params, results, and solver version on the saved part', () => {
    const saved = run('savePart', { ...BEAM, name: 'Gantry' }, A);
    assert.equal(saved.ok, true);
    const part = saved.result.part;
    assert.equal(part.params.length, 1.2);
    assert.equal(part.results.maxStressMPa, 86.1);
    assert.equal(part.solverVersion, 'fea-solver@5.0.0');
    const listed = run('listParts', {}, A);
    assert.equal(listed.result.parts.length, 1);
    assert.equal(listed.result.parts[0].solverVersion, 'fea-solver@5.0.0');
    assert.equal(listed.result.parts[0].results.pass, true);
    assert.deepEqual(run('listParts', {}, B).result.parts, []);
  });
});

describe('engineering parts — ownership', () => {
  it('account B cannot delete or rename A\'s part (403), and the part stays', () => {
    const saved = run('savePart', { ...BEAM, name: 'Gantry' }, A);
    const id = saved.result.part.id;

    const del = run('deletePart', { id }, B);
    assert.equal(del.ok, false);
    assert.equal(del.status, 403);
    assert.match(del.error, /^forbidden/);
    const delHttp = httpErrorFromLensAction(del);
    assert.equal(delHttp.status, 403);
    assert.equal(delHttp.body.ok, false);
    assert.equal(delHttp.body.code, 'not_owner');
    assert.match(delHttp.body.error, /^forbidden/);

    const ren = run('renamePart', { id, name: 'Stolen' }, B);
    assert.equal(ren.ok, false);
    assert.equal(ren.status, 403);
    assert.match(ren.error, /^forbidden/);
    assert.equal(httpErrorFromLensAction(ren).status, 403);

    const still = run('listParts', {}, A);
    assert.equal(still.result.parts.length, 1);
    assert.equal(still.result.parts[0].id, id);
    assert.equal(still.result.parts[0].name, 'Gantry');

    // A missing id is not a 403, and a non-ownership failure is not HTTP 403.
    const missing = run('renamePart', { id: 'part_nope', name: 'X' }, B);
    assert.equal(missing.ok, false);
    assert.equal(missing.status, undefined);
    assert.equal(httpErrorFromLensAction(missing), null);
    assert.equal(httpErrorFromLensAction({ ok: false, error: 'nope' }), null);
    assert.equal(httpErrorFromLensAction({ ok: false, status: 403, error: 'nope' }), null);
  });

  it('the owner can rename and delete, and the part is gone after reload', () => {
    const saved = run('savePart', { ...BEAM, name: 'Gantry' }, A);
    const id = saved.result.part.id;
    const ren = run('renamePart', { id, name: 'Walkway beam' }, A);
    assert.equal(ren.ok, true);
    assert.equal(ren.result.part.name, 'Walkway beam');
    assert.equal(run('listParts', {}, A).result.parts[0].name, 'Walkway beam');

    const del = run('deletePart', { id }, A);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, 1);
    assert.equal(httpErrorFromLensAction(del), null);
    const after = run('listParts', {}, A);
    assert.equal(after.result.parts.length, 0);
    assert.equal(after.result.parts.some((p) => p.id === id), false);
  });

  it('the lens run route maps this refusal to HTTP 403', () => {
    const src = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
    assert.match(src, /const _httpErr = _httpErrorFromLensAction\(lensRaw\)/);
    assert.match(src, /return res\.status\(_httpErr\.status\)\.json\(_httpErr\.body\)/);
  });
});
