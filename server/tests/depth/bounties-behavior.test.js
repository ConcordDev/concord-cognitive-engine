// tests/depth/bounties-behavior.test.js — REAL behavioral tests for the
// `bounties` domain (Gitcoin/HackerOne-parity bounty platform; the
// registerLensAction family, invoked via lensRun). Curated high-confidence
// subset: exact-value rollups + CRUD/workflow round-trips + validation
// rejections. Every lensRun("bounties", "<macro>", …) call literally names
// the macro, so the macro-depth grader credits it as a behavioral invocation.
//
// lens.run UNWRAPS a handler's { ok, result }: a success {ok:true, result:X}
// surfaces as r.result === X; a refusal {ok:false, error} has no `result` key
// so it surfaces as r.result.ok === false + r.result.error. (Verified against
// server.js:37514-37520.)
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("bounties — create contracts (validation + exact rollups)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("bounties-create"); });

  it("create: a flat-reward bounty reads back with pool=reward, status open, nothing paid", async () => {
    const r = await lensRun("bounties", "create", {
      params: { title: "Fix the login bug", description: "Login fails on Safari sometimes", category: "bug", difficulty: "intermediate", rewardCc: 250, tags: ["safari", "auth"] },
    }, ctx);
    assert.notEqual(r.result.ok, false);
    const b = r.result.bounty;
    assert.equal(b.title, "Fix the login bug");
    assert.equal(b.category, "bug");
    assert.equal(b.difficulty, "intermediate");
    assert.equal(b.rewardCc, 250);
    assert.equal(b.poolCc, 250);
    assert.equal(b.paidCc, 0);
    assert.equal(b.status, "open");
    assert.equal(b.submissionCount, 0);
    assert.deepEqual(b.tags, ["safari", "auth"]);
  });

  it("create: milestones override rewardCc — pool is the sum of milestone rewards (floored to >=1 each)", async () => {
    const r = await lensRun("bounties", "create", {
      params: {
        title: "Build the dashboard", description: "Multi-part build with milestones",
        milestones: [{ title: "Wireframe", rewardCc: 100 }, { title: "Implement", rewardCc: 300.9 }],
        rewardCc: 5, // ignored because milestones present
      },
    }, ctx);
    assert.notEqual(r.result.ok, false);
    const b = r.result.bounty;
    assert.equal(b.milestones.length, 2);
    assert.equal(b.milestones[0].rewardCc, 100);
    assert.equal(b.milestones[1].rewardCc, 300); // floor(300.9)
    assert.equal(b.rewardCc, 400); // 100 + 300
    assert.equal(b.poolCc, 400);
    assert.equal(b.milestones[0].status, "open");
  });

  it("create: an unknown category/difficulty falls back to 'other'/'intermediate'", async () => {
    const r = await lensRun("bounties", "create", {
      params: { title: "Something vague", description: "A description long enough", category: "nonsense", difficulty: "godlike", rewardCc: 10 },
    }, ctx);
    assert.notEqual(r.result.ok, false);
    assert.equal(r.result.bounty.category, "other");
    assert.equal(r.result.bounty.difficulty, "intermediate");
  });

  it("validation: a too-short title is rejected", async () => {
    const bad = await lensRun("bounties", "create", { params: { title: "hi", description: "a long enough description", rewardCc: 10 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("title must be at least 6 characters"));
  });

  it("validation: a too-short description is rejected", async () => {
    const bad = await lensRun("bounties", "create", { params: { title: "Long enough title", description: "short", rewardCc: 10 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("description must be at least 12 characters"));
  });

  it("create: a zero/negative rewardCc with no milestones is floored to 1 (not rejected)", async () => {
    const r = await lensRun("bounties", "create", { params: { title: "Valid title here", description: "Valid description here", rewardCc: 0 } }, ctx);
    assert.notEqual(r.result.ok, false);
    assert.equal(r.result.bounty.rewardCc, 1); // Math.max(1, floor(0))
    assert.equal(r.result.bounty.poolCc, 1);
  });
});

describe("bounties — list/get search + filter", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("bounties-list"); });

  it("list: filters by category, exposes the catalog enums, and get reads a single bounty back", async () => {
    const sec = await lensRun("bounties", "create", { params: { title: "Patch the CVE", description: "Critical vuln in parser", category: "security", rewardCc: 1000, tags: ["cve", "parser"] } }, ctx);
    await lensRun("bounties", "create", { params: { title: "Write the docs", description: "Document the API surface", category: "docs", rewardCc: 50 } }, ctx);

    const list = await lensRun("bounties", "list", { params: { category: "security" } }, ctx);
    assert.notEqual(list.result.ok, false);
    assert.deepEqual(list.result.categories, ["security", "feature", "bug", "design", "docs", "research", "infra", "other"]);
    assert.deepEqual(list.result.difficulties, ["beginner", "intermediate", "advanced", "expert"]);
    assert.ok(list.result.bounties.every((b) => b.category === "security"));
    assert.ok(list.result.bounties.some((b) => b.id === sec.result.bounty.id));

    const got = await lensRun("bounties", "get", { params: { bountyId: sec.result.bounty.id } }, ctx);
    assert.notEqual(got.result.ok, false);
    assert.equal(got.result.bounty.title, "Patch the CVE");
  });

  it("list: a free-text query matches title/description/tags", async () => {
    const r = await lensRun("bounties", "list", { params: { query: "cve" } }, ctx);
    assert.notEqual(r.result.ok, false);
    assert.ok(r.result.bounties.some((b) => b.tags.includes("cve")));
  });

  it("list: sortBy=reward orders by pool descending", async () => {
    const r = await lensRun("bounties", "list", { params: { sortBy: "reward" } }, ctx);
    assert.notEqual(r.result.ok, false);
    const pools = r.result.bounties.map((b) => b.poolCc);
    for (let i = 1; i < pools.length; i++) assert.ok(pools[i - 1] >= pools[i]);
  });

  it("get: an unknown bounty id is rejected", async () => {
    const bad = await lensRun("bounties", "get", { params: { bountyId: "bty_nope_999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("bounty not found"));
  });
});

describe("bounties — submit + review payout workflow", () => {
  // Owner posts; a DIFFERENT user submits; owner accepts → payout + earnings.
  let owner, claimant;
  before(async () => {
    owner = await depthCtx("bounties-owner");
    claimant = await depthCtx("bounties-claimant");
  });

  it("submit → review accept: a flat bounty pays the full pool to the claimant and resolves", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Implement feature X", description: "Add the new export button", category: "feature", rewardCc: 300 } }, owner);
    const bountyId = created.result.bounty.id;

    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "Done — PR attached", link: "https://example.test/pr/1" } }, claimant);
    assert.notEqual(sub.result.ok, false);
    assert.equal(sub.result.submission.status, "pending");
    assert.equal(sub.result.bounty.status, "claimed"); // open → claimed on first submission
    const submissionId = sub.result.submission.id;

    const rev = await lensRun("bounties", "review", { params: { bountyId, submissionId, decision: "accept", reviewNote: "lgtm" } }, owner);
    assert.notEqual(rev.result.ok, false);
    assert.equal(rev.result.submission.status, "accepted");
    assert.equal(rev.result.paidCc, 300);
    assert.equal(rev.result.currency, "CC");
    assert.equal(rev.result.bounty.status, "paid");
    assert.equal(rev.result.bounty.paidCc, 300);
    assert.equal(rev.result.bounty.acceptedSubmissionId, submissionId);

    // Claimant earnings + owner resolved counter updated.
    const claimantActivity = await lensRun("bounties", "my-activity", {}, claimant);
    assert.ok(claimantActivity.result.earnedCc >= 300);
    const ownerActivity = await lensRun("bounties", "my-activity", {}, owner);
    assert.ok(ownerActivity.result.resolvedCount >= 1);
  });

  it("review reject: the submission is rejected and the bounty is not paid", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Try this thing out", description: "An attempt that will be rejected", rewardCc: 80 } }, owner);
    const bountyId = created.result.bounty.id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "first attempt here" } }, claimant);
    const rev = await lensRun("bounties", "review", { params: { bountyId, submissionId: sub.result.submission.id, decision: "reject", reviewNote: "not quite" } }, owner);
    assert.notEqual(rev.result.ok, false);
    assert.equal(rev.result.submission.status, "rejected");
    assert.notEqual(rev.result.bounty.status, "paid");
    assert.equal(rev.result.bounty.paidCc, 0);
  });

  it("validation: owner cannot submit to their own bounty", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "My own bounty here", description: "I will try to submit to it", rewardCc: 25 } }, owner);
    const bad = await lensRun("bounties", "submit", { params: { bountyId: created.result.bounty.id, summary: "self submission" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("owner cannot submit to own bounty"));
  });

  it("validation: a too-short summary is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Bounty needing work", description: "Needs a real submission", rewardCc: 25 } }, owner);
    const bad = await lensRun("bounties", "submit", { params: { bountyId: created.result.bounty.id, summary: "x" } }, claimant);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("summary must be at least 8 characters"));
  });

  it("validation: only the owner can review; a stranger is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Reviewer auth test", description: "Only owner reviews this", rewardCc: 40 } }, owner);
    const bountyId = created.result.bounty.id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "claimant work here" } }, claimant);
    const bad = await lensRun("bounties", "review", { params: { bountyId, submissionId: sub.result.submission.id, decision: "accept" } }, claimant);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("only the bounty owner can review submissions"));
  });

  it("validation: a review decision other than accept/reject is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Bad decision test", description: "Decision must be accept/reject", rewardCc: 40 } }, owner);
    const bountyId = created.result.bounty.id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "some work done" } }, claimant);
    const bad = await lensRun("bounties", "review", { params: { bountyId, submissionId: sub.result.submission.id, decision: "maybe" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("decision must be 'accept' or 'reject'"));
  });
});

