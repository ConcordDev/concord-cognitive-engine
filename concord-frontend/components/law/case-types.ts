/**
 * Shared case-file constants/types — used by CaseFiles (the per-user case
 * tracker) and CaseAnalytics (which runs the real `law.caseAnalysis` /
 * `law.deadlineTracker` macros over the real case list CaseFiles produces).
 */

export const JURISDICTIONS = ['US', 'EU', 'UK', 'CA', 'AU', 'INT'] as const;
export type Jurisdiction = typeof JURISDICTIONS[number];

export const JURISDICTION_COLORS: Record<Jurisdiction, string> = {
  US: 'bg-blue-400/15 border-blue-400/30 text-blue-400',
  EU: 'bg-indigo-400/15 border-indigo-400/30 text-indigo-400',
  UK: 'bg-purple-400/15 border-purple-400/30 text-purple-400',
  CA: 'bg-red-400/15 border-red-400/30 text-red-400',
  AU: 'bg-yellow-400/15 border-yellow-400/30 text-yellow-400',
  INT: 'bg-teal-400/15 border-teal-400/30 text-teal-400',
};

export const CASE_STATUSES = ['open', 'in-review', 'hearing', 'closed'] as const;
export type CaseStatus = typeof CASE_STATUSES[number];

export const STATUS_COLORS: Record<CaseStatus, string> = {
  open: 'bg-blue-400/15 border-blue-400/30 text-blue-400',
  'in-review': 'bg-yellow-400/15 border-yellow-400/30 text-yellow-400',
  hearing: 'bg-orange-400/15 border-orange-400/30 text-orange-400',
  closed: 'bg-green-400/15 border-green-400/30 text-green-400',
};

export const CASE_TYPES = ['litigation', 'contract-dispute', 'regulatory', 'ip', 'employment', 'other'] as const;
export type CaseType = typeof CASE_TYPES[number];

// Maps to law.caseAnalysis's win/loss keyword scan (winKeywords: won, win,
// favorable, settled, dismissed; lossKeywords: lost, loss, unfavorable,
// adverse). Values below are chosen to hit those exact keywords so the
// real macro's win-rate computation reflects what the user records.
export const CASE_OUTCOMES = ['pending', 'won', 'settled', 'lost', 'dismissed'] as const;
export type CaseOutcome = typeof CASE_OUTCOMES[number];

export const OUTCOME_COLORS: Record<CaseOutcome, string> = {
  pending: 'bg-gray-500/15 border-gray-500/30 text-gray-400',
  won: 'bg-emerald-400/15 border-emerald-400/30 text-emerald-300',
  settled: 'bg-cyan-400/15 border-cyan-400/30 text-cyan-300',
  lost: 'bg-rose-500/15 border-rose-500/30 text-rose-300',
  dismissed: 'bg-amber-400/15 border-amber-400/30 text-amber-300',
};

export interface CaseFileSummary {
  id: string;
  title: string;
  jurisdiction: Jurisdiction;
  caseType: CaseType;
  status: CaseStatus;
  outcome: CaseOutcome;
  judge: string | null;
  deadline: string | null;
  /** Real record-creation timestamp (`createdAt`) — used as filedDate. */
  filedDate: string;
  /** Stamped the moment status transitions to `closed` — null otherwise. */
  closedDate: string | null;
}
