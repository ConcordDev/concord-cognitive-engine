import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useCallback } from 'react';

interface Invariant {
  id: string;
  name: string;
  status: 'enforced' | 'warning' | 'violated';
  description: string;
  lastChecked: string;
}

// Real shape of GET /api/sovereignty/status (server.js's sovereignty/status
// route) -- the sovereignty percentage field is `sovereigntyPct`, not
// `lockPercentage`, and `invariants`/`isHealthy` are derived server-side
// from the frozen ETHOS_INVARIANTS constant. Don't rename these to match a
// wished-for shape; SovereigntyDashboard.tsx reads this same endpoint with
// these exact field names.
interface SovereigntyStatusResponse {
  ok: boolean;
  mode: string;
  sovereigntyPct: number;
  invariants: Invariant[];
  isHealthy: boolean;
  lastAudit?: string;
}

/**
 * Hook for managing the 70% sovereignty lock
 * The 70% lock ensures that core ethos invariants are always enforced
 */
export function use70Lock() {
  const queryClient = useQueryClient();

  // Fetch sovereignty status
  const {
    data: status,
    isLoading,
    error,
  } = useQuery<SovereigntyStatusResponse>({
    queryKey: ['sovereignty-status'],
    queryFn: () => api.get('/api/sovereignty/status').then((r) => r.data),
    refetchInterval: 60000, // Check every minute
  });

  // Trigger manual audit
  const auditMutation = useMutation({
    mutationFn: () => api.post('/api/sovereignty/audit'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sovereignty-status'] });
    },
  });

  // Check if above 70% threshold
  const isLocked = (status?.sovereigntyPct ?? 0) >= 70;

  // Get lock color based on percentage
  const getLockColor = useCallback((percentage: number) => {
    if (percentage >= 70) return 'sovereignty-locked'; // Green
    if (percentage >= 50) return 'sovereignty-warning'; // Yellow
    return 'sovereignty-danger'; // Red
  }, []);

  // Get invariant status summary
  const invariantSummary = {
    enforced: status?.invariants?.filter((i) => i.status === 'enforced').length ?? 0,
    warning: status?.invariants?.filter((i) => i.status === 'warning').length ?? 0,
    violated: status?.invariants?.filter((i) => i.status === 'violated').length ?? 0,
  };

  return {
    // State
    lockPercentage: status?.sovereigntyPct ?? 0,
    invariants: status?.invariants ?? [],
    lastAudit: status?.lastAudit,
    isHealthy: status?.isHealthy ?? true,

    // Computed
    isLocked,
    lockColor: getLockColor(status?.sovereigntyPct ?? 0),
    invariantSummary,

    // Loading state
    isLoading,
    error,

    // Actions
    runAudit: auditMutation.mutate,
    isAuditing: auditMutation.isPending,
  };
}

// Default ethos invariants (used when server is unavailable)
export const DEFAULT_INVARIANTS: Invariant[] = [
  {
    id: 'no-telemetry',
    name: 'NO_TELEMETRY',
    status: 'enforced',
    description: 'No external analytics or tracking',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'no-ads',
    name: 'NO_ADS',
    status: 'enforced',
    description: 'No advertisements or sponsored content',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'no-resale',
    name: 'NO_RESALE',
    status: 'enforced',
    description: 'User data is never sold',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'local-first',
    name: 'LOCAL_FIRST',
    status: 'enforced',
    description: 'Local processing prioritized over cloud',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'owner-control',
    name: 'OWNER_CONTROL',
    status: 'enforced',
    description: 'Owner maintains full control of data',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'transparent-ops',
    name: 'TRANSPARENT_OPS',
    status: 'enforced',
    description: 'All operations are auditable',
    lastChecked: new Date().toISOString(),
  },
  {
    id: 'no-dark-patterns',
    name: 'NO_DARK_PATTERNS',
    status: 'enforced',
    description: 'No manipulative UI/UX patterns',
    lastChecked: new Date().toISOString(),
  },
];
