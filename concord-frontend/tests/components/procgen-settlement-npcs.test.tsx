/**
 * Tier-2 frontend test for ProcgenSettlementNpcs (finding #32).
 *
 * `/api/lens/run` always responds `{ ok: true, result: PAYLOAD }` — the
 * macro's own fields (here `npcs`) live under `.result`, not at the top
 * level. The component used to read `data.npcs` directly off the raw
 * response, so the procgen settlement layer silently stayed empty.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import ProcgenSettlementNpcs from '@/components/world/ProcgenSettlementNpcs';

describe('ProcgenSettlementNpcs', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('propagates NPCs from the nested result payload to the parent callback', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: {
          ok: true,
          npcs: [
            {
              id: 'settler-1',
              region_id: 'r1',
              world_id: 'tunya',
              name: 'Wanderer Kess',
              archetype: 'trader',
              faction_id: null,
              level: 3,
              x: 12,
              z: -4,
              spawned_at: 1000,
            },
          ],
          count: 1,
        },
      }),
    });

    const onSettlementNpcs = vi.fn();
    render(
      <ProcgenSettlementNpcs
        worldId="tunya"
        onSettlementNpcs={onSettlementNpcs}
        pollIntervalMs={10 * 60_000}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Called once with the empty initial rows, then again once the fetch
    // resolves and rows are populated — assert the LAST call carries the
    // real NPC.
    const lastCall = onSettlementNpcs.mock.calls[onSettlementNpcs.mock.calls.length - 1][0];
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0]).toMatchObject({ id: 'settler-1', name: 'Wanderer Kess', occupation: 'trader' });
  });
});
