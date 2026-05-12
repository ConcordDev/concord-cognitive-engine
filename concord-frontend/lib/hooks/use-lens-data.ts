/**
 * useLensData — Auto-seeding lens data hook
 *
 * Combines artifact fetching with auto-seeding: if the backend returns empty
 * for a domain+type, the provided seed data is bulk-created automatically.
 * This enables zero-config migration from MOCK_* to real persistence.
 *
 * Usage:
 *   const { items, isLoading, create, update, remove } = useLensData('music', 'track', {
 *     seed: SEED_TRACKS.map(t => ({ title: t.name, data: t })),
 *   });
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';

export interface LensItem<T = Record<string, unknown>> {
  id: string;
  title: string;
  data: T;
  meta: { tags: string[]; status: string; visibility: string; [key: string]: unknown };
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface SeedItem {
  title?: string;
  data?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

interface UseLensDataOptions {
  /** Seed items to auto-create when backend is empty */
  seed?: SeedItem[];
  /** Additional query filters */
  search?: string;
  tags?: string[];
  status?: string;
  limit?: number;
  /** Disable auto-seeding */
  noSeed?: boolean;
  /** Disable the query entirely */
  enabled?: boolean;
}

export function useLensData<T = Record<string, unknown>>(
  domain: string,
  type: string,
  options: UseLensDataOptions = {}
) {
  const { seed = [], search, tags, status, limit = 200, noSeed = false, enabled = true } = options;
  const qc = useQueryClient();
  const seeded = useRef(false);

  // Fetch artifacts from backend
  const { data: response, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['lens', domain, 'list', { type, search, tags, status, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('type', type);
      if (search) params.set('search', search);
      if (tags?.length) params.set('tags', tags.join(','));
      if (status) params.set('status', status);
      if (limit) params.set('limit', String(limit));
      const { data } = await api.get(`/api/lens/${domain}?${params.toString()}`);
      return data as { ok: boolean; artifacts: LensItem<T>[]; total: number };
    },
    enabled,
    staleTime: 30000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  // Auto-seed if backend returned empty and we have seed data.
  // ONLY in development — in production, empty means genuinely empty,
  // and seeding would mask real auth/connection failures.
  const isDev = process.env.NODE_ENV === 'development';
  useEffect(() => {
    if (!isDev || noSeed || seeded.current || !response || isLoading) return;
    if (response.ok && response.total === 0 && seed.length > 0) {
      seeded.current = true;
      // @env-config-ok: 1min poll for live-data lenses
      api.post(`/api/lens/${domain}/bulk`, { type, items: seed }, { timeout: 60000 })
        .then(() => {
          qc.invalidateQueries({ queryKey: ['lens', domain, 'list'] });
        })
        .catch((err) => {
          console.error(`[useLensData] Bulk seed failed for ${domain}/${type}:`, err?.message || err);
          seeded.current = false;
        });
    }
  }, [isDev, response, isLoading, domain, type, seed, noSeed, qc]);

  const items: LensItem<T>[] = response?.artifacts || [];

  // Create mutation
  const createMut = useMutation({
    mutationFn: async (input: { title?: string; data?: Partial<T>; meta?: Record<string, unknown> }) => {
      const { data } = await api.post(`/api/lens/${domain}`, { type, ...input });
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lens', domain, 'list'] }),
  });

  // Update mutation
  const updateMut = useMutation({
    mutationFn: async ({ id, ...rest }: { id: string; title?: string; data?: Partial<T>; meta?: Record<string, unknown> }) => {
      const { data } = await api.put(`/api/lens/${domain}/${id}`, rest);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lens', domain, 'list'] }),
  });

  // Delete mutation
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.delete(`/api/lens/${domain}/${id}`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lens', domain, 'list'] }),
  });

  const create = useCallback(
    (input: { title?: string; data?: Partial<T>; meta?: Record<string, unknown> }) => createMut.mutateAsync(input),
    [createMut]
  );
  const update = useCallback(
    (id: string, input: { title?: string; data?: Partial<T>; meta?: Record<string, unknown> }) => updateMut.mutateAsync({ id, ...input }),
    [updateMut]
  );
  const remove = useCallback(
    (id: string) => deleteMut.mutateAsync(id),
    [deleteMut]
  );

  return {
    items,
    total: response?.total || 0,
    isLoading,
    isError,
    error,
    isSeeding: createMut.isPending,
    refetch,
    create,
    update,
    remove,
    createMut,
    updateMut,
    deleteMut,
  };
}
