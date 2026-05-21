// Tier-2 contract tests for the collab lens domain.
//
// Covers the facilitation macros (sessionAnalytics / contributionScore /
// detectConsensus / balanceWorkload) plus the full real-time multiplayer
// co-editing backbone: shared documents with a conflict-free CRDT op log,
// live presence + multiplayer cursors + follow-mode, version-history
// snapshot/restore, @-mention threaded comments + notifications, and
// per-invitee permission tiers (view / comment / edit).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCollabActions from "../domains/collab.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
// The /api/lens/run route passes `input` as BOTH artifact.data and params,
// so the test harness mirrors that contract.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`collab.${name}`);
  if (!fn) throw new Error(`collab.${name} not registered`);
  return fn(ctx, { id: null, domain: "collab", type: "domain_action", data: input, meta: {} }, input);
}

before(() => {
  registerCollabActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a", name: "Alice" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b", name: "Bob" }, userId: "user_b" };
const ctxC = { actor: { userId: "user_c", name: "Cara" }, userId: "user_c" };

// ── Facilitation macros ─────────────────────────────────────────────────────

describe("collab facilitation macros", () => {
  it("sessionAnalytics computes Gini balance + per-participant share", () => {
    const r = call("sessionAnalytics", ctxA, {
      durationMinutes: 30,
      participants: ["Alice", "Bob"],
      messages: [
        { author: "Alice", content: "hi there team" },
        { author: "Alice", content: "ok" },
        { author: "Bob", content: "yes" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMessages, 3);
    assert.equal(r.result.totalParticipants, 2);
    assert.ok(r.result.participantStats.length === 2);
  });

  it("contributionScore ranks weighted contributions", () => {
    const r = call("contributionScore", ctxA, {
      contributions: [
        { name: "Alice", type: "code", quality: 0.9, count: 2 },
        { name: "Bob", type: "discussion", quality: 0.7, count: 1 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.topContributor, "Alice");
    assert.equal(r.result.rankings.length, 2);
  });

  it("detectConsensus flags supermajority", () => {
    const r = call("detectConsensus", ctxA, {
      votes: [
        { voter: "a", position: "ship" },
        { voter: "b", position: "ship" },
        { voter: "c", position: "ship" },
        { voter: "d", position: "wait" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.leadingPosition, "ship");
    assert.equal(r.result.consensusPercent, 75);
    assert.equal(r.result.hasSupermajority, true);
  });

  it("balanceWorkload flags overloaded members", () => {
    const r = call("balanceWorkload", ctxA, {
      members: [{ name: "Alice", capacityHours: 10 }, { name: "Bob", capacityHours: 40 }],
      tasks: [{ assignee: "Alice", hours: 20 }, { assignee: "Bob", hours: 5 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overloadedMembers, 1);
    assert.ok(r.result.suggestions.length > 0);
  });
});

// ── Shared documents — conflict-free CRDT co-editing ────────────────────────

describe("collab shared documents (CRDT co-editing)", () => {
  it("docCreate / docList / docState round-trip", () => {
    const c = call("docCreate", ctxA, { title: "Spec", text: "hello" });
    assert.equal(c.ok, true);
    assert.ok(c.result.id);
    const list = call("docList", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    const st = call("docState", ctxA, { docId: c.result.id });
    assert.equal(st.ok, true);
    assert.equal(st.result.text, "hello");
    assert.equal(st.result.canEdit, true);
  });

  it("docState rejects unknown document", () => {
    const r = call("docState", ctxA, { docId: "doc_missing" });
    assert.equal(r.ok, false);
  });

  it("docOp applies inserts and materializes the text", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "ab" }).result;
    const op = call("docOp", ctxA, { docId: doc.id, type: "insert", pos: 2, text: "c", lamport: 0 });
    assert.equal(op.ok, true);
    assert.equal(op.result.text, "abc");
  });

  it("concurrent ops converge in deterministic (lamport, authorId) order", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    // Two authors both produce ops claiming lamport 0 — backend total-orders them.
    call("docOp", ctxB, { docId: doc.id, type: "insert", pos: 0, text: "Z", lamport: 0 });
    const st1 = call("docState", ctxA, { docId: doc.id });
    call("docOp", ctxC, { docId: doc.id, type: "insert", pos: 0, text: "A", lamport: 0 });
    const st2 = call("docState", ctxA, { docId: doc.id });
    // Convergence: re-reading state is stable + deterministic.
    assert.equal(st2.result.text, call("docState", ctxA, { docId: doc.id }).result.text);
    assert.ok(st1.result.text.length === 1 && st2.result.text.length === 2);
  });

  it("docSync returns ops newer than the caller's lamport + presence", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "x" }).result;
    const op = call("docOp", ctxA, { docId: doc.id, type: "insert", pos: 1, text: "y", lamport: 0 });
    const sync = call("docSync", ctxB, { docId: doc.id, sinceLamport: 0 });
    assert.equal(sync.ok, true);
    assert.ok(sync.result.ops.length >= 1);
    assert.equal(sync.result.lamport, op.result.lamport);
    assert.ok(Array.isArray(sync.result.presence));
  });
});

// ── Version history ─────────────────────────────────────────────────────────

describe("collab version history", () => {
  it("docSnapshot / docHistory / docRestore round-trip", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "v1" }).result;
    const snap = call("docSnapshot", ctxA, { docId: doc.id, label: "first" });
    assert.equal(snap.ok, true);
    call("docOp", ctxA, { docId: doc.id, type: "insert", pos: 2, text: "-v2", lamport: 0 });
    const hist = call("docHistory", ctxA, { docId: doc.id });
    assert.equal(hist.ok, true);
    assert.ok(hist.result.snapshots.length >= 1);
    const restore = call("docRestore", ctxA, { docId: doc.id, snapshotId: snap.result.id });
    assert.equal(restore.ok, true);
    assert.equal(restore.result.text, "v1");
    assert.equal(call("docState", ctxA, { docId: doc.id }).result.text, "v1");
  });

  it("docRestore rejects an unknown snapshot", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "v1" }).result;
    const r = call("docRestore", ctxA, { docId: doc.id, snapshotId: "snap_missing" });
    assert.equal(r.ok, false);
  });
});

