// Move Builder declaration pins (MB-S1, B6 full build) — Review 4's gate
// record FAILED this lens at the absent banner (F1, the declaration-
// coverage census's sixth F-F instance): the manifest carried no dataTier
// and no badge override existed, so the mounted DepthBadge rendered
// nothing — on a lens whose undeclared act is a MINT: a creator could not
// tell into what store, under what tier, their moves are minted, when in
// code move-builder.mint INSERTs a kind='move_recipe' DTU into the
// canonical dtus table. These pins hold the declaration the build ships:
// REAL_LIVE with a scoped caption answering the mint question in its own
// text, the integration-registry agreement, and every macro the manifest
// advertises registered by server/domains/move-builder.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('move-builder');

describe('Move Builder manifest declaration', () => {
  it('declares REAL_LIVE — the lens is no longer declaration-absent', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped mint caption, not the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('move-builder')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/move_recipe DTU/);
    expect(badge?.caption).toMatch(/canonical store/);
    expect(badge?.caption).not.toMatch(/polled live from an external source/i);
  });

  it('every advertised action and macro is registered by server/domains/move-builder.js, and mint writes the canonical store', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/move-builder.js'), 'utf8');
    for (const a of m?.actions || []) {
      expect(src, a).toContain(`"move-builder", "${a}"`);
    }
    const macros = m?.macros || {};
    for (const id of Object.values(macros)) {
      const action = String(id).split('.').pop();
      expect(src, String(id)).toContain(`"move-builder", "${action}"`);
    }
    // the mint's store truth, pinned at the code that performs it
    expect(src).toContain('INSERT INTO dtus');
  });

  it('the integration registry agrees: both move keys read REAL_LIVE from substrate', () => {
    const reg = readFileSync(join(__dirname, '../../server/lib/integration-registry.js'), 'utf8');
    expect(reg).toMatch(/move_builder:\s*\{\s*tier: TIER\.REAL_LIVE, liveFromSubstrate: true/);
    expect(reg).toMatch(/"move-builder":\s*\{\s*tier: TIER\.REAL_LIVE, liveFromSubstrate: true/);
  });
});
