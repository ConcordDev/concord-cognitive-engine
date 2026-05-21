// Contract tests for server/domains/inheritance.js — estate-planning
// macros: beneficiaries, wills, assets, executors, locks, probate
// timeline, heir notices. All in-memory (globalThis._concordSTATE).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInheritanceActions from "../domains/inheritance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`inheritance.${name}`);
  if (!fn) throw new Error(`inheritance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerInheritanceActions(register); });

// Fresh estate state per test.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const ctxNone = {};

describe("inheritance — no-actor guard", () => {
  it("every read macro fails cleanly without an actor", () => {
    for (const m of ["estate_overview", "list_beneficiaries", "list_will_versions",
      "list_assets", "list_executors", "list_locks", "probate_timeline", "list_notices"]) {
      const r = call(m, ctxNone);
      assert.equal(r.ok, false, `${m} should reject no-actor`);
      assert.equal(r.error, "no_actor");
    }
  });
});

describe("inheritance.estate_overview", () => {
  it("returns a blank estate summary for a new user", () => {
    const r = call("estate_overview", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.beneficiaryCount, 0);
    assert.equal(r.result.shareBalanced, false);
  });
});

describe("inheritance — beneficiary builder", () => {
  it("adds, lists, updates, and removes a beneficiary", () => {
    const add = call("add_beneficiary", ctxA, { name: "Mira", relationship: "child", sharePct: 60 });
    assert.equal(add.ok, true);
    const id = add.result.beneficiary.id;

    let list = call("list_beneficiaries", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.totalSharePct, 60);
    assert.equal(list.result.remainderPct, 40);
    assert.equal(list.result.balanced, false);

    const upd = call("update_beneficiary", ctxA, { beneficiaryId: id, sharePct: 100 });
    assert.equal(upd.ok, true);
    list = call("list_beneficiaries", ctxA);
    assert.equal(list.result.balanced, true);

    const rm = call("remove_beneficiary", ctxA, { beneficiaryId: id });
    assert.equal(rm.ok, true);
    assert.equal(call("list_beneficiaries", ctxA).result.beneficiaries.length, 0);
  });

  it("rejects a nameless beneficiary and a missing id", () => {
    assert.equal(call("add_beneficiary", ctxA, {}).ok, false);
    assert.equal(call("update_beneficiary", ctxA, { beneficiaryId: "nope" }).ok, false);
    assert.equal(call("remove_beneficiary", ctxA, { beneficiaryId: "nope" }).ok, false);
  });
});

describe("inheritance — will authoring + versioning", () => {
  it("authors versions, supersedes the prior active, and restores", () => {
    const v1 = call("author_will", ctxA, { title: "First", body: "leave all to Mira" });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.version, 1);

    const v2 = call("author_will", ctxA, { title: "Second", body: "split evenly", kind: "living_directive" });
    assert.equal(v2.result.version, 2);

    const versions = call("list_will_versions", ctxA);
    assert.equal(versions.ok, true);
    assert.equal(versions.result.activeVersion, 2);

    const got = call("get_will_version", ctxA, { version: 1 });
    assert.equal(got.ok, true);
    assert.equal(got.result.will.status, "superseded");

    const restored = call("restore_will_version", ctxA, { version: 1 });
    assert.equal(restored.ok, true);
    assert.equal(restored.result.will.restoredFrom, 1);
    assert.equal(call("list_will_versions", ctxA).result.activeVersion, 3);
  });

  it("rejects an empty will body and a bad version lookup", () => {
    assert.equal(call("author_will", ctxA, { body: "" }).ok, false);
    assert.equal(call("get_will_version", ctxA, { version: 99 }).ok, false);
    assert.equal(call("restore_will_version", ctxA, { version: 99 }).ok, false);
  });
});

describe("inheritance — asset inventory", () => {
  it("adds assets, aggregates by category, and removes", () => {
    call("add_asset", ctxA, { label: "Manor", category: "property", valueCc: 500 });
    const a2 = call("add_asset", ctxA, { label: "Frost recipe", category: "recipe", valueCc: 120 });
    assert.equal(a2.ok, true);

    const list = call("list_assets", ctxA);
    assert.equal(list.ok, true);
    assert.equal(list.result.totalValueCc, 620);
    assert.equal(list.result.byCategory.property.count, 1);
    assert.equal(list.result.byCategory.recipe.valueCc, 120);

    const rm = call("remove_asset", ctxA, { assetId: a2.result.asset.id });
    assert.equal(rm.ok, true);
    assert.equal(call("list_assets", ctxA).result.totalValueCc, 500);
  });

  it("rejects a labelless asset", () => {
    assert.equal(call("add_asset", ctxA, {}).ok, false);
    assert.equal(call("remove_asset", ctxA, { assetId: "nope" }).ok, false);
  });
});

describe("inheritance — executor consent workflow", () => {
  it("assigns, consents, and reports full consent", () => {
    const ex = call("assign_executor", ctxA, { name: "Tomas", role: "executor" });
    assert.equal(ex.ok, true);
    assert.equal(ex.result.executor.consentStatus, "pending");

    let list = call("list_executors", ctxA);
    assert.equal(list.result.consentSummary.pending, 1);
    assert.equal(list.result.fullyConsented, false);

    const resp = call("respond_executor_consent", ctxA, { executorId: ex.result.executor.id, decision: "accepted" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.allExecutorsConsented, true);

    list = call("list_executors", ctxA);
    assert.equal(list.result.fullyConsented, true);

    const rm = call("remove_executor", ctxA, { executorId: ex.result.executor.id });
    assert.equal(rm.ok, true);
  });

  it("rejects a nameless executor and a bad decision", () => {
    assert.equal(call("assign_executor", ctxA, {}).ok, false);
    const ex = call("assign_executor", ctxA, { name: "X" });
    assert.equal(call("respond_executor_consent", ctxA, { executorId: ex.result.executor.id, decision: "maybe" }).ok, false);
  });
});

describe("inheritance — heir-slot lock revoke / amend", () => {
  it("tracks, amends, and revokes a lock", () => {
    const lk = call("track_lock", ctxA, { listingId: 7, npcName: "Old Sage", priceCc: 200 });
    assert.equal(lk.ok, true);
    const id = lk.result.lock.id;

    const am = call("amend_lock", ctxA, { lockId: id, priceCc: 250 });
    assert.equal(am.ok, true);
    assert.equal(am.result.lock.status, "amended");
    assert.equal(am.result.lock.priceCc, 250);

    let locks = call("list_locks", ctxA);
    assert.equal(locks.result.escrowedCc, 250);

    const rv = call("revoke_lock", ctxA, { lockId: id });
    assert.equal(rv.ok, true);
    assert.equal(rv.result.refundedCc, 250);

    locks = call("list_locks", ctxA);
    assert.equal(locks.result.escrowedCc, 0);

    // A revoked lock can no longer be amended or re-revoked.
    assert.equal(call("amend_lock", ctxA, { lockId: id, priceCc: 1 }).ok, false);
    assert.equal(call("revoke_lock", ctxA, { lockId: id }).ok, false);
  });
});

describe("inheritance — probate timeline", () => {
  it("aggregates wills, executors, and locks into a sorted timeline", () => {
    call("author_will", ctxA, { body: "x" });
    call("assign_executor", ctxA, { name: "Tomas" });
    call("track_lock", ctxA, { listingId: 1, npcName: "Sage", priceCc: 50 });

    const r = call("probate_timeline", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.events.length, 3);
    assert.equal(r.result.pendingTransfers, 1);
    for (let i = 1; i < r.result.events.length; i++) {
      assert.ok(r.result.events[i].time >= r.result.events[i - 1].time);
    }
  });
});

describe("inheritance — heir notification + acceptance", () => {
  it("notifies an heir, who lists and responds to the notice", () => {
    const ben = call("add_beneficiary", ctxA, { name: "Mira", sharePct: 50, heirUserId: "user_b" });
    const notify = call("notify_heir", ctxA, { heirUserId: "user_b", beneficiaryId: ben.result.beneficiary.id });
    assert.equal(notify.ok, true);

    const inbox = call("list_notices", ctxB);
    assert.equal(inbox.ok, true);
    assert.equal(inbox.result.unreadCount, 1);

    const resp = call("respond_notice", ctxB, { noticeId: inbox.result.notices[0].id, decision: "accepted" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.notice.acceptance, "accepted");

    // Acceptance reflects back onto the estate owner's beneficiary record.
    const owner = call("list_beneficiaries", ctxA);
    assert.equal(owner.result.beneficiaries[0].acceptanceStatus, "accepted");
  });

  it("an executor invite to a real user lands in their notice inbox", () => {
    call("assign_executor", ctxA, { name: "Tomas", executorUserId: "user_b" });
    const inbox = call("list_notices", ctxB);
    assert.ok(inbox.result.notices.some((n) => n.kind === "executor_invite"));
  });

  it("rejects a heirless notify and a bad notice decision", () => {
    assert.equal(call("notify_heir", ctxA, {}).ok, false);
    assert.equal(call("respond_notice", ctxB, { noticeId: "nope", decision: "accepted" }).ok, false);
  });
});

describe("inheritance — per-user isolation", () => {
  it("estates do not leak across users", () => {
    call("add_beneficiary", ctxA, { name: "A-heir", sharePct: 10 });
    assert.equal(call("list_beneficiaries", ctxB).result.beneficiaries.length, 0);
  });
});
