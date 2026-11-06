// Pins the Goddess declaration (F1) AND the determination the
// compilation joins to it (S1 + A1 as one commission): the banner is
// written against the composer's truth. server/lib/goddess-
// broadcaster.js's composeDispatch is real composition — the tone
// bands on the ecosystem score, the body varies with refusal-field
// strength and drift kind — and composeAndRecord reads all three
// inputs from live world machinery. So the tier is REAL_LIVE, the
// caption states the consequence (a quiet world reads quiet), and
// the integration registry — which already read goddess REAL_LIVE
// while the manifest declared nothing — is pinned in agreement.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('goddess');

describe('Goddess declaration (F1, written against the A1 determination)', () => {
  it('declares REAL_LIVE in the manifest', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('renders the scoped Live chip, not the generic polled-feed line', () => {
    const badge = renderHook(() => useDepthBadge('goddess')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.tone).toBe('live');
    expect(badge?.caption).toContain('composed live from this world’s own signals');
    expect(badge?.caption).not.toBe('Real, polled live from an external source.');
  });

  it('the caption carries the determination: inputs named, quiet world reads quiet, nothing simulated', () => {
    const badge = renderHook(() => useDepthBadge('goddess')).result.current;
    expect(badge?.caption).toContain('ecosystem score, refusal-field strength, and drift events');
    expect(badge?.caption).toContain('A quiet world reads quiet');
    expect(badge?.caption).toContain('not that the feed is simulated');
  });

  it('the integration registry agrees (goddess REAL_LIVE, liveFromSubstrate — as it already stood)', () => {
    const reg = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    const line = reg.split('\n').find((l) => l.includes('goddess:'));
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });

  it('a control lens keeps its own declaration (aviation stays Real / REAL_FREE)', () => {
    expect(getLensManifest('aviation')?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('aviation')).result.current;
    expect(badge?.label).toBe('Real');
  });
});
