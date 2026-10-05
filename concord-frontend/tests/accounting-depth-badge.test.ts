// Pins the Accounting header depth chip. The books are the user's own
// persisted chart of accounts + journal entries, so the chip must not read
// "Simulated · Not real data". Other lenses sharing the manifest keep their
// own tiers.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

describe('Accounting depth badge', () => {
  it('Accounting is on the real-data tier, not SIM_GRADE_A', () => {
    expect(getLensManifest('accounting')?.dataTier).toBe('REAL_FREE');
  });

  it('the header chip reads "Real", the same chip Food and Retail show', () => {
    const acct = renderHook(() => useDepthBadge('accounting')).result.current;
    const food = renderHook(() => useDepthBadge('food')).result.current;
    const retail = renderHook(() => useDepthBadge('retail')).result.current;
    expect(acct?.label).toBe('Real');
    expect(acct?.caption).not.toMatch(/Not real data/);
    expect(food?.label).toBe('Real');
    expect(retail?.label).toBe('Real');
  });

  it('lenses that really are simulations keep the Simulated chip', () => {
    expect(getLensManifest('sim')?.dataTier).toBe('SIM_GRADE_A');
    expect(renderHook(() => useDepthBadge('sim')).result.current?.label).toBe('Simulated');
  });
});
