// Ghost Tracker declaration pins (GT-S1, B6 full build) — Review 4's gate
// record FAILED this lens at the absent banner (F1, the declaration-
// coverage census's eleventh F-F instance): the manifest carried no
// dataTier and no badge override existed, so the mounted DepthBadge
// rendered nothing — on the one lens where a user most needs to know
// whether zero residues means a healthy world, an unconnected tracker,
// or a simulated plane. These pins hold the declaration the build ships:
// REAL_LIVE with a scoped caption naming the substrate truthfully
// (residues = the world's real drift_alerts, read live; hunts/dossiers/
// history = the hunter's own records), and every macro the manifest
// advertises registered by server/domains/ghost-hunt.js.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('ghost-tracker');

describe('Ghost Tracker manifest declaration', () => {
  it('declares REAL_LIVE — the lens is no longer declaration-absent', () => {
    expect(m?.dataTier).toBe('REAL_LIVE');
  });

  it('the badge reads Live with the scoped drift caption, not the generic external-source line', () => {
    const badge = renderHook(() => useDepthBadge('ghost-tracker')).result.current;
    expect(badge?.label).toBe('Live');
    expect(badge?.caption).toMatch(/world's real drift events/);
    expect(badge?.caption).toMatch(/empty plane means the world is quiet/);
    expect(badge?.caption).not.toMatch(/polled live from an external source/i);
  });

  it('every advertised action is registered by server/domains/ghost-hunt.js', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/ghost-hunt.js'), 'utf8');
    for (const a of m?.actions || []) {
      expect(src, a).toContain(`"ghost-hunt", "${a}"`);
    }
    const macros = m?.macros || {};
    for (const id of Object.values(macros)) {
      const action = String(id).split('.').pop();
      expect(src, String(id)).toContain(`"ghost-hunt", "${action}"`);
    }
  });
});