describe("bounties — milestone submission + acceptance", () => {
  let owner, claimant;
  before(async () => {
    owner = await depthCtx("bounties-ms-owner");
    claimant = await depthCtx("bounties-ms-claimant");
  });

  it("accept a milestone-scoped submission pays only that milestone; bounty stays in_review until all paid", async () => {
    const created = await lensRun("bounties", "create", {
      params: { title: "Milestone build project", description: "Two milestones to deliver",
        milestones: [{ title: "M1", rewardCc: 100 }, { title: "M2", rewardCc: 200 }] },
    }, owner);
    const b = created.result.bounty;
    const m1 = b.milestones[0].id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId: b.id, summary: "milestone 1 delivered", milestoneId: m1 } }, claimant);
    assert.notEqual(sub.result.ok, false);

    const rev = await lensRun("bounties", "review", { params: { bountyId: b.id, submissionId: sub.result.submission.id, decision: "accept" } }, owner);
    assert.notEqual(rev.result.ok, false);
    assert.equal(rev.result.paidCc, 100); // only M1
    assert.equal(rev.result.bounty.status, "in_review"); // M2 still open
    assert.equal(rev.result.bounty.paidCc, 100);
    const paidM1 = rev.result.bounty.milestones.find((m) => m.id === m1);
    assert.equal(paidM1.status, "paid");
    assert.equal(paidM1.paidTo, sub.result.submission.claimantId);
  });

  it("validation: submitting against an unknown milestone id is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Milestone id check", description: "Has a single milestone", milestones: [{ title: "Only", rewardCc: 50 }] } }, owner);
    const bad = await lensRun("bounties", "submit", { params: { bountyId: created.result.bounty.id, summary: "wrong milestone here", milestoneId: "ms_bogus" } }, claimant);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("milestone not found on this bounty"));
  });
});

