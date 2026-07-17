/**
 * tracked-changes — Word-style "tracked changes / accept-reject" review
 * state layered on top of the REAL line-level redline diff produced by
 * `law.contract-diff` (server/domains/law.js#lineDiff, a classic LCS diff
 * — see `contract-version-save`/`contract-diff`).
 *
 * This is deliberately a pure UI/metadata convention, not a new diff
 * engine: it never recomputes or invents a diff — it only tracks a
 * per-line accept/reject/pending decision over the `ops` array the real
 * `contract-diff` macro already returned. 'same' lines are unchanged
 * context and are not reviewable; only 'add'/'remove' lines are redlines
 * a reviewer can accept or reject.
 *
 * Reused by concord-frontend/components/law/ContractRedline.tsx.
 */

export interface DiffOp {
  op: 'same' | 'add' | 'remove';
  text: string;
}

export type ReviewDecision = 'pending' | 'accepted' | 'rejected';

export interface TrackedChange {
  /** Index into the original `ops` array — stable identity for a decision. */
  index: number;
  op: 'add' | 'remove';
  text: string;
  decision: ReviewDecision;
}

export interface ReviewSummary {
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  /** True only when there is at least one reviewable change and none are pending. */
  allResolved: boolean;
}

/**
 * Derive the reviewable tracked-change list from a real diff `ops` array.
 * Every entry starts 'pending' — nothing is pre-accepted or pre-rejected,
 * since neither the CRDT nor the diff engine has an opinion on that; it's
 * purely a human review decision.
 */
export function buildTrackedChanges(ops: DiffOp[]): TrackedChange[] {
  const changes: TrackedChange[] = [];
  ops.forEach((o, index) => {
    if (o.op === 'add' || o.op === 'remove') {
      changes.push({ index, op: o.op, text: o.text, decision: 'pending' });
    }
  });
  return changes;
}

/** Set one change's review decision, returning a new array (immutable update). */
export function decideChange(changes: TrackedChange[], index: number, decision: ReviewDecision): TrackedChange[] {
  return changes.map((c) => (c.index === index ? { ...c, decision } : c));
}

/** Bulk-apply a decision to every change (e.g. "Accept all" / "Reject all"). */
export function decideAll(changes: TrackedChange[], decision: ReviewDecision): TrackedChange[] {
  return changes.map((c) => ({ ...c, decision }));
}

export function summarizeReview(changes: TrackedChange[]): ReviewSummary {
  const total = changes.length;
  let accepted = 0;
  let rejected = 0;
  for (const c of changes) {
    if (c.decision === 'accepted') accepted++;
    else if (c.decision === 'rejected') rejected++;
  }
  const pending = total - accepted - rejected;
  return { total, accepted, rejected, pending, allResolved: total > 0 && pending === 0 };
}
