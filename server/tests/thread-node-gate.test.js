// Thread node gate — security regression tests.
//
// Pins the fix for: `thread.merge` / `thread.delete_node` lens actions let
// ANY signed-in member act on ANY thread artifact because `thread` is a
// LENS_SOCIAL_DOMAINS domain on the generic lens run path:
//   * `merge` appended a merge node built from other users' branch contents;
//   * `delete_node` removed any node AND its whole descendant subtree —
//     including other users' replies.
// Product default (safest): merge and moderation-delete are restricted to
// the thread owner, moderator-class roles, and internal/admin callers; a
// plain member may only delete a subtree authored entirely by themselves.
// (`thread.branch` — adding your own node — deliberately stays open.)
//
// Two layers:
//   1. Unit tests for threadModerationDenial / threadDeleteNodeDenial
//      (owner/moderator/admin/internal ok, anon 401, member 403, author
//      own-leaf ok, foreign-reply subtree 403, empty removedNodes 403).
//   2. Source-order assertions that BOTH handlers in server.js call their
//      gate BEFORE the first `artifact.data =` mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { threadModerationDenial, threadDeleteNodeDenial } from "../lib/thread-node-gate.js";
import { FORUM_MOD_ROLES } from "../lib/forum-mod-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const ANON_DENIED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });
const MEMBER_MERGE_DENIED = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the thread owner or a moderator can do this" });
const MEMBER_DELETE_DENIED = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: you can only delete your own nodes" });

describe("thread-node-gate — threadModerationDenial unit", () => {
  it("the thread owner is allowed", () => {
    assert.equal(threadModerationDenial({ isThreadOwner: true, userId: "owner-1", role: "member" }), null);
  });

  it("a moderator is allowed", () => {
    assert.equal(threadModerationDenial({ isThreadOwner: false, role: "moderator", userId: "mod-1" }), null);
  });

  it("an admin is allowed", () => {
    assert.equal(threadModerationDenial({ isThreadOwner: false, role: "admin", userId: "admin-1" }), null);
  });

  it("internal callers are allowed", () => {
    assert.equal(threadModerationDenial({ internal: true, userId: "member-1" }), null);
    assert.equal(threadModerationDenial({ internal: true }), null);
  });

  it("internal beats the anon sentinel (allow order)", () => {
    assert.equal(threadModerationDenial({ internal: true, userId: "anon" }), null);
  });

  it("every FORUM_MOD_ROLES string role is allowed", () => {
    for (const role of FORUM_MOD_ROLES) {
      assert.equal(threadModerationDenial({ userId: "u-" + role, role }), null, role);
    }
  });

  it("the role match is case-insensitive (string and roles array)", () => {
    assert.equal(threadModerationDenial({ userId: "u1", role: "Moderator" }), null);
    assert.equal(threadModerationDenial({ userId: "u2", role: "ADMIN" }), null);
    assert.equal(threadModerationDenial({ userId: "u3", role: "member", roles: ["member", "Moderator"] }), null);
    assert.equal(threadModerationDenial({ userId: "u4", roles: ["Member", "Sovereign"] }), null);
  });

  it("the anon sentinel / missing userId / empty input is denied 401", () => {
    assert.deepEqual(threadModerationDenial({ userId: "anon", role: "member" }), ANON_DENIED);
    assert.deepEqual(threadModerationDenial({ role: "member" }), ANON_DENIED);
    assert.deepEqual(threadModerationDenial({}), ANON_DENIED);
    assert.deepEqual(threadModerationDenial(undefined), ANON_DENIED);
    assert.deepEqual(threadModerationDenial(null), ANON_DENIED);
  });

  it("a signed-in plain member is denied 403 on merge", () => {
    assert.deepEqual(threadModerationDenial({ userId: "member-1", role: "member" }), MEMBER_MERGE_DENIED);
    assert.deepEqual(threadModerationDenial({ userId: "member-2" }), MEMBER_MERGE_DENIED);
    assert.deepEqual(threadModerationDenial({ userId: "member-3", role: "viewer", roles: ["member", "viewer"] }), MEMBER_MERGE_DENIED);
  });

  it("denial results are fresh objects every time", () => {
    const a = threadModerationDenial({ userId: "member-1" });
    const b = threadModerationDenial({ userId: "member-1" });
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
    a.error = "mutated";
    assert.deepEqual(threadModerationDenial({ userId: "member-1" }), MEMBER_MERGE_DENIED);
  });
});

