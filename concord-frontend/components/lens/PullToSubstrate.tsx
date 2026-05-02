'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { Download, Quote, GitFork } from 'lucide-react';

interface PullToSubstrateProps {
  /** The lens domain (e.g., 'news', 'music', 'research') */
  domain: string;
  /** The lens artifact ID to pull */
  artifactId: string;
  /** Optional DTU ID if this artifact links to a DTU */
  dtuId?: string;
  /** Compact mode: icon-only buttons */
  compact?: boolean;
}

/**
 * Reusable component for pulling lens artifacts into the user's DTU substrate.
 * Provides Pull (fork to substrate), Cite, and Fork actions.
 * Used across all lens pages to enable the feed → substrate flow.
 */
function PullToSubstrateBase({ domain, artifactId, dtuId, compact = false }: PullToSubstrateProps) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const pullMutation = useMutation({
    mutationFn: () => api.post(`/api/lens/${domain}/${artifactId}/pull`),
    onSuccess: (_res) => {
      addToast({ type: 'success', message: `Pulled to your substrate` });
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
      queryClient.invalidateQueries({ queryKey: ['lens', domain] });
    },
    onError: () => addToast({ type: 'error', message: 'Failed to pull to substrate' }),
  });

  const forkMutation = useMutation({
    mutationFn: () => {
      if (dtuId) return api.post(`/api/dtus/${dtuId}/fork`);
      return api.post(`/api/lens/${domain}/${artifactId}/pull`);
    },
    onSuccess: () => {
      addToast({ type: 'success', message: 'Forked to your substrate' });
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
    },
    onError: () => addToast({ type: 'error', message: 'Fork failed' }),
  });

  const citeMutation = useMutation({
    mutationFn: () =>
      api.post('/api/social/cite', { citedDtuId: dtuId || artifactId, citingDtuId: 'latest' }),
    onSuccess: () => addToast({ type: 'success', message: 'Citation recorded' }),
  });

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            pullMutation.mutate();
          }}
          disabled={pullMutation.isPending}
          className="text-gray-400 hover:text-neon-green transition-colors disabled:opacity-50"
          title="Pull to substrate"
        >
          <Download className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            citeMutation.mutate();
          }}
          className="text-gray-400 hover:text-neon-cyan transition-colors"
          title="Cite"
        >
          <Quote className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            forkMutation.mutate();
          }}
          disabled={forkMutation.isPending}
          className="text-gray-400 hover:text-neon-purple transition-colors disabled:opacity-50"
          title="Fork / Remix"
        >
          <GitFork className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2 flex-wrap">
      <button
        onClick={() => pullMutation.mutate()}
        disabled={pullMutation.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neon-green/10 text-neon-green border border-neon-green/20 hover:bg-neon-green/20 transition-colors disabled:opacity-50"
      >
        <Download className="w-3 h-3" />
        {pullMutation.isPending ? 'Pulling...' : 'Pull to Substrate'}
      </button>
      <button
        onClick={() => citeMutation.mutate()}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20 hover:bg-neon-cyan/20 transition-colors"
      >
        <Quote className="w-3 h-3" />
        Cite
      </button>
      <button
        onClick={() => forkMutation.mutate()}
        disabled={forkMutation.isPending}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/20 hover:bg-neon-purple/20 transition-colors disabled:opacity-50"
      >
        <GitFork className="w-3 h-3" />
        {forkMutation.isPending ? 'Forking...' : 'Fork / Remix'}
      </button>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedPullToSubstrate = withErrorBoundary(PullToSubstrateBase);
export { _WrappedPullToSubstrate as PullToSubstrate };
