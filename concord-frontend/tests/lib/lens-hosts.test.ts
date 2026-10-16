import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getLensById, getParentCoreLens, SOVEREIGN_LENSES } from '@/lib/lens-registry';
import { DESTINATIONS } from '@/lib/destinations';
import { ADMIN_GATED_LENS_IDS, LENS_HOSTS, getHostChildren, getHostForLens } from '@/lib/lens-hosts';

// Generic host-lens layer (Phase 3). Hosts are ordinary lenses that show a
// workspace tab bar over their children; children keep their own routes and gates.
const pagePath = (id: string) => path.join(process.cwd(), 'app', 'lenses', id, 'page.tsx');
const ADMIN_GATE = /AdminRequiredState|requireRole|useRequireAdmin|isAdmin\b/;
const destinationMembers = new Set(DESTINATIONS.flatMap((d) => d.absorbs ?? []));
const destinationIds = new Set(DESTINATIONS.map((d) => d.id));

describe('lens hosts', () => {
  const entries = Object.entries(LENS_HOSTS);

  it('every host and child is a real registry lens with a page', () => {
    for (const [host, children] of entries) {
      for (const id of [host, ...children]) {
        expect(getLensById(id), id).toBeTruthy();
        expect(fs.existsSync(pagePath(id)), `${id} page`).toBe(true);
      }
    }
  });

  it('hosts are not core lenses or destinations, and children have exactly one home', () => {
    const seen = new Set<string>();
    for (const [host, children] of entries) {
      expect(getParentCoreLens(host), host).toBeFalsy();
      expect(destinationIds.has(host), host).toBe(false);
      for (const id of children) {
        expect(seen.has(id), `${id} listed twice`).toBe(false);
        seen.add(id);
        expect(getParentCoreLens(id), `${id} is core-absorbed`).toBeFalsy();
        expect(destinationMembers.has(id), `${id} is also a destination member`).toBe(false);
        expect(destinationIds.has(id), `${id} is a destination`).toBe(false);
        expect(LENS_HOSTS[id], `${id} is itself a host`).toBeUndefined();
      }
    }
  });

  it('never puts an admin-gated or sovereign lens in a member-facing bar', () => {
    for (const s of SOVEREIGN_LENSES) expect(ADMIN_GATED_LENS_IDS.has(s)).toBe(true);
    for (const [, children] of entries) {
      for (const id of children) {
        expect(ADMIN_GATED_LENS_IDS.has(id), id).toBe(false);
        expect(ADMIN_GATE.test(fs.readFileSync(pagePath(id), 'utf8')), `${id} page has an admin gate`).toBe(false);
      }
    }
  });

  it('getHostChildren filters admin-gated ids; getHostForLens maps children to their host', () => {
    expect(getHostChildren('reflection')).toEqual(['metacognition', 'metalearning', 'affect', 'attention']);
    expect(getHostChildren('no-such-host')).toEqual([]);
    expect(getHostForLens('sync')).toBe('platform');
    expect(getHostForLens('genesis')).toBe('world-creator');
    expect(getHostForLens('platform')).toBeUndefined();
    expect(getHostForLens('crisis-ops')).toBeUndefined();
  });
});
