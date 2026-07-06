import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { macro } from '@/components/world/concordia-hud/panels/_macro';
import { macroCall } from '@/components/world/concordia-hud/HUDContextProvider';

/**
 * Regression pin: POST /api/lens/run always wraps a macro's own payload as
 * { ok:true, result: PAYLOAD } — the outer `ok` is a transport flag, not the
 * macro's success/failure. Both `macro()` (13 Concordia HUD panels) and
 * `macroCall()` (HUDContextProvider's live poll) used to return the raw
 * envelope, so every caller's field reads (e.g. `r.schemes`) were always
 * undefined. Fixed to unwrap `.result` once, inside the shared helper.
 */
describe('Concordia HUD macro helpers unwrap the lens-run envelope', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('macro() returns the macro payload, not the outer envelope', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, schemes: [{ id: 's1' }] } }),
    });
    const r = await macro('schemes', 'list_for_user');
    expect(r).toEqual({ ok: true, schemes: [{ id: 's1' }] });
    // The historical bug: reading r.schemes off the un-unwrapped envelope.
    expect((r as { schemes?: unknown[] })?.schemes).toEqual([{ id: 's1' }]);
  });

  it('macro() returns null on HTTP failure (unchanged transport-error behavior)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });
    const r = await macro('schemes', 'list_for_user');
    expect(r).toBeNull();
  });

  it('macroCall() returns the macro payload, not the outer envelope', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { ok: true, jobs: [{ id: 'j1' }] } }),
    });
    const r = await macroCall('craft_chains', 'my_jobs');
    expect(r).toEqual({ ok: true, jobs: [{ id: 'j1' }] });
    expect((r as { jobs?: unknown[] })?.jobs).toEqual([{ id: 'j1' }]);
  });

  it('macroCall() falls back to the raw body if result is absent (back-compat)', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, season: 'winter' }),
    });
    const r = await macroCall('season', 'current');
    expect(r).toEqual({ ok: true, season: 'winter' });
  });
});
