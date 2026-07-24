// WorldEventBeacons — V1.2 Wave A adds spontaneous-gathering beacons on top
// of the existing authored-event beacons. This is a real render + imperative
// Three.js-scene behavioral test: mount the component against a real
// THREE.Scene stashed at window.__concordiaScene (the same global the
// production ConcordiaScene component sets), let it poll, and assert real
// beacon groups land in the scene at the REAL gathering centroid — not a
// hashed/fabricated spot like the authored-event beacons use.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import * as THREE from 'three';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import WorldEventBeacons from './WorldEventBeacons';

function gatheringsResult(gatherings: unknown[]) {
  return { data: { ok: true, result: { gatherings } } };
}

declare global {
  var __concordiaScene: THREE.Scene | undefined;
}

describe('WorldEventBeacons', () => {
  let scene: THREE.Scene;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    scene = new THREE.Scene();
    window.__concordiaScene = scene;
    lensRun.mockReset();
    lensRun.mockResolvedValue(gatheringsResult([]));
    // No authored events by default — isolates the gathering-beacon behavior.
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    } as Response);
  });

  afterEach(() => {
    cleanup();
    fetchSpy.mockRestore();
    delete window.__concordiaScene;
  });

  it('renders a beacon for a live spontaneous gathering at its real centroid', async () => {
    lensRun.mockResolvedValue(
      gatheringsResult([
        { id: 'gather_w_1:2', location: 'plaza', playerCount: 4, description: '4 players gathering at plaza', x: 55.5, y: 1, z: -12.25 },
      ]),
    );

    render(<WorldEventBeacons worldId="w" pollMs={999999} />);

    await waitFor(() => {
      const group = scene.getObjectByName('world-gathering-beacon:gather_w_1:2') as THREE.Group | undefined;
      expect(group).toBeTruthy();
    });

    const group = scene.getObjectByName('world-gathering-beacon:gather_w_1:2') as THREE.Group;
    // Real, non-fabricated position — exactly the gathering's centroid, not
    // a hash-derived spot (that mechanism is reserved for authored events
    // which carry no position of their own).
    expect(group.position.x).toBeCloseTo(55.5);
    expect(group.position.y).toBeCloseTo(1);
    expect(group.position.z).toBeCloseTo(-12.25);

    expect(lensRun).toHaveBeenCalledWith('world', 'gatherings', { worldId: 'w' });
  });

  it('never renders a gathering beacon when the macro reports no gatherings (honest-empty)', async () => {
    render(<WorldEventBeacons worldId="w" pollMs={999999} />);

    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    // Give any (incorrect) fabrication path a chance to run before asserting absence.
    await new Promise((r) => setTimeout(r, 20));
    const gatheringGroups = scene.children.filter((c) => c.name.startsWith('world-gathering-beacon:'));
    expect(gatheringGroups).toHaveLength(0);
  });

  it('removes a gathering beacon once that gathering is no longer detected on the next poll', async () => {
    lensRun.mockResolvedValueOnce(
      gatheringsResult([
        { id: 'gather_w_5:5', location: 'market', playerCount: 3, description: '3 players gathering at market', x: 10, y: 0, z: 10 },
      ]),
    );
    // The component floors the poll interval at 3000ms (`Math.max(3000, pollMs)`)
    // regardless of what's requested, so the next real poll lands ~3s out.
    render(<WorldEventBeacons worldId="w" pollMs={100} />);
    await waitFor(() => {
      expect(scene.getObjectByName('world-gathering-beacon:gather_w_5:5')).toBeTruthy();
    });

    // Cluster dissolves — the next poll must diff it out and dispose the group.
    lensRun.mockResolvedValue(gatheringsResult([]));
    await waitFor(
      () => {
        expect(scene.getObjectByName('world-gathering-beacon:gather_w_5:5')).toBeUndefined();
      },
      { timeout: 5000 },
    );
  }, 8000);

  it('caps rendered gathering beacons at the top-N most populous clusters', async () => {
    const gatherings = Array.from({ length: 8 }, (_, i) => ({
      id: `gather_w_${i}:0`, location: `spot-${i}`, playerCount: i + 2,
      description: `${i + 2} players gathering at spot-${i}`, x: i * 10, y: 0, z: 0,
    }));
    lensRun.mockResolvedValue(gatheringsResult(gatherings));

    render(<WorldEventBeacons worldId="w" pollMs={999999} />);

    await waitFor(() => {
      const groups = scene.children.filter((c) => c.name.startsWith('world-gathering-beacon:'));
      expect(groups.length).toBeGreaterThan(0);
    });
    const groups = scene.children.filter((c) => c.name.startsWith('world-gathering-beacon:'));
    expect(groups).toHaveLength(5);
    // The 5 most populous (playerCount 9,8,7,6,5 → ids for i=7,6,5,4,3) survive.
    for (const i of [7, 6, 5, 4, 3]) {
      expect(scene.getObjectByName(`world-gathering-beacon:gather_w_${i}:0`)).toBeTruthy();
    }
  });
});
