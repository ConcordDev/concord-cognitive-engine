'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import {
  Users, Send, Lightbulb
} from 'lucide-react';


export function PredictionMarketPanel() {
  const queryClient = useQueryClient();
  const [newClaim, setNewClaim] = useState('');
  const [newDomain, setNewDomain] = useState('general');
  const [filterState, setFilterState] = useState<string>('');

  const { data: predictions, isLoading } = useQuery({
    queryKey: ['cc-prediction-market', filterState],
    queryFn: () => apiHelpers.predictions.list({ state: filterState || undefined }).then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['cc-prediction-leaderboard'],
    queryFn: () => apiHelpers.predictions.leaderboard({ limit: 10 }).then(r => r.data),
    refetchInterval: 60000,
  });

  const createMutation = useMutation({
    mutationFn: (data: { claim: string; domain?: string }) =>
      apiHelpers.predictions.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cc-prediction-market'] });
      setNewClaim('');
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiHelpers.predictions.resolve(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['cc-prediction-market'] }),
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const hypotheses = predictions?.hypotheses || [];
  const leaders = leaderboard?.leaderboard || [];

  const stateColors: Record<string, string> = {
    proposed: 'text-blue-400 bg-blue-500/10',
    challenged: 'text-yellow-400 bg-yellow-500/10',
    defended: 'text-purple-400 bg-purple-500/10',
    resolved_true: 'text-green-400 bg-green-500/10',
    resolved_false: 'text-red-400 bg-red-500/10',
    indeterminate: 'text-gray-400 bg-gray-500/10',
    collapsed: 'text-red-600 bg-red-600/10',
  };

  return (
    <div className="space-y-4 p-4">
      {/* Create prediction */}
      <div className="p-4 bg-lattice-surface border border-lattice-border rounded-lg space-y-3">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-neon-cyan" />
          Create Prediction
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newClaim}
            onChange={e => setNewClaim(e.target.value)}
            placeholder="Enter a prediction claim..."
            className="flex-1 px-3 py-2 text-sm bg-lattice-deep border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50"
          />
          <select
            value={newDomain}
            onChange={e => setNewDomain(e.target.value)}
            className="px-3 py-2 text-sm bg-lattice-deep border border-white/10 rounded-lg text-white"
          >
            <option value="general">General</option>
            <option value="technical">Technical</option>
            <option value="market">Market</option>
            <option value="research">Research</option>
          </select>
          <button
            onClick={() => newClaim.trim() && createMutation.mutate({ claim: newClaim, domain: newDomain })}
            disabled={!newClaim.trim() || createMutation.isPending}
            className="px-4 py-2 text-sm bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex gap-2 flex-wrap">
        {['', 'proposed', 'challenged', 'defended', 'resolved_true', 'resolved_false'].map(state => (
          <button
            key={state || 'all'}
            onClick={() => setFilterState(state)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filterState === state
                ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                : 'border-white/10 text-gray-400 hover:text-white'
            }`}
          >
            {state ? state.replace(/_/g, ' ') : 'All'}
          </button>
        ))}
      </div>

      {/* Active predictions */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading predictions...</p>
      ) : hypotheses.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No predictions yet. Create one to get started.</p>
      ) : (
        <div className="space-y-2">
          {hypotheses.map((h: { id: string; claim: string; state: string; domain: string; robustnessScore: number; truthWeight: number; evidenceCount: number; challengeCount: number; defenseCount: number; createdAt: string; resolvedAt: string | null }) => (
            <div key={h.id} className="p-3 bg-lattice-surface border border-lattice-border rounded-lg">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{h.claim}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${stateColors[h.state] || 'text-gray-400 bg-gray-500/10'}`}>
                      {h.state.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-gray-400">{h.domain}</span>
                    <span className="text-xs text-gray-400">
                      {h.evidenceCount} evidence / {h.challengeCount} challenges / {h.defenseCount} defenses
                    </span>
                    <span className="text-xs text-gray-400">
                      robustness: {(h.robustnessScore * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                {!h.resolvedAt && (
                  <button
                    onClick={() => resolveMutation.mutate(h.id)}
                    className="px-3 py-1 text-xs bg-green-500/10 text-green-400 border border-green-500/30 rounded-lg hover:bg-green-500/20 flex-shrink-0"
                  >
                    Resolve
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accuracy Leaderboard */}
      {leaders.length > 0 && (
        <div className="p-4 bg-lattice-surface border border-lattice-border rounded-lg">
          <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            Accuracy Leaderboard
          </h3>
          <div className="space-y-1.5">
            {leaders.map((entry: { actorId: string; accuracy: number; totalClaims: number; weight: number }, i: number) => (
              <div key={entry.actorId} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
                <span className="text-white flex-1 truncate font-mono text-xs">{entry.actorId}</span>
                <span className="text-green-400 text-xs">{(entry.accuracy * 100).toFixed(0)}%</span>
                <span className="text-gray-400 text-xs">{entry.totalClaims} claims</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
