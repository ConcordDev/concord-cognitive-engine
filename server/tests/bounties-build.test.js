// Build tests for the Bounties full-lens build (B2, 2026-11-03) — one case
// per canonical finding, each failing on the pre-build behaviour:
//   F5 zero reward rejected, never rewritten (create + milestones)
//   F4 poster lifecycle: update + cancel verbs with their state guards
//   F2/S1 dispute-resolve refusal carries its reason; authorisation unchanged
//   item-8 rejecting the last live submission reopens the bounty
//   S3 identity join: names resolve at read time via lib/user-identity.js
//   F7 list totals are board-wide under any filter

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
beforeEach(() => { globalThis._concordSTATE = {}; });

const owner = { actor: { userId: "owner_1" }, userId: "owner_1" };
const claimant = { actor: { userId: "claimant_1" }, userId: "claimant_1" };
const stranger = { actor: { userId: "stranger_1" }, userId: "stranger_1" };
const arbiter = { actor: { userId: "arbiter_1", role: "admin" }, userId: "arbiter_1" };

function makeBounty(ctx = owner, extra = {}) {
  const r = call("create", ctx, {
    title: "Fix the auth race condition",
    description: "There is a race in the login path that needs a real fix.",
    category: "bug",
    rewardCc: 100,
    ...extra,
  });
  assert.equal(r.ok, true, r.error);
  return r.result.bounty;
}
function submitWork(bountyId, ctx = claimant) {
  const r = call("submit", ctx, { bountyId, summary: "Fixed it, tests attached." });
  assert.equal(r.ok, true, r.error);
  return r.result.submission;
}

