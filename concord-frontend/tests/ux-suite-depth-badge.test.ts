/**
 * UX Suite depth-badge / caption pins.
 * Manifest + registry already declared REAL_LIVE; the badge's generic
 * external-poll caption was false for a catalogue in the platform store.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('ux-suite declaration — scoped caption, registry agreement', () => {
  it('manifest declares ux-suite REAL_LIVE', () => {
    expect(getLensManifest('ux-suite')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped caption — never the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('ux-suite')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('component catalogue');
    expect(badge?.caption).not.toContain('polled live from an external source');
  });

  it('the server integration registry agrees: ux-suite REAL_LIVE + liveFromSubstrate', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    expect(registry).toMatch(/"ux-suite":\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
  });

  it('one count everywhere (F3): no platform surface still claims 20 absorbed components', () => {
    for (const rel of ['concord-frontend/lib/lens-registry.ts', 'concord-frontend/lib/lenses/lens-status.ts', 'concord-frontend/lib/lenses/manifest.ts']) {
      const text = readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      expect(text).not.toContain('20 absorbed');
    }
  });
});
