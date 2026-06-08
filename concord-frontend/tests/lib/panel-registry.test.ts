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
