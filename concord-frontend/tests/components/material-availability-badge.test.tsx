/**
 * Tier-2 frontend test for MaterialAvailabilityBadge.
 *
 * Pins:
 *   - Renders nothing until the for_player macro returns
 *   - Renders the 4 material chips after fetch
 *   - Shows "No ammo" warning when ballistic_ammo tier is depleted
 *   - Shows "Ammo scarce" warning when tier is scarce
 *   - Hidden in combat/dialogue/vehicle/photo modes
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';
import { MaterialAvailabilityBadge } from '@/components/world/concordia-hud/MaterialAvailabilityBadge';

function mockMaterials(tier: 'abundant' | 'moderate' | 'scarce' | 'depleted', ammoValue: number) {
  return {
    ballistic_ammo:   { value: ammoValue, tier },
    magical_reagents: { value: 0.5, tier: 'moderate' },
    tech_parts:       { value: 0.5, tier: 'moderate' },
    bloodline_fuel:   { value: 0.5, tier: 'moderate' },
  };
}

beforeEach(() => {
  useHUDContext.setState({ worldId: 'tunya', inputMode: 'exploration' });
});

describe('MaterialAvailabilityBadge', () => {
  it('renders nothing initially before fetch resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => { /* never resolves */ })));
    const { container } = render(<MaterialAvailabilityBadge />);
    expect(container.querySelector('[data-testid="hud-material-availability"]')).toBeNull();
  });

  it('renders four chips after fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, materials: mockMaterials('moderate', 0.5) }),
    })));
    const { container } = render(<MaterialAvailabilityBadge />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const chips = container.querySelectorAll('[data-material-kind]');
    expect(chips.length).toBe(4);
  });

  it('shows "No ammo" warning when ballistic_ammo is depleted', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, materials: mockMaterials('depleted', 0.05) }),
    })));
    const { container } = render(<MaterialAvailabilityBadge />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const warn = container.querySelector('[data-material-warning="ballistic_ammo"]');
    expect(warn).not.toBeNull();
    expect(warn?.getAttribute('data-tier')).toBe('depleted');
    expect(container.textContent).toMatch(/no ammo/i);
  });

  it('shows "Ammo scarce" when tier is scarce', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, materials: mockMaterials('scarce', 0.20) }),
    })));
    const { container } = render(<MaterialAvailabilityBadge />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.textContent).toMatch(/ammo scarce/i);
  });

  it('does NOT show warning when ammo is abundant', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, materials: mockMaterials('abundant', 1.0) }),
    })));
    const { container } = render(<MaterialAvailabilityBadge />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-material-warning]')).toBeNull();
  });

  it('hides in combat mode even when materials are loaded', async () => {
    useHUDContext.setState({ worldId: 'tunya', inputMode: 'combat' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, materials: mockMaterials('depleted', 0.05) }),
    })));
    const { container } = render(<MaterialAvailabilityBadge />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(container.querySelector('[data-testid="hud-material-availability"]')).toBeNull();
  });
});