describe("thread-node-gate — threadDeleteNodeDenial unit", () => {
  const ownLeaf = [{ id: "b1", authorId: "author-1" }];

  it("the thread owner may delete any subtree (other users' nodes included)", () => {
    assert.equal(threadDeleteNodeDenial({ isThreadOwner: true, userId: "owner-1", removedNodes: [{ id: "n1", authorId: "someone-else" }] }), null);
  });

  it("a moderator may delete any subtree", () => {
    assert.equal(threadDeleteNodeDenial({ role: "moderator", userId: "mod-1", removedNodes: [{ id: "n1", authorId: "someone-else" }] }), null);
  });

  it("an admin may delete any subtree", () => {
    assert.equal(threadDeleteNodeDenial({ role: "admin", userId: "admin-1", removedNodes: [{ id: "n1", authorId: "someone-else" }, { id: "n2", authorId: "author-1" }] }), null);
  });

  it("internal callers may delete any subtree", () => {
    assert.equal(threadDeleteNodeDenial({ internal: true, userId: "member-1", removedNodes: [{ id: "n1", authorId: "someone-else" }] }), null);
    assert.equal(threadDeleteNodeDenial({ internal: true, removedNodes: [] }), null);
  });

  it("the anon sentinel / missing userId is denied 401 even for an own-authored subtree", () => {
    assert.deepEqual(threadDeleteNodeDenial({ userId: "anon", removedNodes: [{ id: "n1", authorId: "anon" }] }), ANON_DENIED);
    assert.deepEqual(threadDeleteNodeDenial({ removedNodes: ownLeaf }), ANON_DENIED);
    assert.deepEqual(threadDeleteNodeDenial({}), ANON_DENIED);
    assert.deepEqual(threadDeleteNodeDenial(undefined), ANON_DENIED);
    assert.deepEqual(threadDeleteNodeDenial(null), ANON_DENIED);
  });

  it("an author deleting their own leaf node is allowed", () => {
    assert.equal(threadDeleteNodeDenial({ userId: "author-1", role: "member", removedNodes: ownLeaf }), null);
  });

  it("an author deleting their own multi-node subtree (all theirs) is allowed", () => {
    const subtree = [
      { id: "b1", authorId: "author-1" },
      { id: "b2", parentNodeId: "b1", authorId: "author-1" },
      { id: "b3", parentNodeId: "b2", authorId: "author-1" },
    ];
    assert.equal(threadDeleteNodeDenial({ userId: "author-1", role: "member", removedNodes: subtree }), null);
  });

  it("an author deleting their own node with another user's reply below it is denied 403", () => {
    const subtree = [
      { id: "b1", authorId: "author-1" },
      { id: "b2", parentNodeId: "b1", authorId: "member-9" },
    ];
    assert.deepEqual(threadDeleteNodeDenial({ userId: "author-1", role: "member", removedNodes: subtree }), MEMBER_DELETE_DENIED);
  });

  it("a member deleting someone else's node is denied 403", () => {
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", role: "member", removedNodes: [{ id: "n1", authorId: "someone-else" }] }), MEMBER_DELETE_DENIED);
  });

  it("a member deleting a node with no authorId on it is denied 403", () => {
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", removedNodes: [{ id: "n1" }] }), MEMBER_DELETE_DENIED);
  });

  it("an empty removedNodes array is denied 403", () => {
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", removedNodes: [] }), MEMBER_DELETE_DENIED);
  });

  it("a missing/non-array removedNodes is denied 403", () => {
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1" }), MEMBER_DELETE_DENIED);
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", removedNodes: undefined }), MEMBER_DELETE_DENIED);
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", removedNodes: "b1" }), MEMBER_DELETE_DENIED);
  });

  it("denial results are fresh objects every time", () => {
    const a = threadDeleteNodeDenial({ userId: "member-1", removedNodes: [] });
    const b = threadDeleteNodeDenial({ userId: "member-1", removedNodes: [] });
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
    a.error = "mutated";
    assert.deepEqual(threadDeleteNodeDenial({ userId: "member-1", removedNodes: [] }), MEMBER_DELETE_DENIED);
  });
});

