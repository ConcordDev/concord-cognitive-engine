/**
 * Meditation — depth-badge + declaration pins for build(meditation).
 *
 * The manifest already declared REAL_LIVE, but the badge fell back
 * to the generic caption ("polled live from an external source") —
 * false for a lens whose data is the member's own practice record —
 * and the integration registry still claimed REAL_FREE over
 * "wikipedia.meditation". The build scopes the caption to the
 * record (only performed time counts) and corrects the registry
 * entry to match.
 */
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REGISTRY_SRC = readFileSync(
  join(__dirname, '../../server/lib/integration-registry.js'),
  'utf8',
);

describe('meditation — the Live declaration', () => {
  it('the manifest entry declares REAL_LIVE', () => {
    expect(getLensManifest('meditation')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the practice-record caption', () => {
    const badge = renderHook(() => useDepthBadge('meditation')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('your own practice record');
    expect(badge?.caption).toContain('Only performed time counts');
  });

  it('the integration registry carries meditation at REAL_LIVE from its substrate', () => {
    const line = REGISTRY_SRC.split('\n').find((l) => l.includes('meditation:') && l.includes('TIER.REAL_LIVE'));
    expect(line).toBeTruthy();
    expect(line).toContain('liveFromSubstrate: true');
    expect(REGISTRY_SRC).not.toContain('wikipedia.meditation');
  });
});
