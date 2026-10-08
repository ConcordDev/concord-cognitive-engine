import { describe, it, expect, vi, afterEach } from 'vitest';
import { beamQuery, depthSweepValues, solveDemoBeam, sweepDemoBeam, fetchDemoMaterials } from '@/lib/conkay/demo-api';
import { NEW_STUDY } from '@/components/conkay/workspace/useConKayWorkspace';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({ status, json: async () => body });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('ConKay demo API client', () => {
  it('builds the beam query from the study inputs', () => {
    const q = beamQuery(NEW_STUDY);
    expect(q.get('length')).toBe('1200');
    expect(q.get('webThickness')).toBe('9');
    expect(q.get('loadN')).toBe('200000');
    expect(q.get('support')).toBe('simply-supported');
    expect(q.get('material')).toBe('steel-a992');
  });

  it('calls the demo route without credentials', async () => {
    const f = mockFetch(200, { ok: true, saved: false, result: { maxStressMPa: 12.5, utilizationByMember: [], dims: NEW_STUDY.dims } });
    const r = await solveDemoBeam(NEW_STUDY);
    expect(f.mock.calls[0][0]).toMatch(/^\/api\/conkay\/demo\/beam\?/);
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'omit' });
    expect('error' in r).toBe(false);
    if (!('error' in r)) {
      expect(r.maxStressMPa).toBe(12.5);
      expect(r.jobId).toBeNull();
      expect(r.dtuId).toBeNull();
    }
  });

  it('passes the solver reason through on a 400', async () => {
    mockFetch(400, { ok: false, error: 'the two flanges are thicker than the beam is tall' });
    expect(await solveDemoBeam(NEW_STUDY)).toEqual({ error: 'the two flanges are thicker than the beam is tall' });
  });

  it('never shows a result without a finite stress', async () => {
    mockFetch(200, { ok: true, result: { maxStressMPa: null } });
    expect(await solveDemoBeam(NEW_STUDY)).toEqual({ error: 'The solver returned no result.' });
  });

  it('explains a rate limit plainly', async () => {
    mockFetch(429, { error: 'Rate limit exceeded' });
    const r = await fetchDemoMaterials();
    expect(r).toEqual({ error: 'Too many solves from this connection. Wait a minute and try again.' });
  });

  it('sends the sweep parameter and values', async () => {
    const f = mockFetch(200, { ok: true, result: { param: 'height', rows: [], lightestPassing: null, elapsedMs: 1 } });
    await sweepDemoBeam(NEW_STUDY, 'height', [180, 240, 300]);
    const url = new URL(f.mock.calls[0][0], 'http://x');
    expect(url.searchParams.get('param')).toBe('height');
    expect(url.searchParams.get('values')).toBe('180,240,300');
  });

  it('sweep depths are whole millimetres around the current depth', () => {
    expect(depthSweepValues(300)).toEqual([180, 240, 300, 360, 420]);
    expect(depthSweepValues(1)).toEqual([1, 2]);
  });
});
