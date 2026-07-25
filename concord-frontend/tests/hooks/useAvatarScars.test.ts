// Real behavioral coverage for useAvatarScars (Phase BA5) — independent of
// AvatarSystem3D, which is too Three.js-heavy to mount in jsdom (see
// tests/avatar-scar-render.test.tsx's header for that exemption + how it
// covers AvatarSystem3D's own wiring via the extracted buildAvatarWearState
// pure function instead). This file drives the REAL hook via renderHook +
// a mocked fetch, proving the actual fetch/parse/clamp behavior works —
// not a regex match against source text.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAvatarScars } from '@/hooks/useAvatarScars';

describe('useAvatarScars', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches both /scars and /drift for the given userId and returns the real parsed values', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/scars')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            scars: [{ id: 's1', region: 'torso', source: 'combat', severity: 0.5, acquired_at: 1, visible_label: null }],
          }),
        });
      }
      if (url.includes('/drift')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, drift_score: 0.37 }) });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    const { result } = renderHook(() => useAvatarScars('user-42'));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user-42/scars');
    expect(mockFetch).toHaveBeenCalledWith('/api/avatars/user-42/drift');
    expect(result.current.scars).toHaveLength(1);
    expect(result.current.scars[0].id).toBe('s1');
    expect(result.current.drift).toBeCloseTo(0.37);
  });

  it('clamps drift_score into [0, 1] even when the backend sends an out-of-range value', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/scars')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, scars: [] }) });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, drift_score: 4.2 }) });
    });

    const { result } = renderHook(() => useAvatarScars('user-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.drift).toBe(1);
  });

  it('does not fetch at all when userId is null/undefined', () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useAvatarScars(null));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('leaves scars/drift at their safe defaults when the requests fail', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useAvatarScars('user-9'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.scars).toEqual([]);
    expect(result.current.drift).toBe(0);
  });
});
