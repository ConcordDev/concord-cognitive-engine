'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { EmergentCard, type EmergentEntity } from './EmergentCard';
import { Brain } from 'lucide-react';

function EmergentPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['emergent-status'],
    queryFn: () => apiHelpers.emergent.status().then((r) => r.data),
    refetchInterval: 15000,
    retry: false,
  });

  const emergents: EmergentEntity[] =
    (data as { emergents?: EmergentEntity[]; entities?: EmergentEntity[] })?.emergents ||
    (data as { emergents?: EmergentEntity[]; entities?: EmergentEntity[] })?.entities ||
    [];

  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Brain className="w-4 h-4 text-neon-purple" />
          Emergent Council
        </h2>
        <span className="text-xs text-gray-500">
          {
            emergents.filter(
              (e) => e.state === 'active' || e.status === 'active' || e.active === true
            ).length
          }{' '}
          / {emergents.length} active
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-lattice-deep animate-pulse rounded-lg" />
          ))}
        </div>
      ) : emergents.length === 0 ? (
        <div className="text-center py-6">
          <Brain className="w-8 h-8 mx-auto mb-2 text-gray-600" />
          <p className="text-sm text-gray-500">No emergent entities detected</p>
          <p className="text-xs text-gray-600 mt-1">
            The council will appear when emergents are active
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {emergents.map((emergent, i) => (
            <EmergentCard key={emergent.id || i} emergent={emergent} />
          ))}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedEmergentPanel = withErrorBoundary(EmergentPanel);
export { _WrappedEmergentPanel as EmergentPanel };
