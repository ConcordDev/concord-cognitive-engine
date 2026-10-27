import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useListMine } from '@/hooks/useListMine';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

describe('useListMine — canonical lensRun path', () => {
  beforeEach(() => lensRun.mockReset());

  it('calls the ${domain}.recent_mine macro through lensRun and exposes items', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ok: true,
          items: [
            { id: 'a1', title: 'Alpha' },
            { id: 'a2', title: 'Beta' },
          ],
          total: 2,
        },
      },
    });
    const { result } = renderHook(() => useListMine('test-lens', { limit: 10 }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.total).toBe(2);
    expect(lensRun).toHaveBeenCalledWith('test-lens', 'recent_mine', { limit: 10 });
  });

  it('surfaces a macro-level failure as an error without throwing', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { ok: false, reason: 'no_user' } },
    });
    const { result } = renderHook(() => useListMine('test-lens'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.error?.message).toBe('no_user');
  });

  it('surfaces a network failure as an error', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'network' } });
    const { result } = renderHook(() => useListMine('test-lens'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(0);
    expect(result.current.error?.message).toBe('network');
  });
});
