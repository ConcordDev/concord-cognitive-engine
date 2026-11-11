import { describe, expect, it } from 'vitest';
import { lfgPostDisabled } from '@/lib/lfg-post';

describe('lfg post', () => {
  it('stays enabled when the optional note is blank', () => {
    expect(lfgPostDisabled(null)).toBe(false);
    expect(lfgPostDisabled('invite-1')).toBe(false);
    expect(lfgPostDisabled('post')).toBe(true);
  });
});
