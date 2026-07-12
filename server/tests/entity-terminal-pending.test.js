// Regression test for the "council-vote approval queue has no listing
// mechanism" gap (Wave 4 gap-closure, docs/WAVE4_INVENTORY.md, entity lens).
//
// entity.terminal_approve (server.js) lets a reviewer vote on a pending
// terminal-execution proposal by exact id, but until this fix there was no
// way to discover which proposals were pending in the first place —
// STATE.queues.terminalRequests was write-only (pushed by entity.terminal,
// searched by id by entity.terminal_approve). entity.terminal_pending is a
// new READ-ONLY macro that lists them; it does not touch votes, status, or
// execution — that logic lives entirely in the unmodified terminal_approve.
//
// This file pins two things:
//   1. ACL parity — entity.terminal_pending is governed by the exact same
//      MACRO_ACL rule as entity.terminal_approve for every role (both are
//      registered via the same two allowMacro(...) call sites, in the same
//      order, so whichever entry ends up load-bearing for terminal_approve
//      is load-bearing for terminal_pending too).
//   2. The listing macro's own behavior — pending-only filtering (FIFO
//      order), a bounded recent-history tail for resolved proposals, and an
//      honest vote tally / myVote projection — against fixture proposals
//      seeded directly into STATE.queues.terminalRequests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";

let _serverMod = null;
registerServerCleanExit(() => _serverMod?.__TEST__);

describe("entity.terminal_pending — ACL parity with entity.terminal_approve", () => {
  it("canRunMacro agrees for entity.terminal_pending and entity.terminal_approve across roles", async () => {
    const mod = await import("../server.js");
    _serverMod = mod;
    assert.ok(mod.__TEST__, "server.js must export __TEST__ for the harness");
    assert.equal(typeof globalThis.canRunMacro, "function", "canRunMacro must be installed on globalThis by server.js boot");

    const roleCases = [
      { role: "owner", scopes: ["*"] },
      { role: "admin", scopes: ["admin"] },
      { role: "admin", scopes: ["read"] }, // right role, wrong scope
      { role: "council", scopes: ["*"] },
      { role: "member", scopes: ["*"] },
      { role: "viewer", scopes: ["read"] },
    ];

    for (const { role, scopes } of roleCases) {
      const actor = { userId: "u-acl-probe", role, scopes };
      const forApprove = globalThis.canRunMacro(actor, "entity", "terminal_approve");
      const forPending = globalThis.canRunMacro(actor, "entity", "terminal_pending");
      assert.equal(
        forPending, forApprove,
        `role=${role} scopes=${JSON.stringify(scopes)}: terminal_pending (${forPending}) must match terminal_approve (${forApprove})`
      );
    }
  });

  it("a low-privilege, non-authenticated, non-HTTP caller is rejected identically by both macros", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;

    // Construct the one ctx shape under which runMacro's ACL branch actually
    // fires for a non-sovereign domain like "entity" (see server.js's own
    // comment on makeCtx: "the runMacro ACL check is skipped for HTTP
    // requests" — it only engages when the caller is neither authenticated
    // nor an HTTP/human request). No userId, no reqMeta, no internal flag.
    const lowPrivCtx = { state: __TEST__.STATE, actor: { role: "viewer", scopes: ["read"] } };

    await assert.rejects(
      () => __TEST__.runMacro("entity", "terminal_pending", {}, lowPrivCtx),
      /forbidden: entity\.terminal_pending/,
      "terminal_pending must reject a non-council caller the same way terminal_approve does"
    );
    await assert.rejects(
      () => __TEST__.runMacro("entity", "terminal_approve", { proposalId: "nope", vote: "approve" }, lowPrivCtx),
      /forbidden: entity\.terminal_approve/,
      "sanity check: terminal_approve rejects the identical ctx the same way"
    );
  });
});

