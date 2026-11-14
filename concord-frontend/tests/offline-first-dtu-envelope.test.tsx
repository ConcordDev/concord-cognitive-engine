/**
 * Desk docket item (B7, CB-0623): useOfflineFirstDTU must tolerate the
 * platform's single-DTU envelope. GET /api/dtus/:id returns
 * { ok: true, dtu: <DTU> } (the dtu.get macro's shape) — the hook used
 * to hand the envelope itself to consumers as if it were the DTU and
 * to spread it into the IndexedDB cache, where the missing `id`
 * (the dtus table's primary key) made the put reject, so the fetched
 * DTU was never cached. These pins exercise the real hook: the server
 * leg unwraps the envelope, the cache write carries the DTU's own id,
 * a bare-DTU response still works, and a 404 falls through to the
 * offline error leg.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const putSpy = vi.fn(async (_rec: Record<string, unknown>) => undefined);
const getSpy = vi.fn(async (_id: string) => undefined);

vi.mock('@/lib/offline/db', () => ({
  getDB: () => ({ dtus: { get: getSpy, put: putSpy } }),
  isOnline: () => true,
}));
vi.mock('@/lib/offline/cloud-bridge', () => ({
  downloadArtifact: vi.fn(async () => null),
  isCloudConnected: () => false,
}));
vi.mock('@/lib/offline/storage-manager', () => ({
  touchDTU: vi.fn(),
}));

import { useOfflineFirstDTU } from '@/hooks/useOfflineFirst';

const DTU = { id: 'dtu-env-1', title: 'Envelope DTU', summary: 's', tier: 'regular' };

function mockFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })));
}

beforeEach(() => {
  putSpy.mockClear();
  getSpy.mockClear();
  getSpy.mockResolvedValue(undefined);
});

describe('useOfflineFirstDTU envelope tolerance', () => {
  it('unwraps the { ok, dtu } envelope — data is the DTU itself', async () => {
    mockFetch({ ok: true, dtu: DTU });
    const { result } = renderHook(() => useOfflineFirstDTU('dtu-env-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const data = result.current.data as Record<string, unknown>;
    expect(data?.title).toBe('Envelope DTU');
    expect(data?.id).toBe('dtu-env-1');
    expect(data).not.toHaveProperty('dtu');
    expect(result.current.source).toBe('server');
  });

  it('caches the unwrapped DTU under its own id', async () => {
    mockFetch({ ok: true, dtu: DTU });
    const { result } = renderHook(() => useOfflineFirstDTU('dtu-env-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(putSpy).toHaveBeenCalledTimes(1);
    const rec = putSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(rec.id).toBe('dtu-env-1');
    expect(rec.title).toBe('Envelope DTU');
    expect(rec.synced).toBe(true);
    expect(rec).not.toHaveProperty('dtu');
  });

  it('tolerates a bare DTU response as-is', async () => {
    mockFetch(DTU);
    const { result } = renderHook(() => useOfflineFirstDTU('dtu-env-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect((result.current.data as Record<string, unknown>)?.title).toBe('Envelope DTU');
  });

  it('a 404 falls through to the offline error leg', async () => {
    mockFetch({ ok: false, error: 'DTU not found' }, false, 404);
    const { result } = renderHook(() => useOfflineFirstDTU('dtu-env-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('offline, data not cached locally');
    expect(putSpy).not.toHaveBeenCalled();
  });
});
