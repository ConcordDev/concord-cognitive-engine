import { describe, it, expect } from 'vitest';
import {
  PANEL_REGISTRY,
  allPanels,
  getPanelById,
  searchPanels,
} from '@/lib/panel-registry';
import {
  PANEL_AFFINITY,
  MAX_PANELS_PER_DESTINATION,
  panelsForDestination,
} from '@/lib/panel-affinity';
import { getLensById } from '@/lib/lens-registry';
import {
  DESTINATIONS,
  DESTINATION_GROUPS,
  getDestinationsByGroup,
  isDestination,
} from '@/lib/destinations';

const DOTTED_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

describe('panel-registry integrity', () => {
  it('every entry has a dotted id matching its key, a label, and a lazy load thunk', () => {
    for (const [key, entry] of Object.entries(PANEL_REGISTRY)) {
      expect(entry.id, `entry.id must equal its key (${key})`).toBe(key);
      expect(DOTTED_ID.test(entry.id), `id ${entry.id} must be "domain.panel"`).toBe(true);
      expect(typeof entry.label).toBe('string');
      expect(entry.label.length).toBeGreaterThan(0);
      expect(typeof entry.load, `${entry.id}.load must be a function`).toBe('function');
      // load must be a thunk (zero-arg) so the import() stays lazy.
      expect(entry.load.length).toBe(0);
      expect(['global', 'world']).toContain(entry.scope);
    }
  });

  it('ids are unique', () => {
    const ids = allPanels().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('searchPanels finds entries by keyword and returns nothing for empty query', () => {
    expect(searchPanels('')).toEqual([]);
    const hits = searchPanels('crypto');
    expect(hits.some((p) => p.id === 'crypto.portfolio')).toBe(true);
  });

  it('every load thunk resolves to a real component (correct path + export name)', async () => {
    for (const entry of allPanels()) {
      const mod = await entry.load();
      expect(mod, `${entry.id} module`).toBeTruthy();
      expect(
        typeof mod.default === 'function' || typeof mod.default === 'object',
        `${entry.id} must resolve to a component (check path + export name)`,
      ).toBe(true);
    }
  });
});

describe('panel-affinity integrity (curation discipline)', () => {
  it('every affinity destination is a real lens id', () => {
    for (const lensId of Object.keys(PANEL_AFFINITY)) {
      expect(getLensById(lensId), `destination "${lensId}" must be a real lens`).toBeTruthy();
    }
  });

  it('every affinity panel id resolves in the registry', () => {
    for (const [lensId, panelIds] of Object.entries(PANEL_AFFINITY)) {
      for (const panelId of panelIds) {
        expect(getPanelById(panelId), `${lensId} → unknown panel "${panelId}"`).toBeTruthy();
      }
    }
  });

  it('no destination exceeds the density cap (anti-Starfield-clutter)', () => {
    for (const [lensId, panelIds] of Object.entries(PANEL_AFFINITY)) {
      expect(panelIds.length, `${lensId} over density cap`).toBeLessThanOrEqual(MAX_PANELS_PER_DESTINATION);
      // no duplicate panel in a single destination
      expect(new Set(panelIds).size, `${lensId} has duplicate panels`).toBe(panelIds.length);
    }
  });

  it('panelsForDestination returns [] for a lens with no curation', () => {
    expect(panelsForDestination('definitely-not-a-destination')).toEqual([]);
  });
});

describe('destinations integrity (the concentrated 25)', () => {
  it('every destination is a REAL, operable lens (ConKay/macro reachable)', () => {
    // ConKay operates a lens by pathname → getLensById → /api/lens-actions, so a
    // destination that isn't a real lens would be a dead front door. Guard it.
    for (const dest of DESTINATIONS) {
      expect(getLensById(dest.id), `destination "${dest.id}" must be a real lens`).toBeTruthy();
    }
  });

  it('destination ids are unique and each declares a valid group', () => {
    const ids = DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const validGroups = new Set(DESTINATION_GROUPS.map((g) => g.id));
    for (const d of DESTINATIONS) {
      expect(validGroups.has(d.group), `${d.id} has unknown group ${d.group}`).toBe(true);
      expect(typeof d.name).toBe('string');
      // lucide icons are forwardRef components (objects), not plain functions.
      expect(d.icon).toBeTruthy();
    }
  });

  it('getDestinationsByGroup covers every destination with no orphans', () => {
    const grouped = getDestinationsByGroup().flatMap((g) => g.items.map((d) => d.id));
    expect(new Set(grouped)).toEqual(new Set(DESTINATIONS.map((d) => d.id)));
  });

  it('isDestination reflects membership', () => {
    expect(isDestination(DESTINATIONS[0].id)).toBe(true);
    expect(isDestination('definitely-not-a-destination')).toBe(false);
  });
});
