'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Target, TrendingUp, Plus, Loader2, ChevronDown, ChevronUp,
  Coins, CheckCircle, Clock, Hand,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'text-green-400 bg-green-500/10',
  medium: 'text-blue-400 bg-blue-500/10',
  hard: 'text-purple-400 bg-purple-500/10',
  legendary: 'text-yellow-400 bg-yellow-500/10',
};

const BOUNTY_STATUS_COLORS: Record<string, string> = {
  open: 'text-green-400',
  claimed: 'text-blue-400',
  submitted: 'text-yellow-400',
  completed: 'text-neon-cyan',
  expired: 'text-gray-500',
};

interface Bounty {
  id: string;
  title: string;
  description: string;
  domain: string;
  reward: number;
  difficulty: string;
  status: string;
  deadline: string;
  createdAt: string;
}

interface Future {
  id: string;
  question: string;
  domain: string;
  options: { id: string; label: string; stakes: number; stakers: unknown[] }[];
  status: string;
  resolution: string | null;
  totalStaked: number;
  resolveBy: string;
  createdAt: string;
}

function BountiesAndFutures({ className }: { className?: string }) {
  const [tab, setTab] = useState<'bounties' | 'futures'>('bounties');
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden', className)}>
      {/* Header with tabs */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            {tab === 'bounties' ? (
              <Target className="w-5 h-5 text-yellow-400" />
            ) : (
              <TrendingUp className="w-5 h-5 text-yellow-400" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('bounties')}
              className={cn(
                'px-2 py-1 text-sm rounded-lg transition-colors',
                tab === 'bounties' ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400 hover:text-white'
              )}
            >
              Bounties
            </button>
            <button
              onClick={() => setTab('futures')}
              className={cn(
                'px-2 py-1 text-sm rounded-lg transition-colors',
                tab === 'futures' ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-400 hover:text-white'
              )}
            >
              Futures
            </button>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {tab === 'bounties' ? (
        <BountiesTab expanded={expanded} />
      ) : (
        <FuturesTab expanded={expanded} />
      )}
    </div>
  );
}

function BountiesTab({ expanded }: { expanded: boolean }) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [reward, setReward] = useState('50');
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['bounties'],
    queryFn: () => api.get('/api/bounties').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/bounties', { title: title.trim(), reward: parseInt(reward) || 50 }),
    onSuccess: () => {
      setTitle('');
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['bounties'] });
    },
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/bounties/${id}/claim`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bounties'] }),
  });

  const bounties: Bounty[] = data?.bounties || [];

  return (
    <div className="p-4 space-y-3">
      {/* Create button */}
      <button
        onClick={() => setCreating(!creating)}
        className="flex items-center gap-2 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Post a Bounty
      </button>

      {creating && (
        <div className="space-y-2">
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What knowledge is needed?"
            className="w-full bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          />
          <div className="flex gap-2">
            <input
              type="number"
              value={reward}
              onChange={e => setReward(e.target.value)}
              placeholder="XP reward"
              className="w-24 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
            />
            <button
              onClick={() => title.trim() && createMutation.mutate()}
              disabled={!title.trim() || createMutation.isPending}
              className="px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 text-sm disabled:opacity-50"
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Post'}
            </button>
          </div>
        </div>
      )}

      {bounties.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No bounties yet.</p>
      ) : (
        bounties.slice(0, expanded ? 20 : 5).map(bounty => (
          <div key={bounty.id} className="p-3 bg-lattice-deep rounded-lg">
            <div className="flex items-center gap-2">
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] capitalize', DIFFICULTY_COLORS[bounty.difficulty] || '')}>
                {bounty.difficulty}
              </span>
              {bounty.status === 'completed' && <CheckCircle className="w-3 h-3 text-green-400" />}
              {bounty.deadline && (
                <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                  <Clock className="w-2.5 h-2.5" />
                  {new Date(bounty.deadline).toLocaleDateString()}
                </span>
              )}
              <p className="text-sm text-white flex-1 truncate">{bounty.title}</p>
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <Coins className="w-3 h-3" />
                {bounty.reward} XP
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className={cn('text-[10px] capitalize', BOUNTY_STATUS_COLORS[bounty.status])}>
                {bounty.status}
              </span>
              {bounty.status === 'open' && (
                <button
                  onClick={() => claimMutation.mutate(bounty.id)}
                  className="flex items-center gap-1 text-[10px] text-neon-cyan hover:text-neon-cyan/80 transition-colors"
                >
                  <Hand className="w-3 h-3" /> Claim
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FuturesTab({ expanded }: { expanded: boolean }) {
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['futures'],
    queryFn: () => api.get('/api/futures').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/api/futures', { question: question.trim() }),
    onSuccess: () => {
      setQuestion('');
      setCreating(false);
      queryClient.invalidateQueries({ queryKey: ['futures'] });
    },
  });

  const stakeMutation = useMutation({
    mutationFn: ({ futureId, optionId }: { futureId: string; optionId: string }) =>
      api.post(`/api/futures/${futureId}/stake`, { optionId, amount: 10 }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['futures'] }),
  });

  const futures: Future[] = data?.futures || [];

  return (
    <div className="p-4 space-y-3">
      <button
        onClick={() => setCreating(!creating)}
        className="flex items-center gap-2 text-xs text-yellow-400 hover:text-yellow-300 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        Create a Prediction
      </button>

      {creating && (
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="What will happen?"
            className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          />
          <button
            onClick={() => question.trim() && createMutation.mutate()}
            disabled={!question.trim() || createMutation.isPending}
            className="px-3 py-2 bg-yellow-500/20 text-yellow-400 rounded-lg hover:bg-yellow-500/30 text-sm disabled:opacity-50"
          >
            {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create'}
          </button>
        </div>
      )}

      {futures.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No predictions yet.</p>
      ) : (
        futures.slice(0, expanded ? 20 : 5).map(future => (
          <div key={future.id} className="p-3 bg-lattice-deep rounded-lg">
            <p className="text-sm text-white">{future.question}</p>
            <div className="flex items-center gap-2 mt-2">
              {future.options.map(opt => {
                const total = future.totalStaked || 1;
                const pct = Math.round((opt.stakes / total) * 100);
                return (
                  <button
                    key={opt.id}
                    onClick={() => future.status === 'open' && stakeMutation.mutate({ futureId: future.id, optionId: opt.id })}
                    disabled={future.status !== 'open'}
                    className={cn(
                      'flex-1 p-2 rounded-lg border text-center transition-colors',
                      future.resolution === opt.id
                        ? 'border-green-500/50 bg-green-500/10'
                        : 'border-lattice-border hover:border-yellow-500/30'
                    )}
                  >
                    <p className="text-xs text-white font-medium">{opt.label}</p>
                    <p className="text-[10px] text-gray-500">{opt.stakes} XP ({pct}%)</p>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className={cn(
                'text-[10px]',
                future.status === 'open' ? 'text-green-400' : future.status === 'resolved' ? 'text-neon-cyan' : 'text-gray-500'
              )}>
                {future.status}
              </span>
              <span className="text-[10px] text-gray-500">{future.totalStaked} XP staked</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}


import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _BountiesAndFutures = withErrorBoundary(BountiesAndFutures);
export { _BountiesAndFutures as BountiesAndFutures };
