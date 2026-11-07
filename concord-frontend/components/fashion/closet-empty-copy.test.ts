import { test } from 'vitest';
import assert from 'node:assert/strict';
import { closetEmptyCopy } from './closet-empty-copy';

test('an unfiltered closet with no items invites a first piece', () => {
  assert.equal(
    closetEmptyCopy({ category: '', laundryLabel: null }),
    'No items. Add pieces to build your digital closet.',
  );
});

test('a laundry filter names itself and does not call the closet empty', () => {
  const text = closetEmptyCopy({ category: '', laundryLabel: 'Clean' });
  assert.match(text, /No items match Clean/);
  assert.doesNotMatch(text, /Add pieces/);
  assert.doesNotMatch(text, /digital closet/);
});

test('a category filter names itself', () => {
  const text = closetEmptyCopy({ category: 'shoes', laundryLabel: null });
  assert.match(text, /No items match shoes/);
  assert.doesNotMatch(text, /Add pieces/);
});

test('both filters are named together', () => {
  assert.equal(
    closetEmptyCopy({ category: 'dress', laundryLabel: 'At cleaner' }),
    'No items match dress, At cleaner. Clear the filter to see the rest of the closet.',
  );
});
