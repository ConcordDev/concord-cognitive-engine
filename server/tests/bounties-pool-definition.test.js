// Pool-definition tests for server/domains/bounties.js — Group B B9
// (the Bounties pair), founder-ruled 2026-11-05: THE POOL COUNTS THE
// UNPAID REMAINDER ONLY (superseding the §8 Q2 full-total semantics).
//
// Pins, against the real domain macros in the shipped harness shape:
//   - a milestone bounty's pool drops by each paid milestone;
//   - review's whole-accept still pays the FULL pool (it reads poolFor
//     before its status flip) — the redefinition must not short a payout;
//   - a paid plain bounty's pool is 0 while its paidCc keeps the record;
//   - a disputed bounty's unpaid remainder stays in its pool;
//   - list rows carry the restated pool (the figure the header sums).
// (poolFor also returns 0 for the terminal 'cancelled'/'resolved'
// statuses in paidFor's existing vocabulary; no macro sets them on a
// bounty at this commit, so they are not macro-pinned here.)

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

function milestoneBounty() {
  return call("create", ctxOwner, {
    title: "Two milestone bounty",
    description: "partial payouts across two milestones",
    milestones: [
      { title: "Phase 1", rewardCc: 40 },
      { title: "Phase 2", rewardCc: 60 },
    ],
  }).result.bounty;
}

describe("bounties — pool counts the unpaid remainder only (ruled definition)", () => {
  it("a milestone pool drops by each paid milestone", () => {
    const b = milestoneBounty();
    assert.equal(b.poolCc, 100, "at creation nothing is paid: pool = the full remainder");
    const sub1 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase one", milestoneId: b.milestones[0].id });
    const rev1 = call("review", ctxOwner, { bountyId: b.id, submissionId: sub1.result.submission.id, decision: "accept" });
    assert.equal(rev1.result.paidCc, 40);
    assert.equal(rev1.result.bounty.poolCc, 60, "pool = the unpaid remainder after milestone 1 pays");
    assert.equal(rev1.result.bounty.paidCc, 40, "the paid side of the ledger does not move");

    const sub2 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase two", milestoneId: b.milestones[1].id });
    const rev2 = call("review", ctxOwner, { bountyId: b.id, submissionId: sub2.result.submission.id, decision: "accept" });
    assert.equal(rev2.result.bounty.status, "paid");
    assert.equal(rev2.result.bounty.poolCc, 0, "fully paid: nothing remains in the pool");
    assert.equal(rev2.result.bounty.paidCc, 100);
  });

  it("a whole-accept still pays the FULL pool under the new definition", () => {
    // A milestone bounty accepted through one unscoped submission: the
    // review handler computes paid = poolFor(b) BEFORE flipping status
    // or marking milestones — the payout must be the whole 100, not a
    // remainder computed after the fact.
    const b = milestoneBounty();
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "did everything at once" });
    const rev = call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" });
    assert.equal(rev.result.paidCc, 100, "whole-accept pays the full pool");
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 100);
    assert.equal(rev.result.bounty.poolCc, 0);
  });

  it("a paid plain bounty's pool is 0; its paidCc keeps the record", () => {
    const b = call("create", ctxOwner, {
      title: "Plain bounty here", description: "single-shot payout work", rewardCc: 250,
    }).result.bounty;
    assert.equal(b.poolCc, 250);
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "done the work" });
    const rev = call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" });
    assert.equal(rev.result.paidCc, 250);
    assert.equal(rev.result.bounty.poolCc, 0);
    assert.equal(rev.result.bounty.paidCc, 250);
  });

  it("a disputed bounty's unpaid remainder stays in its pool", () => {
    const b = milestoneBounty();
    const sub1 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase one", milestoneId: b.milestones[0].id });
    call("review", ctxOwner, { bountyId: b.id, submissionId: sub1.result.submission.id, decision: "accept" });
    const sub2 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase two", milestoneId: b.milestones[1].id });
    call("review", ctxOwner, { bountyId: b.id, submissionId: sub2.result.submission.id, decision: "reject" });
    const opened = call("dispute-open", ctxClaimant, { bountyId: b.id, reason: "phase two was delivered in full" });
    assert.equal(opened.ok, true);
    const view = call("get", ctxOwner, { bountyId: b.id }).result.bounty;
    assert.equal(view.status, "disputed");
    assert.equal(view.poolCc, 60, "the held, unpaid remainder stays in the pool; the paid milestone is out");
    assert.equal(view.paidCc, 40);
  });

  it("the board list carries the restated pool (the figure the header sums)", () => {
    const b = milestoneBounty();
    const sub1 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase one", milestoneId: b.milestones[0].id });
    call("review", ctxOwner, { bountyId: b.id, submissionId: sub1.result.submission.id, decision: "accept" });
    const listed = call("list", ctxOwner, {}).result.bounties.find((x) => x.id === b.id);
    assert.equal(listed.poolCc, 60, "list rows pool the unpaid remainder — OPEN POOL restates by construction");
    assert.equal(listed.paidCc, 40);
  });
});
