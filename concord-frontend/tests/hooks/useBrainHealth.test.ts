import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBrainHealth } from '@/hooks/useBrainHealth';

describe('useBrainHealth', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns loading state initially', () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'four-brain',
        onlineCount: 3,
        brains: {
          conscious: { enabled: true, model: '', role: 'conscious', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          subconscious: { enabled: true, model: '', role: 'subconscious', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          utility: { enabled: true, model: '', role: 'utility', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
        },
      }),
    });

    const { result } = renderHook(() => useBrainHealth());
    expect(result.current.isLoading).toBe(true);
  });

  it('fetches brain health and returns status', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'four-brain',
        onlineCount: 2,
        brains: {
          conscious: { enabled: true, model: 'qwen2.5:7b', role: 'conscious', avgResponseMs: 100, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          subconscious: { enabled: true, model: 'qwen2.5:1.5b', role: 'subconscious', avgResponseMs: 50, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          utility: { enabled: false, model: 'qwen2.5:3b', role: 'utility', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
        },
      }),
    });

    const { result } = renderHook(() => useBrainHealth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 3000 });

    expect(result.current.brainStatus.conscious?.online).toBe(true);
    expect(result.current.brainStatus.utility?.online).toBe(false);
  });

  it('does not sticky-mark brains offline on fetch failure (keeps unknown/null)', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useBrainHealth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 3000 });

    // Never successfully loaded — stay unknown, not sticky all-offline (503/shed).
    expect(result.current.brainStatus.mode).toBe('unknown');
    expect(result.current.brainStatus.conscious).toBeNull();
    expect(result.current.brainStatus.subconscious).toBeNull();
    expect(result.current.brainStatus.utility).toBeNull();
    expect(result.current.brainStatus.repair).toBeNull();
  });

  it('preserves last-known-good status across a transient HTTP failure', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          mode: 'four-brain',
          onlineCount: 2,
          brains: {
            conscious: { enabled: true, model: 'qwen', role: 'conscious', avgResponseMs: 1, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
            utility: { enabled: true, model: 'qwen', role: 'utility', avgResponseMs: 1, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 });

    const { result } = renderHook(() => useBrainHealth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.brainStatus.utility?.online).toBe(true);
    }, { timeout: 3000 });

    await result.current.refresh();

    await waitFor(() => {
      // Still online from last-known-good despite 503
      expect(result.current.brainStatus.utility?.online).toBe(true);
      expect(result.current.brainStatus.conscious?.online).toBe(true);
      expect(result.current.brainStatus.mode).toBe('four-brain');
    }, { timeout: 3000 });
  });

  it('displays four brain statuses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'four-brain',
        onlineCount: 4,
        brains: {
          conscious: { enabled: true, model: '', role: 'conscious', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          subconscious: { enabled: true, model: '', role: 'subconscious', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          utility: { enabled: true, model: '', role: 'utility', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
          repair: { enabled: true, model: '', role: 'repair', avgResponseMs: 0, stats: { requests: 0, totalMs: 0, dtusGenerated: 0, errors: 0, lastCallAt: null } },
        },
      }),
    });

    const { result } = renderHook(() => useBrainHealth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 3000 });

    expect(result.current.brainStatus).toHaveProperty('conscious');
    expect(result.current.brainStatus).toHaveProperty('subconscious');
    expect(result.current.brainStatus).toHaveProperty('utility');
    expect(result.current.brainStatus).toHaveProperty('repair');
  });
});
