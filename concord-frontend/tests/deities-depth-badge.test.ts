// Pins the Deities declaration (F1 — the gate record's P0: no tier
// declaration whatsoever at lens level, the ninth consecutive F-F
// instance). Deities is the census's badge-only pole: its Explore
// panel carries a "wikipedia REST · live" SOURCE badge, which the
// counting rule (this lens's own gate record) says must NOT mark the
// lens as declared — the declaration lives in the manifest tier and
// nowhere else. The content is player-composed religion, so the
// scoped caption states the trust fact plainly: the pantheon is
// other players' creations kept as live records — not authored
// content, not simulation — and only the Explore panel reads from
// Wikipedia. The generic REAL_LIVE caption ("polled live from an
// external source") would claim the pantheon itself is a feed.
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('deities');

describe('Deities declaration (F1)', () => {
  it('declares REAL_LIVE in the manifest (the panel badge alone never counted)', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('renders the scoped Live chip, not the generic polled-feed line', () => {
    const badge = renderHook(() => useDepthBadge('deities')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.tone).toBe('live');
    expect(badge?.caption).toContain('composed by players');
    expect(badge?.caption).not.toBe('Real, polled live from an external source.');
  });

  it('the caption separates the pantheon (player records) from the Explore feed (Wikipedia, badged there)', () => {
    const badge = renderHook(() => useDepthBadge('deities')).result.current;
    expect(badge?.caption).toContain('not authored or simulated content');
    expect(badge?.caption).toContain('Explore panel reads live from Wikipedia');
  });

  it('the integration registry agrees (deities REAL_LIVE, liveFromSubstrate)', () => {
    const reg = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    const line = reg.split('\n').find((l) => l.includes('deities:'));
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });

  it('a control lens keeps its own declaration (aviation stays Real / REAL_FREE)', () => {
    expect(getLensManifest('aviation')?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('aviation')).result.current;
    expect(badge?.label).toBe('Real');
  });
});
