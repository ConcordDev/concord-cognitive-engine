// concord-frontend/components/engineering/fea-verification.ts
//
// Honest classifier for a REAL engineering.runFEA computation result — the
// analysis itself, not a marketplace listing of it (that separate concern is
// already covered by components/marketplace/ListingVerificationBadge.tsx).
// Grounding audit gap: FEAResultViewer showed only a bare per-member
// PASS/WARN/FAIL bar (the existing <UtilizationBadge>) with no OVERALL
// "was this structure actually checked, and did the whole model pass" signal
// distinct from "no analysis has run yet." This is backwards — the place
// that most needs an honest indicator is where the computation happens.
//
// Mirrors the REAL shape server/lib/simulation/fea-solver.js#runFEA returns
// (read directly from that file, verified 2026-07-24):
//   success: { ok: true, displacements, reactions, memberForces, stresses,
//              utilization, summary: { maxDisplacement, maxUtilization,
//              allPass, memberCount, nodeCount } }
//   failure: { ok: false, error: string }   // e.g. empty model
//
// Same three honest states as getListingVerification
// (components/marketplace/ListingVerificationBadge.tsx), mapped onto THIS
// result shape's real fields only — never a field that shape doesn't have
// (no `safetyFactor` here; that field belongs to the separate blade-frame
// FEA-gate model in server/lib/asset-gen/fea-gate.js, a different real
// engine with a different real result shape).

import type { ComputedResultState } from '@/components/common/ComputedResultBadge';

export interface FeaComputationSummary {
  maxDisplacement?: number;
  maxUtilization?: number;
  allPass?: boolean;
  memberCount?: number;
  nodeCount?: number;
}

/** The real, minimal shape of an `engineering.runFEA` response this
 * classifier reads. Every field optional so a partial/absent result still
 * type-checks — classification never assumes a field is present. */
export interface FeaComputationResult {
  ok?: boolean;
  error?: string | null;
  summary?: FeaComputationSummary | null;
}

export interface FeaVerification {
  state: ComputedResultState;
  label: string;
  detail: string;
}

function fmtPct(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'n/a';
  return `${Math.round(n * 1000) / 10}%`;
}

/**
 * Classify a real FEA computation result. PURE — no fetch, no macro call.
 * Never defaults to "verified": a missing result, a solve failure
 * (`ok !== true`), or a missing/malformed `summary` all fall to the honest
 * `no_data` state — that means "no check has actually completed," which is
 * distinct from `failed` (a check DID complete and did not pass).
 */
export function getFeaVerification(result?: FeaComputationResult | null): FeaVerification {
  if (
    !result ||
    typeof result !== 'object' ||
    result.ok !== true ||
    !result.summary ||
    typeof result.summary.allPass !== 'boolean'
  ) {
    const solveError = result && result.ok === false && result.error;
    return {
      state: 'no_data',
      label: 'Not run',
      detail: solveError
        ? `No FEA result: the solve did not complete (${result.error}).`
        : 'No FEA analysis has been run on this model yet.',
    };
  }

  const { summary } = result;
  if (summary.allPass === true) {
    return {
      state: 'verified',
      label: 'FEA Verified',
      detail: `Structural FEA check passed — all ${summary.memberCount ?? '?'} member(s) within allowable stress (max utilization ${fmtPct(summary.maxUtilization)}).`,
    };
  }

  return {
    state: 'failed',
    label: 'FEA Failed',
    detail: `A structural FEA check ran and did NOT pass — at least one of ${summary.memberCount ?? '?'} member(s) exceeds allowable stress (max utilization ${fmtPct(summary.maxUtilization)}).`,
  };
}
