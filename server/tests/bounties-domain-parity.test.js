// Contract tests for server/domains/bounties.js — the Gitcoin / HackerOne
// parity bounty platform (create / submit / review / milestones / disputes /
// leaderboard / search). Every macro must return an `ok` envelope and never
// throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBountiesActions from "../domains/bounties.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`bounties.${name}`);
  if (!fn) throw new Error(`bounties.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerBountiesActions(register); });

beforeEach(() => {
  // fresh STATE per test so bounties don't leak across cases
  globalThis._concordSTATE = {};
});

const owner = { actor: { userId: "owner_1" }, userId: "owner_1" };
const claimant = { actor: { userId: "claimant_1" }, userId: "claimant_1" };
const arbiter = { actor: { userId: "arbiter_1" }, userId: "arbiter_1" };

function makeBounty(ctx = owner, extra = {}) {
  const r = call("create", ctx, {
    title: "Fix the auth race condition",
    description: "There is a race in the login path that needs a real fix.",
    category: "bug",
    difficulty: "advanced",
    tags: "auth, race, security",
    rewardCc: 250,
    ...extra,
  });
  assert.equal(r.ok, true, r.error);
  return r.result.bounty;
}

describe("bounties.create", () => {
  it("creates a custom bounty with category/tags/difficulty", () => {
    const b = makeBounty();
    assert.equal(b.category, "bug");
    assert.equal(b.difficulty, "advanced");
    assert.equal(b.rewardCc, 250);
    assert.equal(b.poolCc, 250);
    assert.equal(b.status, "open");
    assert.deepEqual(b.tags.sort(), ["auth", "race", "security"]);
  });

  it("rejects short titles", () => {
    const r = call("create", owner, { title: "x", description: "long enough description" });
    assert.equal(r.ok, false);
  });

  it("derives reward pool from milestones", () => {
    const r = call("create", owner, {
      title: "Milestone bounty here",
      description: "Three staged deliverables for this bounty.",
      milestones: [
        { title: "Phase 1", rewardCc: 50 },
        { title: "Phase 2", rewardCc: 100 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.bounty.poolCc, 150);
    assert.equal(r.result.bounty.milestones.length, 2);
  });
});

describe("bounties.list (search / filter / sort)", () => {
  it("filters by category and searches by query", () => {
    makeBounty(owner, { title: "Bug fix one", category: "bug" });
    makeBounty(owner, { title: "Add dark mode feature", category: "feature" });
    const byCat = call("list", owner, { category: "feature" });
    assert.equal(byCat.ok, true);
    assert.equal(byCat.result.bounties.length, 1);
    const byQuery = call("list", owner, { query: "dark mode" });
    assert.equal(byQuery.result.bounties.length, 1);
  });

  it("sorts by reward", () => {
    makeBounty(owner, { title: "Cheap bounty here", rewardCc: 10 });
    makeBounty(owner, { title: "Expensive bounty here", rewardCc: 9000 });
    const r = call("list", owner, { sortBy: "reward" });
    assert.equal(r.result.bounties[0].rewardCc, 9000);
  });
});

describe("bounties.get", () => {
  it("reads a single bounty", () => {
    const b = makeBounty();
    const r = call("get", owner, { bountyId: b.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.bounty.id, b.id);
  });
  it("404s for unknown id", () => {
    const r = call("get", owner, { bountyId: "nope" });
    assert.equal(r.ok, false);
  });
});

describe("bounties.submit", () => {
  it("a claimant submits work against a bounty", () => {
    const b = makeBounty();
    const r = call("submit", claimant, {
      bountyId: b.id, summary: "Patched the race with a mutex", link: "https://example.com/pr/1",
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.submission.status, "pending");
    assert.equal(r.result.bounty.status, "claimed");
  });

  it("rejects the owner submitting to their own bounty", () => {
    const b = makeBounty();
    const r = call("submit", owner, { bountyId: b.id, summary: "owner work" });
    assert.equal(r.ok, false);
  });
});

describe("bounties.review (acceptance workflow + payout)", () => {
  it("accepting a submission pays the claimant and resolves the bounty", () => {
    const b = makeBounty();
    const sub = call("submit", claimant, { bountyId: b.id, summary: "Real fix delivered" }).result.submission;
    const r = call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "accept" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.paidCc, 250);
    assert.equal(r.result.bounty.status, "paid");
  });

  it("rejecting a submission leaves the bounty unpaid", () => {
    const b = makeBounty();
    const sub = call("submit", claimant, { bountyId: b.id, summary: "Incomplete work" }).result.submission;
    const r = call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "reject" });
    assert.equal(r.ok, true);
    assert.equal(r.result.submission.status, "rejected");
    assert.notEqual(r.result.bounty.status, "paid");
  });

  it("non-owners cannot review", () => {
    const b = makeBounty();
    const sub = call("submit", claimant, { bountyId: b.id, summary: "Some work here" }).result.submission;
    const r = call("review", claimant, { bountyId: b.id, submissionId: sub.id, decision: "accept" });
    assert.equal(r.ok, false);
  });
});

describe("bounties.release-milestone (partial payouts)", () => {
  it("releases a single milestone's reward", () => {
    const b = call("create", owner, {
      title: "Staged delivery bounty",
      description: "Two milestones to release independently.",
      milestones: [{ title: "M1", rewardCc: 40 }, { title: "M2", rewardCc: 60 }],
    }).result.bounty;
    const m1 = b.milestones[0];
    const r = call("release-milestone", owner, {
      bountyId: b.id, milestoneId: m1.id, claimantId: "claimant_1",
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.paidCc, 40);
    assert.equal(r.result.bounty.status, "in_review");
    assert.equal(r.result.bounty.paidCc, 40);
  });
});

describe("bounties.dispute-open / dispute-resolve", () => {
  it("an involved party opens a dispute and an arbiter resolves it", () => {
    const b = makeBounty();
    call("submit", claimant, { bountyId: b.id, summary: "Disputed work here" });
    const opened = call("dispute-open", claimant, {
      bountyId: b.id, reason: "The reviewer ignored my accepted submission entirely.",
    });
    assert.equal(opened.ok, true, opened.error);
    assert.equal(opened.result.bounty.status, "disputed");

    const resolved = call("dispute-resolve", arbiter, {
      bountyId: b.id, ruling: "overturn", rulingNote: "Submission was valid.",
    });
    assert.equal(resolved.ok, true, resolved.error);
    assert.equal(resolved.result.dispute.status, "resolved");
    assert.equal(resolved.result.dispute.ruling, "overturn");
  });

  it("rejects disputes from uninvolved users", () => {
    const b = makeBounty();
    const r = call("dispute-open", arbiter, { bountyId: b.id, reason: "I am not involved at all here." });
    assert.equal(r.ok, false);
  });
});

describe("bounties.leaderboard", () => {
  it("ranks top earners after a payout", () => {
    const b = makeBounty();
    const sub = call("submit", claimant, { bountyId: b.id, summary: "Earner work done" }).result.submission;
    call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "accept" });
    const r = call("leaderboard", owner, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.topEarners));
    assert.equal(r.result.topEarners[0].userId, "claimant_1");
    assert.equal(r.result.topEarners[0].earnedCc, 250);
    assert.equal(r.result.topResolvers[0].userId, "owner_1");
  });
});

describe("bounties.my-activity", () => {
  it("returns posted bounties + submissions + earnings for the actor", () => {
    const b = makeBounty();
    call("submit", claimant, { bountyId: b.id, summary: "My submission here" });
    const ownerView = call("my-activity", owner, {});
    assert.equal(ownerView.ok, true);
    assert.equal(ownerView.result.posted.length, 1);
    const claimantView = call("my-activity", claimant, {});
    assert.equal(claimantView.result.submitted.length, 1);
  });
});

describe("bounties — never throws", () => {
  it("all macros return an ok envelope even with empty params", () => {
    for (const name of ["create", "list", "get", "submit", "review",
      "release-milestone", "dispute-open", "dispute-resolve", "leaderboard", "my-activity"]) {
      const r = call(name, owner, {});
      assert.equal(typeof r.ok, "boolean", `${name} did not return an ok boolean`);
    }
  });
});
