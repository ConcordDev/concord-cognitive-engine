import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDtuSurface } from '@/hooks/useDtuSurface';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

describe('useDtuSurface — canonical lensRun path', () => {
  beforeEach(() => lensRun.mockReset());

  it('records a surface event through dtu_surface.record with all required fields', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: true, recordedAt: 1 } } });
    const { result } = renderHook(() => useDtuSurface());
    await result.current.record({ dtuId: 'dtu_1', lensId: 'chat', surfaceKind: 'citation_chip', meta: { foo: 1 } });
    expect(lensRun).toHaveBeenCalledWith('dtu_surface', 'record', {
      dtuId: 'dtu_1', lensId: 'chat', surfaceKind: 'citation_chip', meta: { foo: 1 },
    });
  });

  it('does not call the macro when a required field is missing', async () => {
    const { result } = renderHook(() => useDtuSurface());
    await result.current.record({ dtuId: 'dtu_1', lensId: 'chat', surfaceKind: '' as any });
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('does not throw when the macro fails', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'db down' } });
    const { result } = renderHook(() => useDtuSurface());
    await expect(
      result.current.record({ dtuId: 'dtu_1', lensId: 'chat', surfaceKind: 'citation_chip' })
    ).resolves.toBeUndefined();
  });
});
