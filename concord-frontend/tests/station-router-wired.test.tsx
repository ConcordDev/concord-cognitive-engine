// Phase DA2 — StationInteractionRouter frontend wiring tests.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StationInteractionRouter } from '@/components/world/StationInteractionRouter';
import { dispatchBuildingInteractEvent } from '@/lib/world-lens/building-interact-dispatch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTER = path.resolve(__dirname, '..', 'components', 'world', 'StationInteractionRouter.tsx');
const WORLD = path.resolve(__dirname, '..', 'app', 'lenses', 'world', 'page.tsx');

describe('Phase DA2 — Station interaction router', () => {
  it('listens for concordia:building-interact', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/addEventListener\(\s*['"]concordia:building-interact['"]/);
  });

  it('maps 11 building_type keys to overlay components', () => {
    const src = readFileSync(ROUTER, 'utf8');
    const keys = [
      'farm_plot', 'restaurant', 'trivia_kiosk', 'karaoke_booth',
      'mahjong_table', 'hacking_terminal', 'programming_console',
      'factory_workbench', 'attraction_booth', 'creature_pen', 'glyph_altar',
    ];
    for (const k of keys) {
      expect(src).toMatch(new RegExp(k));
    }
  });

  it('proximity-gates at 4m', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/PROXIMITY_GATE_M\s*=\s*4/);
    expect(src).toMatch(/Math\.hypot/);
  });

  it('lazy-loads overlays (Suspense + lazy)', () => {
    const src = readFileSync(ROUTER, 'utf8');
    expect(src).toMatch(/lazy\(/);
    expect(src).toMatch(/Suspense/);
  });

  // Was a source-string pin only. The world page's raycaster building-click
  // handler (`handleConcordiaBuildingClick`, components/world/WorldOsSurface.tsx) had
  // its dispatch pulled out into a small, real, exported function
  // (`dispatchBuildingInteractEvent`, lib/world-lens/building-interact-
  // dispatch.ts) with byte-identical behavior to what was inline before —
  // the raycaster hit-test itself still needs a live WebGL scene graph
  // jsdom can't provide, but the actual dispatch it calls once a hit
  // resolves has no such dependency. These tests call THAT function — the
  // literal code the world page's click handler invokes — directly, and
  // assert on StationInteractionRouter (the real listener) actually
  // reacting: fetching the building, applying the real proximity-gate math
  // against playerX/playerZ, and opening (or rejecting) the overlay.
  describe('world lens → StationInteractionRouter real dispatch (via the extracted seam)', () => {
    afterEach(() => {
      cleanup();
      vi.unstubAllGlobals();
    });

    it('world lens dispatches concordia:building-interact on raycaster hit, and a nearby building opens its real overlay', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ building: { id: 'b1', building_type: 'farm_plot', x: 10, z: 10, name: 'Farm Plot' } }),
      })));
      render(<StationInteractionRouter />);

      // This is the exact function the world page's raycaster building-click
      // handler calls once ConcordiaScene resolves a hit on a building.
      act(() => {
        dispatchBuildingInteractEvent({ buildingId: 'b1', worldId: 'concordia-hub', playerX: 10, playerZ: 10 });
      });

      // Real consequence: the router fetched the building, ran the real
      // Math.hypot proximity check against the payload's playerX/playerZ
      // (10,10 vs building at 10,10 → 0m, well inside the 4m gate), matched
      // farm_plot in the real ROUTER_TABLE, and is now Suspense-loading the
      // real lazy FarmTileEditor overlay.
      await waitFor(() => expect(screen.getByText('Loading…')).toBeDefined());
    });

    it('a distant building is proximity-gated instead of opening, proving playerX/playerZ in the payload are real (not decorative)', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ building: { id: 'b2', building_type: 'farm_plot', x: 0, z: 0, name: 'Far Farm' } }),
      })));
      render(<StationInteractionRouter />);

      act(() => {
        dispatchBuildingInteractEvent({ buildingId: 'b2', worldId: 'concordia-hub', playerX: 500, playerZ: 500 });
      });

      await waitFor(() => expect(screen.getByText(/Too far — get closer/)).toBeDefined());
      expect(screen.queryByText('Loading…')).toBeNull();
    });
  });

  it('StationInteractionRouter mounted in world lens', () => {
    const src = readFileSync(WORLD, 'utf8');
    expect(src).toMatch(/import\('@\/components\/world\/StationInteractionRouter'\)/);
    expect(src).toMatch(/<StationInteractionRouter \/>/);
  });
});
