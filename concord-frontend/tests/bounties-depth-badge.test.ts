// Pins the Bounties header depth chip (S2 of the full-lens build). The lens
// transacts live — bounties are posted, worked and paid by real users against
// persisted state (the first pass's determination probe: PROBE-LIVE) — so the
// manifest must declare a tier, and the chip must read "Live" without the
// generic REAL_LIVE caption's "external source" claim (the board is user
// data, not a polled feed; LENS_DEPTH_OVERRIDE carries the true caption).
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

describe('Bounties depth badge', () => {
  it('Bounties declares the live tier in the manifest', () => {
    expect(getLensManifest('bounties')?.dataTier).toBe('REAL_LIVE');
  });

  it('the header chip reads "Live" with the user-data caption', () => {
    const badge = renderHook(() => useDepthBadge('bounties')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/posted, worked and paid by Concord users/);
    expect(badge?.caption).not.toMatch(/external source/);
    expect(badge?.caption).not.toMatch(/Not real data/);
  });
});