describe("thread-node-gate — server.js handler wiring (source order)", () => {
  // Delimit each handler's registration block by the next registration after it.
  const branchStart = SERVER_JS.indexOf('registerLensAction("thread", "branch"');
  const mergeStart = SERVER_JS.indexOf('registerLensAction("thread", "merge"');
  const summarizeStart = SERVER_JS.indexOf('registerLensAction("thread", "summarize"');
  const deleteStart = SERVER_JS.indexOf('registerLensAction("thread", "delete_node"');
  const musicStart = SERVER_JS.indexOf('registerLensAction("music", "analyze"');

  it("all the thread action registrations are found in order", () => {
    assert.ok(branchStart > 0, "thread.branch registration found");
    assert.ok(mergeStart > branchStart, "thread.merge registration found after thread.branch");
    assert.ok(summarizeStart > mergeStart, "thread.summarize registration found after thread.merge");
    assert.ok(deleteStart > summarizeStart, "thread.delete_node registration found after thread.summarize");
    assert.ok(musicStart > deleteStart, "music.analyze registration found after thread.delete_node");
  });

  it("thread.merge gates with threadModerationDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(mergeStart, summarizeStart);
    const gateAt = body.indexOf("threadModerationDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "thread.merge calls threadModerationDenial");
    assert.ok(mutateAt > 0, "thread.merge mutates artifact.data");
    assert.ok(gateAt < mutateAt, "thread.merge: threadModerationDenial precedes the artifact.data mutation");
  });

  it("thread.delete_node gates with threadDeleteNodeDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(deleteStart, musicStart);
    const gateAt = body.indexOf("threadDeleteNodeDenial");
    const removedAt = body.indexOf("removedNodes");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "thread.delete_node calls threadDeleteNodeDenial");
    assert.ok(removedAt > 0, "thread.delete_node computes removedNodes");
    assert.ok(mutateAt > 0, "thread.delete_node mutates artifact.data");
    assert.ok(removedAt < gateAt, "thread.delete_node: removedNodes is computed before the gate call");
    assert.ok(gateAt < mutateAt, "thread.delete_node: threadDeleteNodeDenial precedes the artifact.data mutation");
  });

  it("thread.delete_node keeps the nodeId and not-found checks before the gate", () => {
    const body = SERVER_JS.slice(deleteStart, musicStart);
    const nodeIdAt = body.indexOf("nodeId required");
    const notFoundAt = body.indexOf("node not found");
    const gateAt = body.indexOf("threadDeleteNodeDenial");
    assert.ok(nodeIdAt > 0, "thread.delete_node still requires nodeId");
    assert.ok(notFoundAt > 0, "thread.delete_node still rejects unknown nodes");
    assert.ok(nodeIdAt < gateAt && notFoundAt < gateAt, "input validation precedes the gate call");
  });

  it("thread.branch stays open (no gate on adding your own node)", () => {
    const body = SERVER_JS.slice(branchStart, mergeStart);
    assert.ok(body.indexOf("artifact.data =") > 0, "thread.branch mutates artifact.data");
    assert.equal(body.indexOf("threadModerationDenial"), -1, "thread.branch is not gated");
    assert.equal(body.indexOf("threadDeleteNodeDenial"), -1, "thread.branch is not gated");
  });

  it("both gates pass the shared owner/admin/role/roles/internal/userId context shape", () => {
    const mergeBody = SERVER_JS.slice(mergeStart, summarizeStart);
    const deleteBody = SERVER_JS.slice(deleteStart, musicStart);
    for (const [label, body] of [["thread.merge", mergeBody], ["thread.delete_node", deleteBody]]) {
      assert.ok(body.includes("isThreadOwner: _lensIsOwnerActor(ctx, artifact) || _lensIsAdminActor(ctx)"), `${label} passes the owner-or-admin flag`);
      assert.ok(body.includes("role: ctx?.actor?.role"), `${label} passes the actor role`);
      assert.ok(body.includes("roles: ctx?.actor?.roles"), `${label} passes the actor roles array`);
      assert.ok(body.includes("internal: ctx?.internal === true || ctx?.actor?.internal === true"), `${label} passes the internal flag`);
      assert.ok(body.includes("userId: ctx?.actor?.userId"), `${label} passes the actor userId`);
    }
  });

  it("server.js imports the gate helpers from lib/thread-node-gate.js", () => {
    assert.ok(
      SERVER_JS.includes('import { threadModerationDenial, threadDeleteNodeDenial } from "./lib/thread-node-gate.js";'),
      "server.js imports the shared gate helpers"
    );
  });
});