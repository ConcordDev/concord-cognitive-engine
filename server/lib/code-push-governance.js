// server/lib/code-push-governance.js
//
// GH-3c — governed push: the last leg of the GH-1 -> GH-3 loop. Turns an
// already-verified edit set (the output of `code.propose-verified-patch`,
// GH-3b) into a real, human-approved commit against the user's connected
// GitHub repo.
//
// Mirrors `repair-remediation.js`'s propose -> approve/reject -> apply
// discipline (structured returns, no placeholder proposals, honest
// degradation over fabrication), scoped to one narrow, well-understood
// action: push a verified patch to a NEW branch, never the base branch,
// never auto-approved.
//
// Storage: an in-memory `Map<id, entry>`, same shape as
// `repair-remediation.js`'s `_queue` — these proposals are ephemeral,
// per-process, human-in-the-loop review state, not a durable record a user
// would expect to survive a restart (same rationale repair-remediation.js
// documents for its own queue: there is no existing lightweight table
// pattern in this codebase for this exact "ephemeral per-user proposal
// awaiting one human click" shape, and inventing a migration + table for
// data that's supposed to be reviewed within minutes of being proposed
// would be over-engineering relative to the real need). Every entry carries
// `userId` and every read/write path is ownership-checked so one user's
// proposals are never visible or actionable by another — the isolation
// contract every other GH-* macro already holds (per-user OAuth token
// resolution off `ctx.actor.userId`).
//
// Honesty contract (CLAUDE.md "honest by construction"):
//  - `createProposal` never runs a GitHub call. It only stores what the
//    caller (the `code.push-proposal-create` macro) already validated is a
//    genuinely *verified* patch.
//  - `approveProposal` is the ONLY function that ever touches GitHub, and it
//    only runs once a human has explicitly approved — never automatically,
//    never speculatively.
//  - `approveProposal` NEVER commits to the proposal's base ref. It always
//    creates a new branch first (`github.branch-create` from `baseRef` to
//    `branchName`) and every subsequent `github.file-commit` targets that
//    new branch.
//  - Before committing each file, it re-fetches that file's CURRENT content
//    + sha from the just-created branch (which is byte-identical to the
//    base ref at the moment of branch creation) via a fresh
//    `github.file-get` call — never reusing a sha captured when the
//    proposal was created (GH-1's own conflict-avoidance rule: a sha can go
//    stale the instant something else touches the file). If the fresh
//    content no longer matches what the plan's `edit.before` expected, that
//    is a REAL conflict — someone/something changed the file on GitHub
//    since the proposal was made — and this module stops committing further
//    files and reports the conflict honestly rather than blindly pushing
//    `edit.after` over content the plan was never actually written against.
//  - Every return value distinguishes exactly which files committed, which
//    hit a real conflict, which failed for another reason, and which were
//    never attempted because an earlier file in the same proposal already
//    stopped the run — mirroring `multi-file-apply`'s
//    `{ applied, skipped }` honesty convention, extended with a `conflicts`
//    bucket for this module's specific new failure mode. `ok:true` is
//    returned ONLY when every file in the proposal actually committed —
//    a partially-pushed proposal is always `ok:false`, because a caller
//    silently trusting `ok:true` here would think of the push as done.
//  - No proposal can be approved twice. The instant `approveProposal` is
//    called on a `pending` entry it is stamped into a non-`pending` status
//    before any GitHub call runs, so a second concurrent approve call on
//    the same id always sees `wrong_state`, never double-pushes.

import crypto from "node:crypto";

/** @type {Map<string, ProposalEntry>} */
const _proposals = new Map();

/**
 * @typedef {Object} ProposalEdit
 * @property {string} filename
 * @property {string} before   the file content the plan was written against
 * @property {string} after    the file content to commit
 * @property {string|null} [reason]
 *
 * @typedef {Object} ProposalEntry
 * @property {string} id
 * @property {string} userId        owner — every read/write is scoped to this
 * @property {string} repo          "owner/name"
 * @property {string} baseRef       branch/tag/sha the new branch is cut from
 * @property {string} branchName    the NEW branch this proposal pushes to — never baseRef
 * @property {ProposalEdit[]} edits
 * @property {"pending"|"approving"|"pushed"|"conflict"|"push_failed"|"branch_create_failed"|"rejected"} status
 * @property {string} createdAt
 * @property {string} [approvedAt]
 * @property {string} [rejectedAt]
 * @property {string} [rejectReason]
 * @property {object} [pushResult]
 */

