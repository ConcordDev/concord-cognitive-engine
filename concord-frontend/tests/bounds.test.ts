// GB-1539 — the client mirror of the bounds policy. The constants
// themselves are pinned against the server module by
// server/tests/bounds-policy.test.js; this suite pins the mirror's
// helper behaviour the forms rely on.
import { describe, it, expect } from 'vitest';
import { BOUNDS, TEXT_LIMITS, textLimitMessage, textInBounds, numberInBounds, percentInBounds } from '../lib/bounds';

describe('bounds mirror helpers', () => {
  it('carries the ruled values', () => {
    expect(BOUNDS.TITLE).toBe(200);
    expect(BOUNDS.NOTE).toBe(5000);
    expect(BOUNDS.POST).toBe(5000);
    expect(BOUNDS.DOC).toBe(50000);
    expect(BOUNDS.QUANTITY_MAX).toBe(10000);
    expect(BOUNDS.MONEY_MAX).toBe(1000000);
    expect(BOUNDS.NUMBER_MAX).toBe(1000000);
    expect(BOUNDS.DURATION_YEARS).toBe(10);
    expect(BOUNDS.LIST_MAX).toBe(500);
    expect(TEXT_LIMITS.title).toBe(200);
  });

  it('textInBounds respects the class limit and passes absent values', () => {
    expect(textInBounds('x'.repeat(200), 'title')).toBe(true);
    expect(textInBounds('x'.repeat(201), 'title')).toBe(false);
    expect(textInBounds('x'.repeat(5000), 'note')).toBe(true);
    expect(textInBounds(null, 'title')).toBe(true);
    expect(textInBounds(undefined, 'post')).toBe(true);
  });

  it('textLimitMessage names the limit', () => {
    expect(textLimitMessage('Name', 'title')).toBe('Name is limited to 200 characters.');
    expect(textLimitMessage('Body', 'post')).toBe('Body is limited to 5000 characters.');
  });

  it('numberInBounds rejects negatives, over-max and non-finite', () => {
    expect(numberInBounds(0, BOUNDS.QUANTITY_MAX)).toBe(true);
    expect(numberInBounds(10000, BOUNDS.QUANTITY_MAX)).toBe(true);
    expect(numberInBounds(10001, BOUNDS.QUANTITY_MAX)).toBe(false);
    expect(numberInBounds(-1, BOUNDS.MONEY_MAX)).toBe(false);
    expect(numberInBounds(NaN, BOUNDS.MONEY_MAX)).toBe(false);
    expect(numberInBounds(null, BOUNDS.MONEY_MAX)).toBe(true);
  });

  it('percentInBounds is 0-100 inclusive', () => {
    expect(percentInBounds(0)).toBe(true);
    expect(percentInBounds(100)).toBe(true);
    expect(percentInBounds(150)).toBe(false);
    expect(percentInBounds(-5)).toBe(false);
  });
});