describe("F5 — zero reward is rejected, never rewritten", () => {
  it("create with rewardCc 0 fails loudly", () => {
    const r = call("create", owner, {
      title: "Zero reward bounty", description: "A bounty with no reward at all.", rewardCc: 0,
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 1/);
  });
  it("create with a zero-reward milestone fails loudly", () => {
    const r = call("create", owner, {
      title: "Milestone zero bounty", description: "One milestone pays nothing at all.",
      milestones: [{ title: "Phase 1", rewardCc: 50 }, { title: "Phase 2", rewardCc: 0 }],
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /milestone 2 reward must be at least 1 CC/);
  });
  it("create with no reward and no milestones fails loudly", () => {
    const r = call("create", owner, {
      title: "Rewardless bounty", description: "No reward field supplied at all.",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 1/);
  });
});

describe("F4 — poster lifecycle (update / cancel)", () => {
  it("owner edits text fields and the reward before any submission", () => {
    const b = makeBounty();
    const r = call("update", owner, { bountyId: b.id, title: "Fix the auth race (updated)", rewardCc: 150 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.bounty.title, "Fix the auth race (updated)");
    assert.equal(r.result.bounty.rewardCc, 150);
    assert.equal(r.result.bounty.poolCc, 150);
  });
  it("a non-owner cannot edit", () => {
    const b = makeBounty();
    const r = call("update", claimant, { bountyId: b.id, title: "Hijacked title here" });
    assert.equal(r.ok, false);
    assert.match(r.error, /only the bounty owner/);
  });
  it("the reward locks once work is submitted; text stays editable", () => {
    const b = makeBounty();
    submitWork(b.id);
    const money = call("update", owner, { bountyId: b.id, rewardCc: 5 });
    assert.equal(money.ok, false);
    assert.match(money.error, /work has been submitted/);
    const text = call("update", owner, { bountyId: b.id, title: "Fix the auth race (clarified)" });
    assert.equal(text.ok, true, text.error);
  });
  it("owner cancels an unsubmitted bounty; it leaves the open pool", () => {
    const b = makeBounty();
    const r = call("cancel", owner, { bountyId: b.id });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.bounty.status, "cancelled");
    const list = call("list", owner, {});
    assert.equal(list.result.totals.openPoolCc, 0);
    assert.equal(list.result.totals.bountyCount, 0);
  });
  it("cancel is refused with a live submission, and for a non-owner", () => {
    const b = makeBounty();
    submitWork(b.id);
    const byOwner = call("cancel", owner, { bountyId: b.id });
    assert.equal(byOwner.ok, false);
    assert.match(byOwner.error, /submissions awaiting an outcome/);
    const fresh = makeBounty();
    const byOther = call("cancel", claimant, { bountyId: fresh.id });
    assert.equal(byOther.ok, false);
    assert.match(byOther.error, /only the bounty owner/);
  });
  it("a cancelled bounty refuses submissions and disputes", () => {
    const b = makeBounty();
    call("cancel", owner, { bountyId: b.id });
    const sub = call("submit", claimant, { bountyId: b.id, summary: "Work on a cancelled bounty." });
    assert.equal(sub.ok, false);
    assert.match(sub.error, /cancelled/);
    const dsp = call("dispute-open", owner, { bountyId: b.id, reason: "Disputing my own cancelled bounty." });
    assert.equal(dsp.ok, false);
    assert.match(dsp.error, /cancelled/);
  });
  it("cancel is refused while a dispute is open", () => {
    const b = makeBounty();
    const sub = submitWork(b.id);
    call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "reject" });
    call("dispute-open", claimant, { bountyId: b.id, reason: "The rejection was unfair here." });
    const r = call("cancel", owner, { bountyId: b.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /open dispute/);
  });
});

describe("S1 — dispute resolution: reasoned refusals, unchanged authorisation", () => {
  function disputedBounty() {
    const b = makeBounty();
    const sub = submitWork(b.id);
    call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "reject" });
    call("dispute-open", claimant, { bountyId: b.id, reason: "The rejection was unfair here." });
    return b;
  }
  it("a non-arbiter gets the reason in words, not a bare code", () => {
    const b = disputedBounty();
    const r = call("dispute-resolve", stranger, { bountyId: b.id, ruling: "overturn" });
    assert.equal(r.ok, false);
    assert.match(r.error, /only a platform admin or moderator/);
    assert.notEqual(r.error, "forbidden");
  });
  it("a party still cannot arbitrate, with the legible refusal", () => {
    const b = disputedBounty();
    const partyAdmin = { actor: { userId: "owner_1", role: "admin" }, userId: "owner_1" };
    const r = call("dispute-resolve", partyAdmin, { bountyId: b.id, ruling: "uphold" });
    assert.equal(r.ok, false);
    assert.match(r.error, /parties to a dispute cannot arbitrate/);
  });
  it("a neutral arbiter still resolves (acceptance-fixture shape)", () => {
    const b = disputedBounty();
    const r = call("dispute-resolve", arbiter, { bountyId: b.id, ruling: "overturn" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.dispute.status, "resolved");
    assert.equal(r.result.bounty.status, "open");
  });
});

describe("item-8 — rejecting the last live submission reopens the bounty", () => {
  it("claimed returns to open when no live submissions remain", () => {
    const b = makeBounty();
    const sub = submitWork(b.id);
    assert.equal(call("get", owner, { bountyId: b.id }).result.bounty.status, "claimed");
    const r = call("review", owner, { bountyId: b.id, submissionId: sub.id, decision: "reject" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.bounty.status, "open");
  });
  it("a second pending submission keeps the bounty claimed", () => {
    const b = makeBounty();
    const s1 = submitWork(b.id);
    submitWork(b.id, { actor: { userId: "claimant_2" }, userId: "claimant_2" });
    const r = call("review", owner, { bountyId: b.id, submissionId: s1.id, decision: "reject" });
    assert.equal(r.result.bounty.status, "claimed");
  });
});

describe("S3 — identity join resolves names at read time", () => {
  // Stub db in the shape lib/user-identity.js accepts: prepare().get() answers
  // the username select; no .all() → the PRAGMA introspection is skipped.
  const stubDb = {
    prepare: (sql) => ({
      get: (uid) => (sql.includes("FROM users") && uid === "owner_1" ? { username: "ramaj" } : undefined),
    }),
  };
  const namedOwner = { actor: { userId: "owner_1" }, userId: "owner_1", db: stubDb };
  it("publicView carries ownerName; unknown users stay null, never fabricated", () => {
    const b = makeBounty(namedOwner);
    assert.equal(b.ownerName, "ramaj");
    const other = makeBounty(claimant);
    assert.equal(other.ownerName, null);
  });
  it("leaderboard rows carry names", () => {
    const b = makeBounty(namedOwner);
    const sub = submitWork(b.id);
    call("review", namedOwner, { bountyId: b.id, submissionId: sub.id, decision: "accept" });
    const lb = call("leaderboard", namedOwner, {});
    assert.equal(lb.result.topEarners[0].userId, "claimant_1");
    assert.equal(lb.result.topEarners[0].name, null); // claimant has no users row in the stub
  });
});

describe("F7 — list totals are board-wide under any filter", () => {
  it("totals ignore the active filter while rows honour it", () => {
    makeBounty(owner, { title: "Security audit bounty", category: "security", rewardCc: 100 });
    const b2 = makeBounty(owner, { title: "Feature build bounty", category: "feature", rewardCc: 50 });
    const sub = submitWork(b2.id);
    call("review", owner, { bountyId: b2.id, submissionId: sub.id, decision: "accept" });
    const filtered = call("list", owner, { status: "paid" });
    assert.equal(filtered.result.bounties.length, 1);
    assert.equal(filtered.result.totals.openPoolCc, 100);
    assert.equal(filtered.result.totals.paidOutCc, 50);
    assert.equal(filtered.result.totals.bountyCount, 2);
  });
});
