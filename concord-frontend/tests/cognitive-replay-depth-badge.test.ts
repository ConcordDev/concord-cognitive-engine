/**
 * Cognitive Replay / Moments — depth-badge + declaration pins for
 * build(cognitive-replay), S-CRP-1 + S-CRP-2.
 *
 * The lens's manifest entry declared nothing and the badge had no
 * scoped caption, on a surface whose data path was determined live
 * (the member's own journal, persisted server-side). The build adds
 * the REAL_LIVE declaration (own entry only) and a caption scoped to
 * the journal: the member's own dated records — and expressly not a
 * recording or a replay of anything.
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

describe('cognitive-replay (Moments) — the Live declaration', () => {
  it('the manifest entry declares REAL_LIVE', () => {
    expect(getLensManifest('cognitive-replay')?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the journal-scoped caption', () => {
    const badge = renderHook(() => useDepthBadge('cognitive-replay')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toContain('moment journal');
    expect(badge?.caption).toContain('Nothing here is recorded from your sessions or replayed');
  });

  it('the integration registry carries both keys at REAL_LIVE with the journal note', () => {
    for (const key of ['cognitive_replay', '"cognitive-replay"']) {
      const line = REGISTRY_SRC.split('\n').find((l) => l.includes(`${key}:`) && l.includes('TIER.REAL_LIVE'));
      expect(line, key).toBeTruthy();
      expect(line).toContain('moment journal');
    }
  });
});
