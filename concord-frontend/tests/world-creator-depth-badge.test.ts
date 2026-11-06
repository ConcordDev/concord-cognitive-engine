// Pins the World Creator declaration AS CORRECTED by its
// determination (F1, the Fractal form: a Simulated banner over an
// authoring tool). The determination, verified in code: drafts
// persist in the platform store with the full editor verb set, and
// playtest mints a real world via /api/worlds and routes the
// creator into it — the execution is real, so the tier is
// REAL_LIVE. The cross-lens seam (A3) is NOT wired — Sub-Worlds'
// discover reads only its own store — so the scoped caption states
// that limit in the open, and the registry flips cover the two
// authoring keys only: the anomalies key is pinned UNCHANGED at
// SIM_GRADE_A, because no anomalies substrate was found in the
// lens's domain (flipping it would assert an unverified reality).
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('world-creator');
const reg = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
const regLine = (key: string) => reg.split('\n').find((l) => l.includes(key));

describe('World Creator declaration (F1, following the determination)', () => {
  it('declares REAL_LIVE in the manifest (the Simulated banner was a taxonomy error)', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('renders the scoped Live chip, not the generic polled-feed line', () => {
    const badge = renderHook(() => useDepthBadge('world-creator')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.tone).toBe('live');
    expect(badge?.caption).toContain('Drafts here are your real records');
    expect(badge?.caption).not.toBe('Real, polled live from an external source.');
  });

  it('the caption states both halves: real authoring + playtest mint, and the unwired Sub-Worlds seam', () => {
    const badge = renderHook(() => useDepthBadge('world-creator')).result.current;
    expect(badge?.caption).toContain('playtest mints a real world you enter in the World lens');
    expect(badge?.caption).toContain('do not yet surface in Sub-Worlds’ discovery');
  });

  it('the integration registry agrees on both authoring keys (REAL_LIVE, liveFromSubstrate)', () => {
    for (const key of ['"world-creator":', 'world_creator:']) {
      expect(regLine(key), key).toContain('TIER.REAL_LIVE');
      expect(regLine(key), key).toContain('liveFromSubstrate: true');
    }
  });

  it('the anomalies registry key stays SIM_GRADE_A (no substrate verified — not this build’s to flip)', () => {
    expect(regLine('"world-creator/anomalies":')).toContain('TIER.SIM_GRADE_A');
  });

  it('a control lens keeps its own declaration (aviation stays Real / REAL_FREE)', () => {
    expect(getLensManifest('aviation')?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('aviation')).result.current;
    expect(badge?.label).toBe('Real');
  });
});
