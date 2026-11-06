'use client';

/**
 * Shared types + lensRun helper for understanding panels.
 * Extracted from app/lenses/understanding/page.tsx — do not invent macros.
 */

import { api } from '@/lib/api/client';
import type { ReactNode } from 'react';

export type SubjectKind = 'dtu' | 'claims' | 'raw' | 'entity' | 'world' | 'faction';

export interface Understanding {
  id: string;
  subjectId?: string;
  subjectKind?: SubjectKind;
  composer?: 'rules' | 'llm';
  consistency?: number;
  confidence?: number;
  composedAt?: string | number;
  expiresAt?: string | number;
  evidence?: unknown[];
  text?: string;
  claims?: unknown[];
  meta?: Record<string, unknown>;
}

export interface EvolutionStats {
  totalUnderstandings?: number;
  promotedCount?: number;
  consolidatedCount?: number;
  expiredCount?: number;
  pendingPromotion?: number;
  averageConfidence?: number;
}

export interface NotesOverview {
  noteCount?: number;
  manualLinkCount?: number;
  wikiLinkCount?: number;
  tagCount?: number;
  reviewEnabledCount?: number;
  dueForReviewCount?: number;
}

export interface PromotionEval {
  ok: boolean;
  decision?: 'promote' | 'reject' | 'pending';
  reason?: string;
  evidenceCount?: number;
  thresholds?: Record<string, number>;
}

export interface ConsolidationCandidate {
  parentId?: string;
  childIds: string[];
  similarity?: number;
  rationale?: string;
}

export interface LineageNode {
  id: string;
  depth?: number;
  parentId?: string | null;
  composer?: string;
  composedAt?: string | number;
}

export async function understandingMacro<T = unknown>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const r = await api.post('/api/lens/run', { domain: 'understanding', name, input });
  const data = r.data as { ok?: boolean; result?: unknown } | unknown;
  // The route shapes every success as { ok:true, result:<payload> }.
  // The panels read the payload's fields (understanding / rows / stats)
  // at top level beside ok — before this unwrap they read undefined
  // and reported 'parse failed' / 'compose failed' against a pipeline
  // that had in fact answered. Failures arrive unpeeled ({ ok:false,
  // error }) and pass through untouched.
  if (
    data && typeof data === 'object' && 'result' in data &&
    (data as { ok?: boolean }).ok !== false &&
    (data as { result?: unknown }).result && typeof (data as { result?: unknown }).result === 'object'
  ) {
    return { ...(data as { result: object }).result, ok: true } as T;
  }
  return data as T;
}

export function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <div className="text-[10px] text-white/40 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}
