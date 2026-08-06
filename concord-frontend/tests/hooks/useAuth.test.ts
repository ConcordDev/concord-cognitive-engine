import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// useAuth goes through the shared axios `api` client (so the 401
// auto-refresh interceptor fires on session expiry) instead of raw
// fetch() — mock the client the same way the rest of the hook tests do.
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { useAuth } from '@/hooks/useAuth';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

describe('useAuth', () => {
  const mockUser = {
    id: 'user-123',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user',
    scopes: ['read', 'write'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns user when authenticated', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, user: mockUser } });

    const { result } = renderHook(() => useAuth());

    // Initially loading
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('returns null when not authenticated', async () => {
    mockedApi.get.mockRejectedValue(Object.assign(new Error('Unauthorized'), {
      response: { status: 401 },
    }));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('returns null when API returns ok:false', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: false } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('isLoading is true during initial check', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout calls API and clears state', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { ok: true, user: mockUser } });
    mockedApi.post.mockResolvedValueOnce({ data: { ok: true } });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);

    // Verify logout API was called
    expect(mockedApi.post).toHaveBeenCalledWith('/api/auth/logout', {});
  });

  it('handles network error during auth check', async () => {
    mockedApi.get.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('logout clears state even if server request fails', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { ok: true, user: mockUser } });
    mockedApi.post.mockRejectedValueOnce(new Error('Logout failed'));

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    // Should still clear local state
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('refresh re-checks auth status', async () => {
    mockedApi.get
      .mockResolvedValueOnce({ data: { ok: true, user: mockUser } })
      .mockResolvedValueOnce({
        data: { ok: true, user: { ...mockUser, username: 'updateduser' } },
      });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.user?.username).toBe('testuser');

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.user?.username).toBe('updateduser');
  });

  it('calls /api/auth/me', async () => {
    mockedApi.get.mockResolvedValue({ data: { ok: true, user: mockUser } });

    renderHook(() => useAuth());

    await waitFor(() => {
      expect(mockedApi.get).toHaveBeenCalledWith('/api/auth/me');
    });
  });

  it('properly constructs user object from response', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        ok: true,
        user: {
          id: 'user-456',
          username: 'alice',
          email: 'alice@example.com',
          role: 'admin',
          scopes: ['admin', 'read', 'write'],
          extraField: 'should-be-ignored', // extra fields
        },
      },
    });

    const { result } = renderHook(() => useAuth());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    expect(result.current.user).toEqual({
      id: 'user-456',
      username: 'alice',
      email: 'alice@example.com',
      role: 'admin',
      scopes: ['admin', 'read', 'write'],
    });
  });
});
