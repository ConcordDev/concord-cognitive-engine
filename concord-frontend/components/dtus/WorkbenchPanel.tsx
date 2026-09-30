'use client';

/**
 * WorkbenchPanel — KnowledgeWorkbench over a loaded DTU corpus.
 * Fetches its own page of DTUs so the thin shell stays data-free.
 */

import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import type { DTU } from '@/lib/api/generated-types';
import { KnowledgeWorkbench } from '@/components/dtus/KnowledgeWorkbench';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { ErrorState, Skeleton } from '@/components/ui';

export function WorkbenchPanel() {
  const [selectedDtuId, setSelectedDtuId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dtus-workbench-corpus'],
    queryFn: async () => {
      const res = await apiHelpers.dtus.paginated({ limit: 100, offset: 0, scope: 'mine' });
      return res.data as { ok: boolean; dtus?: DTU[]; items?: DTU[] };
    },
    staleTime: 15_000,
  });

  const dtus: DTU[] = data?.dtus || data?.items || [];
  const onSelect = useCallback((id: string) => setSelectedDtuId(id), []);

  if (isLoading && dtus.length === 0) {
    return <Skeleton variant="block" height="24rem" className="rounded-xl" />;
  }
  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load DTU corpus for workbench.'}
        onRetry={() => refetch()}
        retrying={isLoading}
      />
    );
  }

  return (
    <>
      <KnowledgeWorkbench dtus={dtus} onSelectDtu={onSelect} />
      {selectedDtuId && (
        <DTUDetailView
          dtuId={selectedDtuId}
          onClose={() => setSelectedDtuId(null)}
          onNavigate={(id) => setSelectedDtuId(id)}
        />
      )}
    </>
  );
}