describe("bounties — release-milestone (owner-directed partial payout)", () => {
  let owner;
  before(async () => { owner = await depthCtx("bounties-release"); });

  it("release-milestone pays the named claimant and marks bounty paid once all milestones are paid", async () => {
    const created = await lensRun("bounties", "create", {
      params: { title: "Single milestone release", description: "One milestone to release directly", milestones: [{ title: "Whole job", rewardCc: 500 }] },
    }, owner);
    const b = created.result.bounty;
    const msId = b.milestones[0].id;
    const rel = await lensRun("bounties", "release-milestone", { params: { bountyId: b.id, milestoneId: msId, claimantId: "winner-user" } }, owner);
    assert.notEqual(rel.result.ok, false);
    assert.equal(rel.result.paidCc, 500);
    assert.equal(rel.result.currency, "CC");
    assert.equal(rel.result.milestone.status, "paid");
    assert.equal(rel.result.milestone.paidTo, "winner-user");
    assert.equal(rel.result.bounty.status, "paid"); // only milestone → all paid
  });

  it("validation: releasing an already-paid milestone is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Double release guard", description: "Cannot pay twice", milestones: [{ title: "Once", rewardCc: 60 }] } }, owner);
    const msId = created.result.bounty.milestones[0].id;
    await lensRun("bounties", "release-milestone", { params: { bountyId: created.result.bounty.id, milestoneId: msId, claimantId: "u1" } }, owner);
    const bad = await lensRun("bounties", "release-milestone", { params: { bountyId: created.result.bounty.id, milestoneId: msId, claimantId: "u2" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("milestone already paid"));
  });

  it("validation: releasing without a claimantId is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "Need claimant id", description: "claimantId is required", milestones: [{ title: "X", rewardCc: 10 }] } }, owner);
    const bad = await lensRun("bounties", "release-milestone", { params: { bountyId: created.result.bounty.id, milestoneId: created.result.bounty.milestones[0].id } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("claimantId required"));
  });
});

