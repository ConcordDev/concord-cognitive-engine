// Lens-as-Station approach prompt — surfaces the nearest lens-station building
// and fires the same building-interact event a click would. Pure nearest-station
// logic + a render/keypress smoke. No mocks beyond the player-position global.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { nearestStation, LensStationPrompt, type StationBuilding } from '@/components/world/LensStationPrompt';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';

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
    // Player position is in the origin-centred scene frame; the fetched building
    // at server (800,1000) shifts to scene (-200,0), so the player stands there.
    (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos = { x: -200, z: 0 };
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

// Runtime-health capability map finding #11 — this component used to read
// `concordia:activeWorldId` from localStorage in a mount-only effect, so
// traveling to a different world in the SAME tab (portals / Concord Link /
// fast-travel, no navigation away from /lenses/world) left it permanently
// querying the OLD world's buildings. It's now driven by useActiveWorldId(),
// which is reactive to the `concordia:active-world-changed` CustomEvent
// dispatched by useWorldTravel.
describe('LensStationPrompt (same-tab world travel)', () => {
  const tunyaBuildings: StationBuilding[] = []; // no lens-stations in the new world

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.includes('/api/worlds/tunya/buildings')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, buildings: tunyaBuildings }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, buildings }) });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    (window as { __concordiaPlayerPos?: { x: number; z: number } }).__concordiaPlayerPos = { x: -200, z: 0 };
  });
  afterEach(() => {
    delete (window as { __concordiaPlayerPos?: unknown }).__concordiaPlayerPos;
  });

  it('re-fetches buildings scoped to the new world and drops the stale prompt on travel', async () => {
    render(<LensStationPrompt />);

    // Defaults to 'concordia-hub' (no localStorage key set) — the hub's
    // code-terminal prompt appears.
    await screen.findByText('The Lattice Terminal');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/worlds/concordia-hub/buildings'))).toBe(true);

    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVE_WORLD_CHANGED_EVENT, { detail: { worldId: 'tunya' } }));
    });

    // The stale prompt is cleared IMMEDIATELY — synchronously, before the new
    // world's buildings fetch even resolves. A pure hook swap without this
    // reset would leave the old world's prompt (and its buildingId) live
    // until the new fetch landed.
    expect(screen.queryByText('The Lattice Terminal')).toBeNull();

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('/api/worlds/tunya/buildings'))).toBe(true));

    // Tunya has no lens-stations — the prompt never reappears, proving the
    // component is genuinely querying the new world, not just clearing state
    // and re-showing the old data once the (unrelated) fetch resolves.
    await new Promise((r) => setTimeout(r, 350)); // let the 300ms proximity poll tick at least once
    expect(screen.queryByText('The Lattice Terminal')).toBeNull();
  });
});
