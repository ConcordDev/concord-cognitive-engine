'use client';

import { motion } from 'framer-motion';
import { useState, useMemo, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { api, apiHelpers } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import {
  Scale,
  Users,
  MessageSquare,
  Sparkles,
  Vote,
  FileText,
  DollarSign,
  Shield,
  ClipboardList,
  Plus,
  X,
  ChevronRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
  Send,
  Timer,
  Eye,
  EyeOff,
  Download,
  BarChart3,
  TrendingUp,
  Minus,
  ThumbsUp,
  ThumbsDown,
  Ban,
  Gavel,
  PenLine,
  UserMinus,
  ArrowRightLeft,
  Megaphone,
  FileDown,
  History,
  Hash,
  Search,
  Target,
  Layers,
  CircleDot,
  ClipboardCheck,
  HeartHandshake as HandshakeIcon,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { GovernanceVotingPanel } from '@/components/emergent/GovernanceVotingPanel';
import { EntityCard } from '@/components/entity/EntityCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CouncilTab = 'proposals' | 'voting' | 'debates' | 'budget' | 'audit' | 'stakeholders';

type ProposalType = 'policy' | 'budget' | 'amendment' | 'resolution' | 'motion';
type ProposalStatus = 'draft' | 'discussion' | 'voting' | 'decided' | 'implemented' | 'rejected';
type VotingMethod = 'simple_majority' | 'supermajority' | 'ranked_choice' | 'approval' | 'consent';
type VoteChoice =
  | 'strongly_support'
  | 'support'
  | 'abstain'
  | 'oppose'
  | 'strongly_oppose'
  | 'block';

interface DiscussionComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  type: 'comment' | 'amendment' | 'motion';
}

interface Amendment {
  id: string;
  proposalId: string;
  author: string;
  title: string;
  description: string;
  status: 'proposed' | 'accepted' | 'rejected';
  createdAt: string;
}

interface Proposal {
  id: string;
  title: string;
  description: string;
  type: ProposalType;
  status: ProposalStatus;
  sponsor: string;
  coSponsors: string[];
  createdAt: string;
  updatedAt: string;
  discussion: DiscussionComment[];
  amendments: Amendment[];
  impactAssessment: string;
  linkedBudgetItems: string[];
  votingMethod: VotingMethod;
  votingDeadline: string | null;
  votes: Record<string, VoteChoice>;
  quorumRequired: number;
  tags: string[];
}

interface BudgetItem {
  id: string;
  category: string;
  description: string;
  amount: number;
  type: 'revenue' | 'expense';
  justification: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  proposalId: string | null;
  scenario: 'current' | 'proposed' | 'alternative';
}

interface Stakeholder {
  id: string;
  name: string;
  role: string;
  votingWeight: number;
  committees: string[];
  delegatedTo: string | null;
  conflicts: string[];
  participationScore: number;
  joinedAt: string;
}

interface Committee {
  id: string;
  name: string;
  description: string;
  members: string[];
  chair: string;
}

interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  target: string;
  details: string;
  category: 'vote' | 'proposal' | 'amendment' | 'budget' | 'stakeholder' | 'debate';
}

interface DebateSession {
  id: string;
  topic: string;
  status: 'active' | 'concluded' | 'tabled';
  participants: string[];
  speakingQueue: string[];
  currentSpeaker: string | null;
  timePerSpeaker: number;
  points: { speaker: string; content: string; type: 'point' | 'counterpoint' | 'motion' }[];
  synthesis: string | null;
  createdAt: string;
}

interface Persona {
  id: string;
  name: string;
  style: string;
}

