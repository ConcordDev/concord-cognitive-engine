import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { discoverItems } from './discover-payload';

describe('discoverItems', () => {
  it('reads facts from the unwrapped lensRun result', () => {
    const got = discoverItems({
      ok: true,
      result: { ok: true, facts: [{ fact: 'Cats sleep a lot.', length: 18 }] },
    }, 'facts');
    assert.equal(got.error, null);
    assert.equal(got.items.length, 1);
  });

  it('reads images from the unwrapped lensRun result', () => {
    const got = discoverItems({
      ok: true,
      result: { ok: true, images: ['https://images.dog.ceo/breeds/hound/a.jpg'] },
    }, 'images');
    assert.equal(got.error, null);
    assert.equal(got.items[0], 'https://images.dog.ceo/breeds/hound/a.jpg');
  });

  it('a successful payload with no list is no_content, not a blank panel', () => {
    assert.equal(discoverItems({ ok: true, result: { ok: true, facts: [] } }, 'facts').error, 'no_content');
    assert.equal(discoverItems({ ok: true, result: { ok: true } }, 'images').error, 'no_content');
  });

  it('a refused call keeps the reason', () => {
    assert.equal(
      discoverItems({ ok: false, result: null, error: 'catfacts_unreachable' }, 'facts').error,
      'catfacts_unreachable',
    );
    assert.equal(
      discoverItems({ ok: true, result: { ok: false, reason: 'dog_ceo_error' } }, 'images').error,
      'dog_ceo_error',
    );
  });

  it('a missing envelope is a failed fetch', () => {
    assert.equal(discoverItems(null, 'facts').error, 'fetch_failed');
  });
});
