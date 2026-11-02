// SPDX-License-Identifier: LicenseRef-Concord-Community-1.0
// Copyright (c) 2026 Concord AI, LLC. Source-available under the CSL-CE
// license (see LICENSE.txt in the repo root).
// ═══════════════════════════════════════════════════════════════════════
// RESEARCH — import duplicate detection (S3 / F8) + library search (F6)
//
// Behaviour tests against the REAL research domain (S1/S2 extraction
// harness: the domain file is imported directly, actions invoked
// through registerLensAction's map, DATA_DIR pointed at a temp dir).
// Fetch is stubbed: Crossref answers only the AlphaGo DOI.
//
// What this pins:
//  • importing the same DOI twice files ONE record; the second import
//    answers { duplicate: true, reference: <the existing record> }.
//  • DOI case / doi.org-prefix variants dedupe (normalised matching).
//  • academic-resolve-import inherits the same gate.
//  • with no DOI on either side, same normalised title + year dedupes;
//    a different year does NOT (a distinct edition is not a twin).
//  • the F8 case: a hand-filed record with no DOI does not block on
//    title alone when years agree — and DOES answer duplicate when a
//    DOI'd import of the same title arrives with an upstream-quirk
//    year (2017 on file, 2025 from OpenAlex).
//  • a stored record carrying a DIFFERENT DOI disproves identity:
//    same title + same year is then not a duplicate.
//  • manual reference-add passes the same gate.
//  • dedupe is per-user: another user's identical reference never
//    blocks your import.
//  • reference-list query (the server half of library search) filters
//    over title/authors/journal/tags/doi, case-insensitively, and an
//    empty query restores the full list.
// ═══════════════════════════════════════════════════════════════════════
import { test, describe, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import registerActions from '../domains/research.js';
import { clearExternalFetchCache } from '../lib/external-fetch.js';

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
before(() => { registerActions(register); });

const CTX = { actor: { userId: 'u-dedupe' }, userId: 'u-dedupe' };
const CTX_B = { actor: { userId: 'u-other' }, userId: 'u-other' };

const realFetch = globalThis.fetch;
const CROSSREF_GO = {
  message: {
    DOI: '10.1038/nature16961',
    title: ['Mastering the game of Go with deep neural networks and tree search'],
    author: [{ given: 'David', family: 'Silver' }],
    published: { 'date-parts': [[2016]] },
    'container-title': ['Nature'],
    URL: 'https://doi.org/10.1038/nature16961',
    'is-referenced-by-count': 100,
  },
};

let fetchCalls = [];
function stubFetch(handler) {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    return handler(u);
  };
}
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function resetState() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  clearExternalFetchCache();
}

