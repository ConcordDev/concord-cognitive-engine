// Shared types for the bounties lens (Gitcoin / HackerOne parity surface).

export interface Milestone {
  id: string;
  index: number;
  title: string;
  rewardCc: number;
  status: 'open' | 'submitted' | 'paid';
  paidTo?: string;
  paidAt?: string;
}

export interface Submission {
  id: string;
  bountyId: string;
  claimantId: string;
  summary: string;
  link: string;
  notes: string;
  milestoneId: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  reviewNote: string | null;
  createdAt: string;
  bountyTitle?: string;
  bountyStatus?: string;
}

export interface Dispute {
  id: string;
  openedBy: string;
  reason: string;
  status: 'open' | 'resolved';
  ruling: 'uphold' | 'overturn' | 'split' | null;
  rulingNote: string | null;
  arbiterId?: string;
  resolvedAt: string | null;
  openedAt: string;
}

export interface PlatformBounty {
  id: string;
  title: string;
  description: string;
  ownerId: string;
  category: string;
  tags: string[];
  difficulty: string;
  rewardCc: number;
  poolCc: number;
  paidCc: number;
  status: 'open' | 'claimed' | 'in_review' | 'paid' | 'disputed';
  createdAt: string;
  updatedAt: string;
  deadline: string | null;
  milestones: Milestone[];
  submissions: Submission[];
  submissionCount: number;
  acceptedSubmissionId: string | null;
  dispute: Dispute | null;
}

export interface LeaderRow {
  rank: number;
  userId: string;
  earnedCc: number;
  resolved: number;
}

export const STATUS_STYLE: Record<string, string> = {
  open: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/40',
  claimed: 'bg-cyan-500/15 text-cyan-300 ring-cyan-500/40',
  in_review: 'bg-amber-500/15 text-amber-300 ring-amber-500/40',
  paid: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/40',
  disputed: 'bg-red-500/15 text-red-300 ring-red-500/40',
};

export const DIFFICULTY_STYLE: Record<string, string> = {
  beginner: 'text-emerald-300',
  intermediate: 'text-cyan-300',
  advanced: 'text-amber-300',
  expert: 'text-red-300',
};
