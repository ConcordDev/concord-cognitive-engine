// Regression pin (2026-07-25): BuildingRenderer3D (and friends) call
// recordAssetInteraction() once per building/NPC on every re-run of their
// render effect. Because the frontend's (source, sourceId) scheme for
// passive-presence interactions ('authored' + a building/npc DTU id) never
// matches anything the server registers under evo_assets, every one of
// those calls 404s asset_not_found — by construction, not bad luck (see
// server/lib/evo-asset/source-loaders.js + gameplay-asset-bridge.js). A
// single lens load was measured firing 20-40 doomed POSTs.
//
// recordAssetInteraction() now gates repeats: once a given (source,
// sourceId) is confirmed 404, it's remembered for a while and skipped
// instead of re-asked; an in-flight guard also collapses a same-tick burst
// for the same id into a single request. Neither gate touches the server's
// honest-404 behavior (untouched, and correct) — they only stop the client
// from re-asking a question it already knows the doomed answer to.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordAssetInteraction, clearAssetCache } from '@/lib/evo-asset/loader';

function flush(): Promise<void> {
  // Let the fetch().then()/.finally() microtask chain inside
  // recordAssetInteraction settle before assertions.
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('recordAssetInteraction noise gate', () => {
  beforeEach(() => {
    clearAssetCache();
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fires the request on the first call for a given (source, sourceId)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });
    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/evo-asset/interaction', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ source: 'authored', sourceId: 'building-1', action: 'render', weight: 0.1 }),
    }));
  });

  it('THE GATE: skips re-firing for the same id once a 404 is confirmed', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });

    // Simulates BuildingRenderer3D's render effect re-running for the same
    // building across several incremental data updates within one page load.
    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    await flush();
    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    await flush();

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not suppress a DIFFERENT asset id — real telemetry still gets through', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });

    recordAssetInteraction('authored', 'building-1', 'render', 0.1);
    await flush();
    recordAssetInteraction('authored', 'building-2', 'render', 0.1);
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('in-flight guard: a synchronous burst for the same id before the response lands only sends one request', async () => {
    let resolveFetch!: (v: { status: number }) => void;
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; }),
    );

    recordAssetInteraction('authored', 'building-3', 'render', 0.1);
    recordAssetInteraction('authored', 'building-3', 'render', 0.1);
    recordAssetInteraction('authored', 'building-3', 'render', 0.1);

    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFetch({ status: 404 });
    await flush();
  });

  it('a successful resolution is never cached negatively — repeats still fire', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });

    recordAssetInteraction('concordia', 'skill:fireball', 'use_hit', 1.0);
    await flush();
    recordAssetInteraction('concordia', 'skill:fireball', 'use_hit', 1.0);
    await flush();

    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