// ── Presence, multiplayer cursors, follow-mode ──────────────────────────────

describe("collab presence + cursors + follow-mode", () => {
  it("cursorUpdate registers a presence row with a deterministic color", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "abc" }).result;
    const r = call("cursorUpdate", ctxB, { docId: doc.id, cursor: 2, selection: { start: 1, end: 2 } });
    assert.equal(r.ok, true);
    const me = r.result.presence.find((p) => p.userId === "user_b");
    assert.ok(me);
    assert.equal(me.cursor, 2);
    assert.match(me.color, /^#/);
  });

  it("presenceState returns the live roster", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "abc" }).result;
    call("cursorUpdate", ctxA, { docId: doc.id, cursor: 0 });
    call("cursorUpdate", ctxB, { docId: doc.id, cursor: 1 });
    const r = call("presenceState", ctxA, { docId: doc.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.online, 2);
  });

  it("setFollow locks a viewer onto a present user", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "abc" }).result;
    call("cursorUpdate", ctxB, { docId: doc.id, cursor: 5 });
    const r = call("setFollow", ctxA, { docId: doc.id, targetId: "user_b" });
    assert.equal(r.ok, true);
    assert.equal(r.result.following, "user_b");
    assert.ok(r.result.followTarget);
    const clear = call("setFollow", ctxA, { docId: doc.id });
    assert.equal(clear.result.following, null);
  });

  it("setFollow rejects an absent target", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "abc" }).result;
    const r = call("setFollow", ctxA, { docId: doc.id, targetId: "user_ghost" });
    assert.equal(r.ok, false);
  });
});

// ── Permission tiers ────────────────────────────────────────────────────────

