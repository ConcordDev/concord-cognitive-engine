// Pins the Carpentry header chip after CP-S1 (build(carpentry), GB-1088).
// The declaration stood at SIM_GRADE_A ("Simulated") in all three
// registries over a substrate Review 5's determination probe proved live
// (fixture job persisted across reloads; species lookups genuinely live
// from Wikipedia) — the manifest and the server registry now declare
// REAL_LIVE and the depth override labels it "Live" with the scoped
// caption. A still-simulated sibling (welding) is the control.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('carpentry');

describe('Carpentry manifest honesty', () => {
  it('is on the live tier with a "Live" chip, not Simulated', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
    const badge = renderHook(() => useDepthBadge('carpentry')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/your account's real data, saved as you work/);
    expect(badge?.caption).toMatch(/Species lookups pull live reference data from Wikipedia/);
  });

  it('the server integration registry agrees (REAL_LIVE, liveFromSubstrate)', () => {
    const src = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    expect(src).toMatch(/carpentry:\s*\{\s*tier: TIER\.REAL_LIVE, liveFromSubstrate: true/);
  });

  it('control: a sibling trades lens keeps its own declaration (welding)', () => {
    const w = getLensManifest('welding');
    expect(w?.dataTier).not.toBe('REAL_LIVE');
    const badge = renderHook(() => useDepthBadge('welding')).result.current;
    expect(badge?.label).not.toBe('Live');
  });
});
