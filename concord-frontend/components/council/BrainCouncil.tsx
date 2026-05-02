'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  Sparkles,
  Wrench,
  Shield,
  Users,
  Loader2,
  ChevronDown,
  ChevronUp,
  Send,
  CheckCircle,
  XCircle,
  MinusCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const BRAIN_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  conscious: { icon: Brain, color: 'text-blue-400', label: 'Conscious' },
  subconscious: { icon: Sparkles, color: 'text-purple-400', label: 'Subconscious' },
  utility: { icon: Wrench, color: 'text-green-400', label: 'Utility' },
  repair: { icon: Shield, color: 'text-red-400', label: 'Repair' },
};

const VOTE_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  approve: { icon: CheckCircle, color: 'text-green-400' },
  reject: { icon: XCircle, color: 'text-red-400' },
  modify: { icon: MinusCircle, color: 'text-yellow-400' },
  abstain: { icon: MinusCircle, color: 'text-gray-500' },
};

const CONSENSUS_COLORS: Record<string, string> = {
  approve: 'text-green-400 bg-green-500/10 border-green-500/30',
  reject: 'text-red-400 bg-red-500/10 border-red-500/30',
  split: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
};

function BrainCouncil({ className }: { className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [question, setQuestion] = useState('');
  const queryClient = useQueryClient();

  const { data: sessionsData, isLoading } = useQuery({
    queryKey: ['council-sessions'],
    queryFn: () => api.get('/api/council/sessions?limit=10').then((r) => r.data),
    refetchInterval: 30000,
  });

  const deliberate = useMutation({
    mutationFn: (q: string) => api.post('/api/council/deliberate', { question: q }),
    onSuccess: () => {
      setQuestion('');
      queryClient.invalidateQueries({ queryKey: ['council-sessions'] });
    },
  });

  if (isLoading) {
    return (
      <div
        className={cn(
          'p-4 bg-lattice-surface border border-lattice-border rounded-xl animate-pulse',
          className
        )}
      >
        <div className="h-6 bg-lattice-deep rounded w-40" />
      </div>
    );
  }

  const sessions = sessionsData?.sessions || [];
  const latestSession = sessions[0];

  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-lattice-border">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-neon-purple/20 rounded-lg">
            <Users className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h3 className="font-medium text-white">Brain Council</h3>
            <p className="text-xs text-gray-500">
              {sessions.length > 0
                ? `${sessions.length} deliberations held`
                : '4-brain deliberation system'}
            </p>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-lattice-deep text-gray-400 hover:text-white transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Ask a question */}
      <div className="p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && question.trim() && !deliberate.isPending) {
                deliberate.mutate(question.trim());
              }
            }}
            placeholder="Ask the council..."
            className="flex-1 bg-lattice-deep border border-lattice-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-neon-purple"
            disabled={deliberate.isPending}
          />
          <button
            onClick={() => question.trim() && deliberate.mutate(question.trim())}
            disabled={!question.trim() || deliberate.isPending}
            className="px-3 py-2 bg-neon-purple/20 text-neon-purple rounded-lg hover:bg-neon-purple/30 transition-colors disabled:opacity-50"
          >
            {deliberate.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Latest session result */}
      {latestSession && (
        <div className="px-4 pb-4">
          <CouncilSessionCard session={latestSession} />
        </div>
      )}

      {/* Expanded: session history */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 border-t border-lattice-border space-y-3 max-h-96 overflow-y-auto">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                Session History
              </h4>
              {sessions.slice(1).map((session: CouncilSession) => (
                <CouncilSessionCard key={session.id} session={session} compact />
              ))}
              {sessions.length <= 1 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No previous sessions. Ask the council a question above.
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface CouncilSession {
  id: string;
  question: string;
  status: string;
  consensus: string;
  confidence: number;
  opinions: Record<string, { brain: string; opinion: string; vote: string; confidence: number }>;
  votes: Record<string, string>;
  startedAt: string;
  completedAt: string | null;
}

function CouncilSessionCard({ session, compact }: { session: CouncilSession; compact?: boolean }) {
  const [showDetails, setShowDetails] = useState(!compact);
  const consensusStyle = CONSENSUS_COLORS[session.consensus] || CONSENSUS_COLORS.split;

  return (
    <div className="bg-lattice-deep rounded-lg overflow-hidden">
      <button onClick={() => setShowDetails(!showDetails)} className="w-full p-3 text-left">
        <div className="flex items-center justify-between">
          <p className="text-sm text-white truncate pr-2">{session.question}</p>
          <span
            className={cn('px-2 py-0.5 text-xs rounded-full border capitalize', consensusStyle)}
          >
            {session.consensus}
          </span>
        </div>
        {compact && (
          <p className="text-xs text-gray-500 mt-1">
            {session.completedAt ? new Date(session.completedAt).toLocaleString() : 'In progress'}
            {' · '}
            {Math.round(session.confidence * 100)}% confidence
          </p>
        )}
      </button>

      {showDetails && session.opinions && (
        <div className="px-3 pb-3 space-y-2">
          {/* Brain votes */}
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(session.opinions).map(([brainName, op]) => {
              const brainConf = BRAIN_CONFIG[brainName] || BRAIN_CONFIG.conscious;
              const voteConf = VOTE_CONFIG[op.vote] || VOTE_CONFIG.abstain;
              const BrainIcon = brainConf.icon;
              const VoteIcon = voteConf.icon;

              return (
                <div key={brainName} className="p-2 bg-lattice-surface rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <BrainIcon className={cn('w-3.5 h-3.5', brainConf.color)} />
                    <span className="text-xs font-medium text-gray-300">{brainConf.label}</span>
                    <VoteIcon className={cn('w-3 h-3 ml-auto', voteConf.color)} />
                  </div>
                  <p className="text-[11px] text-gray-400 line-clamp-2">{op.opinion}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={cn('text-[10px] capitalize', voteConf.color)}>{op.vote}</span>
                    <span className="text-[10px] text-gray-600">
                      {Math.round(op.confidence * 100)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Consensus summary */}
          <div className={cn('p-2 rounded-lg border text-center', consensusStyle)}>
            <p className="text-xs font-medium capitalize">
              Council{' '}
              {session.consensus === 'split'
                ? 'Split'
                : session.consensus === 'approve'
                  ? 'Approved'
                  : 'Rejected'}
            </p>
            <p className="text-[10px] opacity-70">
              {Math.round(session.confidence * 100)}% confidence
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedBrainCouncil = withErrorBoundary(BrainCouncil);
export { _WrappedBrainCouncil as BrainCouncil };
