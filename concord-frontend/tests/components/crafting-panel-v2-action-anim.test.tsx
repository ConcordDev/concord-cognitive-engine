// Animation-coverage audit (2026-07-21) — CraftingPanelV2 was the primary
// player-facing craft loop (mounted directly on the world page, no station
// proximity needed) and was completely silent: a successful craft dispatched
// toast/juice/SFX events but never called playAction/playActionAtPlayer, so
// the avatar stood idle through it. Fixed by mapping recipe.category (or
// output.type as a fallback) onto the labor verb table already used by
// station overlays (RestaurantDashboard/FarmTileEditor/etc via
// lib/concordia/play-action.ts), so e.g. a weapon/tool recipe plays the real
// forge pose (hammer_tap loop, sparks, forge_ring sfx) and a consumable
// recipe plays the real cook pose (sizzle/steam) instead of nothing at all.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import CraftingPanelV2 from '@/components/world-lens/CraftingPanelV2';

const playActionAtPlayer = vi.fn();
vi.mock('@/lib/concordia/play-action', () => ({
  playActionAtPlayer: (...args: unknown[]) => playActionAtPlayer(...args),
}));

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

const RECIPE = {
  id: 'r1',
  category: 'weapon',
  ingredients: [{ type: 'wood', quantity: 2, name: 'Wood' }],
  output: { name: 'Iron Sword', type: 'weapon' },
  craftable: true,
};

describe('CraftingPanelV2 — real avatar feedback on craft (not a silent panel)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    playActionAtPlayer.mockClear();
    fetchMock = vi.fn((url: string) => {
      if (url === '/api/starter/recipes') return jsonResponse({ recipes: [RECIPE] });
      if (url === '/api/starter/inventory') return jsonResponse({ items: [] });
      return jsonResponse({ ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('plays the forge verb (category=weapon) on a successful craft', async () => {
    const { getByText } = render(<CraftingPanelV2 worldId="w1" />);
    await waitFor(() => { expect(getByText('Craft')).toBeTruthy(); });

    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === '/api/starter/craft') {
        expect(JSON.parse(String(opts?.body)).recipeId).toBe('r1');
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ recipes: [RECIPE], items: [] });
    });

    fireEvent.click(getByText('Craft'));

    await waitFor(() => { expect(playActionAtPlayer).toHaveBeenCalledWith('forge'); });
  });

  it('does not play an animation when the craft fails', async () => {
    const { getByText } = render(<CraftingPanelV2 worldId="w1" />);
    await waitFor(() => { expect(getByText('Craft')).toBeTruthy(); });

    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/starter/craft') return jsonResponse({ ok: false, error: 'insufficient_resources', missing: [] });
      return jsonResponse({ recipes: [RECIPE], items: [] });
    });

    fireEvent.click(getByText('Craft'));

    await waitFor(() => { expect(getByText(/Need:/)).toBeTruthy(); });
    expect(playActionAtPlayer).not.toHaveBeenCalled();
  });
});
