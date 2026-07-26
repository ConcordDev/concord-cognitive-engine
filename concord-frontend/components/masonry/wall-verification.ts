// concord-frontend/components/masonry/wall-verification.ts
//
// Honest classifier for a REAL masonry.wallStrength computation result — the
// second real-computation lens (per CLAUDE.md's "zero-generic-tendencies"
// hard invariant) with a genuine deterministic structural check
// (slenderness-ratio pass/fail) rendered only as a bare pass/fail color box,
// with no honest verified/failed/no-data signal distinguishing "no check has
// been run yet" from a real passing or failing result. Reuses the same
// shared shell (components/common/ComputedResultBadge.tsx) the FEA fix uses
// (components/engineering/fea-verification.ts) — genuinely analogous gap,
// genuinely analogous fix.
//
// Mirrors the REAL shape server/domains/masonry.js's `wallStrength` macro
// returns (read directly from that file, verified 2026-07-24):
//   registerLensAction("masonry", "wallStrength", ...) always returns
//   `{ ok: true, result: { heightFeet, thicknessInches, slendernessRatio,
//     maxAllowedRatio, passesSlenderness, reinforced, loadBearing,
//     recommendation } }` — non-finite height/thickness inputs fall back to
//   safe defaults (8 ft / 8 in) rather than erroring, so there is no
//   `ok: false` failure path for this macro. `no_data` here means "the caller
//   hasn't run a check yet" (no `result` object at all), never "the macro
//   errored."

import type { ComputedResultState } from '@/components/common/ComputedResultBadge';

/** The real, minimal shape of a `masonry.wallStrength` response this
 * classifier reads. Every field optional so a partial/absent result still
 * type-checks — classification never assumes a field is present. */
export interface WallStrengthResult {
  slendernessRatio?: number;
  maxAllowedRatio?: number;
  passesSlenderness?: boolean;
}

export interface WallVerification {
  state: ComputedResultState;
  label: string;
  detail: string;
}

/**
 * Classify a real wall-strength computation result. PURE — no fetch, no
 * macro call. Never defaults to "verified": no result (or a malformed one
 * missing the boolean `passesSlenderness` field) always falls to the honest
 * `no_data` state.
 */
export function getWallVerification(result?: WallStrengthResult | null): WallVerification {
  if (!result || typeof result !== 'object' || typeof result.passesSlenderness !== 'boolean') {
    return {
      state: 'no_data',
      label: 'Not checked',
      detail: 'No wall-strength check has been run yet.',
    };
  }

  const ratio = result.slendernessRatio ?? 'n/a';
  const max = result.maxAllowedRatio ?? 'n/a';

  if (result.passesSlenderness) {
    return {
      state: 'verified',
      label: 'Wall OK',
      detail: `Slenderness ratio ${ratio} is within the allowed ${max} limit.`,
    };
  }

  return {
    state: 'failed',
    label: 'Wall Fails Check',
    detail: `Slenderness ratio ${ratio} EXCEEDS the allowed ${max} limit — increase thickness or add pilasters.`,
  };
}
