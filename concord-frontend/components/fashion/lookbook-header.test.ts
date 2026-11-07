import { test } from 'vitest';
import assert from 'node:assert/strict';
import { notifyLookbookHeader } from './lookbook-header';

test('a stored lookbook asks the header to refresh', () => {
  let calls = 0;
  notifyLookbookHeader(true, () => { calls += 1; });
  assert.equal(calls, 1);
});

test('a refused lookbook leaves the header alone', () => {
  let calls = 0;
  const result = notifyLookbookHeader(false, () => { calls += 1; });
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test('a stored lookbook with no header callback does nothing', () => {
  assert.equal(notifyLookbookHeader(true), undefined);
});
