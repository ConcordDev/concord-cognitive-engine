// S12 (studio.md §7 / F12) — the platform chrome rule: the data-tier banner
// paints on every lens's landing surface, in the standard header position,
// from the same manifest source as the working surface.
//
// Studio was the counterexample: it sits in FULL_BLEED_LENSES, and the layout
// routed full-bleed lenses to the diegetic (chrome-less) layout, so no tier
// banner ever mounted on its landing. This test pins the wiring that fixed
// it, following the depth-badge test pattern: the badge data via the real
// hook, and the chrome routing via the layout source.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const layoutSrc = readFileSync(join(__dirname, '../app/lenses/layout.tsx'), 'utf8');

function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`);
  expect(start, `${name} not found in layout.tsx`).toBeGreaterThanOrEqual(0);
  const next = src.indexOf('\nfunction ', start + 1);
  const constNext = src.indexOf('\nconst ', start + 1);
  const ends = [next, constNext].filter((i) => i > start);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('S12 — Studio landing carries the tier banner', () => {
  it('studio manifest tier resolves to the Live badge the banner paints', () => {
    expect(getLensManifest('studio')?.dataTier).toBe('REAL_LIVE');
    const badge = renderHook(() => useDepthBadge('studio')).result.current;
    expect(badge?.label).toBe('Live');
  });

  it('the full-bleed layout paints the badge in the standard header position', () => {
    const body = functionBody(layoutSrc, 'FullBleedLensLayout');
    // Same component + toolbar flag as the universal header row.
    expect(body).toContain('<DepthBadge lensId={slug} size="sm" inToolbar />');
    // Host context: per-page badges suppress, the chip appears exactly once.
    expect(body).toContain('DepthBadgeHostContext.Provider');
  });

  it('full-bleed lenses route to the banner layout, not the chrome-less one', () => {
    const body = functionBody(layoutSrc, 'LensLayout');
    expect(body).toMatch(/FULL_BLEED_LENSES\.has\(lensName\)\) \{\s*return <FullBleedLensLayout>/);
    expect(body).toMatch(/if \(diegetic\) \{\s*return <DiegeticLensLayout>/);
  });

  it('the universal header still paints the badge for ordinary lenses', () => {
    const body = functionBody(layoutSrc, 'UniversalLensFeatures');
    expect(body).toContain('<DepthBadge lensId={slug} size="sm" inToolbar />');
  });
});
