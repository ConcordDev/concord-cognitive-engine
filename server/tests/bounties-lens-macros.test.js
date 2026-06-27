// Behavioral macro tests for server/domains/bounties.js — the Gitcoin /
// HackerOne-parity bounty platform that backs /lenses/bounties (the "Bounty
// board" surface). The legacy `bounty` autofix-staking domain lives in
// server.js and is NOT exercised here.
//
// LIGHTWEIGHT + hermetic: drives the registered macros the way runMacro would
// (a `(ctx, _a, params)` call) against the REAL in-memory
// globalThis._concordSTATE.bountiesLens store. NO server boot, NO network, NO
// LLM, NO DB needed (this domain is a pure in-memory STATE model). These are
// NOT shape-only assertions — every test asserts ACTUAL values + multi-step
// round-trips: post → list shows it; submit → review accept → reward pays out
// the REAL amount; milestone partial payout; idempotency; per-user earnings;
// and the fail-CLOSED numeric guard that stops a poisoned reward minting CC.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBountiesActions from "../domains/bounties.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "bounties", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// The bounties domain registers `(ctx, _a, params)` handlers — mirror runMacro.
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`bounties.${name} not registered`);
  return fn(ctx, null, params);
}

before(() => { registerBountiesActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxOwner = { actor: { userId: "owner_1" } };
const ctxClaimant = { actor: { userId: "claimant_1" } };
const ctxOther = { actor: { userId: "other_1" } };

describe("bounties — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "create", "list", "get", "submit", "review",
      "release-milestone", "dispute-open", "dispute-resolve",
      "leaderboard", "my-activity",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing bounties.${m}`);
    }
  });
});

describe("bounties — post → list round-trip", () => {
  it("creates a bounty that then shows on the board with the real pool", () => {
    const created = call("create", ctxOwner, {
      title: "Fix the auth bug",
      description: "Sessions drop on refresh; needs a real repro + patch.",
      category: "security",
      difficulty: "advanced",
      tags: "auth, sessions",
      rewardCc: 250,
    });
    assert.equal(created.ok, true);
    const b = created.result.bounty;
    assert.equal(b.title, "Fix the auth bug");
    assert.equal(b.category, "security");
    assert.equal(b.difficulty, "advanced");
    assert.equal(b.rewardCc, 250);
    assert.equal(b.poolCc, 250);
    assert.equal(b.paidCc, 0);
    assert.equal(b.status, "open");
    assert.deepEqual(b.tags, ["auth", "sessions"]);

    const listed = call("list", ctxOther, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.bounties[0].id, b.id);
    assert.equal(listed.result.bounties[0].poolCc, 250);

    const got = call("get", ctxOther, { bountyId: b.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.bounty.id, b.id);
  });

  it("filters by category, difficulty, tag and free-text query", () => {
    call("create", ctxOwner, { title: "Security patch one", description: "do the thing here", category: "security", difficulty: "expert", tags: "crypto", rewardCc: 10 });
    call("create", ctxOwner, { title: "Docs cleanup task", description: "rewrite the readme please", category: "docs", difficulty: "beginner", tags: "markdown", rewardCc: 5 });

    assert.equal(call("list", ctxOther, { category: "security" }).result.total, 1);
    assert.equal(call("list", ctxOther, { difficulty: "beginner" }).result.total, 1);
    assert.equal(call("list", ctxOther, { tag: "crypto" }).result.total, 1);
    assert.equal(call("list", ctxOther, { query: "readme" }).result.total, 1);
    assert.equal(call("list", ctxOther, { category: "feature" }).result.total, 0);
  });

  it("sorts by reward descending", () => {
    call("create", ctxOwner, { title: "Small bounty here", description: "tiny reward value", rewardCc: 5 });
    call("create", ctxOwner, { title: "Large bounty here", description: "big reward value", rewardCc: 500 });
    const sorted = call("list", ctxOther, { sortBy: "reward" });
    assert.equal(sorted.result.bounties[0].rewardCc, 500);
    assert.equal(sorted.result.bounties[1].rewardCc, 5);
  });
});

describe("bounties — submit → review → payout pays the REAL amount, mints no money", () => {
  it("accepts a submission and credits the claimant exactly the pool", () => {
    const b = call("create", ctxOwner, {
      title: "Whole bounty payout",
      description: "single accept pays the full pool",
      rewardCc: 300,
    }).result.bounty;

    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "Here is my working fix", link: "https://x" });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.bounty.status, "claimed");
    const submissionId = sub.result.submission.id;

    // Owner accepts → full pool pays out to the claimant, status -> paid.
    const rev = call("review", ctxOwner, { bountyId: b.id, submissionId, decision: "accept" });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.paidCc, 300, "must pay the REAL pool amount");
    assert.equal(rev.result.currency, "CC");
    assert.equal(rev.result.bounty.status, "paid");
    assert.equal(rev.result.bounty.paidCc, 300);

    // Earnings ledger credits exactly the claimant, not the owner.
    const claimantActivity = call("my-activity", ctxClaimant, {});
    assert.equal(claimantActivity.result.earnedCc, 300);
    const ownerActivity = call("my-activity", ctxOwner, {});
    assert.equal(ownerActivity.result.earnedCc, 0, "owner must not be credited");
    assert.equal(ownerActivity.result.resolvedCount, 1);

    // Leaderboard reflects exactly one earner of 300 CC — nothing minted extra.
    const lb = call("leaderboard", ctxOther, {});
    assert.equal(lb.result.topEarners.length, 1);
    assert.equal(lb.result.topEarners[0].userId, "claimant_1");
    assert.equal(lb.result.topEarners[0].earnedCc, 300);
  });

  it("rejecting a submission pays nothing", () => {
    const b = call("create", ctxOwner, { title: "Reject this work", description: "owner will reject the work", rewardCc: 100 }).result.bounty;
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "incomplete work here" });
    const rev = call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "reject" });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.submission.status, "rejected");
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 0);
  });

  it("milestone-scoped accept pays only that milestone; full clearing flips to paid", () => {
    const b = call("create", ctxOwner, {
      title: "Two milestone bounty",
      description: "partial payouts across two milestones",
      milestones: [
        { title: "Phase 1", rewardCc: 40 },
        { title: "Phase 2", rewardCc: 60 },
      ],
    }).result.bounty;
    assert.equal(b.poolCc, 100, "pool is the sum of milestone rewards");
    assert.equal(b.rewardCc, 100);
    const ms1 = b.milestones[0].id;
    const ms2 = b.milestones[1].id;

    const sub1 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase one", milestoneId: ms1 });
    const rev1 = call("review", ctxOwner, { bountyId: b.id, submissionId: sub1.result.submission.id, decision: "accept" });
    assert.equal(rev1.result.paidCc, 40, "only the milestone reward pays");
    assert.equal(rev1.result.bounty.status, "in_review");
    assert.equal(rev1.result.bounty.paidCc, 40);

    const sub2 = call("submit", ctxClaimant, { bountyId: b.id, summary: "did phase two", milestoneId: ms2 });
    const rev2 = call("review", ctxOwner, { bountyId: b.id, submissionId: sub2.result.submission.id, decision: "accept" });
    assert.equal(rev2.result.paidCc, 60);
    assert.equal(rev2.result.bounty.status, "paid");
    assert.equal(rev2.result.bounty.paidCc, 100);

    // Total credited = 100, never more.
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 100);
  });

  it("release-milestone pays the named claimant the real milestone amount", () => {
    const b = call("create", ctxOwner, {
      title: "Direct milestone release",
      description: "owner releases a milestone directly",
      milestones: [{ title: "Only phase", rewardCc: 75 }],
    }).result.bounty;
    const rel = call("release-milestone", ctxOwner, { bountyId: b.id, milestoneId: b.milestones[0].id, claimantId: "claimant_1" });
    assert.equal(rel.ok, true);
    assert.equal(rel.result.paidCc, 75);
    assert.equal(rel.result.bounty.status, "paid");
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 75);
  });
});

describe("bounties — authorization + idempotency guards", () => {
  it("owner cannot submit to own bounty; non-owner cannot review", () => {
    const b = call("create", ctxOwner, { title: "Authz checks here", description: "exercise auth gating now", rewardCc: 50 }).result.bounty;
    assert.equal(call("submit", ctxOwner, { bountyId: b.id, summary: "self submission attempt" }).ok, false);
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "legit submission here" });
    assert.equal(call("review", ctxOther, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" }).ok, false);
  });

  it("a milestone cannot be paid twice (idempotent payout)", () => {
    const b = call("create", ctxOwner, {
      title: "Double pay guard",
      description: "milestone must not pay twice",
      milestones: [{ title: "Phase", rewardCc: 90 }],
    }).result.bounty;
    const msId = b.milestones[0].id;
    const r1 = call("release-milestone", ctxOwner, { bountyId: b.id, milestoneId: msId, claimantId: "claimant_1" });
    assert.equal(r1.ok, true);
    const r2 = call("release-milestone", ctxOwner, { bountyId: b.id, milestoneId: msId, claimantId: "claimant_1" });
    assert.equal(r2.ok, false, "second release must be rejected");
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 90, "credited exactly once");
  });

  it("re-reviewing an already-decided submission is rejected", () => {
    const b = call("create", ctxOwner, { title: "Re-review guard", description: "cannot re-review a decided sub", rewardCc: 30 }).result.bounty;
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "submission to accept" });
    call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" });
    const again = call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" });
    assert.equal(again.ok, false, "no double payout via re-review");
    assert.equal(call("my-activity", ctxClaimant, {}).result.earnedCc, 30);
  });
});

describe("bounties — fail-CLOSED numeric guard (no fabricated CC)", () => {
  it("rejects a poisoned rewardCc (1e308) instead of minting an absurd pool", () => {
    const r = call("create", ctxOwner, {
      title: "Poisoned reward attempt",
      description: "1e308 must not become a real pool",
      rewardCc: 1e308,
    });
    assert.equal(r.ok, false, "poisoned reward must be rejected");
    assert.match(r.error, /numeric field/);
    // Nothing was created.
    assert.equal(call("list", ctxOther, {}).result.total, 0);
  });

  it("rejects NaN / negative / over-cap rewards", () => {
    for (const bad of [NaN, "not-a-number", -5, 2e6, Infinity]) {
      const r = call("create", ctxOwner, { title: "Reward guard probe", description: "bad numeric reward probe", rewardCc: bad });
      assert.equal(r.ok, false, `rewardCc=${bad} must reject`);
    }
    assert.equal(call("list", ctxOther, {}).result.total, 0);
  });

  it("rejects a poisoned milestone rewardCc", () => {
    const r = call("create", ctxOwner, {
      title: "Poisoned milestone reward",
      description: "milestone with poisoned reward must reject",
      milestones: [{ title: "ok", rewardCc: 10 }, { title: "bad", rewardCc: 1e308 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /milestones\[1\]/);
    assert.equal(call("list", ctxOther, {}).result.total, 0);
  });

  it("a clean reward still works (guard does not over-reject)", () => {
    const r = call("create", ctxOwner, { title: "Clean reward path", description: "a normal reward still works", rewardCc: 1000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.bounty.rewardCc, 1000);
  });
});

describe("bounties — dispute flow", () => {
  it("opens and resolves a dispute (overturn reopens the bounty)", () => {
    const b = call("create", ctxOwner, { title: "Dispute lifecycle", description: "owner and claimant dispute outcome", rewardCc: 120 }).result.bounty;
    const sub = call("submit", ctxClaimant, { bountyId: b.id, summary: "the disputed work" });
    call("review", ctxOwner, { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" });

    const disp = call("dispute-open", ctxClaimant, { bountyId: b.id, reason: "Owner paid the wrong person entirely" });
    assert.equal(disp.ok, true);
    assert.equal(disp.result.bounty.status, "disputed");

    const res = call("dispute-resolve", ctxOther, { bountyId: b.id, ruling: "overturn", rulingNote: "reopen it" });
    assert.equal(res.ok, true);
    assert.equal(res.result.dispute.ruling, "overturn");
    assert.equal(res.result.bounty.status, "claimed");
    assert.equal(res.result.bounty.acceptedSubmissionId, null);
  });

  it("rejects a dispute from an uninvolved user", () => {
    const b = call("create", ctxOwner, { title: "Uninvolved dispute", description: "stranger cannot dispute this", rewardCc: 20 }).result.bounty;
    assert.equal(call("dispute-open", ctxOther, { bountyId: b.id, reason: "I want to meddle in this" }).ok, false);
  });
});

describe("bounties — per-user isolation", () => {
  it("my-activity only shows the caller's own posted bounties", () => {
    call("create", ctxOwner, { title: "Owner one bounty", description: "posted by owner one here", rewardCc: 10 });
    call("create", ctxOther, { title: "Other one bounty", description: "posted by other one here", rewardCc: 10 });
    assert.equal(call("my-activity", ctxOwner, {}).result.posted.length, 1);
    assert.equal(call("my-activity", ctxOther, {}).result.posted.length, 1);
    // But the board is cross-user.
    assert.equal(call("list", ctxOwner, {}).result.total, 2);
  });
});
