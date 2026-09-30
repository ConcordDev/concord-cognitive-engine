'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { DriftTimeline, type DriftFeed } from '@/components/cognition/DriftTimeline';
import { Loader2 } from 'lucide-react';

export function DriftPanel() {
  const [driftSeverity, setDriftSeverity] = useState('');

  const driftFeed = useQuery({
    queryKey: ['cognition-drift', driftSeverity],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('cognition', 'driftAlerts', {
        severity: driftSeverity || undefined,
        limit: 150,
      });
      return (r.data?.result ?? r.data) as DriftFeed;
    },
    refetchInterval: 60_000,
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-violet-200">Lattice drift alerts</h2>
      <p className="mb-3 text-xs text-violet-700">
        Findings from the drift-monitor&apos;s scan of the live DTU corpus —
        Goodhart gaming, memetic drift, capability creep, circular evidence,
        echo chambers, metric divergence.
      </p>
      {driftFeed.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
      ) : driftFeed.isError ? (
        <p className="text-xs text-rose-400">Drift feed unavailable.</p>
      ) : (
        <DriftTimeline
          feed={driftFeed.data ?? null}
          severityFilter={driftSeverity}
          onSeverityChange={setDriftSeverity}
        />
      )}
    </section>
  );
}
