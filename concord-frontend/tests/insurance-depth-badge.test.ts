// Pins the Insurance F1 declaration correction (R5 re-pass on PR #2210:
// NOT PASS on F1 alone — a "Simulated / Not real data" banner beside the
// LIVE badge, over a live per-user store). The lens's book is the
// account's own persisted data, so the manifest tier is REAL_LIVE and
// the header chip is the scoped Live caption — never the generic
// "polled live from an external source" line, which would claim a
// carrier feed this lens does not poll.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge, TIER_INFO } from '@/hooks/useDepthBadge';

const m = getLensManifest('insurance');

describe('Insurance declaration honesty (F1)', () => {
  it('declares REAL_LIVE in the manifest, not SIM_GRADE_A', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('renders the scoped Live chip: label and tone agree with the LIVE badge', () => {
    const badge = renderHook(() => useDepthBadge('insurance')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.tone).toBe('live');
    expect(badge?.caption).not.toMatch(/Not real data|simulation/i);
  });

  it('the caption names the actual substrate: own records, no carrier feed polled', () => {
    const badge = renderHook(() => useDepthBadge('insurance')).result.current;
    expect(badge?.caption).toMatch(/your own records/);
    expect(badge?.caption).toMatch(/no live carrier quotes are polled/);
    // The scoped caption replaces the generic REAL_LIVE line, it does
    // not repeat its external-source claim.
    expect(badge?.caption).not.toBe(TIER_INFO.REAL_LIVE.caption);
    expect(badge?.caption).not.toMatch(/polled live from an external source/);
  });

  it('control: a genuinely simulated lens still declares SIM_GRADE_A', () => {
    expect(getLensManifest('sim')?.dataTier).toBe('SIM_GRADE_A');
    const badge = renderHook(() => useDepthBadge('sim')).result.current;
    expect(badge?.label).toBe('Simulated');
  });
});
