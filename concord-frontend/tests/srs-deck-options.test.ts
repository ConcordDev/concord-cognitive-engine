import { describe, it, expect } from 'vitest';
import { eligibleDeckParents, parseLearningSteps } from '@/components/srs/deckOptions';

describe('parseLearningSteps', () => {
  it('rejects a non-numeric token instead of dropping it', () => {
    const parsed = parseLearningSteps('abc');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toMatch(/abc/);
  });

  it('keeps a real step list', () => {
    expect(parseLearningSteps('1 10')).toEqual({ ok: true, steps: [1, 10] });
  });
});

describe('eligibleDeckParents', () => {
  it('excludes the deck and its descendants', () => {
    const decks = [
      { id: 'root', name: 'Root', parentId: null },
      { id: 'child', name: 'Child', parentId: 'root' },
      { id: 'grand', name: 'Grand', parentId: 'child' },
      { id: 'other', name: 'Other', parentId: null },
      { id: 'filt', name: 'Filtered', parentId: null, filtered: true },
    ];
    expect(eligibleDeckParents(decks, 'root').map((d) => d.id)).toEqual(['other']);
    expect(eligibleDeckParents(decks, 'child').map((d) => d.id)).toEqual(['root', 'other']);
  });
});
