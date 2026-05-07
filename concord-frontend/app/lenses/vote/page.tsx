'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { apiHelpers } from '@/lib/api/client';

import { Loading } from '@/components/common/Loading';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  Check, X, Users, Scale, Plus, Clock, MessageSquare,
  ThumbsUp, ThumbsDown, Minus, BarChart3, ChevronDown,
  ChevronUp, Send, AlertCircle, Vote, Layers, TrendingUp, Percent, Zap,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion } from 'framer-motion';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProposalData {
  title: string;
  description: string;
  proposer: string;
  type: 'feature' | 'policy' | 'resource' | 'experiment';
  status: 'active' | 'passed' | 'rejected' | 'pending';
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  threshold: number;
  deadline: string;
  createdAt: string;
  comments?: CommentData[];
}

interface CommentData {
  id: string;
  author: string;
  text: string;
  createdAt: string;
  upvotes: number;
  downvotes: number;
  parentId?: string;
  replies?: CommentData[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimeRemaining(deadline: string): string {
  const now = Date.now();
  const end = new Date(deadline).getTime();
  if (isNaN(end)) return 'No deadline';
  const diff = end - now;
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function VoteLensPage() {
  useLensNav('vote');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('vote');
  const queryClient = useQueryClient();

  // UI state
  const [filter, setFilter] = useState<'all' | 'active' | 'passed' | 'rejected'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'proposals' | 'dashboard'>('proposals');
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [showFeatures, setShowFeatures] = useState(true);

  // Data
  const {
    items: proposalItems, isLoading, isError, error, refetch, create,
  } = useLensData<ProposalData>('vote', 'proposal', { seed: [] });

  // Map lens items to proposals
  const proposals = useMemo(() =>
    proposalItems.map((item) => ({
      id: item.id,
      title: item.title || item.data?.title || '',
      description: (item.data?.description || '') as string,
      proposer: (item.data?.proposer || 'Anonymous') as string,
      type: (item.data?.type || 'feature') as ProposalData['type'],
      status: (item.data?.status || 'pending') as ProposalData['status'],
      votesFor: (item.data?.votesFor ?? 0) as number,
      votesAgainst: (item.data?.votesAgainst ?? 0) as number,
      votesAbstain: (item.data?.votesAbstain ?? 0) as number,
      threshold: (item.data?.threshold ?? 10) as number,
      deadline: (item.data?.deadline || '') as string,
      createdAt: (item.data?.createdAt || item.createdAt) as string,
      comments: (item.data?.comments || []) as CommentData[],
    })),
    [proposalItems],
  );

  // Cast vote mutation
  const castVote = useMutation({
    mutationFn: async ({ proposalId, vote }: { proposalId: string; vote: 'for' | 'against' | 'abstain' }) => {
      const { data } = await apiHelpers.council.vote({
        dtuId: proposalId,
        vote: vote === 'for' ? 'approve' : 'reject',
        reason: vote === 'abstain' ? 'abstain' : undefined,
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lens', 'vote', 'list'] });
    },
    onError: (err) => console.error('castVote failed:', err instanceof Error ? err.message : err),
  });

  // Filtered proposals
  const filteredProposals = useMemo(() =>
    proposals.filter((p) => filter === 'all' ? true : p.status === filter),
    [proposals, filter],
  );

  // Stats
  const stats = useMemo(() => {
    const total = proposals.length;
    const active = proposals.filter((p) => p.status === 'active').length;
    const passed = proposals.filter((p) => p.status === 'passed').length;
    const rejected = proposals.filter((p) => p.status === 'rejected').length;
    const totalVotes = proposals.reduce((s, p) => s + p.votesFor + p.votesAgainst + p.votesAbstain, 0);
    const passRate = total > 0 ? Math.round((passed / Math.max(passed + rejected, 1)) * 100) : 0;
    const avgParticipation = total > 0
      ? Math.round(totalVotes / Math.max(total, 1))
      : 0;
    return { total, active, passed, rejected, totalVotes, passRate, avgParticipation };
  }, [proposals]);

  const typeColors: Record<string, string> = {
    feature: 'text-neon-cyan bg-neon-cyan/20',
    policy: 'text-neon-purple bg-neon-purple/20',
    resource: 'text-neon-green bg-neon-green/20',
    experiment: 'text-neon-blue bg-neon-blue/20',
  };

  // Loading
  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loading text="Loading proposals..." />
      </div>
    );
  }

  // Error
  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-neon-purple/20 flex items-center justify-center">
            <Vote className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Governance</h1>
            <p className="text-sm text-gray-400">
              Council voting on proposals and governance decisions
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="vote" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn-neon purple flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          New Proposal
        </button>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="vote" artifactId={proposalItems[0]?.id} compact />

      {/* Quick Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Scale className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{stats.active}</p>
            <p className="text-xs text-gray-500">Active Proposals</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <TrendingUp className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{stats.totalVotes}</p>
            <p className="text-xs text-gray-500">Votes Cast</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Percent className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{stats.passRate}%</p>
            <p className="text-xs text-gray-500">Pass Rate</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="panel p-3 flex items-center gap-3">
          <Users className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{stats.avgParticipation}</p>
            <p className="text-xs text-gray-500">Avg Participation</p>
          </div>
        </motion.div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <Scale className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{stats.active}</p>
          <p className="text-sm text-gray-400">Active Votes</p>
        </div>
        <div className="lens-card">
          <Check className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{stats.passed}</p>
          <p className="text-sm text-gray-400">Passed</p>
        </div>
        <div className="lens-card">
          <X className="w-5 h-5 text-neon-pink mb-2" />
          <p className="text-2xl font-bold">{stats.rejected}</p>
          <p className="text-sm text-gray-400">Rejected</p>
        </div>
        <div className="lens-card">
          <Users className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{stats.totalVotes}</p>
          <p className="text-sm text-gray-400">Total Votes Cast</p>
        </div>
      </div>

      {/* Tab Switch: Proposals / Dashboard */}
      <div className="flex gap-2 border-b border-lattice-border pb-0">
        {(['proposals', 'dashboard'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 capitalize font-medium text-sm border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-neon-purple text-neon-purple'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'proposals' ? 'Proposals' : 'Results Dashboard'}
          </button>
        ))}
      </div>

      {/* ============ PROPOSALS TAB ============ */}
      {activeTab === 'proposals' && (
        <>
          {/* Filter Tabs */}
          <div className="flex gap-2">
            {(['all', 'active', 'passed', 'rejected'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 rounded-lg capitalize text-sm ${
                  filter === f
                    ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                    : 'bg-lattice-surface text-gray-400 hover:text-white'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Proposals List */}
          <div className="space-y-4">
            {filteredProposals.length === 0 && (
              <div className="panel p-8 text-center">
                <Scale className="w-8 h-8 text-gray-500 mx-auto mb-3" />
                <p className="text-gray-400">No proposals found.</p>
                <p className="text-sm text-gray-500 mt-1">Create the first proposal to get started.</p>
              </div>
            )}
            {filteredProposals.map((proposal, index) => {
              const totalVotes = proposal.votesFor + proposal.votesAgainst + proposal.votesAbstain;
              const quorumProgress = Math.min((totalVotes / proposal.threshold) * 100, 100);
              const quorumMet = totalVotes >= proposal.threshold;
              const isExpanded = expandedProposal === proposal.id;
              const forPct = totalVotes > 0 ? (proposal.votesFor / totalVotes) * 100 : 0;
              const againstPct = totalVotes > 0 ? (proposal.votesAgainst / totalVotes) * 100 : 0;
              const abstainPct = totalVotes > 0 ? (proposal.votesAbstain / totalVotes) * 100 : 0;

              return (
                <motion.div key={proposal.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="panel p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-semibold truncate">{proposal.title}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded ${typeColors[proposal.type] || 'text-gray-400 bg-gray-500/20'}`}>
                          {proposal.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-400 line-clamp-2">{proposal.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span>By {proposal.proposer}</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {proposal.status === 'active' ? getTimeRemaining(proposal.deadline) : formatDate(proposal.createdAt)}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`ml-3 px-3 py-1 rounded-lg text-sm whitespace-nowrap ${
                        proposal.status === 'active'
                          ? 'bg-neon-blue/20 text-neon-blue'
                          : proposal.status === 'passed'
                          ? 'bg-neon-green/20 text-neon-green'
                          : proposal.status === 'rejected'
                          ? 'bg-neon-pink/20 text-neon-pink'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {proposal.status}
                    </span>
                  </div>

                  {/* Vote Progress Bar */}
                  <div className="mb-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-neon-green flex items-center gap-1">
                        <ThumbsUp className="w-3 h-3" /> {proposal.votesFor} For ({forPct.toFixed(0)}%)
                      </span>
                      <span className="text-neon-pink flex items-center gap-1">
                        {proposal.votesAgainst} Against ({againstPct.toFixed(0)}%) <ThumbsDown className="w-3 h-3" />
                      </span>
                    </div>
                    <div className="h-3 bg-lattice-deep rounded-full overflow-hidden flex">
                      {totalVotes > 0 ? (
                        <>
                          <div className="h-full bg-neon-green transition-all" style={{ width: `${forPct}%` }} />
                          <div className="h-full bg-gray-500 transition-all" style={{ width: `${abstainPct}%` }} />
                          <div className="h-full bg-neon-pink transition-all" style={{ width: `${againstPct}%` }} />
                        </>
                      ) : (
                        <div className="h-full w-0" />
                      )}
                    </div>
                    {proposal.votesAbstain > 0 && (
                      <p className="text-xs text-gray-500 mt-1">{proposal.votesAbstain} abstained</p>
                    )}
                  </div>

                  {/* Quorum Indicator */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-gray-400">Quorum Progress</span>
                        <span className={quorumMet ? 'text-neon-green' : 'text-gray-400'}>
                          {totalVotes}/{proposal.threshold} votes {quorumMet ? '(met)' : '(needed)'}
                        </span>
                      </div>
                      <div className="h-1.5 bg-lattice-deep rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${quorumMet ? 'bg-neon-green' : 'bg-neon-blue'}`}
                          style={{ width: `${quorumProgress}%` }}
                        />
                      </div>
                    </div>
                    {quorumMet && (
                      <div className="flex items-center gap-1 text-xs text-neon-green whitespace-nowrap">
                        <Check className="w-3 h-3" />
                        Quorum Met
                      </div>
                    )}
                    {!quorumMet && (
                      <div className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                        <AlertCircle className="w-3 h-3" />
                        Need {proposal.threshold - totalVotes} more
                      </div>
                    )}
                  </div>

                  {/* Vote Buttons (active only) */}
                  {proposal.status === 'active' && (
                    <div className="flex gap-3 mb-3">
                      <button
                        onClick={() => castVote.mutate({ proposalId: proposal.id, vote: 'for' })}
                        disabled={castVote.isPending}
                        className="flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 bg-neon-green/10 text-neon-green border border-neon-green/30 hover:bg-neon-green/20 transition-colors disabled:opacity-50"
                      >
                        <ThumbsUp className="w-4 h-4" />
                        {castVote.isPending ? 'Voting...' : 'For'}
                      </button>
                      <button
                        onClick={() => castVote.mutate({ proposalId: proposal.id, vote: 'abstain' })}
                        disabled={castVote.isPending}
                        className="flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 bg-gray-500/10 text-gray-400 border border-gray-500/30 hover:bg-gray-500/20 transition-colors disabled:opacity-50"
                      >
                        <Minus className="w-4 h-4" />
                        Abstain
                      </button>
                      <button
                        onClick={() => castVote.mutate({ proposalId: proposal.id, vote: 'against' })}
                        disabled={castVote.isPending}
                        className="flex-1 py-2 rounded-lg font-medium flex items-center justify-center gap-2 bg-neon-pink/10 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/20 transition-colors disabled:opacity-50"
                      >
                        <ThumbsDown className="w-4 h-4" />
                        Against
                      </button>
                    </div>
                  )}

                  {/* Discussion Toggle */}
                  <button
                    onClick={() => setExpandedProposal(isExpanded ? null : proposal.id)}
                    className="w-full flex items-center justify-center gap-2 text-sm text-gray-400 hover:text-white transition-colors pt-2 border-t border-lattice-border"
                  >
                    <MessageSquare className="w-4 h-4" />
                    Discussion ({proposal.comments?.length || 0})
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {/* Discussion Thread */}
                  {isExpanded && (
                    <DiscussionThread
                      proposalId={proposal.id}
                      comments={proposal.comments || []}
                      onRefetch={refetch}
                    />
                  )}
                </motion.div>
              );
            })}
          </div>
        </>
      )}

      {/* ============ DASHBOARD TAB ============ */}
      {activeTab === 'dashboard' && (
        <ResultsDashboard proposals={proposals} stats={stats} proposalItemId={proposalItems[0]?.id} />
      )}

      {/* ============ CREATE PROPOSAL MODAL ============ */}
      {showCreateModal && (
        <CreateProposalModal
          onClose={() => setShowCreateModal(false)}
          onCreate={create}
        />
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="vote" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Proposal Modal
// ---------------------------------------------------------------------------

function CreateProposalModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: { title?: string; data?: Record<string, unknown> }) => Promise<unknown>;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ProposalData['type']>('feature');
  const [duration, setDuration] = useState('7');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const validate = (): string[] => {
    const errs: string[] = [];
    if (!title.trim()) errs.push('Title is required.');
    if (title.trim().length > 120) errs.push('Title must be 120 characters or fewer.');
    if (!description.trim()) errs.push('Description is required.');
    if (description.trim().length < 20) errs.push('Description must be at least 20 characters.');
    const d = parseInt(duration, 10);
    if (isNaN(d) || d < 1 || d > 90) errs.push('Duration must be between 1 and 90 days.');
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (errs.length > 0) return;

    setSubmitting(true);
    try {
      const deadlineDate = new Date();
      deadlineDate.setDate(deadlineDate.getDate() + parseInt(duration, 10));

      await onCreate({
        title: title.trim(),
        data: {
          title: title.trim(),
          description: description.trim(),
          proposer: 'Current User',
          type,
          status: 'active',
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          threshold: 10,
          deadline: deadlineDate.toISOString(),
          createdAt: new Date().toISOString(),
          comments: [],
        },
      });
      onClose();
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Failed to create proposal.']);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-lattice-surface border border-lattice-border rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Plus className="w-5 h-5 text-neon-purple" />
            New Proposal
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="bg-neon-pink/10 border border-neon-pink/30 rounded-lg p-3 space-y-1">
            {errors.map((e, i) => (
              <p key={i} className="text-sm text-neon-pink flex items-center gap-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0" /> {e}
              </p>
            ))}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Title</label>
          <input
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm focus:border-neon-purple/50 focus:ring-1 focus:ring-neon-purple/30 outline-none"
            placeholder="Proposal title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
          />
          <p className="text-xs text-gray-500 mt-1">{title.length}/120</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
          <textarea
            className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm focus:border-neon-purple/50 focus:ring-1 focus:ring-neon-purple/30 outline-none resize-none"
            placeholder="Describe the proposal in detail (minimum 20 characters)"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="text-xs text-gray-500 mt-1">{description.length} characters (min 20)</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Type</label>
            <select
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as ProposalData['type'])}
            >
              <option value="feature">Feature</option>
              <option value="policy">Policy</option>
              <option value="resource">Resource</option>
              <option value="experiment">Experiment</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Duration (days)</label>
            <input
              className="w-full px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm focus:border-neon-purple/50 focus:ring-1 focus:ring-neon-purple/30 outline-none"
              type="number"
              min={1}
              max={90}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg text-gray-400 hover:text-white bg-lattice-elevated border border-lattice-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-2 rounded-lg font-medium bg-neon-purple/20 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Submit Proposal'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discussion Thread
// ---------------------------------------------------------------------------

function DiscussionThread({
  proposalId,
  comments,
  onRefetch,
}: {
  proposalId: string;
  comments: CommentData[];
  onRefetch: () => void;
}) {
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reactComment = useMutation({
    mutationFn: async ({ commentId, reaction }: { commentId: string; reaction: 'upvote' | 'downvote' }) => {
      return apiHelpers.lens.run('vote', commentId, { action: reaction });
    },
    onSuccess: () => {
      onRefetch();
    },
    onError: (err) => console.error('Reaction failed:', err instanceof Error ? err.message : 'Unknown error'),
  });

  // Use collab comments API for real persistence
  const addCommentMutation = useMutation({
    mutationFn: async (text: string) => {
      const { data } = await apiHelpers.collab.addComment(proposalId, text, replyTo || undefined);
      return data;
    },
    onSuccess: () => {
      setNewComment('');
      setReplyTo(null);
      onRefetch();
    },
    onError: (err) => console.error('addComment failed:', err instanceof Error ? err.message : err),
  });

  // Fetch threaded comments
  const { data: threadData } = useQuery({
    queryKey: ['collab-comments', proposalId],
    queryFn: () => apiHelpers.collab.getComments(proposalId, true).then((r) => r.data),
    staleTime: 15000,
  });

  // Use API comments if available, otherwise fall back to proposal-embedded comments
  const displayComments: CommentData[] = threadData?.comments || comments;

  const handleSubmit = () => {
    if (!newComment.trim() || submitting) return;
    setSubmitting(true);
    addCommentMutation.mutate(newComment.trim());
    setSubmitting(false);
  };

  const renderComment = (comment: CommentData, depth = 0) => (
    <div key={comment.id} className={`${depth > 0 ? 'ml-6 border-l border-lattice-border pl-4' : ''}`}>
      <div className="py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{comment.author || 'Anonymous'}</span>
          <span className="text-xs text-gray-500">{formatDate(comment.createdAt)}</span>
        </div>
        <p className="text-sm text-gray-300">{comment.text}</p>
        <div className="flex items-center gap-3 mt-2">
          <button onClick={() => reactComment.mutate({ commentId: comment.id, reaction: 'upvote' })} disabled={reactComment.isPending} className="flex items-center gap-1 text-xs text-gray-500 hover:text-neon-green transition-colors disabled:opacity-50">
            <ThumbsUp className="w-3 h-3" /> {comment.upvotes || 0}
          </button>
          <button onClick={() => reactComment.mutate({ commentId: comment.id, reaction: 'downvote' })} disabled={reactComment.isPending} className="flex items-center gap-1 text-xs text-gray-500 hover:text-neon-pink transition-colors disabled:opacity-50">
            <ThumbsDown className="w-3 h-3" /> {comment.downvotes || 0}
          </button>
          <button
            onClick={() => setReplyTo(comment.id)}
            className="text-xs text-gray-500 hover:text-neon-blue transition-colors"
          >
            Reply
          </button>
        </div>
      </div>
      {comment.replies?.map((reply) => renderComment(reply, depth + 1))}
    </div>
  );

  return (
    <div className="mt-4 pt-4 border-t border-lattice-border space-y-2">
      {displayComments.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-4">No comments yet. Start the discussion.</p>
      )}
      {displayComments.map((c) => renderComment(c))}

      {/* New Comment Input */}
      <div className="pt-3">
        {replyTo && (
          <div className="flex items-center gap-2 mb-2 text-xs text-neon-blue">
            <span>Replying to comment</span>
            <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 bg-lattice-deep border border-lattice-border rounded-lg text-sm focus:border-neon-blue/50 outline-none"
            placeholder="Add a comment..."
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button
            onClick={handleSubmit}
            disabled={!newComment.trim() || addCommentMutation.isPending}
            className="px-4 py-2 bg-neon-blue/10 text-neon-blue border border-neon-blue/30 rounded-lg hover:bg-neon-blue/20 transition-colors disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results Dashboard
// ---------------------------------------------------------------------------

function ResultsDashboard({
  proposals,
  stats,
  proposalItemId,
}: {
  proposals: Array<{
    id: string;
    title: string;
    type: string;
    status: string;
    votesFor: number;
    votesAgainst: number;
    votesAbstain: number;
    proposer: string;
    createdAt: string;
  }>;
  stats: {
    total: number;
    active: number;
    passed: number;
    rejected: number;
    totalVotes: number;
    passRate: number;
    avgParticipation: number;
  };
  proposalItemId?: string;
}) {
  const runVoteAction = useRunArtifact('vote');
  const [voteActionResult, setVoteActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [voteActiveAction, setVoteActiveAction] = useState<string | null>(null);

  const handleVoteAction = useCallback(async (action: string) => {
    const id = proposalItemId;
    if (!id) return;
    setVoteActiveAction(action);
    try {
      const res = await runVoteAction.mutateAsync({ id, action });
      if (res.ok) setVoteActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setVoteActiveAction(null);
    }
  }, [proposalItemId, runVoteAction]);

  // Recent decisions (passed or rejected, sorted by date)
  const recentDecisions = useMemo(() =>
    proposals
      .filter((p) => p.status === 'passed' || p.status === 'rejected')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10),
    [proposals],
  );

  // Top contributors by vote participation
  const contributorMap = useMemo(() => {
    const map = new Map<string, number>();
    proposals.forEach((p) => {
      const name = p.proposer || 'Anonymous';
      map.set(name, (map.get(name) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [proposals]);

  return (
    <div data-lens-theme="vote" className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card">
          <BarChart3 className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-sm text-gray-400">Total Proposals</p>
        </div>
        <div className="lens-card">
          <div className="flex items-center gap-2 mb-2">
            <Check className="w-5 h-5 text-neon-green" />
          </div>
          <p className="text-2xl font-bold">{stats.passRate}%</p>
          <p className="text-sm text-gray-400">Pass Rate</p>
        </div>
        <div className="lens-card">
          <Users className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{stats.avgParticipation}</p>
          <p className="text-sm text-gray-400">Avg Votes / Proposal</p>
        </div>
        <div className="lens-card">
          <Scale className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{stats.totalVotes}</p>
          <p className="text-sm text-gray-400">Total Votes Cast</p>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Decisions Timeline */}
        <div className="panel p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-neon-cyan" />
            Recent Decisions
          </h3>
          {recentDecisions.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No decisions yet.</p>
          ) : (
            <div className="space-y-3">
              {recentDecisions.map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-2 border-b border-lattice-border last:border-0">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${d.status === 'passed' ? 'bg-neon-green' : 'bg-neon-pink'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.title}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(d.createdAt)} &middot; {d.votesFor} for, {d.votesAgainst} against
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    d.status === 'passed' ? 'bg-neon-green/20 text-neon-green' : 'bg-neon-pink/20 text-neon-pink'
                  }`}>
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Contributors */}
        <div className="panel p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-neon-purple" />
            Top Contributors
          </h3>
          {contributorMap.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No contributors yet.</p>
          ) : (
            <div className="space-y-3">
              {contributorMap.map(([name, count], i) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-neon-purple/20 text-neon-purple flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm">{name}</span>
                  <span className="text-sm text-gray-400">{count} proposal{count !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Proposal Type Breakdown */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-green" />
          Proposals by Type
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(['feature', 'policy', 'resource', 'experiment'] as const).map((t) => {
            const count = proposals.filter((p) => p.type === t).length;
            const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            const colors: Record<string, string> = {
              feature: 'bg-neon-cyan',
              policy: 'bg-neon-purple',
              resource: 'bg-neon-green',
              experiment: 'bg-neon-blue',
            };
            return (
              <div key={t} className="text-center">
                <div className="h-24 bg-lattice-deep rounded-lg flex items-end justify-center p-2 mb-2">
                  <div
                    className={`w-10 ${colors[t]} rounded-t transition-all`}
                    style={{ height: `${Math.max(pct, 5)}%` }}
                  />
                </div>
                <p className="text-sm font-medium capitalize">{t}</p>
                <p className="text-xs text-gray-400">{count} ({pct}%)</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Vote Actions Panel */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-purple" />
            Vote Actions
          </h3>
          {voteActionResult && (
            <button onClick={() => setVoteActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['tallyVotes', 'fairnessCheck', 'consensusMeasure'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleVoteAction(action)}
              disabled={!proposalItemId || voteActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {voteActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'tallyVotes' ? 'Tally Votes' : action === 'fairnessCheck' ? 'Fairness Check' : 'Consensus Measure'}
            </button>
          ))}
        </div>
        {voteActionResult && (
          <div className="bg-lattice-deep border border-lattice-border rounded-lg p-3 space-y-2 text-sm">
            {voteActionResult.action === 'tallyVotes' && (() => {
              const r = voteActionResult.result;
              const outcome = String(r.outcome ?? 'pending');
              const outcomeColor = outcome === 'passed' ? 'text-neon-green' : outcome === 'rejected' ? 'text-red-400' : 'text-yellow-400';
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-xs">Outcome:</span>
                    <span className={`text-sm font-semibold uppercase ${outcomeColor}`}>{outcome}</span>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <span className="text-neon-green">For: {String(r.votesFor ?? 0)} ({String(r.forPercent ?? 0)}%)</span>
                    <span className="text-red-400">Against: {String(r.votesAgainst ?? 0)} ({String(r.againstPercent ?? 0)}%)</span>
                    <span className="text-gray-400">Abstain: {String(r.votesAbstain ?? 0)}</span>
                    <span className="text-gray-400">Total: {String(r.totalVotes ?? 0)}</span>
                  </div>
                </div>
              );
            })()}
            {voteActionResult.action === 'fairnessCheck' && (() => {
              const r = voteActionResult.result;
              const isFair = r.isFair as boolean | undefined;
              const issues = Array.isArray(r.issues) ? r.issues as string[] : [];
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-400">Fairness:</span>
                    <span className={`font-semibold px-2 py-0.5 rounded ${isFair ? 'bg-neon-green/20 text-neon-green' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      {isFair ? 'Fair' : 'Issues Detected'}
                    </span>
                    <span className="text-gray-400">Score: <span className="text-white">{String(r.fairnessScore ?? 0)}</span></span>
                  </div>
                  {issues.length > 0 && (
                    <div className="text-xs space-y-0.5">
                      {issues.slice(0, 3).map((issue, i) => <div key={i} className="text-yellow-400">⚠ {issue}</div>)}
                    </div>
                  )}
                </div>
              );
            })()}
            {voteActionResult.action === 'consensusMeasure' && (() => {
              const r = voteActionResult.result;
              const level = String(r.consensusLevel ?? 'low');
              const levelColor = level === 'high' ? 'text-neon-green' : level === 'medium' ? 'text-yellow-400' : 'text-red-400';
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Consensus: <span className={`font-semibold ${levelColor}`}>{level}</span></span>
                    <span className="text-gray-400">Score: <span className="text-white">{String(r.consensusScore ?? 0)}</span></span>
                    <span className="text-gray-400">Polarization: <span className="text-white">{String(r.polarization ?? 0)}</span></span>
                  </div>
                  {!!r.recommendation && <div className="text-xs text-gray-400">Recommendation: <span className="text-gray-300">{String(r.recommendation)}</span></div>}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
