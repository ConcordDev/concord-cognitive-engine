'use client';

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { subscribe } from '@/lib/realtime/socket';
import { Gavel, CheckCircle, XCircle, ArrowUpCircle, Clock } from 'lucide-react';

interface CouncilAction {
  id?: string;
  type?: string;
  action?: string;
  dtuId?: string;
  dtuTitle?: string;
  title?: string;
  result?: string;
  outcome?: string;
  status?: string;
  actor?: string;
  emergent?: string;
  reason?: string;
  timestamp?: string;
  created_at?: string;
  votes?: { approve?: number; reject?: number };
}

function GovernanceFeed() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['council-actions'],
    queryFn: () => apiHelpers.atlas.councilActions({ limit: 10 }).then((r) => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  // Subscribe to live council events
  useEffect(() => {
    const unsubVote = subscribe<unknown>('council:vote', () => {
      queryClient.invalidateQueries({ queryKey: ['council-actions'] });
    });
    const unsubProposal = subscribe<unknown>('council:proposal', () => {
      queryClient.invalidateQueries({ queryKey: ['council-actions'] });
    });
    const unsubPromoted = subscribe<unknown>('dtu:promoted', () => {
      queryClient.invalidateQueries({ queryKey: ['council-actions'] });
    });

    return () => {
      unsubVote();
      unsubProposal();
      unsubPromoted();
    };
  }, [queryClient]);

  const actions: CouncilAction[] =
    (data as { actions?: CouncilAction[]; items?: CouncilAction[] })?.actions ||
    (data as { actions?: CouncilAction[]; items?: CouncilAction[] })?.items ||
    (Array.isArray(data) ? (data as CouncilAction[]) : []);

  function getActionIcon(action: CouncilAction) {
    const type = action.type || action.action || '';
    const result = action.result || action.outcome || action.status || '';

    if (result === 'approved' || result === 'accepted' || type === 'approve') {
      return <CheckCircle className="w-4 h-4 text-neon-green" />;
    }
    if (result === 'rejected' || type === 'reject') {
      return <XCircle className="w-4 h-4 text-red-400" />;
    }
    if (type === 'promote' || type === 'promotion') {
      return <ArrowUpCircle className="w-4 h-4 text-neon-cyan" />;
    }
    if (type === 'proposal' || type === 'vote') {
      return <Gavel className="w-4 h-4 text-neon-purple" />;
    }
    return <Clock className="w-4 h-4 text-gray-400" />;
  }

  function getActionLabel(action: CouncilAction): string {
    const type = action.type || action.action || 'action';
    const result = action.result || action.outcome || '';
    const actor = action.actor || action.emergent || 'Council';
    const title = action.dtuTitle || action.title || action.dtuId?.slice(0, 8) || 'DTU';

    if (result === 'approved') return `${actor} approved "${title}"`;
    if (result === 'rejected') return `${actor} rejected "${title}"`;
    if (type === 'promote') return `"${title}" promoted to higher scope`;
    if (type === 'proposal') return `${actor} proposed "${title}"`;
    if (type === 'vote') return `${actor} voted on "${title}"`;
    return `${actor}: ${type} on "${title}"`;
  }

  return (
    <div className="rounded-xl border border-lattice-border bg-lattice-surface/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Gavel className="w-4 h-4 text-neon-purple" />
          Governance Activity
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-lattice-deep animate-pulse rounded-lg" />
          ))}
        </div>
      ) : actions.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-gray-500">No recent governance activity</p>
          <p className="text-xs text-gray-600 mt-1">Council decisions will appear here</p>
        </div>
      ) : (
        <div className="space-y-1">
          {actions.slice(0, 8).map((action, i) => (
            <div
              key={action.id || i}
              className="flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-lattice-deep/50 transition-colors"
            >
              <span className="mt-0.5 flex-shrink-0">{getActionIcon(action)}</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-gray-300 truncate">{getActionLabel(action)}</p>
                {action.reason && (
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{action.reason}</p>
                )}
              </div>
              <span className="text-[10px] text-gray-600 flex-shrink-0 mt-0.5">
                {(action.timestamp || action.created_at) &&
                  new Date(action.timestamp || action.created_at || '').toLocaleTimeString(
                    undefined,
                    { hour: '2-digit', minute: '2-digit' }
                  )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedGovernanceFeed = withErrorBoundary(GovernanceFeed);
export { _WrappedGovernanceFeed as GovernanceFeed };
