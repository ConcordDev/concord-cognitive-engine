/**
 * Keep a legacy portfolio-assessment summary (technical debt / migration
 * readiness / risk map) as a private DTU, then a Thread draft (shared
 * dtu.create -> dtu.get read-back -> thread.thread-draft handoff in
 * components/lens/recordKeep.ts). Built only from the summary a legacy macro
 * already returned — a failed run, a message-only result, or an empty
 * summary has nothing honest to keep.
 */

import type { KeptRecord } from '@/components/lens/recordKeep';

export type LegacyAssessmentKind = 'debt' | 'migration' | 'risk';

/** The visible tab labels the assessment panel already renders. */
const KIND_LABELS: Record<LegacyAssessmentKind, string> = {
  debt: 'Technical debt',
  migration: 'Migration readiness',
  risk: 'Risk map',
};

export interface LegacyAssessmentInput {
  kind?: LegacyAssessmentKind;
  summary?: Record<string, unknown> | null;
  error?: string | null;
  message?: string | null;
}

function text(value: unknown, max = 4000): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/** A portfolio-assessment summary the panel already rendered. Null when the run failed, was message-only, or returned no summary values. */
export function legacyKeptRecord(result: LegacyAssessmentInput | null | undefined): KeptRecord | null {
  const kind = text(result?.kind, 40) as LegacyAssessmentKind;
  if (!result || !(kind in KIND_LABELS)) return null;
  if (text(result.error, 400) || text(result.message, 400)) return null;
  const summary = result.summary && typeof result.summary === 'object' ? result.summary : null;
  if (!summary) return null;
  const lines: string[] = [];
  for (const [key, value] of Object.entries(summary)) {
    if (value == null || typeof value === 'object') continue;
    const s = text(value, 2000);
    if (!s) continue;
    lines.push(`${key}: ${s}`);
  }
  if (lines.length === 0) return null;
  const title = KIND_LABELS[kind];
  return {
    title,
    body: [title, ...lines].join('\n'),
    tags: ['legacy', 'assessment'],
    source: 'legacy-lens:assessment-summary',
    createdFrom: 'legacy',
    draftTitle: `Legacy — ${title}`.slice(0, 120),
    machine: {
      kind: 'legacy_assessment',
      assessment: kind,
      summary,
    },
  };
}