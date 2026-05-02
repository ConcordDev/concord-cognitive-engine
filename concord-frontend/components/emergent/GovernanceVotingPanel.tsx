'use client';
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Gavel, AlertTriangle, Loader2, CheckCircle } from 'lucide-react';

interface TallyData {
  creation: number;
  bridge: number;
  refusal: number;
}

interface TallyResponse {
  ok: boolean;
  tally: TallyData;
  total: number;
}

interface VoteResponse {
  ok: boolean;
  voteWeight: number;
  glyph: string;
}

type VoteType = 'creation' | 'bridge' | 'refusal';

interface GovernanceVotingPanelProps {
  proposalId: string;
}

const VOTE_CONFIG: Record<
  VoteType,
  { label: string; glyph: string; color: string; barColor: string }
> = {
  creation: {
    label: 'Creation',
    glyph: '✦',
    color: 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20',
    barColor: 'bg-green-500',
  },
  bridge: {
    label: 'Bridge',
    glyph: '⬡',
    color: 'text-neon-blue border-neon-blue/30 bg-neon-blue/10 hover:bg-neon-blue/20',
    barColor: 'bg-blue-500',
  },
  refusal: {
    label: 'Refusal',
    glyph: '✕',
    color: 'text-red-400 border-red-500/30 bg-red-500/10 hover:bg-red-500/20',
    barColor: 'bg-red-500',
  },
};

function GovernanceVotingPanel({ proposalId }: GovernanceVotingPanelProps) {
  const [voteSuccess, setVoteSuccess] = useState<VoteResponse | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<TallyResponse>({
    queryKey: ['proposal-tally', proposalId],
    queryFn: () => api.get(`/api/emergent/proposals/${proposalId}/tally`).then((r) => r.data),
    refetchInterval: 30000,
  });

  const voteMutation = useMutation<VoteResponse, Error, VoteType>({
    mutationFn: (voteType: VoteType) =>
      api.post(`/api/emergent/proposals/${proposalId}/vote`, { voteType }).then((r) => r.data),
    onSuccess: (res) => {
      setVoteSuccess(res);
      setVoteError(null);
      refetch();
    },
    onError: (err: Error) => {
      setVoteError(err.message);
      setVoteSuccess(null);
    },
  });

  const tally = data?.tally ?? { creation: 0, bridge: 0, refusal: 0 };
  const total = data?.total ?? 0;

  function getPercent(val: number) {
    if (total === 0) return 0;
    return Math.round((val / total) * 100);
  }

  return (
    <div className="bg-lattice-surface border border-lattice-border rounded-lg p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Gavel className="w-5 h-5 text-neon-purple" />
        <h3 className="text-base font-semibold text-gray-100">Governance Vote</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-lattice-deep text-gray-400 border border-lattice-border font-mono">
          #{proposalId}
        </span>
      </div>

      {/* Tally bars */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-3 w-24 bg-lattice-deep animate-pulse rounded" />
              <div className="h-3 bg-lattice-deep animate-pulse rounded" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 text-sm text-neon-orange px-3 py-2 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Failed to load tally
        </div>
      ) : (
        <div className="space-y-3">
          {(Object.entries(VOTE_CONFIG) as [VoteType, typeof VOTE_CONFIG.creation][]).map(
            ([type, cfg]) => {
              const count = tally[type];
              const pct = getPercent(count);
              return (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-300 flex items-center gap-1.5">
                      <span>{cfg.glyph}</span>
                      {cfg.label}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${cfg.barColor}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            }
          )}
          <p className="text-xs text-gray-500 text-right">Total votes: {total}</p>
        </div>
      )}

      {/* Vote buttons */}
      <div className="flex flex-wrap gap-3 pt-1 border-t border-lattice-border">
        {(Object.entries(VOTE_CONFIG) as [VoteType, typeof VOTE_CONFIG.creation][]).map(
          ([type, cfg]) => (
            <button
              key={type}
              onClick={() => voteMutation.mutate(type)}
              disabled={voteMutation.isPending}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50 ${cfg.color}`}
            >
              {voteMutation.isPending && voteMutation.variables === type ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span className="text-base leading-none">{cfg.glyph}</span>
              )}
              {cfg.label}
            </button>
          )
        )}
      </div>

      {/* Vote error */}
      {voteError && (
        <div className="flex items-center gap-2 text-sm text-neon-orange px-3 py-2 bg-neon-orange/5 border border-neon-orange/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {voteError}
        </div>
      )}

      {/* Vote success */}
      {voteSuccess && (
        <div className="flex items-center gap-3 px-4 py-3 bg-neon-green/5 border border-neon-green/20 rounded-lg">
          <CheckCircle className="w-4 h-4 text-neon-green shrink-0" />
          <div>
            <p className="text-sm text-neon-green font-medium">Vote cast — {voteSuccess.glyph}</p>
            <p className="text-xs text-gray-400">Weight: {voteSuccess.voteWeight}</p>
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedGovernanceVotingPanel = withErrorBoundary(GovernanceVotingPanel);
export { _WrappedGovernanceVotingPanel as GovernanceVotingPanel };
export default _WrappedGovernanceVotingPanel;
