// Lens-as-Station approach prompt — surfaces the nearest lens-station building
// and fires the same building-interact event a click would. Pure nearest-station
// logic + a render/keypress smoke. No mocks beyond the player-position global.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { nearestStation, LensStationPrompt, type StationBuilding } from '@/components/world/LensStationPrompt';

const buildings: StationBuilding[] = [
  { id: 'b-code', building_type: 'code_terminal', x: 800, z: 1000 },
  { id: 'b-clinic', building_type: 'clinic', x: 860, z: 1000 },
  { id: 'b-house', building_type: 'house', x: 802, z: 1001 }, // not a station
];

describe('nearestStation (pure)', () => {
  it('returns the nearest lens-station within radius, resolving its registry entry', () => {
    const hit = nearestStation({ x: 803, z: 1000 }, buildings, 6);
    expect(hit).toBeTruthy();
    expect(hit!.building.id).toBe('b-code');
    expect(hit!.station.lensId).toBe('code');
    expect(hit!.station.placeLabel).toBe('The Lattice Terminal');
  });

  it('ignores non-station buildings even when they are closest', () => {
    // The house at (802,1001) is closest, but it is not a lens station.
    const hit = nearestStation({ x: 802, z: 1001 }, buildings, 6);
    expect(hit!.building.id).toBe('b-code'); // falls through to the real station
  });

  it('returns null when nothing is within range, or player position is unknown', () => {
    expect(nearestStation({ x: 700, z: 1000 }, buildings, 6)).toBeNull();
    expect(nearestStation(null, buildings, 6)).toBeNull();
  });
});

describe('LensStationPrompt (render + trigger)', () => {
  beforeEach(() => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, buildings }),
    });
    (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos = { x: 800, z: 1000 };
  });
  afterEach(() => {
    delete (window as { __concordiaPlayerPos?: unknown }).__concordiaPlayerPos;
  });

  it('shows the nearest station prompt and dispatches building-interact on click', async () => {
    const events: CustomEvent[] = [];
    const onInteract = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener('concordia:building-interact', onInteract);

    render(<LensStationPrompt />);

    // The buildings fetch resolves, then the stations effect runs its immediate
    // proximity poll → the prompt appears (real timers, no interval advance).
    const prompt = await screen.findByText('The Lattice Terminal');
    expect(prompt).toBeTruthy();
    expect(screen.getByText(/Jack in/)).toBeTruthy();

    await act(async () => { (prompt.closest('button') as HTMLButtonElement).click(); });
    expect(events.length).toBe(1);
    expect((events[0].detail as { buildingId: string }).buildingId).toBe('b-code');

    window.removeEventListener('concordia:building-interact', onInteract);
  });
});
