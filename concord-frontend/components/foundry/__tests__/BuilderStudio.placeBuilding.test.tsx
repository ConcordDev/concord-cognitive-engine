/// <reference types="@testing-library/jest-dom/vitest" />
// Asset Studio Increment 2-B — place an authored building INTO the selected
// Foundry world from the Foundry builder's Assets tab.
//
// The BuilderStudio Assets tab now carries a "Place a building" flow that mirrors
// AssetStudioPanel's publish payload EXACTLY, but binds worldId to the chosen
// Foundry world (NOT 'concordia-hub') and exposes world-frame x/y/z placement.
// It calls the real `game-design.building-publish` macro via lensRun and renders
// the REAL returned buildingId on success / the REAL error (incl. `overlap`) on
// failure — never a fabricated success.
//
// BuilderStudio auto-selects the first foundry world from `foundry.list`, so we
// mock lensRun to resolve list/asset lookups (making the Assets tab reachable
// with a selected world) and to return a controllable building-publish response.
// ChartKit (viz) is stubbed — it only mounts under the unrelated Analytics tab.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const FOUNDRY_WORLD_ID = 'fw_test_42';

const h = vi.hoisted(() => ({ lensRun: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ lensRun: h.lensRun }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { BuilderStudio } from '@/components/foundry/BuilderStudio';

// A lensRun that makes the Assets tab reachable (foundry.list yields one world,
// auto-selected) and returns `publish` for game-design.building-publish.
function installLensRun(publish: { data: { ok: boolean; result: unknown; error: string | null } }) {
  h.lensRun.mockImplementation(async (domain: string, action: string) => {
    if (domain === 'foundry' && action === 'list') {
      return { data: { ok: true, result: { worlds: [{ id: FOUNDRY_WORLD_ID, name: 'Testworld', status: 'draft' }] }, error: null } };
    }
    if (domain === 'foundry' && action === 'asset_kinds') {
      return { data: { ok: true, result: { kinds: ['mesh'] }, error: null } };
    }
    if (domain === 'foundry' && action === 'asset_list') {
      return { data: { ok: true, result: { assets: [] }, error: null } };
    }
    // The default Scripting tab mounts first — feed its lookups real shapes so
    // its mount effects don't reject before we switch to Assets.
    if (domain === 'foundry' && action === 'blueprint_kinds') {
      return { data: { ok: true, result: { nodeKinds: ['event'], eventTypes: [], actionTypes: [] }, error: null } };
    }
    if (domain === 'foundry' && action === 'blueprint_get') {
      return { data: { ok: true, result: { blueprint: { nodes: [], edges: [] }, validation: { ok: true, errors: [], warnings: [], nodeCount: 0, edgeCount: 0 } }, error: null } };
    }
    if (domain === 'game-design' && action === 'building-publish') return publish;
    return { data: { ok: true, result: {}, error: null } };
  });
}

// Render BuilderStudio, wait for the world to auto-select, open the Assets tab.
async function renderAtAssets() {
  render(<BuilderStudio />);
  await screen.findByRole('option', { name: /Testworld/ });
  fireEvent.click(screen.getByRole('button', { name: /Assets/ }));
  await screen.findByLabelText('Building archetype');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BuilderStudio Assets tab — place a building into the Foundry world', () => {
  it('renders the place-a-building form with the archetype picker and x/y/z position inputs', async () => {
    installLensRun({ data: { ok: true, result: {}, error: null } });
    await renderAtAssets();

    // Archetype picker over the 5 real archetypes.
    const arch = screen.getByLabelText('Building archetype') as HTMLSelectElement;
    const archValues = Array.from(arch.options).map((o) => o.value);
    expect(archValues).toEqual(['tavern', 'archive', 'forge', 'market', 'tower']);

    // World-frame position inputs, defaulting to the world centre (1000/0/1000).
    expect((screen.getByLabelText('Position X') as HTMLInputElement).value).toBe('1000');
    expect((screen.getByLabelText('Position Y') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('Position Z') as HTMLInputElement).value).toBe('1000');

    expect(screen.getByRole('button', { name: /Place building/ })).toBeInTheDocument();
  });

  it('places into the selected Foundry world (not concordia-hub) with the entered dimensions/position and renders the real returned buildingId', async () => {
    installLensRun({
      data: { ok: true, result: { dtuId: 'dtu_new_9', buildingId: 'b_new_1', spawned: true }, error: null },
    });
    await renderAtAssets();

    fireEvent.change(screen.getByLabelText('Building archetype'), { target: { value: 'archive' } });
    fireEvent.change(screen.getByLabelText('Width (m)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Height (m)'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Depth (m)'), { target: { value: '9' } });
    fireEvent.change(screen.getByLabelText('Position X'), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText('Position Z'), { target: { value: '900' } });

    fireEvent.click(screen.getByRole('button', { name: /Place building/ }));

    await waitFor(() =>
      expect(h.lensRun).toHaveBeenCalledWith(
        'game-design',
        'building-publish',
        expect.objectContaining({
          worldId: FOUNDRY_WORLD_ID,
          archetype: 'archive',
          dimensions: { width: 10, height: 7, depth: 9 },
          position: { x: 1200, y: 0, z: 900 },
        }),
      ),
    );

    // The bound world is the Foundry world, NOT the standalone default.
    const publishCall = h.lensRun.mock.calls.find(
      (c) => c[0] === 'game-design' && c[1] === 'building-publish',
    );
    expect((publishCall![2] as { worldId: string }).worldId).not.toBe('concordia-hub');

    // The REAL returned buildingId is rendered — not a fabricated confirmation.
    expect(await screen.findByText(/b_new_1/)).toBeInTheDocument();
    expect(screen.getByText(/dtu_new_9/)).toBeInTheDocument();
  });

  it('surfaces the real overlap error verbatim on an {ok:false,error:"overlap"} response — never a fabricated success', async () => {
    installLensRun({ data: { ok: false, result: null, error: 'overlap' } });
    await renderAtAssets();

    fireEvent.click(screen.getByRole('button', { name: /Place building/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/overlap/);

    // No fabricated success panel.
    expect(screen.queryByText(/switch to Playtest to walk it/)).not.toBeInTheDocument();
  });
});
