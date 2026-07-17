/**
 * Tracked-changes accept/reject convention (concord-frontend/lib/law/tracked-changes.ts)
 * layered over the REAL `law.contract-diff` line diff.
 *
 * Per the honesty rules for this build: "Compute expected diffs from the
 * real `contract-diff`, not pasted output." `lineDiff` is imported directly
 * from server/domains/law.js (the exact function `contract-diff` calls
 * internally — hoisted to a module-scope export, not re-implemented here)
 * so every `ops` array in this file is the real engine's output, not a
 * hand-typed fixture standing in for one.
 */
import { describe, it, expect } from 'vitest';
// Import the real backend diff engine directly — same function
// `law.contract-diff` calls (server/domains/law.js). Pure, no DB/STATE
// dependency, safe to run under vitest's node-backed jsdom environment.
import { lineDiff } from '../../server/domains/law.js';
import {
  buildTrackedChanges, decideChange, decideAll, summarizeReview,
  type TrackedChange,
} from '@/lib/law/tracked-changes';

const V1 = [
  '[Confidentiality]',
  'Each party shall keep confidential all non-public information.',
  '[Governing Law]',
  'This Agreement is governed by the laws of Delaware.',
].join('\n');

const V2 = [
  '[Confidentiality]',
  'Each party shall keep confidential all non-public information disclosed in writing.',
  '[Governing Law]',
  'This Agreement is governed by the laws of Delaware.',
  '[Termination]',
  'Either party may terminate on 30 days notice.',
].join('\n');

describe('tracked-changes over the real contract-diff ops', () => {
  it('buildTrackedChanges only tracks real add/remove lines the LCS diff produced (never fabricates one)', () => {
    const ops = lineDiff(V1, V2);
    // Sanity: the real engine actually found changes worth reviewing.
    expect(ops.some((o) => o.op === 'add')).toBe(true);
    expect(ops.some((o) => o.op === 'remove')).toBe(true);
    expect(ops.some((o) => o.op === 'same')).toBe(true);

    const changes = buildTrackedChanges(ops);
    // Every tracked change corresponds 1:1 to a real add/remove op at the
    // same index — no invented entries, no dropped ones.
    const expectedIndexes = ops
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.op === 'add' || o.op === 'remove')
      .map(({ i }) => i);
    expect(changes.map((c) => c.index)).toEqual(expectedIndexes);
    for (const c of changes) {
      const original = ops[c.index];
      expect(c.op).toBe(original.op);
      expect(c.text).toBe(original.text);
      expect(c.decision).toBe('pending');
    }
    // 'same' lines are context, not reviewable redlines.
    expect(changes.some((c) => (c as unknown as { op: string }).op === 'same')).toBe(false);
  });

  it('an unchanged body produces zero tracked changes (nothing to review)', () => {
    const ops = lineDiff(V1, V1);
    expect(ops.every((o) => o.op === 'same')).toBe(true);
    const changes = buildTrackedChanges(ops);
    expect(changes).toHaveLength(0);
    const summary = summarizeReview(changes);
    expect(summary).toEqual({ total: 0, accepted: 0, rejected: 0, pending: 0, allResolved: false });
  });

  it('decideChange updates exactly one change immutably, leaving the rest pending', () => {
    const ops = lineDiff(V1, V2);
    const changes = buildTrackedChanges(ops);
    expect(changes.length).toBeGreaterThan(1);
    const target = changes[0];
    const next = decideChange(changes, target.index, 'accepted');

    // Immutable: original array untouched.
    expect(changes[0].decision).toBe('pending');
    // New array: only the targeted index changed.
    expect(next.find((c) => c.index === target.index)?.decision).toBe('accepted');
    const others = next.filter((c) => c.index !== target.index);
    expect(others.every((c) => c.decision === 'pending')).toBe(true);
  });

  it('rejecting a change is distinct from accepting it — both are honest terminal states', () => {
    const ops = lineDiff(V1, V2);
    let changes = buildTrackedChanges(ops);
    const [first, second] = changes;
    changes = decideChange(changes, first.index, 'accepted');
    changes = decideChange(changes, second.index, 'rejected');
    expect(changes.find((c) => c.index === first.index)?.decision).toBe('accepted');
    expect(changes.find((c) => c.index === second.index)?.decision).toBe('rejected');
  });

  it('summarizeReview counts real decisions and reports allResolved only once nothing is pending', () => {
    const ops = lineDiff(V1, V2);
    let changes = buildTrackedChanges(ops);
    const total = changes.length;
    expect(total).toBeGreaterThan(0);

    let summary = summarizeReview(changes);
    expect(summary).toEqual({ total, accepted: 0, rejected: 0, pending: total, allResolved: false });

    // Accept everything but the last one.
    for (const c of changes.slice(0, -1)) {
      changes = decideChange(changes, c.index, 'accepted');
    }
    summary = summarizeReview(changes);
    expect(summary.accepted).toBe(total - 1);
    expect(summary.pending).toBe(1);
    expect(summary.allResolved).toBe(false);

    // Resolve the last one too.
    const last = changes[changes.length - 1] as TrackedChange;
    changes = decideChange(changes, last.index, 'rejected');
    summary = summarizeReview(changes);
    expect(summary.pending).toBe(0);
    expect(summary.allResolved).toBe(true);
    expect(summary.accepted + summary.rejected).toBe(total);
  });

  it('decideAll bulk-applies a single decision to every tracked change', () => {
    const ops = lineDiff(V1, V2);
    const changes = buildTrackedChanges(ops);
    const acceptedAll = decideAll(changes, 'accepted');
    expect(acceptedAll.every((c) => c.decision === 'accepted')).toBe(true);
    const summary = summarizeReview(acceptedAll);
    expect(summary.allResolved).toBe(true);
    expect(summary.rejected).toBe(0);
  });
});
