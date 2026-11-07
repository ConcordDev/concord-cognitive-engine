/**
 * Reflection depth-badge / declaration pins (S-REFL-6 + caption).
 *
 * Reflection already declared REAL_LIVE in the manifest and the
 * integration registry; what stood false was the BADGE: with no scoped
 * override the lens showed REAL_LIVE's generic "polled live from an
 * external source" caption — nothing here is polled (the Journal is the
 * member's own store; the Log is the engine's internal loop; the only
 * outside data is Studio weather, fetched when a place is pinned).
 * These pins hold the scoped caption and the three-registry agreement.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('reflection declaration — scoped caption, three-registry agreement', () => {
  it('manifest declares reflection REAL_LIVE', () => {
    expect(getLensManifest('reflection')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped caption — never the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('reflection')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('your own journal records');
    expect(badge?.caption).toContain('Self-Critique Log');
    expect(badge?.caption).not.toContain('polled live from an external source');
  });

  it('the server integration registry agrees: reflection REAL_LIVE + liveFromSubstrate (both keys)', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    expect(registry).toMatch(/reflection:\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
    expect(registry).toMatch(/reflection_logs:\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
  });
});
