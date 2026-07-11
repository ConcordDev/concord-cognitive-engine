import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api client before importing the hook
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { use70Lock, DEFAULT_INVARIANTS } from '@/hooks/use70Lock';
import { api } from '@/lib/api/client';

const mockedApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

describe('use70Lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initial/loading state', () => {
    it('returns default values while loading', () => {
      mockedApi.get.mockReturnValue(new Promise(() => {})); // never resolves
      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.lockPercentage).toBe(0);
      expect(result.current.invariants).toEqual([]);
      expect(result.current.lastAudit).toBeUndefined();
      expect(result.current.isHealthy).toBe(true);
      expect(result.current.isLocked).toBe(false);
      expect(result.current.lockColor).toBe('sovereignty-danger');
      expect(result.current.invariantSummary).toEqual({
        enforced: 0,
        warning: 0,
        violated: 0,
      });
      expect(result.current.isAuditing).toBe(false);
      expect(typeof result.current.runAudit).toBe('function');
    });
  });

  describe('successful fetch', () => {
    it('returns sovereignty data when fetch succeeds with lock above 70%', async () => {
      const mockStatus = {
        sovereigntyPct: 85,
        invariants: [
          { id: 'no-telemetry', name: 'NO_TELEMETRY', status: 'enforced', description: 'No tracking', lastChecked: '2026-01-01' },
          { id: 'no-ads', name: 'NO_ADS', status: 'warning', description: 'No ads', lastChecked: '2026-01-01' },
          { id: 'local-first', name: 'LOCAL_FIRST', status: 'violated', description: 'Local first', lastChecked: '2026-01-01' },
        ],
        lastAudit: '2026-01-01T00:00:00Z',
        isHealthy: true,
      };

      mockedApi.get.mockResolvedValue({ data: mockStatus });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.lockPercentage).toBe(85);
      expect(result.current.invariants).toHaveLength(3);
      expect(result.current.lastAudit).toBe('2026-01-01T00:00:00Z');
      expect(result.current.isHealthy).toBe(true);
      expect(result.current.isLocked).toBe(true);
      expect(result.current.lockColor).toBe('sovereignty-locked');
      expect(result.current.invariantSummary).toEqual({
        enforced: 1,
        warning: 1,
        violated: 1,
      });
    });

    it('sets isLocked=false when lockPercentage is below 70', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          sovereigntyPct: 55,
          invariants: [],
          lastAudit: '2026-01-01',
          isHealthy: false,
        },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isLocked).toBe(false);
      expect(result.current.lockColor).toBe('sovereignty-warning');
      expect(result.current.isHealthy).toBe(false);
    });

    it('returns sovereignty-danger for lockPercentage below 50', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          sovereigntyPct: 30,
          invariants: [],
          lastAudit: '2026-01-01',
          isHealthy: false,
        },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.lockColor).toBe('sovereignty-danger');
    });

    it('sets isLocked=true when lockPercentage is exactly 70', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          sovereigntyPct: 70,
          invariants: [],
          lastAudit: '2026-01-01',
          isHealthy: true,
        },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isLocked).toBe(true);
      expect(result.current.lockColor).toBe('sovereignty-locked');
    });
  });

  describe('fetch error', () => {
    it('returns error when fetch fails', async () => {
      mockedApi.get.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.error).toBeTruthy());

      expect(result.current.lockPercentage).toBe(0);
      expect(result.current.isLocked).toBe(false);
    });
  });

  describe('runAudit', () => {
    it('calls POST /api/sovereignty/audit and invalidates query', async () => {
      mockedApi.get.mockResolvedValue({
        data: {
          sovereigntyPct: 80,
          invariants: [],
          lastAudit: '2026-01-01',
          isHealthy: true,
        },
      });
      mockedApi.post.mockResolvedValue({ data: { ok: true } });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => {
        result.current.runAudit();
      });

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith('/api/sovereignty/audit');
      });
    });
  });

  describe('getLockColor', () => {
    it('returns sovereignty-locked at boundary (70)', async () => {
      mockedApi.get.mockResolvedValue({
        data: { sovereigntyPct: 70, invariants: [], lastAudit: '', isHealthy: true },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.lockColor).toBe('sovereignty-locked');
    });

    it('returns sovereignty-warning at boundary (50)', async () => {
      mockedApi.get.mockResolvedValue({
        data: { sovereigntyPct: 50, invariants: [], lastAudit: '', isHealthy: true },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.lockColor).toBe('sovereignty-warning');
    });

    it('returns sovereignty-danger at 49', async () => {
      mockedApi.get.mockResolvedValue({
        data: { sovereigntyPct: 49, invariants: [], lastAudit: '', isHealthy: true },
      });

      const { result } = renderHook(() => use70Lock(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.lockColor).toBe('sovereignty-danger');
    });
  });

  describe('DEFAULT_INVARIANTS', () => {
    it('exports 7 default invariants all with enforced status', () => {
      expect(DEFAULT_INVARIANTS).toHaveLength(7);
      DEFAULT_INVARIANTS.forEach((inv) => {
        expect(inv.status).toBe('enforced');
        expect(inv.id).toBeTruthy();
        expect(inv.name).toBeTruthy();
        expect(inv.description).toBeTruthy();
        expect(inv.lastChecked).toBeTruthy();
      });
    });

    it('contains expected invariant IDs', () => {
      const ids = DEFAULT_INVARIANTS.map((i) => i.id);
      expect(ids).toContain('no-telemetry');
      expect(ids).toContain('no-ads');
      expect(ids).toContain('no-resale');
      expect(ids).toContain('local-first');
      expect(ids).toContain('owner-control');
      expect(ids).toContain('transparent-ops');
      expect(ids).toContain('no-dark-patterns');
    });
  });
});
