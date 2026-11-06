/**
 * Paper depth-badge / caption pins.
 * Manifest + registry already declared REAL_LIVE; the badge's generic
 * external-poll caption was false as a blanket line for a personal
 * research store.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('paper declaration — scoped caption, registry agreement', () => {
  it('manifest declares paper REAL_LIVE', () => {
    expect(getLensManifest('paper')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped caption — never the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('paper')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('your own records in the platform store');
    expect(badge?.caption).not.toContain('polled live from an external source');
  });

  it('the server integration registry agrees: paper REAL_LIVE + liveFromSubstrate', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    expect(registry).toMatch(/paper:\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
  });
});
