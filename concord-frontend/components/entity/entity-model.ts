'use client';

import { lensRun } from '@/lib/api/client';

/** The eight entity types the world-model backend accepts (server ENTITY_TYPES). */
export const ENTITY_TYPES = [
  'concept', 'person', 'organization', 'location', 'event', 'process', 'artifact', 'claim',
] as const;
export type WorldEntityType = (typeof ENTITY_TYPES)[number];

export const TYPE_BLURB: Record<WorldEntityType, string> = {
  concept: 'An idea, term or category',
  person: 'A real or modelled individual',
  organization: 'A group, company or institution',
  location: 'A place or region',
  event: 'Something that happened or will',
  process: 'A repeatable sequence of steps',
  artifact: 'A made thing: document, tool, work',
  claim: 'A statement that can be supported or contradicted',
};

/** The twelve relation types the backend accepts (server RELATION_TYPES). */
export const RELATION_TYPES = [
  'causes', 'correlates', 'enables', 'inhibits', 'contains', 'part_of',
  'precedes', 'contradicts', 'supports', 'derives_from', 'similar_to', 'instance_of',
] as const;
export type WorldRelationType = (typeof RELATION_TYPES)[number];

export const TYPE_DOT: Record<string, string> = {
  concept: 'bg-teal-400',
  person: 'bg-sky-400',
  organization: 'bg-violet-400',
  location: 'bg-emerald-400',
  event: 'bg-amber-400',
  process: 'bg-orange-400',
  artifact: 'bg-pink-400',
  claim: 'bg-rose-400',
};

export interface WorldEntitySummary {
  id: string;
  name: string;
  type: WorldEntityType | string;
  salience: number;
  confidence: number;
  relationCount: number;
  createdAt: string;
}

export interface WorldEntity {
  id: string;
  name: string;
  displayName?: string;
  fullTitle?: string | null;
  type: string;
  description: string;
  state: {
    confidence: number;
    salience: number;
    volatility: number;
    properties: Record<string, unknown>;
  };
  source?: { dtuIds?: string[]; extractedFrom?: string | null; createdBy?: string };
  relationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorldRelation {
  id: string;
  from: string;
  to: string;
  type: string;
  strength: number;
  confidence: number;
  direction?: 'incoming' | 'outgoing';
  otherEntity?: WorldEntity | null;
}

export interface SimInsight {
  entityId: string;
  entityName: string;
  type: string;
  delta?: number;
  property?: string;
  startValue?: number;
  endValue?: number;
  description: string;
}

export interface WorldSimulation {
  id: string;
  type: string;
  status: string;
  config?: { hypothesis?: string; maxSteps?: number };
  insights: SimInsight[];
  causalSummary?: { totalEvents: number; causalPathCount: number; longestPath: string[] };
  createdAt: string;
  completedAt: string | null;
}

export interface SimulationSummary {
  id: string;
  type: string;
  status: string;
  hypothesis?: string;
  insightCount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface SnapshotSummary {
  id: string;
  label: string;
  entityCount: number;
  relationCount: number;
  takenAt: string;
}

/**
 * Run a world-model macro. The macro layer reports failure in-band
 * (`{ ok:false, error }`) even on HTTP 200, so this throws on either form —
 * callers never mistake a rejected write for a success.
 */
export async function wm<T = Record<string, unknown>>(action: string, input: Record<string, unknown> = {}): Promise<T> {
  const r = await lensRun('worldmodel', action, input);
  const res = r.data?.result as (Record<string, unknown> & { ok?: boolean; error?: string }) | null;
  if (!r.data?.ok || !res || res.ok === false) {
    throw new Error(res?.error || r.data?.error || `${action} failed`);
  }
  return res as unknown as T;
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
  low: 'border-teal-400/30 bg-teal-400/5',
  medium: 'border-amber-400/30 bg-amber-400/5',
  high: 'border-rose-400/30 bg-rose-400/5',
};

export type EntityView = 'registry' | 'minds' | 'graph' | 'wikidata' | 'agents';

export function pct(n: number | undefined): number {
  return Math.round(Math.max(0, Math.min(1, Number(n) || 0)) * 100);
}
