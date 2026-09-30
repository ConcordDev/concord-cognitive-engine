'use client';

export interface Entity {
  id: string;
  name: string;
  displayName?: string;
  fullTitle?: string;
  domain?: string;
  role?: string;
  type: 'worker' | 'researcher' | 'guardian' | 'architect';
  status: 'active' | 'idle' | 'suspended';
  workspace: string;
  forks: number;
  createdAt: string;
  lastActive: string;
}

/** Council-gated terminal macros ACL (UX honesty gate only). */
export const COUNCIL_ROLES = new Set(['owner', 'admin', 'council']);

export interface TerminalProposalSummary {
  id: string;
  entityId: string;
  command: string;
  riskLevel: 'low' | 'medium' | 'high' | string;
  status: 'pending' | 'approved' | 'denied' | string;
  createdAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  threshold: number;
  votes: { approve: number; deny: number; abstain: number };
  myVote: 'approve' | 'deny' | 'abstain' | null;
}

export const riskColors: Record<string, string> = {
  low: 'text-neon-green bg-neon-green/10 border-neon-green/30',
  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  high: 'text-neon-pink bg-neon-pink/10 border-neon-pink/30',
};

export const typeColors = {
  worker: 'text-neon-blue bg-neon-blue/20',
  researcher: 'text-neon-purple bg-neon-purple/20',
  guardian: 'text-neon-green bg-neon-green/20',
  architect: 'text-neon-cyan bg-neon-cyan/20',
};

export const statusColors = {
  active: 'bg-neon-green',
  idle: 'bg-yellow-500',
  suspended: 'bg-neon-pink',
};

export type EntityView = 'registry' | 'graph' | 'wikidata' | 'agents';
