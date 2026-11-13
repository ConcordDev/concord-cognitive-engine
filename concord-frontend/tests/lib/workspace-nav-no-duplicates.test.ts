// FIX-debate-007 — the lens walk found Debate listed twice in the
// header lens strip on /lenses/debate (start and end of the strip).
// Drive over the real navigation data, composed exactly as the three
// strip builders compose it (CoreLensNav: core + absorbed; HostLensNav:
// host + children; DestinationNav: destination + absorbs minus
// core-absorbed): every strip must list each lens once, the registry
// itself must carry each lens once, and Debate's own strip (the
// Research destination) must contain Debate exactly once. If a
// duplicate registration ever re-enters any of these lists, this fails.
import { describe, it, expect } from 'vitest';
import { LENS_REGISTRY, CORE_LENSES, getAbsorbedLenses, getParentCoreLens, getLensById } from '@/lib/lens-registry';
import { DESTINATIONS, getDestinationForLens } from '@/lib/destinations';
import { LENS_HOSTS, getHostChildren } from '@/lib/lens-hosts';

function dupes(ids: string[]): string[] {
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
}

describe('FIX-debate-007 workspace strips list each lens once', () => {
  it('the registry carries every lens id exactly once — debate included', () => {
    const ids = LENS_REGISTRY.map((l) => l.id);
    expect(dupes(ids)).toEqual([]);
    expect(ids.filter((id) => id === 'debate')).toHaveLength(1);
  });

  it('every core strip (core + absorbed) is duplicate-free', () => {
    for (const core of CORE_LENSES) {
      const strip = [core.id, ...getAbsorbedLenses(core.id).map((l) => l.id)];
      expect(dupes(strip), `core ${core.id}`).toEqual([]);
    }
  });

  it('every host strip (host + children) is duplicate-free', () => {
    for (const hostId of Object.keys(LENS_HOSTS)) {
      const strip = [hostId, ...getHostChildren(hostId)];
      expect(dupes(strip), `host ${hostId}`).toEqual([]);
    }
  });

  it('every destination strip (destination + absorbs) is duplicate-free', () => {
    for (const dest of DESTINATIONS) {
      const members = (dest.absorbs ?? []).filter((id) => !getParentCoreLens(id) && getLensById(id));
      const strip = [dest.id, ...members];
      expect(dupes(strip), `destination ${dest.id}`).toEqual([]);
    }
  });

  it("debate's own strip contains Debate exactly once", () => {
    const dest = getDestinationForLens('debate');
    expect(dest?.id).toBe('research');
    const members = (dest!.absorbs ?? []).filter((id) => !getParentCoreLens(id) && getLensById(id));
    const strip = [dest!.id, ...members];
    expect(strip.filter((id) => id === 'debate')).toHaveLength(1);
  });
});
