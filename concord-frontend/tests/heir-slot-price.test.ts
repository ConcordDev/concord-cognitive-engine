import { describe, expect, it } from 'vitest';
import { heirSlotPriceCc } from '@/components/inheritance/inheritance-shared';

describe('heir slot price', () => {
  it('keeps 0 and refuses a blank or a huge number', () => {
    expect(heirSlotPriceCc('0')).toBe(0);
    expect(heirSlotPriceCc('10')).toBe(10);
    expect(heirSlotPriceCc('')).toBeNull();
    expect(heirSlotPriceCc('nope')).toBeNull();
    expect(heirSlotPriceCc('-1')).toBeNull();
  });
});
