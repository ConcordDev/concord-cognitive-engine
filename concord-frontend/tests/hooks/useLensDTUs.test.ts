import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the api client
vi.mock('@/lib/api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { useLensDTUs } from '@/hooks/useLensDTUs';
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

const mockContextResponse = {
  ok: true,
  dtus: [
    { id: 'h1', tier: 'hyper', content: 'hyper content', title: 'Hyper' },
    { id: 'm1', tier: 'mega', content: 'mega content', title: 'Mega' },
    { id: 'r1', tier: 'regular', content: 'regular content', title: 'Regular' },
    { id: 'r2', tier: 'regular', content: 'regular 2', title: 'Regular 2' },
  ],
  total: 4,
};

const mockDomainResponse = {
  ok: true,
  dtus: [
    { id: 'd1', tier: 'regular', content: 'domain dtu', title: 'Domain DTU' },
  ],
  total: 1,
};

describe('useLensDTUs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock sessionStorage
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });
  });

  describe('initial loading state', () => {
    it('returns loading state initially', () => {
      mockedApi.post.mockReturnValue(new Promise(() => {}));
      mockedApi.get.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      expect(result.current.isLoading).toBe(true);
      expect(result.current.contextDTUs).toEqual([]);
      expect(result.current.domainDTUs).toEqual([]);
      expect(result.current.hyperDTUs).toEqual([]);
      expect(result.current.megaDTUs).toEqual([]);
      expect(result.current.regularDTUs).toEqual([]);
    });
  });

  describe('successful data fetch', () => {
    it('fetches context and domain DTUs', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.contextDTUs).toHaveLength(4);
      expect(result.current.domainDTUs).toHaveLength(1);
    });

    it('splits DTUs by tier', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.hyperDTUs).toHaveLength(1);
      expect(result.current.hyperDTUs[0].id).toBe('h1');
      expect(result.current.megaDTUs).toHaveLength(1);
      expect(result.current.megaDTUs[0].id).toBe('m1');
      expect(result.current.regularDTUs).toHaveLength(2);
    });

    it('computes tier distribution from client data', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.tierDistribution).toEqual({
        hyper: 1,
        mega: 1,
        regular: 2,
        total: 4,
      });
    });

    it('uses server-side tier distribution when available', async () => {
      mockedApi.post.mockResolvedValue({
        data: {
          ...mockContextResponse,
          tiers: { hyper: 10, mega: 20, regular: 70, total: 100 },
        },
      });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.tierDistribution).toEqual({
        hyper: 10,
        mega: 20,
        regular: 70,
        total: 100,
      });
    });
  });

  describe('API calls', () => {
    it('calls context query with correct params', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      renderHook(() => useLensDTUs({ lens: 'research', tags: ['physics'], limit: 50 }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockedApi.post).toHaveBeenCalledWith('/api/macros/run', {
          domain: 'context',
          name: 'query',
          input: { lens: 'research', tags: ['physics'], limit: 50 },
        });
      });
    });

    it('calls domain list with correct params', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      renderHook(() => useLensDTUs({ lens: 'research', domain: 'science' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockedApi.get).toHaveBeenCalledWith('/api/dtus', {
          params: { scope: 'science', limit: 100 },
        });
      });
    });

    it('uses lens as domain scope when domain not specified', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockedApi.get).toHaveBeenCalledWith('/api/dtus', {
          params: { scope: 'research', limit: 100 },
        });
      });
    });
  });

  describe('enabled option', () => {
    it('does not fetch when enabled is false', async () => {
      const { result } = renderHook(
        () => useLensDTUs({ lens: 'research', enabled: false }),
        { wrapper: createWrapper() }
      );

      // Give time for queries to settle
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(mockedApi.post).not.toHaveBeenCalled();
      expect(mockedApi.get).not.toHaveBeenCalled();
    });
  });

  describe('error state', () => {
    it('sets isError when both queries fail', async () => {
      mockedApi.post.mockRejectedValue(new Error('Context query failed'));
      mockedApi.get.mockRejectedValue(new Error('Domain query failed'));

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      // The hook has retry: 2 built-in; with our test QueryClient retry: false,
      // the hook-level retry takes precedence. Wait for all retries to complete.
      await waitFor(
        () => {
          expect(result.current.isError).toBe(true);
        },
        { timeout: 30000 }
      );
    });

    it('returns contextDTUs as empty when context query fails', async () => {
      mockedApi.post.mockRejectedValue(new Error('Context query failed'));
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      // Wait for domain query to finish loading at minimum
      await waitFor(
        () => {
          expect(result.current.domainDTUs).toHaveLength(1);
        },
        { timeout: 30000 }
      );

      // Context DTUs should be empty since the query failed
      expect(result.current.contextDTUs).toEqual([]);
    });
  });

  describe('mutations', () => {
    it('createDTU is a callable function', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.createDTU).toBe('function');
      expect(result.current.isCreating).toBe(false);
    });

    it('publishToMarketplace is a callable function', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.publishToMarketplace).toBe('function');
      expect(result.current.isPublishing).toBe(false);
    });

    it('promoteToGlobal is a callable function', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(typeof result.current.promoteToGlobal).toBe('function');
      expect(result.current.isPromoting).toBe(false);
    });

    it('refetch triggers both context and domain queries', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      const { result } = renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // Clear mocks to check refetch
      mockedApi.post.mockClear();
      mockedApi.get.mockClear();
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockedApi.post).toHaveBeenCalled();
      expect(mockedApi.get).toHaveBeenCalled();
    });
  });

  describe('context tracking via sessionStorage', () => {
    it('stores context DTU IDs in sessionStorage', async () => {
      mockedApi.post.mockResolvedValue({ data: mockContextResponse });
      mockedApi.get.mockResolvedValue({ data: mockDomainResponse });

      renderHook(() => useLensDTUs({ lens: 'research' }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(sessionStorage.setItem).toHaveBeenCalledWith(
          'lens_context_research',
          expect.any(String)
        );
      });
    });
  });
});
