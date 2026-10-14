// Pins the Suffering header depth chip. The pain board holds the account's
// own persisted rows and the Wikipedia panel is live open data, so the chip
// must not read "Simulated · Not real data".
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

describe('Suffering depth badge', () => {
  it('Suffering is on the real-data tier, not SIM_GRADE_A', () => {
    expect(getLensManifest('suffering')?.dataTier).toBe('REAL_FREE');
  });

  it('the header chip reads "Real" and does not claim displayed rows are simulated', () => {
    const badge = renderHook(() => useDepthBadge('suffering')).result.current;
    expect(badge?.label).toBe('Real');
    expect(badge?.caption).not.toMatch(/Not real data/i);
    expect(badge?.caption).not.toMatch(/Simulat/i);
  });

  it('lenses that really are simulations keep the Simulated chip', () => {
    expect(getLensManifest('sim')?.dataTier).toBe('SIM_GRADE_A');
    expect(renderHook(() => useDepthBadge('sim')).result.current?.label).toBe('Simulated');
  });
});
