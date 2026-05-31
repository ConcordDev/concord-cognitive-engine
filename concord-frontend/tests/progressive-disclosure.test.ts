// FTUE2 — progressive disclosure policy.
import { describe, it, expect } from 'vitest';
import {
  isDisclosed, disclosedCategories, nextStage, DISCLOSURE_STAGES,
} from '@/lib/concordia/progressive-disclosure';

describe('progressive disclosure', () => {
  it('arrival shows only core; the deep surface is hidden', () => {
    expect(isDisclosed('core', 'arrival')).toBe(true);
    expect(isDisclosed('interact', 'arrival')).toBe(false);
    expect(isDisclosed('economy', 'arrival')).toBe(false);
    expect(disclosedCategories('arrival')).toEqual(['core']);
  });

  it('categories unlock monotonically as the player advances', () => {
    expect(isDisclosed('interact', 'first_action')).toBe(true);
    expect(isDisclosed('progression', 'first_action')).toBe(false);
    expect(isDisclosed('progression', 'first_win')).toBe(true);
    // free play reveals everything
    const free = disclosedCategories('free');
    expect(free).toContain('economy');
    expect(free).toContain('advanced');
    expect(free.length).toBeGreaterThanOrEqual(8);
  });

  it('nextStage walks the ladder and saturates at free', () => {
    expect(nextStage('arrival')).toBe('first_action');
    expect(nextStage('free')).toBe('free');
    expect(DISCLOSURE_STAGES[0]).toBe('arrival');
  });

  it('an unknown category is never hidden', () => {
    // @ts-expect-error — exercising the runtime fallback
    expect(isDisclosed('mystery', 'arrival')).toBe(true);
  });
});
