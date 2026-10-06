import { describe, it, expect } from 'vitest';
import { FULL_HEIGHT_LENSES, isFullHeightLens } from '@/lib/full-height-lenses';

describe('full-height lenses', () => {
  it('covers the app-style lenses and nothing else', () => {
    expect([...FULL_HEIGHT_LENSES].sort()).toEqual(['/lenses/chat', '/lenses/conkay', '/lenses/world']);
    expect(isFullHeightLens('/lenses/conkay')).toBe(true);
    expect(isFullHeightLens('/lenses/board')).toBe(false);
    expect(isFullHeightLens(null)).toBe(false);
    expect(isFullHeightLens(undefined)).toBe(false);
  });
});