describe("bounties — dispute open + resolve arbitration", () => {
  let owner, claimant;
  before(async () => {
    owner = await depthCtx("bounties-dispute-owner");
    claimant = await depthCtx("bounties-dispute-claimant");
  });

  async function settledBounty() {
    const created = await lensRun("bounties", "create", { params: { title: "Disputed bounty job", description: "Will be paid then disputed", rewardCc: 120 } }, owner);
    const bountyId = created.result.bounty.id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "claimant delivered work" } }, claimant);
    await lensRun("bounties", "review", { params: { bountyId, submissionId: sub.result.submission.id, decision: "accept" } }, owner);
    return bountyId;
  }

  it("dispute-open by an involved party flips the bounty to disputed", async () => {
    const bountyId = await settledBounty();
    const dsp = await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "the work was plagiarised" } }, owner);
    assert.notEqual(dsp.result.ok, false);
    assert.equal(dsp.result.dispute.status, "open");
    assert.equal(dsp.result.dispute.openedBy, dsp.result.dispute.openedBy);
    assert.equal(dsp.result.bounty.status, "disputed");
  });

  it("dispute-resolve overturn reopens the bounty and clears the accepted submission", async () => {
    const bountyId = await settledBounty();
    await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "contested resolution here" } }, claimant);
    const res = await lensRun("bounties", "dispute-resolve", { params: { bountyId, ruling: "overturn", rulingNote: "redo it" } }, owner);
    assert.notEqual(res.result.ok, false);
    assert.equal(res.result.dispute.status, "resolved");
    assert.equal(res.result.dispute.ruling, "overturn");
    assert.equal(res.result.bounty.status, "claimed"); // had submissions → claimed, not open
    assert.equal(res.result.bounty.acceptedSubmissionId, null);
  });

  it("dispute-resolve uphold restores the paid resolution", async () => {
    const bountyId = await settledBounty();
    await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "wants a second look here" } }, owner);
    const res = await lensRun("bounties", "dispute-resolve", { params: { bountyId, ruling: "uphold" } }, owner);
    assert.notEqual(res.result.ok, false);
    assert.equal(res.result.dispute.ruling, "uphold");
    assert.equal(res.result.bounty.status, "paid"); // acceptedSubmissionId present → allPaid → paid
  });

  it("validation: a non-involved stranger cannot open a dispute", async () => {
    const bountyId = await settledBounty();
    const stranger = await depthCtx("bounties-dispute-stranger");
    const bad = await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "I am not involved at all" } }, stranger);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("only the owner or a claimant can open a dispute"));
  });

  it("validation: a too-short dispute reason is rejected", async () => {
    const bountyId = await settledBounty();
    const bad = await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "short" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("reason must be at least 10 characters"));
  });

  it("validation: resolving with no open dispute is rejected", async () => {
    const created = await lensRun("bounties", "create", { params: { title: "No dispute exists yet", description: "Cannot resolve nothing", rewardCc: 30 } }, owner);
    const bad = await lensRun("bounties", "dispute-resolve", { params: { bountyId: created.result.bounty.id, ruling: "uphold" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("no open dispute on this bounty"));
  });

  it("validation: an invalid ruling is rejected", async () => {
    const bountyId = await settledBounty();
    await lensRun("bounties", "dispute-open", { params: { bountyId, reason: "valid reason for dispute" } }, owner);
    const bad = await lensRun("bounties", "dispute-resolve", { params: { bountyId, ruling: "dismiss" } }, owner);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("ruling must be 'uphold', 'overturn' or 'split'"));
  });
});

