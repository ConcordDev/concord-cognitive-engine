import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asBeatListings,
  asSampleListings,
  asStemListings,
} from '../../concord-frontend/lib/music/marketplace-rows.ts';

test('beats envelope is not treated as the row list', () => {
  const rows = asBeatListings({
    ok: true,
    total: 1,
    beats: [{
      id: 'beat_1',
      title: 'Night Bus',
      bpm: 90,
      key: 'Am',
      genre: 'lofi',
      tags: 'lofi, night',
      licenses: { basic: { name: 'Basic License', price: 30 }, free: { price: 0 } },
      ownerId: 'u1',
      totalPlays: 4,
      totalSales: 1,
      status: 'active',
    }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].listingId, 'beat_1');
  assert.deepEqual(rows[0].tags, ['lofi', 'night']);
  assert.deepEqual(rows[0].licenses, [
    { tier: 'basic', price: 30, currency: 'USD' },
    { tier: 'free', price: 0, currency: 'USD' },
  ]);
  assert.equal(typeof rows[0].tags.map, 'function');
  assert.equal(typeof rows[0].licenses.map, 'function');
});

test('a bare ok envelope and a non-object become an empty list', () => {
  assert.deepEqual(asBeatListings({ ok: true, total: 0 }), []);
  assert.deepEqual(asSampleListings(null), []);
  assert.deepEqual(asStemListings('beats'), []);
});

test('samples and stems read their own keys, and listings is the fallback', () => {
  const samples = asSampleListings({
    ok: true,
    samples: [{ id: 'samp_1', title: 'Dust', assetIds: ['a', 'b'], sampleCount: 2, price: 25, tags: ['dust'] }],
  });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].listingId, 'samp_1');
  assert.deepEqual(samples[0].assetIds, ['a', 'b']);
  assert.equal(samples[0].price, 25);

  const stems = asStemListings({
    ok: true,
    stems: [{ id: 'stem_1', title: 'Kit', assetIds: 'kick,snare', price: 50 }],
  });
  assert.equal(stems[0].listingId, 'stem_1');
  assert.deepEqual(stems[0].assetIds, ['kick', 'snare']);

  const listed = asBeatListings({
    listings: [{ listingId: 'beat_9', title: 'Already', tags: ['x'], licenses: [{ tier: 'listen', price: 0 }] }],
  });
  assert.equal(listed[0].listingId, 'beat_9');
  assert.equal(listed[0].licenses[0].tier, 'listen');
});

test('rows without an id are dropped', () => {
  assert.deepEqual(asBeatListings({ beats: [{ title: 'no id' }, { id: 'beat_2', title: 'ok' }] }).map((r) => r.listingId), ['beat_2']);
});