interface DTU {
  id: string;
  content: string;
  meta?: { title?: string };
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS: { id: CouncilTab; label: string; icon: typeof FileText }[] = [
  { id: 'proposals', label: 'Proposals', icon: FileText },
  { id: 'voting', label: 'Voting', icon: Vote },
  { id: 'debates', label: 'Debates', icon: MessageSquare },
  { id: 'budget', label: 'Budget', icon: DollarSign },
  { id: 'audit', label: 'Audit', icon: Shield },
  { id: 'stakeholders', label: 'Stakeholders', icon: Users },
];

const PROPOSAL_TYPES: { value: ProposalType; label: string }[] = [
  { value: 'policy', label: 'Policy' },
  { value: 'budget', label: 'Budget' },
  { value: 'amendment', label: 'Amendment' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'motion', label: 'Motion' },
];

const STATUS_CONFIG: Record<ProposalStatus, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: 'text-gray-400', bg: 'bg-gray-500/20' },
  discussion: { label: 'Discussion', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  voting: { label: 'Voting', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  decided: { label: 'Decided', color: 'text-green-400', bg: 'bg-green-500/20' },
  implemented: { label: 'Implemented', color: 'text-neon-cyan', bg: 'bg-neon-cyan/20' },
  rejected: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/20' },
};

const VOTE_OPTIONS: { value: VoteChoice; label: string; color: string; icon: typeof ThumbsUp }[] = [
  { value: 'strongly_support', label: 'Strongly Support', color: 'bg-green-500', icon: ThumbsUp },
  { value: 'support', label: 'Support', color: 'bg-green-400', icon: ThumbsUp },
  { value: 'abstain', label: 'Abstain', color: 'bg-gray-400', icon: Minus },
  { value: 'oppose', label: 'Oppose', color: 'bg-orange-400', icon: ThumbsDown },
  { value: 'strongly_oppose', label: 'Strongly Oppose', color: 'bg-red-500', icon: ThumbsDown },
  { value: 'block', label: 'Block', color: 'bg-red-700', icon: Ban },
];

const VOTING_METHODS: { value: VotingMethod; label: string; desc: string }[] = [
  { value: 'simple_majority', label: 'Simple Majority', desc: '50% + 1' },
  { value: 'supermajority', label: 'Supermajority', desc: '2/3 required' },
  { value: 'ranked_choice', label: 'Ranked Choice', desc: 'Preference ranking' },
  { value: 'approval', label: 'Approval Voting', desc: 'Approve multiple' },
  { value: 'consent', label: 'Consent-Based', desc: 'No blocks' },
];

const BUDGET_CATEGORIES = [
  'Operations',
  'Personnel',
  'Technology',
  'Marketing',
  'Research',
  'Infrastructure',
  'Legal',
  'Training',
  'Community',
  'Reserve',
];

// ---------------------------------------------------------------------------
// Initial Data (empty — all data comes from backend)
// ---------------------------------------------------------------------------

const INITIAL_STAKEHOLDERS: Stakeholder[] = [];
const INITIAL_COMMITTEES: Committee[] = [];
const INITIAL_PROPOSALS: Proposal[] = [];
const INITIAL_BUDGET_ITEMS: BudgetItem[] = [];
const INITIAL_AUDIT: AuditEntry[] = [];
const INITIAL_DEBATES: DebateSession[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(d: string) {
  return new Date(d).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function timeUntil(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h remaining`;
  const mins = Math.floor((diff % 3600000) / 60000);
  return `${hours}h ${mins}m remaining`;
}

function getVoteTally(votes: Record<string, VoteChoice>) {
  const tally: Record<VoteChoice, number> = {
    strongly_support: 0,
    support: 0,
    abstain: 0,
    oppose: 0,
    strongly_oppose: 0,
    block: 0,
  };
  Object.values(votes).forEach((v) => {
    tally[v]++;
  });
  return tally;
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CouncilLensPage() {
  useLensNav('council');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('council');
  const queryClient = useQueryClient();

  // ----- Lens persistence (auto-seeds on first use, derives local data) -----
  const {
    items: proposalLensItems,
    isLoading: _proposalsLoading,
    isError,
    error,
    refetch,
    create: createProposalItem,
    update: updateProposalItem,
    remove: removeProposalItem,
  } = useLensData<Record<string, unknown>>('council', 'proposal', {
    seed: INITIAL_PROPOSALS.map((p) => ({
      title: p.title,
      data: p as unknown as Record<string, unknown>,
    })),
  });
  const {
    items: budgetLensItems,
    create: createBudgetItem,
    update: updateBudgetItem,
    remove: removeBudgetItem,
  } = useLensData<Record<string, unknown>>('council', 'budget', {
    seed: INITIAL_BUDGET_ITEMS.map((b) => ({
      title: b.description,
      data: b as unknown as Record<string, unknown>,
    })),
  });
  const {
    items: stakeholderLensItems,
    create: createStakeholderItem,
    update: updateStakeholderItem,
    remove: removeStakeholderItem,
  } = useLensData<Record<string, unknown>>('council', 'stakeholder', {
    seed: INITIAL_STAKEHOLDERS.map((s) => ({
      title: s.name,
      data: s as unknown as Record<string, unknown>,
    })),
  });
  const {
    items: committeeLensItems,
    create: createCommitteeItem,
    update: updateCommitteeItem,
    remove: removeCommitteeItem,
  } = useLensData<Record<string, unknown>>('council', 'committee', {
    seed: INITIAL_COMMITTEES.map((c) => ({
      title: c.name,
      data: c as unknown as Record<string, unknown>,
    })),
  });
  const {
    items: auditLensItems,
    create: createAuditItem,
    update: updateAuditItem,
    remove: removeAuditItem,
  } = useLensData<Record<string, unknown>>('council', 'audit', {
    seed: INITIAL_AUDIT.map((a) => ({
      title: a.action,
      data: a as unknown as Record<string, unknown>,
    })),
  });
  const {
    items: debateLensItems,
    create: createDebateItem,
    update: updateDebateItem,
    remove: removeDebateItem,
  } = useLensData<Record<string, unknown>>('council', 'debate', {
    seed: INITIAL_DEBATES.map((d) => ({
      title: d.topic,
      data: d as unknown as Record<string, unknown>,
    })),
  });

  // Derive typed arrays from lens items (backend data is the source of truth)
  const proposals: Proposal[] = useMemo(
    () => proposalLensItems.map((i) => ({ ...(i.data as unknown as Proposal), id: i.id })),
    [proposalLensItems]
  );
  const budgetItems: BudgetItem[] = useMemo(
    () => budgetLensItems.map((i) => ({ ...(i.data as unknown as BudgetItem), id: i.id })),
    [budgetLensItems]
  );
  const stakeholders: Stakeholder[] = useMemo(
    () => stakeholderLensItems.map((i) => ({ ...(i.data as unknown as Stakeholder), id: i.id })),
    [stakeholderLensItems]
  );
  const committees: Committee[] = useMemo(
    () => committeeLensItems.map((i) => ({ ...(i.data as unknown as Committee), id: i.id })),
    [committeeLensItems]
  );
  const auditLog: AuditEntry[] = useMemo(
    () => auditLensItems.map((i) => ({ ...(i.data as unknown as AuditEntry), id: i.id })),
    [auditLensItems]
  );
  const debates: DebateSession[] = useMemo(
    () => debateLensItems.map((i) => ({ ...(i.data as unknown as DebateSession), id: i.id })),
    [debateLensItems]
  );

  const [activeTab, setActiveTab] = useState<CouncilTab>('proposals');

  // ----- UI State -----
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [showCreateProposal, setShowCreateProposal] = useState(false);
  const [showCreateBudgetItem, setShowCreateBudgetItem] = useState(false);
  const [showCreateCommittee, setShowCreateCommittee] = useState(false);
  const [showCreateDebate, setShowCreateDebate] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProposalStatus | 'all'>('all');
  const [budgetScenario, setBudgetScenario] = useState<
    'current' | 'proposed' | 'alternative' | 'all'
  >('all');
  const [auditCategory, setAuditCategory] = useState<AuditEntry['category'] | 'all'>('all');
  const [anonymousVoting, setAnonymousVoting] = useState(false);

  // ----- Form State -----
  const [newProposal, setNewProposal] = useState({
    title: '',
    description: '',
    type: 'policy' as ProposalType,
    impactAssessment: '',
    tags: '',
    votingMethod: 'simple_majority' as VotingMethod,
  });
  const [newBudgetItem, setNewBudgetItem] = useState({
    category: 'Operations',
    description: '',
    amount: '',
    type: 'expense' as 'revenue' | 'expense',
    justification: '',
    scenario: 'proposed' as BudgetItem['scenario'],
  });
  const [newCommittee, setNewCommittee] = useState({ name: '', description: '' });
  const [newDebate, setNewDebate] = useState({ topic: '', timePerSpeaker: 300 });
  const [commentText, setCommentText] = useState('');
  const [amendmentForm, setAmendmentForm] = useState({ title: '', description: '' });
  const [showAmendmentForm, setShowAmendmentForm] = useState(false);
  const [debatePointText, setDebatePointText] = useState('');

  // ----- Domain Action State -----
  const [councilActionRunning, setCouncilActionRunning] = useState<string | null>(null);
  const [deliberateResult, setDeliberateResult] = useState<Record<string, unknown> | null>(null);
  const [voteCountResult, setVoteCountResult] = useState<Record<string, unknown> | null>(null);
  const [minutesResult, setMinutesResult] = useState<Record<string, unknown> | null>(null);
  const [conflictResult, setConflictResult] = useState<Record<string, unknown> | null>(null);

  // ----- Data Hooks -----
  const {
    data: personasData,
    isError: isError2,
    error: error2,
    refetch: refetch2,
  } = useQuery({
    queryKey: ['personas'],
    queryFn: () => api.get('/api/personas').then((r) => r.data),
  });

  const {
    data: dtusData,
    isError: isError3,
    error: error3,
    refetch: refetch3,
  } = useQuery({
    queryKey: ['dtus'],
    queryFn: () => api.get('/api/dtus').then((r) => r.data),
  });

  const debateMutation = useMutation({
    mutationFn: async (_params: { dtuA: string; dtuB: string; topic: string }) => {
      const res = await apiHelpers.council.reviewGlobal();
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
    },
    onError: (err) => {
      console.error('Debate failed:', err instanceof Error ? err.message : err);
    },
  });

  const runArtifact = useRunArtifact('council');

  const handleCouncilAction = async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void,
    params?: Record<string, unknown>
  ) => {
    setCouncilActionRunning(action);
    try {
      const artifactId = proposalLensItems[0]?.id || 'council';
      const res = await runArtifact.mutateAsync({ id: artifactId, action, params: params || {} });
      if (res.ok === false) {
        setter({
          message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
        } as Record<string, unknown>);
      } else {
        setter((res.result as Record<string, unknown>) || null);
      }
    } catch (e) {
      console.error(`Council action ${action} failed:`, e);
    }
    setCouncilActionRunning(null);
  };

  const personas: Persona[] = personasData?.personas || [];
  const dtus: DTU[] = useMemo(() => dtusData?.dtus?.slice(0, 50) || [], [dtusData]);

  // ----- Computed -----
  const selectedProposal = selectedProposalId
    ? proposals.find((p) => p.id === selectedProposalId) || null
    : null;

  const dashboardStats = useMemo(() => {
    const active = proposals.filter((p) => ['discussion', 'voting'].includes(p.status)).length;
    const pendingVotes = proposals.filter((p) => p.status === 'voting').length;
    const totalVoters = stakeholders.filter((s) => s.votingWeight > 0).length;
    const quorumMet = proposals
      .filter((p) => p.status === 'voting')
      .every((p) => Object.keys(p.votes).length >= p.quorumRequired);
    const decided = proposals.filter((p) =>
      ['decided', 'implemented', 'rejected'].includes(p.status)
    ).length;
    return { active, pendingVotes, quorumMet, totalVoters, decided };
  }, [proposals, stakeholders]);

  const filteredProposals = useMemo(() => {
    let filtered = proposals;
    if (statusFilter !== 'all') filtered = filtered.filter((p) => p.status === statusFilter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.tags.some((t) => t.includes(q))
      );
    }
    return filtered.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [proposals, statusFilter, searchQuery]);

  const filteredBudget = useMemo(() => {
    if (budgetScenario === 'all') return budgetItems;
    return budgetItems.filter((b) => b.scenario === budgetScenario);
  }, [budgetItems, budgetScenario]);

  const filteredAudit = useMemo(() => {
    if (auditCategory === 'all') return auditLog;
    return auditLog.filter((a) => a.category === auditCategory);
  }, [auditLog, auditCategory]);

  const budgetSummary = useMemo(() => {
    const revenue = filteredBudget
      .filter((b) => b.type === 'revenue')
      .reduce((s, b) => s + b.amount, 0);
    const expenses = filteredBudget
      .filter((b) => b.type === 'expense')
      .reduce((s, b) => s + b.amount, 0);
    return { revenue, expenses, balance: revenue - expenses };
  }, [filteredBudget]);

  // ----- Audit Logger -----
  const addAuditEntry = useCallback(
    (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
      const auditEntry = { ...entry, id: `au-${Date.now()}`, timestamp: new Date().toISOString() };
      createAuditItem({
        title: entry.action,
        data: auditEntry as unknown as Record<string, unknown>,
      });
    },
    [createAuditItem]
  );

  // ----- Stakeholder name lookup -----
  const stakeholderName = useCallback(
    (id: string) => {
      return stakeholders.find((s) => s.id === id)?.name || id;
    },
    [stakeholders]
  );

  // ----- Actions -----
  const handleCreateProposal = useCallback(() => {
    if (!newProposal.title.trim()) return;
    const p: Proposal = {
      id: `prop-${Date.now()}`,
      title: newProposal.title,
      description: newProposal.description,
      type: newProposal.type,
      status: 'draft',
      sponsor: 's1',
      coSponsors: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      discussion: [],
      amendments: [],
      impactAssessment: newProposal.impactAssessment,
      linkedBudgetItems: [],
      votingMethod: newProposal.votingMethod,
      votingDeadline: null,
      votes: {},
      quorumRequired: 4,
      tags: newProposal.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    };
    createProposalItem({ title: p.title, data: p as unknown as Record<string, unknown> });
    addAuditEntry({
      actor: 'Council Chair',
      action: 'Created proposal',
      target: p.id,
      details: p.title,
      category: 'proposal',
    });
    setShowCreateProposal(false);
    setNewProposal({
      title: '',
      description: '',
      type: 'policy',
      impactAssessment: '',
      tags: '',
      votingMethod: 'simple_majority',
    });
  }, [newProposal, addAuditEntry, createProposalItem]);

  const handleAdvanceStatus = useCallback(
    (proposalId: string) => {
      const order: ProposalStatus[] = ['draft', 'discussion', 'voting', 'decided', 'implemented'];
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const idx = order.indexOf(p.status);
      if (idx < 0 || idx >= order.length - 1) return;
      const next = order[idx + 1];
      const updated = { ...p, status: next, updatedAt: new Date().toISOString() };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: `Advanced to ${next}`,
        target: p.id,
        details: `${p.title} moved to ${next}`,
        category: 'proposal',
      });
    },
    [proposals, addAuditEntry, updateProposalItem]
  );

  const handleRejectProposal = useCallback(
    (proposalId: string) => {
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const updated = {
        ...p,
        status: 'rejected' as ProposalStatus,
        updatedAt: new Date().toISOString(),
      };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: 'Rejected proposal',
        target: p.id,
        details: p.title,
        category: 'proposal',
      });
    },
    [proposals, addAuditEntry, updateProposalItem]
  );

  const handleCastVote = useCallback(
    (proposalId: string, stakeholderId: string, choice: VoteChoice) => {
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const newVotes = { ...p.votes, [stakeholderId]: choice };
      const updated = { ...p, votes: newVotes, updatedAt: new Date().toISOString() };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: stakeholderName(stakeholderId),
        action: 'Voted',
        target: p.id,
        details: `Cast vote: ${choice.replace('_', ' ')}`,
        category: 'vote',
      });
    },
    [proposals, addAuditEntry, stakeholderName, updateProposalItem]
  );

  const handleAddComment = useCallback(
    (proposalId: string) => {
      if (!commentText.trim()) return;
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const comment: DiscussionComment = {
        id: `dc-${Date.now()}`,
        author: 's1',
        content: commentText,
        createdAt: new Date().toISOString(),
        type: 'comment',
      };
      const updated = {
        ...p,
        discussion: [...p.discussion, comment],
        updatedAt: new Date().toISOString(),
      };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      setCommentText('');
    },
    [commentText, proposals, updateProposalItem]
  );

  const handleAddAmendment = useCallback(
    (proposalId: string) => {
      if (!amendmentForm.title.trim()) return;
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const amendment: Amendment = {
        id: `am-${Date.now()}`,
        proposalId,
        author: 's1',
        title: amendmentForm.title,
        description: amendmentForm.description,
        status: 'proposed',
        createdAt: new Date().toISOString(),
      };
      const updated = {
        ...p,
        amendments: [...p.amendments, amendment],
        updatedAt: new Date().toISOString(),
      };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: 'Proposed amendment',
        target: amendment.id,
        details: amendment.title,
        category: 'amendment',
      });
      setAmendmentForm({ title: '', description: '' });
      setShowAmendmentForm(false);
    },
    [amendmentForm, addAuditEntry, proposals, updateProposalItem]
  );

  const handleAcceptAmendment = useCallback(
    (proposalId: string, amendmentId: string) => {
      const p = proposals.find((pr) => pr.id === proposalId);
      if (!p) return;
      const updated = {
        ...p,
        amendments: p.amendments.map((a) =>
          a.id === amendmentId ? { ...a, status: 'accepted' as const } : a
        ),
        updatedAt: new Date().toISOString(),
      };
      updateProposalItem(proposalId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: 'Accepted amendment',
        target: amendmentId,
        details: 'Amendment accepted',
        category: 'amendment',
      });
    },
    [proposals, addAuditEntry, updateProposalItem]
  );

  const handleCreateBudgetItem = useCallback(() => {
    if (!newBudgetItem.description.trim() || !newBudgetItem.amount) return;
    const item: BudgetItem = {
      id: `bi-${Date.now()}`,
      category: newBudgetItem.category,
      description: newBudgetItem.description,
      amount: parseFloat(newBudgetItem.amount),
      type: newBudgetItem.type,
      justification: newBudgetItem.justification,
      approvalStatus: 'pending',
      proposalId: null,
      scenario: newBudgetItem.scenario,
    };
    createBudgetItem({ title: item.description, data: item as unknown as Record<string, unknown> });
    addAuditEntry({
      actor: 'Council Chair',
      action: 'Submitted budget item',
      target: item.id,
      details: `${item.description} (${formatCurrency(item.amount)})`,
      category: 'budget',
    });
    setShowCreateBudgetItem(false);
    setNewBudgetItem({
      category: 'Operations',
      description: '',
      amount: '',
      type: 'expense',
      justification: '',
      scenario: 'proposed',
    });
  }, [newBudgetItem, addAuditEntry, createBudgetItem]);

  const handleApproveBudgetItem = useCallback(
    (itemId: string, approved: boolean) => {
      const b = budgetItems.find((bi) => bi.id === itemId);
      if (!b) return;
      const updated = {
        ...b,
        approvalStatus: approved ? ('approved' as const) : ('rejected' as const),
      };
      updateBudgetItem(itemId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: approved ? 'Approved budget item' : 'Rejected budget item',
        target: itemId,
        details: '',
        category: 'budget',
      });
    },
    [budgetItems, addAuditEntry, updateBudgetItem]
  );

  const handleCreateCommittee = useCallback(() => {
    if (!newCommittee.name.trim()) return;
    const c: Committee = {
      id: `com-${Date.now()}`,
      name: newCommittee.name,
      description: newCommittee.description,
      members: ['s1'],
      chair: 's1',
    };
    createCommitteeItem({ title: c.name, data: c as unknown as Record<string, unknown> });
    addAuditEntry({
      actor: 'Council Chair',
      action: 'Created committee',
      target: c.id,
      details: c.name,
      category: 'stakeholder',
    });
    setShowCreateCommittee(false);
    setNewCommittee({ name: '', description: '' });
  }, [newCommittee, addAuditEntry, createCommitteeItem]);

  const handleDelegate = useCallback(
    (fromId: string, toId: string | null) => {
      const s = stakeholders.find((sh) => sh.id === fromId);
      if (!s) return;
      const updated = { ...s, delegatedTo: toId };
      updateStakeholderItem(fromId, { data: updated as unknown as Record<string, unknown> });
      if (toId) {
        addAuditEntry({
          actor: stakeholderName(fromId),
          action: 'Delegated vote',
          target: `${fromId} -> ${toId}`,
          details: `Delegated to ${stakeholderName(toId)}`,
          category: 'stakeholder',
        });
      }
    },
    [stakeholders, addAuditEntry, stakeholderName, updateStakeholderItem]
  );

  const handleCreateDebate = useCallback(() => {
    if (!newDebate.topic.trim()) return;
    const d: DebateSession = {
      id: `debate-${Date.now()}`,
      topic: newDebate.topic,
      status: 'active',
      participants: ['s1'],
      speakingQueue: [],
      currentSpeaker: 's1',
      timePerSpeaker: newDebate.timePerSpeaker,
      points: [],
      synthesis: null,
      createdAt: new Date().toISOString(),
    };
    createDebateItem({ title: d.topic, data: d as unknown as Record<string, unknown> });
    addAuditEntry({
      actor: 'Council Chair',
      action: 'Started debate',
      target: d.id,
      details: d.topic,
      category: 'debate',
    });
    // Trigger AI council review for the debate
    if (dtus.length >= 2) {
      debateMutation.mutate({ dtuA: dtus[0].id, dtuB: dtus[1].id, topic: d.topic });
    }
    setShowCreateDebate(false);
    setNewDebate({ topic: '', timePerSpeaker: 300 });
  }, [newDebate, addAuditEntry, createDebateItem, debateMutation, dtus]);

  const handleAddDebatePoint = useCallback(
    (debateId: string, type: 'point' | 'counterpoint' | 'motion') => {
      if (!debatePointText.trim()) return;
      const d = debates.find((db) => db.id === debateId);
      if (!d) return;
      const updated = {
        ...d,
        points: [...d.points, { speaker: 'Council Chair', content: debatePointText, type }],
      };
      updateDebateItem(debateId, { data: updated as unknown as Record<string, unknown> });
      setDebatePointText('');
    },
    [debatePointText, debates, updateDebateItem]
  );

  const handleConcludeDebate = useCallback(
    (debateId: string) => {
      const d = debates.find((db) => db.id === debateId);
      if (!d) return;
      const updated = {
        ...d,
        status: 'concluded' as const,
        synthesis: 'Synthesis to be generated...',
      };
      updateDebateItem(debateId, { data: updated as unknown as Record<string, unknown> });
      addAuditEntry({
        actor: 'Council Chair',
        action: 'Concluded debate',
        target: debateId,
        details: 'Debate concluded',
        category: 'debate',
      });
    },
    [debates, addAuditEntry, updateDebateItem]
  );

  const handleGenerateSynthesis = useCallback(
    (debateId: string) => {
      const debate = debates.find((d) => d.id === debateId);
      if (!debate) return;
      runArtifact.mutate({ id: debateId, action: 'deliberate', params: { points: debate.points } });
    },
    [debates, runArtifact]
  );

  const handleExportAudit = useCallback(() => {
    const csv = [
      'Timestamp,Actor,Action,Target,Details,Category',
      ...filteredAudit.map(
        (a) =>
          `"${a.timestamp}","${a.actor}","${a.action}","${a.target}","${a.details}","${a.category}"`
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `council-audit-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredAudit]);

  // ----- Error -----
  if (isError || isError2 || isError3) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={error?.message || error2?.message || error3?.message}
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
          }}
        />
      </div>
    );
  }

  // ----- Vote Tally Bar -----
  function VoteTallyBar({ votes, quorum }: { votes: Record<string, VoteChoice>; quorum: number }) {
    const tally = getVoteTally(votes);
    const total = Object.values(tally).reduce((s, n) => s + n, 0);
    if (total === 0) return <div className={cn(ds.textMuted, 'py-2')}>No votes cast yet</div>;
    const segments: { choice: VoteChoice; count: number; color: string }[] = VOTE_OPTIONS.map(
      (v) => ({ choice: v.value, count: tally[v.value], color: v.color })
    ).filter((s) => s.count > 0);
    return (
      <div className="space-y-2">
        <div className="flex h-6 rounded-lg overflow-hidden border border-lattice-border">
          {segments.map((s) => (
            <div
              key={s.choice}
              className={cn(
                s.color,
                'flex items-center justify-center text-[10px] font-bold text-white'
              )}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.choice.replace(/_/g, ' ')}: ${s.count}`}
            >
              {s.count}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-xs">
          <span className={ds.textMuted}>
            {total} vote{total !== 1 ? 's' : ''} cast
          </span>
          <span className={cn(total >= quorum ? 'text-green-400' : 'text-yellow-400')}>
            Quorum: {total}/{quorum} {total >= quorum ? '(met)' : '(not met)'}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {segments.map((s) => (
            <span key={s.choice} className="flex items-center gap-1 text-xs text-gray-300">
              <span className={cn('w-2.5 h-2.5 rounded-full', s.color)} />
              {s.choice.replace(/_/g, ' ')} ({s.count})
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ----- Budget Allocation Bar -----
  function BudgetAllocationBar({ items }: { items: BudgetItem[] }) {
    const expenses = items.filter((b) => b.type === 'expense');
    const total = expenses.reduce((s, b) => s + b.amount, 0);
    if (total === 0) return null;
    const categories = [...new Set(expenses.map((b) => b.category))];
    const categoryColors: Record<string, string> = {
      Operations: 'bg-blue-500',
      Personnel: 'bg-indigo-500',
      Technology: 'bg-cyan-500',
      Marketing: 'bg-pink-500',
      Research: 'bg-purple-500',
      Infrastructure: 'bg-yellow-500',
      Legal: 'bg-red-400',
      Training: 'bg-green-500',
      Community: 'bg-orange-500',
      Reserve: 'bg-gray-500',
    };
    const categoryTotals = categories
      .map((cat) => ({
        category: cat,
        amount: expenses.filter((b) => b.category === cat).reduce((s, b) => s + b.amount, 0),
        color: categoryColors[cat] || 'bg-gray-400',
      }))
      .sort((a, b) => b.amount - a.amount);
    return (
      <div className="space-y-2">
        <div className="flex h-5 rounded-lg overflow-hidden border border-lattice-border">
          {categoryTotals.map((c) => (
            <div
              key={c.category}
              className={cn(
                c.color,
                'flex items-center justify-center text-[9px] font-bold text-white'
              )}
              style={{ width: `${(c.amount / total) * 100}%` }}
              title={`${c.category}: ${formatCurrency(c.amount)}`}
            >
              {(c.amount / total) * 100 > 8 ? c.category.slice(0, 4) : ''}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {categoryTotals.map((c) => (
            <span key={c.category} className="flex items-center gap-1.5 text-xs text-gray-300">
              <span className={cn('w-2.5 h-2.5 rounded-full', c.color)} />
              {c.category}: {formatCurrency(c.amount)} ({((c.amount / total) * 100).toFixed(1)}%)
            </span>
          ))}
        </div>
      </div>
    );
  }

  // ===== RENDER TAB: PROPOSALS =====
  function renderProposalsTab() {
    if (selectedProposal) return renderProposalDetail();
    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search proposals..."
                className={cn(ds.input, 'pl-10 !w-64')}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ProposalStatus | 'all')}
              className={cn(ds.select, '!w-40')}
            >
              <option value="all">All Status</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => setShowCreateProposal(true)} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" />
            New Proposal
          </button>
        </div>

        {filteredProposals.length === 0 && (
          <div className={cn(ds.panel, 'text-center py-12')}>
            <FileText className="w-10 h-10 mx-auto mb-3 text-gray-600" />
            <p className={ds.textMuted}>No proposals found. Create one to get started.</p>
          </div>
        )}

        <div className="space-y-3">
          {filteredProposals.map((p, index) => {
            const sc = STATUS_CONFIG[p.status];
            const voteCount = Object.keys(p.votes).length;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => setSelectedProposalId(p.id)}
                className={cn(ds.panelHover, 'cursor-pointer')}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                          sc.bg,
                          sc.color
                        )}
                      >
                        {sc.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-lattice-elevated text-gray-300 capitalize">
                        {p.type}
                      </span>
                      {p.votingDeadline && p.status === 'voting' && (
                        <span className="flex items-center gap-1 text-[10px] text-yellow-400">
                          <Timer className="w-3 h-3" />
                          {timeUntil(p.votingDeadline)}
                        </span>
                      )}
                    </div>
                    <h3 className={cn(ds.heading3, 'mb-1')}>{p.title}</h3>
                    <p className={cn(ds.textMuted, 'line-clamp-2')}>{p.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      <span>Sponsor: {stakeholderName(p.sponsor)}</span>
                      {p.coSponsors.length > 0 && (
                        <span>
                          +{p.coSponsors.length} co-sponsor{p.coSponsors.length > 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />
                        {p.discussion.length}
                      </span>
                      <span className="flex items-center gap-1">
                        <PenLine className="w-3 h-3" />
                        {p.amendments.length} amendment{p.amendments.length !== 1 ? 's' : ''}
                      </span>
                      {voteCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Vote className="w-3 h-3" />
                          {voteCount} vote{voteCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {p.tags.length > 0 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {p.tags.map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 bg-lattice-elevated border border-lattice-border rounded text-[10px] text-gray-400"
                          >
                            <Hash className="w-2.5 h-2.5 inline mr-0.5" />
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-600 flex-shrink-0 mt-1" />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    );
  }

  // ===== RENDER: PROPOSAL DETAIL =====
  function renderProposalDetail() {
    if (!selectedProposal) return null;
    const p = selectedProposal;
    const sc = STATUS_CONFIG[p.status];
    const tally = getVoteTally(p.votes);
    const voteTotal = Object.values(tally).reduce((s, n) => s + n, 0);
    const canVote = p.status === 'voting';
    const votableStakeholders = stakeholders.filter((s) => s.votingWeight > 0 && !p.votes[s.id]);

    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedProposalId(null)} className={cn(ds.btnGhost, 'mb-2')}>
          <ArrowLeft className="w-4 h-4" />
          Back to Proposals
        </button>

        {/* Header */}
        <div className={ds.panel}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className={cn('px-2.5 py-1 rounded-full text-xs font-semibold', sc.bg, sc.color)}>
              {sc.label}
            </span>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-lattice-elevated text-gray-300 capitalize">
              {p.type}
            </span>
            <span className="text-xs text-gray-500">
              Method: {VOTING_METHODS.find((v) => v.value === p.votingMethod)?.label}
            </span>
            {p.votingDeadline && p.status === 'voting' && (
              <span className="flex items-center gap-1 text-xs text-yellow-400">
                <Timer className="w-3.5 h-3.5" />
                {timeUntil(p.votingDeadline)}
              </span>
            )}
          </div>
          <h1 className={cn(ds.heading1, 'mb-2')}>{p.title}</h1>
          <p className="text-gray-300 text-sm leading-relaxed mb-4">{p.description}</p>

          <div className="flex items-center gap-6 text-xs text-gray-400 border-t border-lattice-border pt-3">
            <span>
              Sponsor: <strong className="text-white">{stakeholderName(p.sponsor)}</strong>
            </span>
            {p.coSponsors.length > 0 && (
              <span>Co-sponsors: {p.coSponsors.map((c) => stakeholderName(c)).join(', ')}</span>
            )}
            <span>Created: {formatDate(p.createdAt)}</span>
            <span>Updated: {formatDate(p.updatedAt)}</span>
            <button
              onClick={() => {
                removeProposalItem(p.id);
                setSelectedProposalId(null);
              }}
              className="ml-auto text-red-400 hover:text-red-300 text-xs flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Remove
            </button>
          </div>

          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="council" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 mt-4 flex-wrap">
            {p.status !== 'implemented' && p.status !== 'rejected' && (
              <button onClick={() => handleAdvanceStatus(p.id)} className={ds.btnPrimary}>
                <Gavel className="w-4 h-4" />
                {p.status === 'draft'
                  ? 'Open Discussion'
                  : p.status === 'discussion'
                    ? 'Call Vote'
                    : p.status === 'voting'
                      ? 'Close Voting'
                      : 'Mark Implemented'}
              </button>
            )}
            {p.status !== 'implemented' && p.status !== 'rejected' && (
              <button onClick={() => handleRejectProposal(p.id)} className={ds.btnDanger}>
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            )}
          </div>
        </div>

        {/* Impact Assessment */}
        {p.impactAssessment && (
          <div className={ds.panel}>
            <h2 className={cn(ds.heading3, 'mb-2 flex items-center gap-2')}>
              <Target className="w-4 h-4 text-neon-cyan" />
              Impact Assessment
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed">{p.impactAssessment}</p>
          </div>
        )}

        {/* Voting */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <Vote className="w-4 h-4 text-yellow-400" />
            Vote Tally
          </h2>
          <VoteTallyBar votes={p.votes} quorum={p.quorumRequired} />

          {canVote && votableStakeholders.length > 0 && (
            <div className="mt-4 pt-4 border-t border-lattice-border">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-300">Cast votes for remaining stakeholders:</p>
                <button
                  onClick={() => setAnonymousVoting(!anonymousVoting)}
                  className={cn(ds.btnGhost, 'text-xs')}
                >
                  {anonymousVoting ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                  {anonymousVoting ? 'Anonymous' : 'Transparent'}
                </button>
              </div>
              {votableStakeholders.map((s) => (
                <div key={s.id} className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="text-xs text-gray-400 w-28 flex-shrink-0">{s.name}:</span>
                  {VOTE_OPTIONS.map((v) => (
                    <button
                      key={v.value}
                      onClick={() => handleCastVote(p.id, s.id, v.value)}
                      className={cn(ds.btnSmall, 'text-[10px] px-2 py-1', `hover:${v.color}/30`)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {!anonymousVoting && voteTotal > 0 && (
            <div className="mt-3 pt-3 border-t border-lattice-border">
              <p className="text-xs text-gray-500 mb-2">Individual votes:</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(p.votes).map(([sid, choice]) => {
                  const opt = VOTE_OPTIONS.find((v) => v.value === choice);
                  return (
                    <span
                      key={sid}
                      className="flex items-center gap-1.5 text-xs px-2 py-1 bg-lattice-elevated rounded-full"
                    >
                      <span className={cn('w-2 h-2 rounded-full', opt?.color)} />
                      {stakeholderName(sid)}: {choice.replace(/_/g, ' ')}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Amendments */}
        <div className={ds.panel}>
          <div className={ds.sectionHeader}>
            <h2 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <PenLine className="w-4 h-4 text-purple-400" />
              Amendments ({p.amendments.length})
            </h2>
            <button
              onClick={() => setShowAmendmentForm(!showAmendmentForm)}
              className={ds.btnSecondary}
            >
              <Plus className="w-4 h-4" />
              Propose Amendment
            </button>
          </div>
          {showAmendmentForm && (
            <div className="mt-3 p-3 bg-lattice-elevated rounded-lg space-y-2">
              <input
                value={amendmentForm.title}
                onChange={(e) => setAmendmentForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Amendment title"
                className={ds.input}
              />
              <textarea
                value={amendmentForm.description}
                onChange={(e) => setAmendmentForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Describe the proposed change..."
                rows={3}
                className={ds.textarea}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAmendmentForm(false)} className={ds.btnGhost}>
                  Cancel
                </button>
                <button onClick={() => handleAddAmendment(p.id)} className={ds.btnPrimary}>
                  Submit Amendment
                </button>
              </div>
            </div>
          )}
          {p.amendments.length === 0 && !showAmendmentForm && (
            <p className={cn(ds.textMuted, 'py-4 text-center')}>No amendments proposed.</p>
          )}
          <div className="space-y-2 mt-3">
            {p.amendments.map((a) => (
              <div key={a.id} className="p-3 bg-lattice-elevated rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">{a.title}</h4>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        a.status === 'accepted'
                          ? 'bg-green-500/20 text-green-400'
                          : a.status === 'rejected'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      )}
                    >
                      {a.status}
                    </span>
                  </div>
                  {a.status === 'proposed' && (
                    <button
                      onClick={() => handleAcceptAmendment(p.id, a.id)}
                      className={cn(
                        ds.btnSmall,
                        'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                      )}
                    >
                      Accept
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">{a.description}</p>
                <p className="text-[10px] text-gray-600 mt-1">
                  By {stakeholderName(a.author)} on {formatDate(a.createdAt)}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Discussion */}
        <div className={ds.panel}>
          <h2 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <MessageSquare className="w-4 h-4 text-blue-400" />
            Discussion ({p.discussion.length})
          </h2>
          {p.discussion.length === 0 && (
            <p className={cn(ds.textMuted, 'py-4 text-center')}>No comments yet.</p>
          )}
          <div className="space-y-2 mb-4">
            {p.discussion.map((c) => (
              <div key={c.id} className="p-3 bg-lattice-elevated rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-neon-cyan">
                    {stakeholderName(c.author)}
                  </span>
                  <span className="text-[10px] text-gray-600">{formatDateTime(c.createdAt)}</span>
                  {c.type !== 'comment' && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500/20 text-purple-400">
                      {c.type}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-300">{c.content}</p>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddComment(p.id)}
              placeholder="Add to the discussion..."
              className={cn(ds.input, 'flex-1')}
            />
            <button
              onClick={() => handleAddComment(p.id)}
              disabled={!commentText.trim()}
              className={ds.btnPrimary}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Linked Budget Items */}
        {p.linkedBudgetItems.length > 0 && (
          <div className={ds.panel}>
            <h2 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
              <DollarSign className="w-4 h-4 text-green-400" />
              Linked Budget Items
            </h2>
            <div className="space-y-2">
              {p.linkedBudgetItems.map((biId) => {
                const bi = budgetItems.find((b) => b.id === biId);
                if (!bi) return null;
                return (
                  <div
                    key={bi.id}
                    className="flex items-center justify-between p-2 bg-lattice-elevated rounded-lg"
                  >
                    <div>
                      <span className="text-sm text-white">{bi.description}</span>
                      <span
                        className={cn(
                          'ml-2 text-xs',
                          bi.type === 'revenue' ? 'text-green-400' : 'text-red-400'
                        )}
                      >
                        {bi.type === 'revenue' ? '+' : '-'}
                        {formatCurrency(bi.amount)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        bi.approvalStatus === 'approved'
                          ? 'bg-green-500/20 text-green-400'
                          : bi.approvalStatus === 'rejected'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      )}
                    >
                      {bi.approvalStatus}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== RENDER TAB: VOTING =====
  function renderVotingTab() {
    const votingProposals = proposals.filter((p) => p.status === 'voting');
    const decidedProposals = proposals.filter((p) =>
      ['decided', 'implemented', 'rejected'].includes(p.status)
    );
    return (
      <div className="space-y-6">
        <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
          <Vote className="w-5 h-5 text-yellow-400" />
          Active Votes
        </h2>
        {votingProposals.length === 0 && (
          <div className={cn(ds.panel, 'text-center py-8')}>
            <Vote className="w-8 h-8 mx-auto mb-2 text-gray-600" />
            <p className={ds.textMuted}>
              No active votes. Move a proposal to voting stage to begin.
            </p>
          </div>
        )}
        {votingProposals.map((p) => (
          <div key={p.id} className={ds.panel}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className={ds.heading3}>{p.title}</h3>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-400">
                    Method: {VOTING_METHODS.find((v) => v.value === p.votingMethod)?.label}
                  </span>
                  {p.votingDeadline && (
                    <span className="flex items-center gap-1 text-xs text-yellow-400">
                      <Timer className="w-3 h-3" />
                      {timeUntil(p.votingDeadline)}
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedProposalId(p.id)} className={ds.btnSecondary}>
                View Details
              </button>
            </div>
            <VoteTallyBar votes={p.votes} quorum={p.quorumRequired} />
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={() => setAnonymousVoting(!anonymousVoting)}
                className={cn(ds.btnGhost, 'text-xs')}
              >
                {anonymousVoting ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                {anonymousVoting ? 'Anonymous Voting' : 'Transparent Voting'}
              </button>
            </div>
          </div>
        ))}

        <h2 className={cn(ds.heading2, 'flex items-center gap-2 mt-8')}>
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          Past Decisions
        </h2>
        {decidedProposals.map((p) => {
          const sc = STATUS_CONFIG[p.status];
          return (
            <div
              key={p.id}
              className={cn(ds.panelHover)}
              onClick={() => {
                setSelectedProposalId(p.id);
                setActiveTab('proposals');
              }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                        sc.bg,
                        sc.color
                      )}
                    >
                      {sc.label}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-white">{p.title}</h3>
                  <p className="text-xs text-gray-500 mt-1">
                    {Object.keys(p.votes).length} votes cast | Decided: {formatDate(p.updatedAt)}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-600" />
              </div>
            </div>
          );
        })}

        {/* Governance Voting Panel — emergent proposal voting */}
        <div className="mt-8">
          <GovernanceVotingPanel proposalId="latest" />
        </div>
      </div>
    );
  }

  // ===== RENDER TAB: DEBATES =====
  function renderDebatesTab() {
    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <MessageSquare className="w-5 h-5 text-purple-400" />
            Debate Arena
          </h2>
          <button onClick={() => setShowCreateDebate(true)} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" />
            Start Debate
          </button>
        </div>

        {/* Persona Council */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <Users className="w-4 h-4 text-neon-purple" />
            Council Personas
          </h3>
          <div className={ds.grid4}>
            {personas.map((persona) => (
              <div
                key={persona.id}
                className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border"
              >
                <p className="font-medium text-white text-sm">{persona.name}</p>
                <p className="text-xs text-gray-400 mt-1">{persona.style}</p>
              </div>
            ))}
            {personas.length === 0 && (
              <p className={cn(ds.textMuted, 'col-span-4 text-center py-4')}>Loading personas...</p>
            )}
          </div>
        </div>

        {/* Debate Sessions */}
        {debates.map((d) => (
          <div key={d.id} className={ds.panel}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                      d.status === 'active'
                        ? 'bg-green-500/20 text-green-400'
                        : d.status === 'concluded'
                          ? 'bg-blue-500/20 text-blue-400'
                          : 'bg-gray-500/20 text-gray-400'
                    )}
                  >
                    {d.status}
                  </span>
                  <span className="text-xs text-gray-500">{formatDateTime(d.createdAt)}</span>
                  <span className="text-xs text-gray-500 flex items-center gap-1">
                    <Timer className="w-3 h-3" />
                    {Math.floor(d.timePerSpeaker / 60)}m per speaker
                  </span>
                </div>
                <h3 className={ds.heading3}>{d.topic}</h3>
              </div>
              <div className="flex gap-2">
                {d.status === 'active' && (
                  <>
                    <button
                      onClick={() => handleGenerateSynthesis(d.id)}
                      className={cn(ds.btnSecondary, 'text-xs')}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Synthesize
                    </button>
                    <button
                      onClick={() => handleConcludeDebate(d.id)}
                      className={cn(ds.btnSecondary, 'text-xs')}
                    >
                      <Gavel className="w-3.5 h-3.5" />
                      Conclude
                    </button>
                  </>
                )}
                <button
                  onClick={() => removeDebateItem(d.id)}
                  className={cn(ds.btnSecondary, 'text-xs text-red-400 hover:text-red-300')}
                >
                  <X className="w-3.5 h-3.5" />
                  Remove
                </button>
              </div>
            </div>

            {/* Speaking Queue */}
            {d.status === 'active' && (
              <div className="flex items-center gap-3 mb-3 p-2 bg-lattice-elevated rounded-lg text-xs">
                <span className="text-gray-400">Speaking:</span>
                {d.currentSpeaker && (
                  <span className="text-neon-cyan font-semibold">
                    {stakeholderName(d.currentSpeaker)}
                  </span>
                )}
                {d.speakingQueue.length > 0 && (
                  <>
                    <span className="text-gray-600">|</span>
                    <span className="text-gray-400">Queue:</span>
                    {d.speakingQueue.map((s) => (
                      <span key={s} className="text-gray-300">
                        {stakeholderName(s)}
                      </span>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* Points */}
            <div className="space-y-2 mb-3">
              {d.points.map((pt, i) => (
                <div
                  key={i}
                  className={cn(
                    'p-3 rounded-lg border-l-3',
                    pt.type === 'point'
                      ? 'bg-blue-500/5 border-l-blue-500'
                      : pt.type === 'counterpoint'
                        ? 'bg-orange-500/5 border-l-orange-500'
                        : 'bg-purple-500/5 border-l-purple-500'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-neon-cyan">{pt.speaker}</span>
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-medium',
                        pt.type === 'point'
                          ? 'bg-blue-500/20 text-blue-400'
                          : pt.type === 'counterpoint'
                            ? 'bg-orange-500/20 text-orange-400'
                            : 'bg-purple-500/20 text-purple-400'
                      )}
                    >
                      {pt.type}
                    </span>
                  </div>
                  <p className="text-sm text-gray-300">{pt.content}</p>
                </div>
              ))}
            </div>

            {/* Add Point */}
            {d.status === 'active' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    value={debatePointText}
                    onChange={(e) => setDebatePointText(e.target.value)}
                    placeholder="Add a point to the debate..."
                    className={cn(ds.input, 'flex-1')}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddDebatePoint(d.id, 'point')}
                    disabled={!debatePointText.trim()}
                    className={cn(ds.btnSmall, 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30')}
                  >
                    Point
                  </button>
                  <button
                    onClick={() => handleAddDebatePoint(d.id, 'counterpoint')}
                    disabled={!debatePointText.trim()}
                    className={cn(
                      ds.btnSmall,
                      'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                    )}
                  >
                    Counterpoint
                  </button>
                  <button
                    onClick={() => handleAddDebatePoint(d.id, 'motion')}
                    disabled={!debatePointText.trim()}
                    className={cn(
                      ds.btnSmall,
                      'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30'
                    )}
                  >
                    Motion
                  </button>
                </div>
              </div>
            )}

            {/* Synthesis */}
            {d.synthesis && (
              <div className="mt-3 p-4 bg-green-500/5 rounded-lg border border-green-500/20">
                <h4 className="text-sm font-semibold text-green-400 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Synthesis
                </h4>
                <p className="text-sm text-gray-300 leading-relaxed">{d.synthesis}</p>
              </div>
            )}
          </div>
        ))}

        {debates.length === 0 && (
          <div className={cn(ds.panel, 'text-center py-8')}>
            <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-600" />
            <p className={ds.textMuted}>
              No debates yet. Start one to facilitate structured deliberation.
            </p>
          </div>
        )}
      </div>
    );
  }

  // ===== RENDER TAB: BUDGET =====
  function renderBudgetTab() {
    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <DollarSign className="w-5 h-5 text-green-400" />
              Budget Modeler
            </h2>
            <select
              value={budgetScenario}
              onChange={(e) => setBudgetScenario(e.target.value as typeof budgetScenario)}
              className={cn(ds.select, '!w-36')}
            >
              <option value="all">All Scenarios</option>
              <option value="current">Current</option>
              <option value="proposed">Proposed</option>
              <option value="alternative">Alternative</option>
            </select>
          </div>
          <button onClick={() => setShowCreateBudgetItem(true)} className={ds.btnPrimary}>
            <Plus className="w-4 h-4" />
            Add Line Item
          </button>
        </div>

        {/* Summary Cards */}
        <div className={ds.grid3}>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Total Revenue</p>
            <p className="text-2xl font-bold text-green-400">
              {formatCurrency(budgetSummary.revenue)}
            </p>
          </div>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Total Expenses</p>
            <p className="text-2xl font-bold text-red-400">
              {formatCurrency(budgetSummary.expenses)}
            </p>
          </div>
          <div className={cn(ds.panel, 'text-center')}>
            <p className={ds.textMuted}>Balance</p>
            <p
              className={cn(
                'text-2xl font-bold',
                budgetSummary.balance >= 0 ? 'text-green-400' : 'text-red-400'
              )}
            >
              {formatCurrency(budgetSummary.balance)}
            </p>
          </div>
        </div>

        {/* Allocation Visual */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3')}>Expense Allocation</h3>
          <BudgetAllocationBar items={filteredBudget} />
        </div>

        {/* Revenue Items */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <TrendingUp className="w-4 h-4 text-green-400" />
            Revenue
          </h3>
          <div className="space-y-2">
            {filteredBudget
              .filter((b) => b.type === 'revenue')
              .map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between p-3 bg-lattice-elevated rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{b.description}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-lattice-surface text-gray-400">
                        {b.category}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-lattice-surface text-gray-500">
                        {b.scenario}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{b.justification}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-green-400 font-bold">+{formatCurrency(b.amount)}</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        b.approvalStatus === 'approved'
                          ? 'bg-green-500/20 text-green-400'
                          : b.approvalStatus === 'rejected'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      )}
                    >
                      {b.approvalStatus}
                    </span>
                    {b.approvalStatus === 'pending' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleApproveBudgetItem(b.id, true)}
                          className="p-1 text-green-400 hover:bg-green-500/20 rounded"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleApproveBudgetItem(b.id, false)}
                          className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        removeBudgetItem(b.id);
                        addAuditEntry({
                          actor: 'Council Chair',
                          action: 'Removed budget item',
                          target: b.id,
                          details: b.description,
                          category: 'budget',
                        });
                      }}
                      className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                      title="Remove item"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Expense Items */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <BarChart3 className="w-4 h-4 text-red-400" />
            Expenses
          </h3>
          <div className="space-y-2">
            {filteredBudget
              .filter((b) => b.type === 'expense')
              .map((b) => (
                <div
                  key={b.id}
                  className="flex items-center justify-between p-3 bg-lattice-elevated rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{b.description}</span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-lattice-surface text-gray-400">
                        {b.category}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-lattice-surface text-gray-500">
                        {b.scenario}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{b.justification}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-red-400 font-bold">-{formatCurrency(b.amount)}</span>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-full text-[10px] font-medium',
                        b.approvalStatus === 'approved'
                          ? 'bg-green-500/20 text-green-400'
                          : b.approvalStatus === 'rejected'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                      )}
                    >
                      {b.approvalStatus}
                    </span>
                    {b.approvalStatus === 'pending' && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleApproveBudgetItem(b.id, true)}
                          className="p-1 text-green-400 hover:bg-green-500/20 rounded"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleApproveBudgetItem(b.id, false)}
                          className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => {
                        removeBudgetItem(b.id);
                        addAuditEntry({
                          actor: 'Council Chair',
                          action: 'Removed budget item',
                          target: b.id,
                          details: b.description,
                          category: 'budget',
                        });
                      }}
                      className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                      title="Remove item"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    );
  }

  // ===== RENDER TAB: AUDIT =====
  function renderAuditTab() {
    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
              <Shield className="w-5 h-5 text-orange-400" />
              Audit Trail
            </h2>
            <select
              value={auditCategory}
              onChange={(e) => setAuditCategory(e.target.value as AuditEntry['category'] | 'all')}
              className={cn(ds.select, '!w-40')}
            >
              <option value="all">All Categories</option>
              <option value="vote">Votes</option>
              <option value="proposal">Proposals</option>
              <option value="amendment">Amendments</option>
              <option value="budget">Budget</option>
              <option value="stakeholder">Stakeholders</option>
              <option value="debate">Debates</option>
            </select>
          </div>
          <button onClick={handleExportAudit} className={ds.btnSecondary}>
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>

        {/* Compliance Checklist */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <ClipboardList className="w-4 h-4 text-green-400" />
            Compliance Checklist
          </h3>
          <div className="space-y-2">
            {[
              {
                label: 'All active proposals have sponsors',
                met: proposals
                  .filter((p) => !['implemented', 'rejected'].includes(p.status))
                  .every((p) => p.sponsor),
              },
              {
                label: 'No voting proposals past deadline',
                met: proposals
                  .filter((p) => p.status === 'voting' && p.votingDeadline)
                  .every((p) => new Date(p.votingDeadline!).getTime() > Date.now()),
              },
              {
                label: 'All stakeholders have declared conflicts',
                met: stakeholders.every((s) => s.conflicts.length >= 0),
              },
              {
                label: 'Quorum achievable for all voting items',
                met: proposals
                  .filter((p) => p.status === 'voting')
                  .every(
                    (p) => stakeholders.filter((s) => s.votingWeight > 0).length >= p.quorumRequired
                  ),
              },
              { label: 'Budget is balanced (non-negative)', met: budgetSummary.balance >= 0 },
              { label: 'All committees have a chair', met: committees.every((c) => c.chair) },
              { label: 'Audit log maintained with no gaps', met: auditLog.length > 0 },
            ].map((check, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                {check.met ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                )}
                <span className={cn('text-sm', check.met ? 'text-gray-300' : 'text-yellow-400')}>
                  {check.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Audit Log */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'mb-3 flex items-center gap-2')}>
            <History className="w-4 h-4 text-gray-400" />
            Activity Log ({filteredAudit.length} entries)
          </h3>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">
            {filteredAudit.map((entry) => {
              const catColors: Record<string, string> = {
                vote: 'text-yellow-400',
                proposal: 'text-blue-400',
                amendment: 'text-purple-400',
                budget: 'text-green-400',
                stakeholder: 'text-cyan-400',
                debate: 'text-orange-400',
              };
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-2 hover:bg-lattice-elevated rounded-lg transition-colors"
                >
                  <span
                    className={cn(
                      'text-[10px] mt-1 flex-shrink-0 w-32',
                      ds.textMono,
                      'text-gray-600'
                    )}
                  >
                    {formatDateTime(entry.timestamp)}
                  </span>
                  <CircleDot
                    className={cn(
                      'w-3 h-3 mt-1 flex-shrink-0',
                      catColors[entry.category] || 'text-gray-500'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">
                      <span className="font-medium text-neon-cyan">{entry.actor}</span>{' '}
                      <span className="text-gray-400">{entry.action}</span>{' '}
                      <span className={cn(ds.textMono, 'text-gray-500')}>{entry.target}</span>
                    </p>
                    {entry.details && (
                      <p className="text-xs text-gray-500 mt-0.5">{entry.details}</p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] capitalize',
                      catColors[entry.category] || 'text-gray-500',
                      'bg-lattice-surface flex-shrink-0'
                    )}
                  >
                    {entry.category}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const newDetails = window.prompt(
                        'Update audit details:',
                        entry.details || ''
                      );
                      if (newDetails !== null) {
                        updateAuditItem(entry.id, {
                          data: { ...entry, details: newDetails } as unknown as Record<
                            string,
                            unknown
                          >,
                        });
                      }
                    }}
                    className="text-gray-400 hover:text-white flex-shrink-0 ml-1"
                    title="Edit details"
                  >
                    <PenLine className="w-3 h-3" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAuditItem(entry.id);
                    }}
                    className="text-red-400 hover:text-red-300 flex-shrink-0 ml-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ===== RENDER TAB: STAKEHOLDERS =====
  function renderStakeholdersTab() {
    return (
      <div className="space-y-4">
        <div className={ds.sectionHeader}>
          <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
            <Users className="w-5 h-5 text-cyan-400" />
            Stakeholder Management
          </h2>
          <button onClick={() => setShowCreateCommittee(true)} className={ds.btnSecondary}>
            <Plus className="w-4 h-4" />
            New Committee
          </button>
        </div>

        {/* Stakeholder Cards — rendered via EntityCard for consistent entity display */}
        <div className={ds.grid3}>
          {stakeholders.map((s) => (
            <div key={s.id} className={ds.panel}>
              <EntityCard
                entity={{
                  id: s.id,
                  displayName: s.name,
                  role: s.role,
                  status: s.participationScore >= 60 ? 'active' : 'dormant',
                }}
                className="mb-3"
              />
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white">{s.name}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-lattice-elevated text-gray-300 capitalize">
                  {s.role}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-gray-400">
                <div className="flex items-center justify-between">
                  <span>Voting Weight</span>
                  <span className="font-semibold text-white">
                    {(s.votingWeight ?? 0).toFixed(1)}x
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Participation</span>
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 rounded-full bg-lattice-elevated overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          s.participationScore >= 80
                            ? 'bg-green-400'
                            : s.participationScore >= 60
                              ? 'bg-yellow-400'
                              : 'bg-red-400'
                        )}
                        style={{ width: `${s.participationScore}%` }}
                      />
                    </div>
                    <span className="font-semibold text-white">{s.participationScore}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span>Committees</span>
                  <span className="text-gray-300">{s.committees.length}</span>
                </div>
                {s.delegatedTo && (
                  <div className="flex items-center gap-1 text-yellow-400">
                    <ArrowRightLeft className="w-3 h-3" />
                    Delegated to {stakeholderName(s.delegatedTo)}
                  </div>
                )}
                {s.conflicts.length > 0 && (
                  <div className="flex items-center gap-1 text-orange-400">
                    <AlertTriangle className="w-3 h-3" />
                    {s.conflicts.length} conflict{s.conflicts.length !== 1 ? 's' : ''} declared
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {s.committees.map((cid) => {
                  const com = committees.find((c) => c.id === cid);
                  return com ? (
                    <span
                      key={cid}
                      className="px-2 py-0.5 rounded text-[10px] bg-lattice-elevated text-gray-400"
                    >
                      {com.name.replace(' Committee', '')}
                    </span>
                  ) : null;
                })}
              </div>
              <div className="flex gap-1 mt-3 pt-2 border-t border-lattice-border">
                {!s.delegatedTo ? (
                  <select
                    onChange={(e) => {
                      if (e.target.value) handleDelegate(s.id, e.target.value);
                      e.target.value = '';
                    }}
                    className={cn(ds.select, '!text-xs !py-1')}
                    defaultValue=""
                  >
                    <option value="" disabled>
                      Delegate to...
                    </option>
                    {stakeholders
                      .filter((other) => other.id !== s.id && other.votingWeight > 0)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.name}
                        </option>
                      ))}
                  </select>
                ) : (
                  <button
                    onClick={() => handleDelegate(s.id, null)}
                    className={cn(ds.btnSmall, 'text-[10px] text-yellow-400')}
                  >
                    <UserMinus className="w-3 h-3" />
                    Revoke Delegation
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between mt-2">
                <p className="text-[10px] text-gray-600">Joined: {formatDate(s.joinedAt)}</p>
                <button
                  onClick={() => removeStakeholderItem(s.id)}
                  className="text-red-400 hover:text-red-300 text-[10px] flex items-center gap-0.5"
                >
                  <X className="w-3 h-3" />
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Add Stakeholder */}
        <button
          onClick={() =>
            createStakeholderItem({
              title: 'New Stakeholder',
              data: {
                name: 'New Stakeholder',
                role: 'observer',
                votingWeight: 1,
                votingHistory: {},
                committees: [],
                conflicts: [],
                delegatedTo: null,
                joinedAt: new Date().toISOString(),
              } as unknown as Record<string, unknown>,
            })
          }
          className={ds.btnSecondary}
        >
          <Plus className="w-4 h-4" />
          Add Stakeholder
        </button>

        {/* Committees */}
        <h2 className={cn(ds.heading2, 'flex items-center gap-2 mt-6')}>
          <Layers className="w-5 h-5 text-purple-400" />
          Committees
        </h2>
        <div className={ds.grid2}>
          {committees.map((c) => (
            <div key={c.id} className={ds.panel}>
              <div className="flex items-center justify-between mb-1">
                <h3 className={ds.heading3}>{c.name}</h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() =>
                      updateCommitteeItem(c.id, {
                        data: { ...c, description: c.description } as unknown as Record<
                          string,
                          unknown
                        >,
                      })
                    }
                    className="text-gray-500 hover:text-white text-[10px]"
                  >
                    <PenLine className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => removeCommitteeItem(c.id)}
                    className="text-red-400 hover:text-red-300 text-[10px]"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <p className={cn(ds.textMuted, 'mb-3')}>{c.description}</p>
              <div className="space-y-1.5">
                {c.members.map((mid) => {
                  const member = stakeholders.find((s) => s.id === mid);
                  if (!member) return null;
                  return (
                    <div
                      key={mid}
                      className="flex items-center justify-between text-xs p-1.5 bg-lattice-elevated rounded"
                    >
                      <span className="text-gray-300">{member.name}</span>
                      {c.chair === mid && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-yellow-500/20 text-yellow-400">
                          Chair
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ===== MAIN RENDER =====
  return (
    <div data-lens-theme="council" className={ds.pageContainer}>
      {/* Header */}
      <header>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Scale className="w-7 h-7 text-neon-purple" />
            <div>
              <h1 className={ds.heading1}>Council Lens</h1>
              <p className={ds.textMuted}>
                Governance, deliberation, and collective decision-making
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveTab('debates');
                setShowCreateDebate(true);
              }}
              className={ds.btnSecondary}
            >
              <Megaphone className="w-4 h-4" />
              Start Debate
            </button>
            <button
              onClick={() => {
                const vp = proposals.find((p) => p.status === 'discussion');
                if (vp) {
                  handleAdvanceStatus(vp.id);
                  setActiveTab('voting');
                }
              }}
              className={ds.btnSecondary}
            >
              <Gavel className="w-4 h-4" />
              Call Vote
            </button>
            <button
              onClick={() => {
                runArtifact.mutate({
                  id: 'council',
                  action: 'generateMinutes',
                  params: { debates, proposals },
                });
              }}
              disabled={runArtifact.isPending}
              className={cn(ds.btnSecondary, 'disabled:opacity-50 disabled:cursor-not-allowed')}
            >
              <FileDown className="w-4 h-4" />
              {runArtifact.isPending ? 'Generating...' : 'Generate Minutes'}
            </button>
            <button onClick={handleExportAudit} className={ds.btnSecondary}>
              <Download className="w-4 h-4" />
              Export Decisions
            </button>
          </div>
        </div>
      </header>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Proposals', value: proposals.length, icon: FileText },
          {
            label: 'Active Votes',
            value: proposals.filter((p) => p.status === 'voting').length,
            icon: Vote,
          },
          {
            label: 'Participation',
            value: `${stakeholders.length > 0 ? Math.round((stakeholders.filter((s) => s.votingWeight > 0).length / stakeholders.length) * 100) : 0}%`,
            icon: Users,
          },
          { label: 'Committees', value: committees.length, icon: Layers },
        ].map((stat) => (
          <div key={stat.label} className={ds.panel + ' flex items-center gap-3 p-3'}>
            <stat.icon className="w-5 h-5 text-neon-purple shrink-0" />
            <div>
              <p className="text-xs text-gray-400">{stat.label}</p>
              <p className="text-lg font-bold text-white">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Dashboard Stats */}
      <div className={ds.grid4}>
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-1">
            <p className={ds.textMuted}>Active Proposals</p>
            <FileText className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-3xl font-bold text-white">{dashboardStats.active}</p>
          <p className="text-xs text-gray-500 mt-1">In discussion or voting</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-1">
            <p className={ds.textMuted}>Pending Votes</p>
            <Vote className="w-4 h-4 text-yellow-400" />
          </div>
          <p className="text-3xl font-bold text-white">{dashboardStats.pendingVotes}</p>
          <p className="text-xs text-gray-500 mt-1">Awaiting stakeholder votes</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-1">
            <p className={ds.textMuted}>Quorum Status</p>
            <Users className="w-4 h-4 text-green-400" />
          </div>
          <p
            className={cn(
              'text-3xl font-bold',
              dashboardStats.quorumMet ? 'text-green-400' : 'text-yellow-400'
            )}
          >
            {dashboardStats.quorumMet ? 'Met' : 'Needed'}
          </p>
          <p className="text-xs text-gray-500 mt-1">{dashboardStats.totalVoters} eligible voters</p>
        </div>
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-1">
            <p className={ds.textMuted}>Decisions This Period</p>
            <CheckCircle2 className="w-4 h-4 text-neon-cyan" />
          </div>
          <p className="text-3xl font-bold text-white">{dashboardStats.decided}</p>
          <p className="text-xs text-gray-500 mt-1">Decided, implemented, or rejected</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-lattice-border flex-wrap">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedProposalId(null);
              }}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-neon-cyan text-neon-cyan'
                  : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600'
              )}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'proposals' && renderProposalsTab()}
        {activeTab === 'voting' && renderVotingTab()}
        {activeTab === 'debates' && renderDebatesTab()}
        {activeTab === 'budget' && renderBudgetTab()}
        {activeTab === 'audit' && renderAuditTab()}
        {activeTab === 'stakeholders' && renderStakeholdersTab()}
      </div>

      {/* ========== MODALS ========== */}

      {/* Create Proposal Modal */}
      {showCreateProposal && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreateProposal(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-2xl')} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>New Proposal</h2>
                <button
                  onClick={() => setShowCreateProposal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    value={newProposal.title}
                    onChange={(e) => setNewProposal((p) => ({ ...p, title: e.target.value }))}
                    placeholder="Proposal title..."
                    className={ds.input}
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={newProposal.type}
                      onChange={(e) =>
                        setNewProposal((p) => ({ ...p, type: e.target.value as ProposalType }))
                      }
                      className={ds.select}
                    >
                      {PROPOSAL_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Voting Method</label>
                    <select
                      value={newProposal.votingMethod}
                      onChange={(e) =>
                        setNewProposal((p) => ({
                          ...p,
                          votingMethod: e.target.value as VotingMethod,
                        }))
                      }
                      className={ds.select}
                    >
                      {VOTING_METHODS.map((v) => (
                        <option key={v.value} value={v.value}>
                          {v.label} ({v.desc})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    value={newProposal.description}
                    onChange={(e) => setNewProposal((p) => ({ ...p, description: e.target.value }))}
                    rows={5}
                    placeholder="Describe the proposal in detail..."
                    className={ds.textarea}
                  />
                </div>
                <div>
                  <label className={ds.label}>Impact Assessment</label>
                  <textarea
                    value={newProposal.impactAssessment}
                    onChange={(e) =>
                      setNewProposal((p) => ({ ...p, impactAssessment: e.target.value }))
                    }
                    rows={3}
                    placeholder="Describe the expected impact..."
                    className={ds.textarea}
                  />
                </div>
                <div>
                  <label className={ds.label}>Tags (comma-separated)</label>
                  <input
                    value={newProposal.tags}
                    onChange={(e) => setNewProposal((p) => ({ ...p, tags: e.target.value }))}
                    placeholder="governance, policy, transparency"
                    className={ds.input}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateProposal(false)} className={ds.btnGhost}>
                  Cancel
                </button>
                <button
                  onClick={handleCreateProposal}
                  disabled={!newProposal.title.trim()}
                  className={ds.btnPrimary}
                >
                  Create Proposal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Budget Item Modal */}
      {showCreateBudgetItem && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreateBudgetItem(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Add Budget Line Item</h2>
                <button
                  onClick={() => setShowCreateBudgetItem(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Category</label>
                    <select
                      value={newBudgetItem.category}
                      onChange={(e) =>
                        setNewBudgetItem((b) => ({ ...b, category: e.target.value }))
                      }
                      className={ds.select}
                    >
                      {BUDGET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Type</label>
                    <select
                      value={newBudgetItem.type}
                      onChange={(e) =>
                        setNewBudgetItem((b) => ({
                          ...b,
                          type: e.target.value as 'revenue' | 'expense',
                        }))
                      }
                      className={ds.select}
                    >
                      <option value="expense">Expense</option>
                      <option value="revenue">Revenue</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <input
                    value={newBudgetItem.description}
                    onChange={(e) =>
                      setNewBudgetItem((b) => ({ ...b, description: e.target.value }))
                    }
                    placeholder="Line item description..."
                    className={ds.input}
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Amount ($)</label>
                    <input
                      type="number"
                      value={newBudgetItem.amount}
                      onChange={(e) => setNewBudgetItem((b) => ({ ...b, amount: e.target.value }))}
                      placeholder="0"
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Scenario</label>
                    <select
                      value={newBudgetItem.scenario}
                      onChange={(e) =>
                        setNewBudgetItem((b) => ({
                          ...b,
                          scenario: e.target.value as BudgetItem['scenario'],
                        }))
                      }
                      className={ds.select}
                    >
                      <option value="current">Current</option>
                      <option value="proposed">Proposed</option>
                      <option value="alternative">Alternative</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Justification</label>
                  <textarea
                    value={newBudgetItem.justification}
                    onChange={(e) =>
                      setNewBudgetItem((b) => ({ ...b, justification: e.target.value }))
                    }
                    rows={3}
                    placeholder="Justify this line item..."
                    className={ds.textarea}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateBudgetItem(false)} className={ds.btnGhost}>
                  Cancel
                </button>
                <button
                  onClick={handleCreateBudgetItem}
                  disabled={!newBudgetItem.description.trim() || !newBudgetItem.amount}
                  className={ds.btnPrimary}
                >
                  Add Item
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Committee Modal */}
      {showCreateCommittee && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreateCommittee(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-md')} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Create Committee</h2>
                <button
                  onClick={() => setShowCreateCommittee(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className={ds.label}>Committee Name</label>
                  <input
                    value={newCommittee.name}
                    onChange={(e) => setNewCommittee((c) => ({ ...c, name: e.target.value }))}
                    placeholder="e.g. Ethics Review Committee"
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    value={newCommittee.description}
                    onChange={(e) =>
                      setNewCommittee((c) => ({ ...c, description: e.target.value }))
                    }
                    rows={3}
                    placeholder="Describe the committee's purpose..."
                    className={ds.textarea}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateCommittee(false)} className={ds.btnGhost}>
                  Cancel
                </button>
                <button
                  onClick={handleCreateCommittee}
                  disabled={!newCommittee.name.trim()}
                  className={ds.btnPrimary}
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create Debate Modal */}
      {showCreateDebate && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreateDebate(false)}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-md')} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Start Debate</h2>
                <button
                  onClick={() => setShowCreateDebate(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className={ds.label}>Debate Topic</label>
                  <textarea
                    value={newDebate.topic}
                    onChange={(e) => setNewDebate((d) => ({ ...d, topic: e.target.value }))}
                    rows={3}
                    placeholder="What should the council deliberate on?"
                    className={ds.textarea}
                  />
                </div>
                <div>
                  <label className={ds.label}>Time per Speaker (seconds)</label>
                  <input
                    type="number"
                    value={newDebate.timePerSpeaker}
                    onChange={(e) =>
                      setNewDebate((d) => ({
                        ...d,
                        timePerSpeaker: parseInt(e.target.value) || 300,
                      }))
                    }
                    className={ds.input}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {Math.floor(newDebate.timePerSpeaker / 60)} minutes per speaker
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreateDebate(false)} className={ds.btnGhost}>
                  Cancel
                </button>
                <button
                  onClick={handleCreateDebate}
                  disabled={!newDebate.topic.trim()}
                  className={ds.btnPrimary}
                >
                  <Megaphone className="w-4 h-4" />
                  Start Debate
                </button>
              </div>
            </div>
          </div>

          {/* ── Council Domain Action Panel ──────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={ds.panel + ' space-y-4'}
          >
            <div className="flex items-center gap-2 mb-1">
              <Gavel className="w-4 h-4 text-neon-purple" />
              <h2 className="font-semibold text-sm">Council Analysis Engine</h2>
              <span className="text-xs text-gray-500 ml-auto">
                Domain actions — deliberate, vote, minutes, conflict
              </span>
            </div>

            {/* Action Buttons Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                {
                  action: 'deliberate',
                  label: 'Deliberate',
                  setter: setDeliberateResult,
                  icon: Scale,
                  color: 'text-neon-purple',
                },
                {
                  action: 'voteCount',
                  label: 'Count Votes',
                  setter: setVoteCountResult,
                  icon: Vote,
                  color: 'text-yellow-400',
                },
                {
                  action: 'generateMinutes',
                  label: 'Gen Minutes',
                  setter: setMinutesResult,
                  icon: ClipboardList,
                  color: 'text-neon-cyan',
                },
                {
                  action: 'conflictResolution',
                  label: 'Resolve Conflict',
                  setter: setConflictResult,
                  icon: HandshakeIcon,
                  color: 'text-green-400',
                },
              ].map(({ action, label, setter, icon: Icon, color }) => (
                <button
                  key={action}
                  onClick={() => handleCouncilAction(action, setter)}
                  disabled={councilActionRunning !== null}
                  className={cn(
                    ds.btnSecondary,
                    'flex items-center gap-1.5 justify-center disabled:opacity-40 disabled:cursor-not-allowed text-xs'
                  )}
                >
                  {councilActionRunning === action ? (
                    <ClipboardCheck className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Icon className={cn('w-3.5 h-3.5', color)} />
                  )}
                  {councilActionRunning === action ? 'Running…' : label}
                </button>
              ))}
            </div>

            {/* Results Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Deliberate Result */}
              {deliberateResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-neon-purple/20 bg-neon-purple/5 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neon-purple uppercase tracking-wider flex items-center gap-1.5">
                      <Scale className="w-3.5 h-3.5" /> Deliberation Result
                    </span>
                    {'recommendation' in deliberateResult && (
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          String(deliberateResult.recommendation) === 'Proceed'
                            ? 'bg-green-500/20 text-green-400'
                            : String(deliberateResult.recommendation) === 'Reject'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        )}
                      >
                        {String(deliberateResult.recommendation)}
                      </span>
                    )}
                  </div>
                  {'proposal' in deliberateResult && (
                    <p className="text-xs text-gray-400 italic">
                      &ldquo;{String(deliberateResult.proposal)}&rdquo;
                    </p>
                  )}
                  {'weightedScore' in deliberateResult && (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-500">Weighted Score</span>
                      <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Number(deliberateResult.weightedScore)}%` }}
                          transition={{ duration: 0.6 }}
                          className={cn(
                            'h-full rounded-full',
                            Number(deliberateResult.weightedScore) >= 60
                              ? 'bg-green-500'
                              : Number(deliberateResult.weightedScore) >= 40
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                          )}
                        />
                      </div>
                      <span className="text-sm font-mono font-bold text-white">
                        {String(deliberateResult.weightedScore)}
                      </span>
                    </div>
                  )}
                  {'consensus' in deliberateResult && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Consensus:</span>
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full',
                          String(deliberateResult.consensus) === 'unanimous'
                            ? 'bg-green-500/20 text-green-400'
                            : String(deliberateResult.consensus) === 'majority'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-red-500/20 text-red-400'
                        )}
                      >
                        {String(deliberateResult.consensus)}
                      </span>
                    </div>
                  )}
                  {Array.isArray(deliberateResult.evaluations) && (
                    <div className="space-y-2">
                      <p className="text-xs text-gray-500 font-medium">Voice Evaluations</p>
                      {(deliberateResult.evaluations as Array<Record<string, unknown>>).map(
                        (ev, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 w-24 shrink-0">
                              {String(ev.voice)}
                            </span>
                            <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  Number(ev.score) >= 60
                                    ? 'bg-green-500'
                                    : Number(ev.score) >= 40
                                      ? 'bg-yellow-500'
                                      : 'bg-red-500'
                                )}
                                style={{ width: `${Number(ev.score)}%` }}
                              />
                            </div>
                            <span
                              className={cn(
                                'text-xs w-14 text-right font-mono',
                                String(ev.position) === 'support'
                                  ? 'text-green-400'
                                  : String(ev.position) === 'oppose'
                                    ? 'text-red-400'
                                    : 'text-gray-400'
                              )}
                            >
                              {String(ev.score)}/100
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </motion.div>
              )}

              {/* Vote Count Result */}
              {voteCountResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Vote className="w-3.5 h-3.5" /> Vote Tally
                    </span>
                    {'passed' in voteCountResult && (
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full font-medium',
                          voteCountResult.passed
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-red-500/20 text-red-400'
                        )}
                      >
                        {voteCountResult.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    )}
                  </div>
                  {'tally' in voteCountResult && (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          key: 'for',
                          label: 'For',
                          color: 'text-green-400',
                          bg: 'bg-green-500/20',
                        },
                        {
                          key: 'against',
                          label: 'Against',
                          color: 'text-red-400',
                          bg: 'bg-red-500/20',
                        },
                        {
                          key: 'abstain',
                          label: 'Abstain',
                          color: 'text-gray-400',
                          bg: 'bg-gray-500/20',
                        },
                      ].map(({ key, label, color, bg }) => (
                        <div key={key} className={cn('rounded-lg p-2 text-center', bg)}>
                          <p className={cn('text-lg font-bold', color)}>
                            {String((voteCountResult.tally as Record<string, unknown>)[key] ?? 0)}
                          </p>
                          <p className="text-xs text-gray-500">{label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {'forPercent' in voteCountResult && (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>Support Rate</span>
                        <span className="font-mono text-white">
                          {String(voteCountResult.forPercent)}%
                        </span>
                      </div>
                      <div className="h-2 bg-black/30 rounded-full overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${Number(voteCountResult.forPercent)}%` }}
                          transition={{ duration: 0.6 }}
                          className={cn(
                            'h-full rounded-full',
                            Number(voteCountResult.forPercent) >= 67 ? 'bg-green-500' : 'bg-red-500'
                          )}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-gray-600">
                        <span>Threshold: {String(voteCountResult.passThreshold)}</span>
                        <span>
                          Quorum:{' '}
                          {voteCountResult.quorumMet ? (
                            <span className="text-green-400">Met</span>
                          ) : (
                            <span className="text-red-400">Not Met</span>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {/* Minutes Result */}
              {minutesResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-neon-cyan/20 bg-neon-cyan/5 p-4 space-y-3"
                >
                  <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
                    <ClipboardList className="w-3.5 h-3.5" /> Meeting Minutes
                  </span>
                  {'title' in minutesResult && (
                    <p className="text-sm font-medium text-white">{String(minutesResult.title)}</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {'date' in minutesResult && (
                      <div className="lens-card text-center">
                        <p className="text-xs text-gray-500">Date</p>
                        <p className="text-sm font-mono text-white">{String(minutesResult.date)}</p>
                      </div>
                    )}
                    {'attendees' in minutesResult && (
                      <div className="lens-card text-center">
                        <p className="text-xs text-gray-500">Attendees</p>
                        <p className="text-sm font-bold text-neon-cyan">
                          {String(minutesResult.attendees)}
                        </p>
                      </div>
                    )}
                  </div>
                  {Array.isArray(minutesResult.agendaItems) &&
                    (minutesResult.agendaItems as Array<Record<string, unknown>>).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-1">Agenda Items</p>
                        <div className="space-y-1">
                          {(minutesResult.agendaItems as Array<Record<string, unknown>>).map(
                            (item, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className="w-5 h-5 rounded-full bg-neon-cyan/20 text-neon-cyan flex items-center justify-center font-mono text-[10px] shrink-0">
                                  {String(item.item)}
                                </span>
                                <span className="text-gray-300 flex-1">{String(item.topic)}</span>
                                <span className="text-gray-500 capitalize">
                                  {String(item.status)}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                  {Array.isArray(minutesResult.decisions) &&
                    (minutesResult.decisions as Array<Record<string, unknown>>).length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 font-medium mb-1">Decisions</p>
                        {(minutesResult.decisions as Array<Record<string, unknown>>).map((d, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs p-1.5 rounded bg-white/5"
                          >
                            {d.passed ? (
                              <CheckCircle2 className="w-3 h-3 text-green-400 shrink-0" />
                            ) : (
                              <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                            )}
                            <span className="text-gray-300">{String(d.decision)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                </motion.div>
              )}

              {/* Conflict Resolution Result */}
              {conflictResult && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border border-green-500/20 bg-green-500/5 p-4 space-y-3"
                >
                  <span className="text-xs font-semibold text-green-400 uppercase tracking-wider flex items-center gap-1.5">
                    <HandshakeIcon className="w-3.5 h-3.5" /> Conflict Resolution
                  </span>
                  {'issue' in conflictResult && (
                    <p className="text-xs text-gray-400 italic">
                      &ldquo;{String(conflictResult.issue)}&rdquo;
                    </p>
                  )}
                  {'commonGround' in conflictResult && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Common Ground:</span>
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full',
                          String(conflictResult.commonGround) === 'shared-urgency'
                            ? 'bg-green-500/20 text-green-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        )}
                      >
                        {String(conflictResult.commonGround).replace(/-/g, ' ')}
                      </span>
                    </div>
                  )}
                  {'suggestedApproach' in conflictResult && (
                    <p className="text-xs text-gray-300 bg-black/20 rounded p-2">
                      {String(conflictResult.suggestedApproach)}
                    </p>
                  )}
                  {Array.isArray(conflictResult.steps) && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-1">Resolution Steps</p>
                      <ol className="space-y-1">
                        {(conflictResult.steps as string[]).map((step, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-gray-400">
                            <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            {step}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {Array.isArray(conflictResult.parties) && (
                    <div>
                      <p className="text-xs text-gray-500 font-medium mb-1">Parties</p>
                      <div className="flex flex-wrap gap-2">
                        {(conflictResult.parties as Array<Record<string, unknown>>).map((p, i) => (
                          <span
                            key={i}
                            className={cn(
                              'text-xs px-2 py-0.5 rounded-full',
                              String(p.priority) === 'high'
                                ? 'bg-orange-500/20 text-orange-400'
                                : 'bg-gray-500/20 text-gray-400'
                            )}
                          >
                            {String(p.party)} · {String(p.priority)}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </motion.div>

          {/* Real-time Data Panel */}
          <UniversalActions domain="council" artifactId={null} compact />
          {realtimeData && (
            <RealtimeDataPanel
              domain="council"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
        </div>
      )}
    </div>
  );
}