function nowISO() {
  return new Date().toISOString();
}

function newId() {
  return `push_${Date.now().toString(36)}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Ownership-checked lookup. Returns null for BOTH "no such id" and
 * "exists but belongs to someone else" — deliberately the same shape, so a
 * caller (or an attacker probing ids) can never distinguish the two and
 * learn whether a given id exists for another user. This is the concrete
 * mechanism behind the per-user isolation contract.
 */
function ownedEntry(id, userId) {
  if (!id || !userId) return null;
  const entry = _proposals.get(id);
  if (!entry || entry.userId !== userId) return null;
  return entry;
}

/** Redacts `userId` and trims edits to their reviewable shape for macro callers. */
function publicView(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    repo: entry.repo,
    baseRef: entry.baseRef,
    branchName: entry.branchName,
    status: entry.status,
    fileCount: entry.edits.length,
    edits: entry.edits.map((e) => ({ filename: e.filename, reason: e.reason || null })),
    createdAt: entry.createdAt,
    approvedAt: entry.approvedAt || null,
    rejectedAt: entry.rejectedAt || null,
    rejectReason: entry.rejectReason || null,
    pushResult: entry.pushResult || null,
  };
}

/**
 * Store a new pending proposal. Performs no GitHub calls. `edits` must
 * already be the caller-validated output of a verified patch — this
 * function trusts its caller (the `code.push-proposal-create` macro) to
 * have already rejected an unverified or empty edit set.
 */
export function createProposal({ userId, repo, baseRef, branchName, edits }) {
  const entry = {
    id: newId(),
    userId,
    repo,
    baseRef,
    branchName,
    edits: edits.map((e) => ({
      filename: String(e.filename),
      before: typeof e.before === "string" ? e.before : "",
      after: typeof e.after === "string" ? e.after : "",
      reason: typeof e.reason === "string" ? e.reason : null,
    })),
    status: "pending",
    createdAt: nowISO(),
  };
  _proposals.set(entry.id, entry);
  return publicView(entry);
}

/** The calling user's own pending + resolved proposals, newest first. Never another user's. */
export function listProposals(userId) {
  if (!userId) return [];
  return Array.from(_proposals.values())
    .filter((p) => p.userId === userId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
    .map(publicView);
}

/** Read-only single-proposal lookup, ownership-checked. */
export function getProposal(id, userId) {
  return publicView(ownedEntry(id, userId));
}

/** Discards a pending proposal. No GitHub call is ever made on this path. */
export function rejectProposal(id, userId, reason) {
  const entry = ownedEntry(id, userId);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "pending") return { ok: false, error: "wrong_state", status: entry.status };
  entry.status = "rejected";
  entry.rejectedAt = nowISO();
  entry.rejectReason = typeof reason === "string" ? reason.slice(0, 500) : null;
  return { ok: true, result: { proposal: publicView(entry) } };
}

/**
 * The human-in-the-loop gate. Only a `pending` proposal can be approved,
 * and the instant it is, its status leaves `pending` before any GitHub call
 * runs — so a second concurrent approve on the same id always fails with
 * `wrong_state` rather than double-pushing.
 *
 * Real side effects, in order, per proposal:
 *  1. `github.branch-create(repo, branchName, fromRef: baseRef)` — the ONE
 *     and only place a new ref is created. If this fails, nothing else runs
 *     and the proposal is stamped `branch_create_failed`.
 *  2. For each edit, in order: `github.file-get(repo, path, ref: branchName)`
 *     for a FRESH sha + content (never the sha captured at proposal-create
 *     time). If the fresh content doesn't match `edit.before`, that file is
 *     a genuine conflict — the loop stops there; no more files in this
 *     proposal are attempted.
 *  3. `github.file-commit(repo, path, content: edit.after, sha: freshSha,
 *     branch: branchName)` — always targets `branchName`, never `baseRef`.
 *
 * @param {string} id
 * @param {string} userId
 * @param {Function} runMacro   the caller's `ctx.runMacro` — this module
 *   never imports github.js directly so it stays testable the same way
 *   `propose-verified-patch` already is (a runMacro shim).
 * @param {object} ctx          forwarded to runMacro unchanged.
 */
export async function approveProposal(id, userId, runMacro, ctx) {
  const entry = ownedEntry(id, userId);
  if (!entry) return { ok: false, error: "not_found" };
  if (entry.status !== "pending") return { ok: false, error: "wrong_state", status: entry.status };
  if (typeof runMacro !== "function") return { ok: false, error: "runMacro_unavailable" };

  // Leave `pending` immediately — before any await — so a racing second
  // approve call sees `wrong_state`, never a second push.
  entry.status = "approving";
  entry.approvedAt = nowISO();

  const committed = [];
  const conflicts = [];
  const failed = [];
  const skipped = [];

  let branchRes;
  try {
    branchRes = await runMacro("github", "branch-create", { repo: entry.repo, branchName: entry.branchName, fromRef: entry.baseRef }, ctx);
  } catch (e) {
    branchRes = { ok: false, error: `branch-create threw: ${e?.message || e}` };
  }
  if (!branchRes?.ok) {
    entry.status = "branch_create_failed";
    entry.pushResult = {
      ok: false,
      stage: "branch-create",
      error: branchRes?.error || branchRes?.reason || "branch_create_failed",
      committed, conflicts, failed,
      skipped: entry.edits.map((e) => e.filename),
    };
    return { ok: false, error: "branch_create_failed", detail: branchRes, result: { proposal: publicView(entry) } };
  }

  let stopped = false;
  for (const edit of entry.edits) {
    if (stopped) {
      skipped.push(edit.filename);
      continue;
    }

    let freshRes;
    try {
      freshRes = await runMacro("github", "file-get", { repo: entry.repo, path: edit.filename, ref: entry.branchName }, ctx);
    } catch (e) {
      freshRes = { ok: false, error: `file-get threw: ${e?.message || e}` };
    }
    if (!freshRes?.ok) {
      failed.push({ filename: edit.filename, stage: "file-get", error: freshRes?.error || freshRes?.reason || "file_get_failed" });
      stopped = true;
      continue;
    }

    const freshContent = typeof freshRes.result?.content === "string" ? freshRes.result.content : "";
    const freshSha = freshRes.result?.sha;
    if (freshContent !== edit.before) {
      conflicts.push({
        filename: edit.filename,
        reason: "remote content changed since the proposal was created",
      });
      stopped = true;
      continue;
    }

    let commitRes;
    try {
      commitRes = await runMacro("github", "file-commit", {
        repo: entry.repo,
        path: edit.filename,
        content: edit.after,
        message: edit.reason ? `Concord: ${edit.reason}` : `Concord: update ${edit.filename}`,
        sha: freshSha,
        branch: entry.branchName,
      }, ctx);
    } catch (e) {
      commitRes = { ok: false, error: `file-commit threw: ${e?.message || e}` };
    }
    if (!commitRes?.ok) {
      failed.push({ filename: edit.filename, stage: "file-commit", error: commitRes?.error || commitRes?.reason || "file_commit_failed" });
      stopped = true;
      continue;
    }

    committed.push({ filename: edit.filename, commitSha: commitRes.result?.commitSha || null, htmlUrl: commitRes.result?.htmlUrl || null });
  }

  const allCommitted = committed.length === entry.edits.length && conflicts.length === 0 && failed.length === 0;
  entry.status = allCommitted ? "pushed" : (conflicts.length > 0 ? "conflict" : "push_failed");
  entry.pushResult = { ok: allCommitted, branch: entry.branchName, committed, conflicts, failed, skipped };

  return { ok: allCommitted, result: { proposal: publicView(entry) }, pushResult: entry.pushResult };
}

/** Test-only: clear the in-memory proposal store between test cases. */
export function _resetPushProposals() {
  _proposals.clear();
}

export default {
  createProposal,
  listProposals,
  getProposal,
  rejectProposal,
  approveProposal,
  _resetPushProposals,
};
