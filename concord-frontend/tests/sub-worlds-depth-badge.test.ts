// Pins the Sub-Worlds declaration (F1 — the gate record's P0: the lens
// declared NOTHING, the eighth consecutive F-F instance of the shape).
// The surface mixes three content kinds — users' spawned worlds (real
// records in the platform store), the platform's catalogue state, and
// a live external GitHub feed (the Repos view) — so the declaration
// must do two things at once: claim the worlds substrate truthfully
// (REAL_LIVE, the users' own persisted records) and carry the
// three-kind distinction in its own text, because the generic
// REAL_LIVE caption ("polled live from an external source") is true
// of the Repos view only. ONE lens declaration, kinds named — the
// form the Lead compilation's census flag records for this lens.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('sub-worlds');

describe('Sub-Worlds declaration (F1)', () => {
  it('declares REAL_LIVE in the manifest', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('renders the scoped Live chip, not the generic polled-feed line', () => {
    const badge = renderHook(() => useDepthBadge('sub-worlds')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.tone).toBe('live');
    expect(badge?.caption).toContain('platform store');
    expect(badge?.caption).not.toBe('Real, polled live from an external source.');
  });

  it('the caption carries the three-kind distinction (Repos = live GitHub, worlds not polled)', () => {
    const badge = renderHook(() => useDepthBadge('sub-worlds')).result.current;
    expect(badge?.caption).toContain('Repos view is a live GitHub search');
    expect(badge?.caption).toContain('not polled from an external source');
  });

  it('the integration registry agrees (both key spellings REAL_LIVE, liveFromSubstrate)', () => {
    const reg = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    for (const key of ['"sub-worlds":', 'sub_worlds:']) {
      const line = reg.split('\n').find((l) => l.includes(key));
      expect(line, key).toContain('TIER.REAL_LIVE');
      expect(line, key).toContain('liveFromSubstrate: true');
    }
  });

  it('a control lens keeps its own declaration (astronomy stays Real / REAL_FREE)', () => {
    expect(getLensManifest('astronomy')?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('astronomy')).result.current;
    expect(badge?.label).toBe('Real');
  });
});
