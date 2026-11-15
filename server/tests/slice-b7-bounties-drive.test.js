import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBountiesActions from "../domains/bounties.js";

const actions = new Map();
registerBountiesActions((domain, name, fn) => actions.set(`${domain}:${name}`, fn));
function call(name, input = {}, userId = "u1") {
  const fn = actions.get(`bounties:${name}`);
  assert.ok(fn, `missing action ${name}`);
  return fn({ actor: { userId } }, { id: null, domain: "bounties", type: "domain_action", data: input, meta: {} }, input);
}
beforeEach(() => { globalThis._concordSTATE = {}; });

function postBounty(extra = {}, userId = "u1") {
  const r = call("create", {
    title: "Fix the flaky widget test",
    description: "The widget test fails one run in five; find and fix the race.",
    category: "bug",
    rewardCc: 50,
    ...extra,
  }, userId);
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.result.bounty;
}

test("FIX-bounties-001: owner edits a bounty before the first submission; nobody else can", () => {
  const b = postBounty();
  const stranger = call("update", { bountyId: b.id, title: "Hijacked title here" }, "u9");
  assert.equal(stranger.ok, false);

  const edited = call("update", { bountyId: b.id, title: "Fix the flaky gadget test", deadline: "2999-01-01" });
  assert.equal(edited.ok, true);
  assert.equal(edited.result.bounty.title, "Fix the flaky gadget test");
  assert.equal(edited.result.bounty.deadline, "2999-01-01");
  // Short titles are refused with create's own validation.
  assert.equal(call("update", { bountyId: b.id, title: "tiny" }).ok, false);

  // After a submission lands, editing closes (the ticket's pre-submission scope).
  const sub = call("submit", { bountyId: b.id, summary: "Fixed the race in the widget" }, "u2");
  assert.equal(sub.ok, true, JSON.stringify(sub));
  const late = call("update", { bountyId: b.id, title: "Another new title here" });
  assert.equal(late.ok, false);
  assert.match(late.error, /before the first submission/);
});

test("FIX-bounties-001: cancel closes the bounty, then delete removes it — no CC moves", () => {
  const b = postBounty();
  // Delete before cancel is refused (cancel-first shape).
  assert.equal(call("delete", { bountyId: b.id }).ok, false);
  // A stranger cannot cancel.
  assert.equal(call("cancel", { bountyId: b.id }, "u9").ok, false);

  const cancelled = call("cancel", { bountyId: b.id });
  assert.equal(cancelled.ok, true);
  assert.equal(cancelled.result.bounty.status, "cancelled");
  // A cancelled bounty takes no submissions.
  const sub = call("submit", { bountyId: b.id, summary: "Trying to submit anyway" }, "u2");
  assert.equal(sub.ok, false);
  assert.match(sub.error, /cancelled/);

  const del = call("delete", { bountyId: b.id });
  assert.equal(del.ok, true);
  assert.equal(call("get", { bountyId: b.id }).ok, false);
  assert.equal(call("my-activity", {}).result.posted.length, 0);
  // Nobody earned anything from any of this.
  assert.equal(call("my-activity", {}).result.earnedCc, 0);
});

test("FIX-bounties-001: cancel is refused once any part of the bounty is paid", () => {
  const b = postBounty({ rewardCc: undefined, milestones: [{ title: "Step one", rewardCc: 25 }, { title: "Step two", rewardCc: 25 }] });
  const rel = call("release-milestone", { bountyId: b.id, milestoneId: b.milestones[0].id, claimantId: "u2" });
  assert.equal(rel.ok, true, JSON.stringify(rel));
  const c = call("cancel", { bountyId: b.id });
  assert.equal(c.ok, false);
  assert.match(c.error, /already paid/);
});
