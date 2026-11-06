/**
 * Inference depth-badge / declaration pins (S-INF-5 caption leg).
 *
 * The declaration already stood REAL_LIVE in the manifest and the
 * integration registry; what stood false was the BADGE's generic
 * "polled live from an external source" caption — the knowledge bases
 * are the member's own store and the engines run in-process.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('inference declaration — scoped caption, registry agreement', () => {
  it('manifest declares inference REAL_LIVE', () => {
    expect(getLensManifest('inference')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped caption — never the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('inference')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('engines that run in-process');
    expect(badge?.caption).not.toContain('polled live from an external source');
  });

  it('the server integration registry agrees: inference REAL_LIVE + liveFromSubstrate', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    expect(registry).toMatch(/inference:\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
  });
});
