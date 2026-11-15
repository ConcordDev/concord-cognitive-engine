'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw, Check, X } from 'lucide-react';
import { fetchJSON } from '@/components/lattice/latticeShared';
import { useAuth } from '@/hooks/useAuth';

const REFRESH_ROLES = new Set(['owner', 'admin', 'sovereign']);

export function RefreshPanel() {
  const qc = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();
  const canRefresh = REFRESH_ROLES.has(user?.role || '');
  const triggerRefresh = useMutation({
    mutationFn: (brain: string) =>
      fetchJSON('/api/brains/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brain }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lattice-brains-stats'] }),
  });

  return (
    <section>
      <h2 className="mb-3 text-base font-semibold text-fuchsia-200">Daily refresh</h2>
      <p className="mb-4 max-w-prose text-xs text-fuchsia-700">
        Triggers a manual refresh of a brain&apos;s training corpus. The runner walks recent
        positive interactions, builds a Modelfile diff, and (if eval-gated) promotes the new
        model to active. Heartbeat ticks <code className="rounded bg-fuchsia-950/40 px-1">brain-daily-refresh</code> +
        <code className="mx-1 rounded bg-fuchsia-950/40 px-1">brain-outcome-resolver</code> run automatically.
        Manual refresh is admin-gated.
      </p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {['conscious', 'subconscious', 'utility', 'repair'].map((brain) => (
          <button
            key={brain}
            onClick={() => triggerRefresh.mutate(brain)}
            disabled={triggerRefresh.isPending || authLoading || !canRefresh}
            title={canRefresh ? `Refresh ${brain}` : 'Manual refresh is limited to an owner, admin, or sovereign'}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 px-3 py-2 text-xs hover:bg-fuchsia-900/30 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
          >
            {triggerRefresh.isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
            Refresh {brain}
          </button>
        ))}
      </div>
      {!authLoading && !canRefresh && (
        <p className="mt-3 text-xs text-fuchsia-700">Manual refresh stays off until you are signed in as an owner, admin, or sovereign.</p>
      )}
      {triggerRefresh.isSuccess && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-emerald-400" role="status">
          <Check className="h-3 w-3" aria-hidden /> Refresh started — see Brains tab for evolved model
        </p>
      )}
      {triggerRefresh.isError && (
        <p className="mt-3 inline-flex items-center gap-1 text-xs text-rose-400" role="alert">
          <X className="h-3 w-3" aria-hidden /> {(triggerRefresh.error as Error)?.message ?? 'Refresh failed'}
        </p>
      )}
    </section>
  );
}
