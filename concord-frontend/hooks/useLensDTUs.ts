'use client';

/**
 * useLensDTUs — Universal lens DTU hook
 *
 * Provides DTU context for any lens by combining:
 *   - Context DTUs (regular + MEGA + HYPER) via POST /api/macros/run (context.query)
 *   - Domain-specific DTUs via GET /api/dtus
 *   - createDTU mutation via POST /api/dtus
 *   - publishToMarketplace mutation via POST /api/dtus/:id/publish
 *
 * Exposes tier-split collections and a computed tier distribution for
 * display in LensContextPanel or any lens-specific UI.
 *
 * Usage:
 *   const {
 *     contextDTUs, hyperDTUs, megaDTUs, regularDTUs,
 *     domainDTUs, tierDistribution,
 *     createDTU, publishToMarketplace,
 *     isLoading, isError, refetch,
 *   } = useLensDTUs({ lens: 'research', domain: 'science' });
 */

import { useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { DTU, DTUTier } from '@/lib/api/generated-types';

// ---- Types ----------------------------------------------------------------

export interface LensDTUOptions {
  /** Current lens identifier (e.g. 'research', 'code', 'art'). */
  lens: string;
  /** Optional domain scope for domain-specific DTU list. */
  domain?: string;
  /** Optional tags to filter context query. */
  tags?: string[];
  /** Max DTUs to return from context query. Default 100. */
  limit?: number;
  /** Disable fetching (e.g. when a prerequisite is missing). */
  enabled?: boolean;
  /** Stale time in ms for query cache. Default 30000 (30s). */
  staleTime?: number;
}

export interface TierDistribution {
  hyper: number;
  mega: number;
  regular: number;
  total: number;
}

interface ContextQueryResponse {
  ok: boolean;
  dtus: DTU[];
  total: number;
  tiers?: TierDistribution;
}

interface DomainListResponse {
  ok: boolean;
  dtus: DTU[];
  total: number;
}

interface CreateDTUInput {
  title?: string;
  content: string;
  tags?: string[];
  tier?: DTUTier;
  source?: string;
  parents?: string[];
  citationType?: string;
  artifactSourcesUsed?: string[];
  meta?: Record<string, unknown>;
  contentClass?: string;
  licenseScopes?: string[];
  scopes?: string[];
  license?: { scopes?: string[]; listingScopes?: string[]; [key: string]: unknown };
}

interface CreateDTUResponse {
  ok: boolean;
  dtu: DTU;
}

interface PublishInput {
  dtuId: string;
  price?: number;
  description?: string;
  license?: string;
}

interface PublishResponse {
  ok: boolean;
  listingId: string;
}

// ---- Hook ------------------------------------------------------------------

export function useLensDTUs(options: LensDTUOptions) {
  const {
    lens,
    domain,
    tags,
    limit = 100,
    enabled = true,
    staleTime = 30_000,
  } = options;

  const qc = useQueryClient();

  // ---- Context DTUs query (regular + MEGA + HYPER) ----
  const contextBody = useMemo(
    () => ({ query: lens, primaryDomain: lens, lens, tags, limit }),
    [lens, tags, limit],
  );

  const contextQuery = useQuery<ContextQueryResponse>({
    queryKey: ['lensDTUs', 'context', lens, { tags, limit }],
    queryFn: async () => {
      const { data } = await api.post('/api/macros/run', {
        domain: 'context',
        name: 'query',
        input: contextBody,
      });
      return data as ContextQueryResponse;
    },
    enabled,
    staleTime,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  // ---- Domain-specific DTUs query ----
  const domainQuery = useQuery<DomainListResponse>({
    queryKey: ['lensDTUs', 'domain', domain ?? lens],
    queryFn: async () => {
      const { data } = await api.get('/api/dtus', {
        params: { scope: domain ?? lens, limit },
      });
      return data as DomainListResponse;
    },
    enabled: enabled && Boolean(domain ?? lens),
    staleTime,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  // ---- Derived collections ----
  const contextDTUs: DTU[] = useMemo(() => contextQuery.data?.dtus ?? [], [contextQuery.data?.dtus]);

  const hyperDTUs = useMemo(
    () => contextDTUs.filter((d) => d.tier === 'hyper'),
    [contextDTUs],
  );

  const megaDTUs = useMemo(
    () => contextDTUs.filter((d) => d.tier === 'mega'),
    [contextDTUs],
  );

  const regularDTUs = useMemo(
    () => contextDTUs.filter((d) => d.tier === 'regular'),
    [contextDTUs],
  );

  const domainDTUs: DTU[] = domainQuery.data?.dtus ?? [];

  // ---- Tier distribution ----
  const tierDistribution: TierDistribution = useMemo(() => {
    // Prefer server-side tiers when available
    if (contextQuery.data?.tiers) return contextQuery.data.tiers;
    return {
      hyper: hyperDTUs.length,
      mega: megaDTUs.length,
      regular: regularDTUs.length,
      total: contextDTUs.length,
    };
  }, [contextQuery.data?.tiers, hyperDTUs.length, megaDTUs.length, regularDTUs.length, contextDTUs.length]);

  // ---- Track which DTUs are in active context for citation detection ----
  useEffect(() => {
    if (contextDTUs.length > 0) {
      const contextIds = contextDTUs.map((d) => d.id).filter(Boolean);
      try {
        sessionStorage.setItem(`lens_context_${lens}`, JSON.stringify(contextIds));
      } catch { /* sessionStorage unavailable */ }
    }
  }, [contextDTUs, lens]);

  // ---- Create DTU mutation (with context tracking) ----
  const createMut = useMutation<CreateDTUResponse, Error, CreateDTUInput>({
    mutationFn: async (input) => {
      let activeContext: string[] = [];
      try {
        activeContext = JSON.parse(sessionStorage.getItem(`lens_context_${lens}`) || '[]');
      } catch { /* silent */ }

      const licenseScopes =
        (Array.isArray(input.licenseScopes) && input.licenseScopes.length > 0
          ? input.licenseScopes
          : null) ||
        (Array.isArray(input.scopes) && input.scopes.length > 0 ? input.scopes : null) ||
        (Array.isArray(input.license?.scopes) && input.license!.scopes!.length > 0
          ? input.license!.scopes!
          : null) ||
        ['private'];
      const contentClass = input.contentClass || (input.meta?.contentClass as string | undefined) || 'generic';
      const { data } = await api.post('/api/dtus', {
        title: input.title,
        content: input.content,
        tags: input.tags || [],
        source: input.source || lens,
        parents: input.parents || [],
        contentClass,
        licenseScopes,
        scopes: licenseScopes,
        license: { ...(input.license || {}), scopes: licenseScopes },
        meta: {
          ...(input.meta || {}),
          lens,
          domain: lens,
          contextAtCreation: activeContext,
          citationType: input.citationType || 'reference',
          artifactSourcesUsed: input.artifactSourcesUsed || [],
          contentClass,
        },
      });
      return data as CreateDTUResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lensDTUs', 'context', lens] });
      qc.invalidateQueries({ queryKey: ['lensDTUs', 'domain'] });
    },
  });

  const createDTU = useCallback(
    (input: CreateDTUInput) => createMut.mutateAsync(input),
    [createMut],
  );

  // ---- Publish to marketplace mutation ----
  const publishMut = useMutation<PublishResponse, Error, PublishInput>({
    mutationFn: async (input) => {
      const { data } = await api.post(`/api/dtus/${input.dtuId}/publish`, {
        price: input.price,
        description: input.description,
        license: input.license,
        lens,
      });
      return data as PublishResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lensDTUs', 'context', lens] });
    },
  });

  const publishToMarketplace = useCallback(
    (input: PublishInput) => publishMut.mutateAsync(input),
    [publishMut],
  );

  // ---- Promote to global scope mutation ----
  const promoteMut = useMutation<
    { ok: boolean; scope?: string; votes?: Record<string, number>; error?: string },
    Error,
    { dtuId: string; targetScope: 'global' | 'creative_global' }
  >({
    mutationFn: async (input) => {
      const { data } = await api.post('/api/scope/promote', input);
      return data as { ok: boolean; scope?: string; votes?: Record<string, number>; error?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lensDTUs', 'context', lens] });
      qc.invalidateQueries({ queryKey: ['lensDTUs', 'domain'] });
    },
  });

  const promoteToGlobal = useCallback(
    (input: { dtuId: string; targetScope: 'global' | 'creative_global' }) =>
      promoteMut.mutateAsync(input),
    [promoteMut],
  );

  // ---- Composite loading / error ----
  const isLoading = contextQuery.isLoading || domainQuery.isLoading;
  const isError = contextQuery.isError || domainQuery.isError;

  const refetch = useCallback(async () => {
    await Promise.all([contextQuery.refetch(), domainQuery.refetch()]);
  }, [contextQuery, domainQuery]);

  return {
    // DTU collections
    contextDTUs,
    hyperDTUs,
    megaDTUs,
    regularDTUs,
    domainDTUs,

    // Computed
    tierDistribution,

    // Mutations
    createDTU,
    publishToMarketplace,
    promoteToGlobal,
    isCreating: createMut.isPending,
    isPublishing: publishMut.isPending,
    isPromoting: promoteMut.isPending,

    // Query state
    isLoading,
    isError,
    refetch,
  };
}
