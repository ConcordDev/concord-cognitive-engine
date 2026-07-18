// Regression test for Phase S2-a (docs/CONKAY_SPATIAL_NEXT_GEN_SPEC.md):
// ConcordiaScene's world binding is prop-driven. `resolveSceneWorldId` is the
// single rule its 4 world-scoped fetch sites (terrain deform / hydrology /
// water-plane / world renderers) now go through, replacing 4 inline reads of
// the ambient `localStorage['concordia:activeWorldId']`.
//
// The load-bearing property is PROP-OVER-AMBIENT: an artifact host (Foundry
// preview / ConKay "step in") passes a districtId that differs from the
// viewer's ambient active world, and the scene must fetch the HOSTED world, not
// the ambient one. Before S2-a a hosted scene fetched terrain/water/renderers
// for whatever world the user last visited — the exact bug this closes.
import { describe, it, expect } from 'vitest';
import { resolveSceneWorldId } from '@/lib/world-lens/resolve-scene-world-id';

describe('resolveSceneWorldId — S2-a prop-driven world binding', () => {
  it('the fix: prop-supplied districtId wins over a different ambient world (artifact host)', () => {
    // Foundry/ConKay host a "tunya" artifact while the viewer's ambient world
    // is "concordia-hub" — the scene must bind to tunya.
    expect(resolveSceneWorldId('tunya', 'concordia-hub')).toBe('tunya');
    expect(resolveSceneWorldId('sovereign-ruins', 'cyber')).toBe('sovereign-ruins');
  });

  it('no regression: when prop equals the ambient world (the world lens), returns it', () => {
    // In /lenses/world the districtId prop IS the localStorage active world —
    // this call is a strict no-op there.
    expect(resolveSceneWorldId('cyber', 'cyber')).toBe('cyber');
    expect(resolveSceneWorldId('concordia-hub', 'concordia-hub')).toBe('concordia-hub');
  });

  it('preserves pre-S2-a fallback: empty/blank prop falls back to the ambient world', () => {
    expect(resolveSceneWorldId('', 'tunya')).toBe('tunya');
    expect(resolveSceneWorldId('   ', 'tunya')).toBe('tunya');
    expect(resolveSceneWorldId(null, 'tunya')).toBe('tunya');
    expect(resolveSceneWorldId(undefined, 'tunya')).toBe('tunya');
  });

  it('final fallback to concordia-hub when neither prop nor ambient is present', () => {
    expect(resolveSceneWorldId(undefined, null)).toBe('concordia-hub');
    expect(resolveSceneWorldId('', '')).toBe('concordia-hub');
    expect(resolveSceneWorldId('   ', '   ')).toBe('concordia-hub');
    expect(resolveSceneWorldId(null, undefined)).toBe('concordia-hub');
    expect(resolveSceneWorldId(undefined)).toBe('concordia-hub'); // ambient arg omitted (SSR)
  });

  it('trims surrounding whitespace on the resolved id', () => {
    expect(resolveSceneWorldId('  tunya  ', 'cyber')).toBe('tunya');
    expect(resolveSceneWorldId(null, '  cyber  ')).toBe('cyber');
  });
});
