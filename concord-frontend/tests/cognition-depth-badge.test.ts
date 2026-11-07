/**
 * Cognition depth-badge / declaration pins (S-COG-5 caption leg).
 *
 * The declaration already stood REAL_LIVE in the manifest and the
 * integration registry; what stood false was the BADGE's generic
 * "polled live from an external source" caption — the question log is
 * the member's own store (branch (b): a personal log, per the Lead's
 * ruling).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

describe('cognition declaration — scoped caption, registry agreement', () => {
  it('manifest declares cognition REAL_LIVE', () => {
    expect(getLensManifest('cognition')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped caption — never the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('cognition')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('question log');
    expect(badge?.caption).not.toContain('polled live from an external source');
  });

  it('the server integration registry agrees: cognition REAL_LIVE + liveFromSubstrate', () => {
    const registry = readFileSync(
      path.join(REPO_ROOT, 'server/lib/integration-registry.js'),
      'utf8',
    );
    expect(registry).toMatch(/cognition:\s*\{\s*tier:\s*TIER\.REAL_LIVE,\s*liveFromSubstrate:\s*true/);
  });
});