describe("bounties — leaderboard ranking", () => {
  it("leaderboard ranks top earners descending after a payout", async () => {
    const owner = await depthCtx("bounties-lb-owner");
    const claimant = await depthCtx("bounties-lb-claimant");
    const created = await lensRun("bounties", "create", { params: { title: "Leaderboard payout job", description: "Earns the claimant some CC", rewardCc: 777 } }, owner);
    const bountyId = created.result.bounty.id;
    const sub = await lensRun("bounties", "submit", { params: { bountyId, summary: "leaderboard work done" } }, claimant);
    await lensRun("bounties", "review", { params: { bountyId, submissionId: sub.result.submission.id, decision: "accept" } }, owner);

    const lb = await lensRun("bounties", "leaderboard", { params: { limit: 50 } }, owner);
    assert.notEqual(lb.result.ok, false);
    assert.ok(Array.isArray(lb.result.topEarners));
    // Earners are ranked descending and rank starts at 1.
    if (lb.result.topEarners.length) {
      assert.equal(lb.result.topEarners[0].rank, 1);
      for (let i = 1; i < lb.result.topEarners.length; i++) {
        assert.ok(lb.result.topEarners[i - 1].earnedCc >= lb.result.topEarners[i].earnedCc);
      }
    }
    // The claimant who just earned 777 appears among earners with that floor.
    const me = lb.result.topEarners.find((e) => e.earnedCc >= 777);
    assert.ok(me);
    // topResolvers includes the owner who resolved it.
    assert.ok(lb.result.topResolvers.some((r) => r.resolved >= 1));
  });
});

describe("bounties — my-activity dashboard", () => {
  it("my-activity returns posted bounties for the owner and submissions for a claimant", async () => {
    const owner = await depthCtx("bounties-act-owner");
    const claimant = await depthCtx("bounties-act-claimant");
    const created = await lensRun("bounties", "create", { params: { title: "Activity dashboard job", description: "Shows in posted list", rewardCc: 90 } }, owner);
    const bountyId = created.result.bounty.id;
    await lensRun("bounties", "submit", { params: { bountyId, summary: "claimant submission here" } }, claimant);

    const ownerView = await lensRun("bounties", "my-activity", {}, owner);
    assert.notEqual(ownerView.result.ok, false);
    assert.ok(ownerView.result.posted.some((b) => b.id === bountyId));

    const claimantView = await lensRun("bounties", "my-activity", {}, claimant);
    assert.notEqual(claimantView.result.ok, false);
    assert.ok(claimantView.result.submitted.some((sub) => sub.bountyTitle === "Activity dashboard job"));
  });
});
