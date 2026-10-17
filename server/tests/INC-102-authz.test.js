// server/tests/INC-102-authz.test.js
//
// Regression pins for INC-102 — Bounties dispute resolution authority.
// Any logged-in user could resolve a bounty dispute and become the recorded
// arbiter. Only admins/moderators (or an explicitly assigned neutral arbiter)
// may resolve disputes; parties to the dispute are barred from arbitrating.
//
// Run:
//   cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/INC-102-authz.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBountiesActions from "../domains/bounties.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "bounties", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`bounties.${name} not registered`);
  return fn(ctx, null, params);
}

before(() => { registerBountiesActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxOwner = { actor: { userId: "owner_1" } };
const ctxClaimant = { actor: { userId: "claimant_1" } };
const ctxBystander = { actor: { userId: "bystander_1" } };
const ctxAdmin = { actor: { userId: "admin_1", role: "admin" } };
const ctxModerator = { actor: { userId: "mod_1", role: "moderator" } };
const ctxAnon = { actor: { userId: "anon" } };
const ctxNoActor = {};

function seedDispute() {
  const b = call("create", ctxOwner, {
    title: "Disputed bounty authz",
    description: "A bounty used to verify dispute arbitration authorization.",
    rewardCc: 100,
  }).result.bounty;

  const sub = call("submit", ctxClaimant, {
    bountyId: b.id,
    summary: "My solution to the disputed problem",
  }).result.submission;

  call("review", ctxOwner, {
    bountyId: b.id,
    submissionId: sub.id,
    decision: "accept",
  });

  call("dispute-open", ctxClaimant, {
    bountyId: b.id,
    reason: "The accepted solution does not meet the requirements.",
  });

  return { b, sub };
}

describe("INC-102 — dispute-resolve authorization", () => {
  it("rejects a non-party, non-admin bystander and leaves the dispute open", () => {
    const { b } = seedDispute();
    const before = call("get", ctxOwner, { bountyId: b.id }).result.bounty;

    const r = call("dispute-resolve", ctxBystander, {
      bountyId: b.id,
      ruling: "overturn",
      rulingNote: "I want to meddle",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.status, before.status);
    assert.equal(after.dispute.arbiterId, undefined);
  });

  it("rejects the bounty owner and leaves the dispute open", () => {
    const { b } = seedDispute();
    const before = call("get", ctxOwner, { bountyId: b.id }).result.bounty;

    const r = call("dispute-resolve", ctxOwner, {
      bountyId: b.id,
      ruling: "overturn",
      rulingNote: "I own this so I decide",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.status, before.status);
    assert.equal(after.dispute.arbiterId, undefined);
  });

  it("rejects a claimant and leaves the dispute open", () => {
    const { b } = seedDispute();
    const before = call("get", ctxOwner, { bountyId: b.id }).result.bounty;

    const r = call("dispute-resolve", ctxClaimant, {
      bountyId: b.id,
      ruling: "uphold",
      rulingNote: "I submitted so I decide",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.status, before.status);
    assert.equal(after.dispute.arbiterId, undefined);
  });

  it("rejects anonymous and leaves the dispute open", () => {
    const { b } = seedDispute();
    const before = call("get", ctxOwner, { bountyId: b.id }).result.bounty;

    const r = call("dispute-resolve", ctxAnon, {
      bountyId: b.id,
      ruling: "split",
      rulingNote: "anonymous ruling",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.status, before.status);
    assert.equal(after.dispute.arbiterId, undefined);
  });

  it("rejects a caller with no actor context and leaves the dispute open", () => {
    const { b } = seedDispute();
    const before = call("get", ctxOwner, { bountyId: b.id }).result.bounty;

    const r = call("dispute-resolve", ctxNoActor, {
      bountyId: b.id,
      ruling: "split",
      rulingNote: "no actor context",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.status, before.status);
    assert.equal(after.dispute.arbiterId, undefined);
  });

  it("allows an admin to resolve and records them as arbiter", () => {
    const { b, sub } = seedDispute();
    const r = call("dispute-resolve", ctxAdmin, {
      bountyId: b.id,
      ruling: "overturn",
      rulingNote: "Reopening for fair review.",
    });

    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.dispute.status, "resolved");
    assert.equal(r.result.dispute.ruling, "overturn");
    assert.equal(r.result.dispute.arbiterId, "admin_1");
    assert.equal(r.result.bounty.status, "claimed");
    assert.equal(r.result.bounty.acceptedSubmissionId, null);

    // The original submission should still exist and be accepted; only the
    // acceptedSubmissionId pointer was cleared by overturn.
    const stillSubmitted = r.result.bounty.submissions.find((x) => x.id === sub.id);
    assert.ok(stillSubmitted);
    assert.equal(stillSubmitted.status, "accepted");
  });

  it("allows a moderator to resolve and records them as arbiter", () => {
    const { b } = seedDispute();
    const r = call("dispute-resolve", ctxModerator, {
      bountyId: b.id,
      ruling: "uphold",
      rulingNote: "Submission was valid.",
    });

    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.dispute.status, "resolved");
    assert.equal(r.result.dispute.ruling, "uphold");
    assert.equal(r.result.dispute.arbiterId, "mod_1");
    assert.equal(r.result.bounty.status, "paid");
  });

  it("rejects an admin who is also the owner (party bar)", () => {
    const ctxOwnerAdmin = { actor: { userId: "owner_1", role: "admin" } };
    const b = call("create", ctxOwner, {
      title: "Owner-admin dispute",
      description: "Owner is also admin but should not arbitrate own dispute.",
      rewardCc: 100,
    }).result.bounty;

    call("submit", ctxClaimant, { bountyId: b.id, summary: "work by claimant" });
    call("dispute-open", ctxClaimant, { bountyId: b.id, reason: "I dispute this bounty." });

    const r = call("dispute-resolve", ctxOwnerAdmin, {
      bountyId: b.id,
      ruling: "overturn",
      rulingNote: "I am admin owner",
    });

    assert.equal(r.ok, false);
    const after = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(after.dispute.status, "open");
    assert.equal(after.dispute.arbiterId, undefined);
  });
});
