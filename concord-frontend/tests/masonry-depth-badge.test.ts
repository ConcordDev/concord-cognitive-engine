// F1 — Masonry's declaration flip. Review 4's determination (2026-11-01):
// real execution under a Simulated banner — the calculators compute
// correctly from their stated bases and the suite's records persist
// server-side. The manifest tier flips to REAL_LIVE, and the caption
// override names the real basis instead of claiming an external feed
// this lens does not poll (the database F14 precedent's shape).
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDepthBadge } from '@/hooks/useDepthBadge';

describe('Masonry depth badge (F1 flip)', () => {
  it('reads Live with the real-execution caption, never Simulated', () => {
    const info = renderHook(() => useDepthBadge('masonry')).result.current;
    expect(info?.tier).toBe('REAL_LIVE');
    expect(info?.label).toBe('Live');
    expect(info?.label).not.toBe('Simulated');
    expect(info?.caption).toMatch(/Real execution/);
    expect(info?.caption).toMatch(/spec tables/);
    expect(info?.caption).toMatch(/No external feed is polled/);
    expect(info?.caption).not.toMatch(/Not real data/);
    expect(info?.caption).not.toMatch(/polled live from an external source/);
  });
});