async function run(ctx, action, params = {}) {
  const fn = ACTIONS.get(`research.${action}`);
  assert.ok(fn, `action registered: ${action}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
const listRefs = async (ctx, params = {}) => (await run(ctx, 'reference-list', params)).result.references;
const importWork = (ctx, work) => run(ctx, 'academic-import', { work });

const ATTENTION = {
  title: 'Attention Is All You Need',
  authors: ['Ashish Vaswani', 'Noam Shazeer'],
  venue: 'Advances in Neural Information Processing Systems',
  source: 'openalex',
};

describe('research — import duplicate detection (S3, F8)', () => {
  beforeEach(() => { resetState(); globalThis.fetch = async () => { throw new Error('network off'); }; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('same DOI twice → one record, second answers duplicate with the existing record', async () => {
    const work = { ...ATTENTION, year: 2017, doi: '10.48550/arxiv.1706.03762' };
    const first = await importWork(CTX, work);
    assert.equal(first.ok, true);
    assert.equal(first.result.duplicate, undefined);
    const second = await importWork(CTX, work);
    assert.equal(second.ok, true);
    assert.equal(second.result.duplicate, true);
    assert.equal(second.result.reference.id, first.result.reference.id);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('DOI case and doi.org-prefix variants dedupe', async () => {
    const first = await importWork(CTX, { ...ATTENTION, year: 2017, doi: '10.48550/arxiv.1706.03762' });
    assert.equal(first.result.duplicate, undefined);
    const variant = await importWork(CTX, { ...ATTENTION, year: 2017, doi: 'https://doi.org/10.48550/ARXIV.1706.03762' });
    assert.equal(variant.result.duplicate, true);
    assert.equal(variant.result.reference.id, first.result.reference.id);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('academic-resolve-import inherits the gate (resolve a DOI already in the library)', async () => {
    const filed = await importWork(CTX, {
      title: 'Mastering the game of Go with deep neural networks and tree search',
      authors: ['David Silver'], year: 2016, venue: 'Nature',
      doi: '10.1038/nature16961', source: 'crossref',
    });
    assert.equal(filed.result.duplicate, undefined);
    stubFetch((u) => {
      if (u.startsWith('https://api.crossref.org/works/')) return jsonResponse(200, CROSSREF_GO);
      throw new Error(`unexpected fetch ${u}`);
    });
    const r = await run(CTX, 'academic-resolve-import', { identifier: '10.1038/nature16961' });
    assert.equal(r.ok, true);
    assert.equal(r.result.duplicate, true);
    assert.equal(r.result.reference.id, filed.result.reference.id);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('no DOI on either side: same normalised title + year dedupes', async () => {
    const a = await importWork(CTX, { ...ATTENTION, year: 2017, doi: null });
    assert.equal(a.result.duplicate, undefined);
    const b = await importWork(CTX, { ...ATTENTION, title: '  attention   is all you need ', year: 2017, doi: null });
    assert.equal(b.result.duplicate, true);
    assert.equal(b.result.reference.id, a.result.reference.id);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('no DOI, same title, different year → NOT a duplicate', async () => {
    await importWork(CTX, { ...ATTENTION, year: 2017, doi: null });
    const b = await importWork(CTX, { ...ATTENTION, year: 2023, doi: null });
    assert.equal(b.result.duplicate, undefined);
    assert.equal((await listRefs(CTX)).length, 2);
  });

  test('F8 case: hand-filed DOI-less record + DOI’d import with quirk year → duplicate', async () => {
    const manual = await run(CTX, 'reference-add', { title: 'Attention Is All You Need', year: 2017 });
    assert.equal(manual.ok, true);
    const imp = await importWork(CTX, { ...ATTENTION, year: 2025, doi: '10.48550/arxiv.1706.03762' });
    assert.equal(imp.result.duplicate, true);
    assert.equal(imp.result.reference.id, manual.result.reference.id);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('a stored DIFFERENT DOI disproves identity: same title + year is not a duplicate', async () => {
    await importWork(CTX, { ...ATTENTION, year: 2017, doi: '10.1111/aaaa.0001' });
    const b = await importWork(CTX, { ...ATTENTION, year: 2017, doi: '10.2222/bbbb.0002' });
    assert.equal(b.result.duplicate, undefined);
    assert.equal((await listRefs(CTX)).length, 2);
  });

  test('manual reference-add passes the same gate', async () => {
    const a = await run(CTX, 'reference-add', { title: 'Deep Learning', authors: 'LeCun, Bengio, Hinton', year: 2015, doi: '10.1038/nature14539' });
    assert.equal(a.ok, true);
    assert.equal(a.result.duplicate, undefined);
    const b = await run(CTX, 'reference-add', { title: 'Deep Learning', year: 2015, doi: 'doi:10.1038/NATURE14539' });
    assert.equal(b.ok, true);
    assert.equal(b.result.duplicate, true);
    assert.equal(b.result.reference.id, a.result.reference.id);
    // and a manual add of an already-imported DOI answers duplicate too
    const c = await run(CTX, 'reference-add', { title: 'Some Other Title', year: 2020, doi: '10.1038/nature14539' });
    assert.equal(c.result.duplicate, true);
    assert.equal((await listRefs(CTX)).length, 1);
  });

  test('per-user scoping: another user’s identical reference never blocks', async () => {
    const work = { ...ATTENTION, year: 2017, doi: '10.48550/arxiv.1706.03762' };
    await importWork(CTX, work);
    const b = await importWork(CTX_B, work);
    assert.equal(b.ok, true);
    assert.equal(b.result.duplicate, undefined);
    assert.equal((await listRefs(CTX_B)).length, 1);
    assert.equal((await listRefs(CTX)).length, 1);
  });
});

describe('research — library search filter (F6, server half)', () => {
  beforeEach(() => { resetState(); globalThis.fetch = async () => { throw new Error('network off'); }; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('"Go" filters to the AlphaGo record only; empty query restores the full list', async () => {
    await run(CTX, 'reference-add', {
      title: 'Mastering the game of Go with deep neural networks and tree search',
      authors: 'Silver, David', year: 2016, journal: 'Nature', doi: '10.1038/nature16961',
    });
    await run(CTX, 'reference-add', { title: 'Attention Is All You Need', authors: 'Vaswani, Ashish', year: 2017 });
    assert.equal((await listRefs(CTX)).length, 2);
    const go = await listRefs(CTX, { query: 'Go' });
    assert.deepEqual(go.map((r) => r.title), ['Mastering the game of Go with deep neural networks and tree search']);
    assert.equal((await listRefs(CTX, { query: 'go' })).length, 1);
    assert.equal((await listRefs(CTX, { query: '' })).length, 2);
    assert.equal((await listRefs(CTX, { query: 'zzz-no-match' })).length, 0);
  });

  test('query matches journal, DOI and tags, not just title/authors', async () => {
    await run(CTX, 'reference-add', {
      title: 'A Study of Systems', authors: 'Doe, Jane', year: 2020,
      journal: 'JMLR', doi: '10.5555/xyz.42', tags: ['robotics'],
    });
    assert.equal((await listRefs(CTX, { query: 'jmlr' })).length, 1);
    assert.equal((await listRefs(CTX, { query: '10.5555' })).length, 1);
    assert.equal((await listRefs(CTX, { query: 'robotics' })).length, 1);
    assert.equal((await listRefs(CTX, { query: 'doe' })).length, 1);
  });
});
