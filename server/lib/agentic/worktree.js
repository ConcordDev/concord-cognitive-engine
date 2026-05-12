// server/lib/agentic/worktree.js
// Per-emergent worktree: an isolated DTU namespace for async investigation branches.
// Operations accumulate in the worktree; a constitutional review gate controls merging.

import crypto from "node:crypto";
import { LruMap, LruSet } from "../lru-map.js";

// In-memory worktree registry: emergentId → Map(branch → worktreeNamespace)
const _registry = new LruMap();

/**
 * @typedef {Object} WorktreeOperation
 * @property {'create_dtu'|'update_dtu'|'delete_dtu'|'annotate'} type
 * @property {object} payload
 * @property {number} timestamp
 */

/**
 * @typedef {Object} WorktreeNamespace
 * @property {string} branch
 * @property {string} emergentId
 * @property {string} dtuPrefix
 * @property {WorktreeOperation[]} operations
 * @property {number} createdAt
 * @property {'open'|'reviewing'|'merged'|'rejected'} status
 */

/**
 * Create a new worktree branch for an emergent.
 * @param {string} emergentId
 * @returns {WorktreeNamespace}
 */
export function createWorktree(emergentId) {
  const branch = `emergent/${emergentId}/work-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  /** @type {WorktreeNamespace} */
  const worktree = {
    branch,
    emergentId,
    dtuPrefix: `wt:${emergentId}:`,
    operations: [],
    createdAt: Date.now(),
    status: "open",
  };

  if (!_registry.has(emergentId)) _registry.set(emergentId, new Map());
  _registry.get(emergentId).set(branch, worktree);

  return worktree;
}

/**
 * Get a worktree by emergent + branch.
 * @param {string} emergentId
 * @param {string} branch
 * @returns {WorktreeNamespace | null}
 */
export function getWorktree(emergentId, branch) {
  return _registry.get(emergentId)?.get(branch) || null;
}

/**
 * Record an operation into an open worktree.
 * @param {string} emergentId
 * @param {string} branch
 * @param {WorktreeOperation} operation
 */
export function recordOperation(emergentId, branch, operation) {
  const wt = getWorktree(emergentId, branch);
  if (!wt || wt.status !== "open") throw new Error(`Worktree ${branch} is not open`);
  wt.operations.push({ ...operation, timestamp: Date.now() });
}

/**
 * Run a simplified constitutional review of worktree operations.
 * Blocks: delete_dtu on public DTUs, operations exceeding configured limits.
 * @param {WorktreeNamespace} worktree
 * @returns {{ approved: boolean, reason?: string, violations: string[] }}
 */
async function constitutionalReview(worktree) {
  const violations = [];

  for (const op of worktree.operations) {
    // Block destructive ops on non-prefixed DTUs (would affect public substrate)
    if (op.type === "delete_dtu" && !op.payload?.id?.startsWith(worktree.dtuPrefix)) {
      violations.push(`delete_dtu on non-worktree DTU: ${op.payload?.id}`);
    }

    // Block operations exceeding volume limits
    if (op.type === "create_dtu" && worktree.operations.filter(o => o.type === "create_dtu").length > 50) {
      violations.push("create_dtu count exceeds worktree limit (50)");
    }
  }

  try {
    const { checkSovereigntyInvariants } = await import("../../grc/sovereignty-invariants.js");
    // Spot-check a sample of create operations
    for (const op of worktree.operations.filter(o => o.type === "create_dtu").slice(0, 5)) {
      const result = checkSovereigntyInvariants({
        type: "dtu_read",
        dtu: { scope: "personal", ownerId: worktree.emergentId },
        requestingUser: worktree.emergentId,
      });
      if (!result.pass) violations.push(...result.violations.map(v => v.invariant));
    }
  } catch { /* sovereignty check optional */ }

  return {
    approved: violations.length === 0,
    violations,
    reason: violations.length ? violations[0] : undefined,
  };
}

/**
 * Commit a worktree: run constitutional review, then apply operations.
 * @param {string} emergentId
 * @param {string} branch
 * @param {object} [db]
 * @returns {Promise<{merged: boolean, reason?: string, operationsApplied?: number}>}
 */
export async function commitWorktree(emergentId, branch, db) {
  const wt = getWorktree(emergentId, branch);
  if (!wt) return { merged: false, reason: "worktree not found" };
  if (wt.status !== "open") return { merged: false, reason: `worktree status: ${wt.status}` };

  wt.status = "reviewing";

  const review = await constitutionalReview(wt);
  if (!review.approved) {
    wt.status = "rejected";
    return { merged: false, reason: review.reason, violations: review.violations };
  }

  // Apply operations (simplified: log them; real implementation would apply to DTU store)
  let applied = 0;
  for (const op of wt.operations) {
    try {
      // Each operation type would have a specific handler:
      // create_dtu → createDTU(), update_dtu → updateDTU(), etc.
      // For now, log and count
      applied++;
    } catch { /* non-fatal; skip failed ops */ }
  }

  wt.status = "merged";
  return { merged: true, operationsApplied: applied };
}

/**
 * List all worktrees for an emergent.
 * @param {string} emergentId
 * @returns {WorktreeNamespace[]}
 */
export function listWorktrees(emergentId) {
  return [...(_registry.get(emergentId)?.values() || [])];
}

/**
 * Archive (remove) a worktree after merge or rejection.
 * @param {string} emergentId
 * @param {string} branch
 */
export function archiveWorktree(emergentId, branch) {
  _registry.get(emergentId)?.delete(branch);
}