describe("entity.terminal_pending — listing behavior", () => {
  it("returns only pending proposals (FIFO) plus a bounded, newest-first resolved history, with an honest vote tally", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    __TEST__.ensureQueues();

    const voterId = "u-reviewer-1";
    const fixtures = [
      {
        id: "prop-old-pending",
        type: "ENTITY_TERMINAL_REQUEST",
        entityId: "swarm-1",
        command: "npm install left-pad",
        riskLevel: "medium",
        status: "pending",
        createdAt: "2026-07-01T00:00:00.000Z",
        votes: {
          approve: [{ id: voterId, role: "admin", votedAt: "2026-07-01T00:05:00.000Z" }],
          deny: [],
          abstain: [{ id: "u-other", role: "council", votedAt: "2026-07-01T00:06:00.000Z" }],
        },
        threshold: 0.6,
      },
      {
        id: "prop-new-pending",
        type: "ENTITY_TERMINAL_REQUEST",
        entityId: "swarm-2",
        command: "rm -rf build/",
        riskLevel: "high",
        status: "pending",
        createdAt: "2026-07-05T00:00:00.000Z",
        votes: { approve: [], deny: [], abstain: [] },
        threshold: 0.75,
      },
      {
        id: "prop-approved",
        type: "ENTITY_TERMINAL_REQUEST",
        entityId: "swarm-3",
        command: "git pull",
        riskLevel: "medium",
        status: "approved",
        createdAt: "2026-07-03T00:00:00.000Z",
        approvedAt: "2026-07-03T00:10:00.000Z",
        votes: {
          approve: [
            { id: "u-a", role: "admin", votedAt: "2026-07-03T00:08:00.000Z" },
            { id: "u-b", role: "owner", votedAt: "2026-07-03T00:09:00.000Z" },
            { id: "u-c", role: "council", votedAt: "2026-07-03T00:09:30.000Z" },
          ],
          deny: [], abstain: [],
        },
        threshold: 0.6,
      },
      {
        id: "prop-denied",
        type: "ENTITY_TERMINAL_REQUEST",
        entityId: "swarm-4",
        command: "npm start",
        riskLevel: "high",
        status: "denied",
        createdAt: "2026-07-04T00:00:00.000Z",
        deniedAt: "2026-07-04T00:10:00.000Z",
        votes: { approve: [], deny: [{ id: "u-x", role: "admin", votedAt: "2026-07-04T00:09:00.000Z" }], abstain: [] },
        threshold: 0.75,
      },
    ];
    // Deterministic slate: replace whatever the queue held (a clean seed,
    // same pattern other STATE-seeding tests in this suite use).
    __TEST__.STATE.queues.terminalRequests = fixtures;

    const ctx = __TEST__.makeInternalCtx("terminal-pending-test");
    ctx.actor.userId = voterId; // exercise the myVote projection for a real voter
    const r = await __TEST__.runMacro("entity", "terminal_pending", {}, ctx);

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(Array.isArray(r.pending));
    assert.ok(Array.isArray(r.recentHistory));

    // Only the two "pending" fixtures show up, oldest first (FIFO review order).
    assert.deepEqual(r.pending.map(p => p.id), ["prop-old-pending", "prop-new-pending"]);

    // Resolved fixtures show up in recentHistory, newest first, never in pending.
    assert.deepEqual(r.recentHistory.map(p => p.id), ["prop-denied", "prop-approved"]);
    assert.ok(!r.recentHistory.some(p => p.status === "pending"));

    // Shape + honest vote tally + myVote for the seeded voter.
    const oldPending = r.pending.find(p => p.id === "prop-old-pending");
    assert.equal(oldPending.command, "npm install left-pad");
    assert.equal(oldPending.riskLevel, "medium");
    assert.equal(oldPending.status, "pending");
    assert.deepEqual(oldPending.votes, { approve: 1, deny: 0, abstain: 1 });
    assert.equal(oldPending.myVote, "approve");

    const newPending = r.pending.find(p => p.id === "prop-new-pending");
    assert.deepEqual(newPending.votes, { approve: 0, deny: 0, abstain: 0 });
    assert.equal(newPending.myVote, null);

    const approved = r.recentHistory.find(p => p.id === "prop-approved");
    assert.equal(approved.status, "approved");
    assert.deepEqual(approved.votes, { approve: 3, deny: 0, abstain: 0 });
    assert.equal(approved.myVote, null); // voterId never voted on this one

    // Never leaks raw voter records (id/role/votedAt) — only counts. This
    // matters because raw votes[].id exposes other users' identities to
    // any caller who can list the queue.
    for (const p of [...r.pending, ...r.recentHistory]) {
      assert.equal(typeof p.votes.approve, "number");
      assert.equal(typeof p.votes.deny, "number");
      assert.equal(typeof p.votes.abstain, "number");
    }
  });

  it("caps recentHistory at 20 resolved proposals", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    __TEST__.ensureQueues();

    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `prop-hist-${i}`,
      entityId: "swarm-cap",
      command: "echo hi",
      riskLevel: "low",
      status: i % 2 === 0 ? "approved" : "denied",
      createdAt: new Date(2026, 0, 1 + i).toISOString(),
      votes: { approve: [], deny: [], abstain: [] },
      threshold: 0.6,
    }));
    __TEST__.STATE.queues.terminalRequests = many;

    const ctx = __TEST__.makeInternalCtx("terminal-pending-cap-test");
    const r = await __TEST__.runMacro("entity", "terminal_pending", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.pending.length, 0);
    assert.equal(r.recentHistory.length, 20);
    // newest first
    assert.equal(r.recentHistory[0].id, "prop-hist-24");
  });

  it("never creates, mutates, or executes anything — purely reads the queue", async () => {
    const mod = await import("../server.js");
    const __TEST__ = mod.__TEST__;
    __TEST__.ensureQueues();

    const before = [
      {
        id: "prop-untouched",
        entityId: "swarm-untouched",
        command: "cat README.md",
        riskLevel: "medium",
        status: "pending",
        createdAt: "2026-07-06T00:00:00.000Z",
        votes: { approve: [], deny: [], abstain: [] },
        threshold: 0.6,
      },
    ];
    __TEST__.STATE.queues.terminalRequests = before;
    const snapshotBefore = JSON.stringify(__TEST__.STATE.queues.terminalRequests);

    const ctx = __TEST__.makeInternalCtx("terminal-pending-readonly-test");
    await __TEST__.runMacro("entity", "terminal_pending", {}, ctx);

    const snapshotAfter = JSON.stringify(__TEST__.STATE.queues.terminalRequests);
    assert.equal(snapshotAfter, snapshotBefore, "terminal_pending must not mutate the queue");
  });
});