describe("collab permission tiers (view / comment / edit)", () => {
  it("setPermission / getPermissions enforces owner-only grants", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    const grant = call("setPermission", ctxA, { docId: doc.id, userId: "user_b", tier: "comment" });
    assert.equal(grant.ok, true);
    const denied = call("setPermission", ctxB, { docId: doc.id, userId: "user_c", tier: "edit" });
    assert.equal(denied.ok, false);
    const perms = call("getPermissions", ctxA, { docId: doc.id });
    assert.equal(perms.ok, true);
    assert.equal(perms.result.entries.length, 1);
  });

  it("a view-tier user cannot apply an edit op", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("setPermission", ctxA, { docId: doc.id, isDefault: true, tier: "view" });
    const r = call("docOp", ctxB, { docId: doc.id, type: "insert", pos: 0, text: "x", lamport: 0 });
    assert.equal(r.ok, false);
    assert.match(r.error, /permission denied/);
  });

  it("an edit-tier grant lets a collaborator co-edit", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("setPermission", ctxA, { docId: doc.id, userId: "user_b", tier: "edit" });
    const r = call("docOp", ctxB, { docId: doc.id, type: "insert", pos: 0, text: "ok", lamport: 0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.text, "ok");
  });
});

// ── Comments — @-mentions, threads, per-element pins, notifications ──────────

describe("collab comments + @-mentions + notifications", () => {
  it("addComment extracts @-mentions and pushes a notification", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    const c = call("addComment", ctxA, { docId: doc.id, text: "ping @user_b take a look" });
    assert.equal(c.ok, true);
    assert.deepEqual(c.result.comment.mentions, ["user_b"]);
    const notif = call("notifications", ctxB, {});
    assert.equal(notif.ok, true);
    assert.ok(notif.result.unread >= 1);
    assert.equal(notif.result.notifications[0].kind, "mention");
  });

  it("threaded replies notify the parent author", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("setPermission", ctxA, { docId: doc.id, userId: "user_b", tier: "comment" });
    const top = call("addComment", ctxA, { docId: doc.id, text: "what about caching?" });
    const reply = call("addComment", ctxB, { docId: doc.id, parentId: top.result.comment.id, text: "agreed" });
    assert.equal(reply.ok, true);
    assert.equal(reply.result.comment.threadId, top.result.comment.threadId);
    const notif = call("notifications", ctxA, {});
    assert.ok(notif.result.notifications.some((n) => n.kind === "reply"));
  });

  it("per-element pins are filterable", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("addComment", ctxA, { docId: doc.id, text: "general note" });
    call("addComment", ctxA, { docId: doc.id, text: "pinned note", elementId: "block-7" });
    const pins = call("listComments", ctxA, { docId: doc.id, pinsOnly: true, includeResolved: true });
    assert.equal(pins.ok, true);
    assert.equal(pins.result.comments.length, 1);
    assert.equal(pins.result.comments[0].elementId, "block-7");
  });

  it("resolveThread resolves and re-opens a thread", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    const c = call("addComment", ctxA, { docId: doc.id, text: "needs work" });
    const tid = c.result.comment.threadId;
    const resolved = call("resolveThread", ctxA, { docId: doc.id, threadId: tid });
    assert.equal(resolved.ok, true);
    assert.equal(resolved.result.resolved, true);
    const reopened = call("resolveThread", ctxA, { docId: doc.id, threadId: tid, reopen: true });
    assert.equal(reopened.result.resolved, false);
  });

  it("markNotificationRead clears the unread count", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("addComment", ctxA, { docId: doc.id, text: "@user_b hey" });
    let notif = call("notifications", ctxB, {});
    assert.ok(notif.result.unread >= 1);
    const mark = call("markNotificationRead", ctxB, { all: true });
    assert.equal(mark.ok, true);
    notif = call("notifications", ctxB, {});
    assert.equal(notif.result.unread, 0);
  });

  it("a view-tier user cannot comment", () => {
    const doc = call("docCreate", ctxA, { title: "T", text: "" }).result;
    call("setPermission", ctxA, { docId: doc.id, isDefault: true, tier: "view" });
    const r = call("addComment", ctxB, { docId: doc.id, text: "blocked" });
    assert.equal(r.ok, false);
    assert.match(r.error, /permission denied/);
  });
});
