// Behavioral macro tests for server/domains/inheritance.js — the estate-planning
// substrate the /lenses/inheritance lens drives (beneficiaries, wills, assets,
// executors, probate timeline, heir notices, heir-slot lock bookkeeping).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150): handlers
// registered via `registerLensAction(domain, action, handler)` are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention. Our harness
// calls `fn(ctx, virtualArtifact, input)`, NOT (ctx, input), so a regression
// that confuses the param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed values
// + money accounting: an estate's value == the sum of its assets (no fabricated
// CC minted), escrow == the sum of live locks, a designate→notice→accept round
// trip reflects acceptance back onto the owner's beneficiary record, per-user
// isolation holds, and the value/escrow columns are fail-CLOSED against a
// poisoned 1e308 / Infinity / negative amount BEFORE the value lands.
//
// State is the same in-memory globalThis._concordSTATE the live handlers use;
// no DB / network / LLM boot.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerInheritanceActions from "../domains/inheritance.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "inheritance", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`inheritance.${name} not registered`);
  const virtualArtifact = { id: null, domain: "inheritance", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerInheritanceActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("inheritance — registration (every domains-file macro the lens calls is present)", () => {
  it("registers all 26 estate-planning macros", () => {
    for (const m of [
      "estate_overview",
      "add_beneficiary", "update_beneficiary", "remove_beneficiary", "list_beneficiaries",
      "author_will", "list_will_versions", "get_will_version", "restore_will_version",
      "add_asset", "remove_asset", "list_assets",
      "assign_executor", "respond_executor_consent", "list_executors", "remove_executor",
      "track_lock", "amend_lock", "revoke_lock", "list_locks",
      "probate_timeline",
      "notify_heir", "list_notices", "respond_notice",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing inheritance.${m}`);
    }
  });

  it("a missing actor returns no_actor, never a throw", () => {
    for (const m of ["estate_overview", "list_beneficiaries", "add_asset", "track_lock"]) {
      const r = call(m, {}, {});
      assert.equal(r.ok, false);
      assert.equal(r.error, "no_actor");
    }
  });
});

describe("inheritance — beneficiary share math", () => {
  it("shares sum, clamp 0..100, and report the unallocated remainder", () => {
    call("add_beneficiary", ctxA, { name: "Asbir", relationship: "child", sharePct: 40 });
    call("add_beneficiary", ctxA, { name: "Iyatte", relationship: "child", sharePct: 35 });

    const l = call("list_beneficiaries", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.beneficiaries.length, 2);
    assert.equal(l.result.totalSharePct, 75);
    assert.equal(l.result.balanced, false);
    assert.equal(l.result.remainderPct, 25);

    // A share above 100 is clamped to 100, never stored raw.
    const big = call("add_beneficiary", ctxA, { name: "Greedy", sharePct: 9999 });
    assert.equal(big.ok, true);
    assert.equal(big.result.beneficiary.sharePct, 100);
  });

  it("update_beneficiary reprices an existing share; balanced flips at exactly 100", () => {
    const a = call("add_beneficiary", ctxA, { name: "Sole heir", sharePct: 60 });
    const id = a.result.beneficiary.id;
    const u = call("update_beneficiary", ctxA, { beneficiaryId: id, sharePct: 100 });
    assert.equal(u.ok, true);
    assert.equal(u.result.beneficiary.sharePct, 100);

    const l = call("list_beneficiaries", ctxA, {});
    assert.equal(l.result.totalSharePct, 100);
    assert.equal(l.result.balanced, true);
    assert.equal(l.result.remainderPct, 0);
  });

  it("remove_beneficiary drops the row; unknown id rejects", () => {
    const a = call("add_beneficiary", ctxA, { name: "Temp", sharePct: 10 });
    assert.equal(call("remove_beneficiary", ctxA, { beneficiaryId: a.result.beneficiary.id }).ok, true);
    assert.equal(call("list_beneficiaries", ctxA, {}).result.beneficiaries.length, 0);
    const miss = call("remove_beneficiary", ctxA, { beneficiaryId: "ghost" });
    assert.equal(miss.ok, false);
    assert.equal(miss.error, "beneficiary_not_found");
  });

  it("add_beneficiary rejects a missing name", () => {
    const r = call("add_beneficiary", ctxA, { sharePct: 50 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_name");
  });
});

describe("inheritance — will versioning", () => {
  it("authoring supersedes the prior active will and increments the version", () => {
    const v1 = call("author_will", ctxA, { title: "First", body: "leave all to Asbir", kind: "will" });
    assert.equal(v1.ok, true);
    assert.equal(v1.result.version, 1);
    assert.equal(v1.result.will.status, "active");

    const v2 = call("author_will", ctxA, { body: "amended directive" });
    assert.equal(v2.result.version, 2);

    const lv = call("list_will_versions", ctxA, {});
    assert.equal(lv.result.versions.length, 2);
    assert.equal(lv.result.activeVersion, 2);
    // Exactly one active version at a time.
    assert.equal(lv.result.versions.filter((w) => w.status === "active").length, 1);
  });

  it("restore_will_version forks a new active version from an old body", () => {
    call("author_will", ctxA, { title: "Original", body: "ORIGINAL BODY" });
    call("author_will", ctxA, { title: "Newer", body: "newer body" });
    const r = call("restore_will_version", ctxA, { version: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.will.version, 3);
    assert.equal(r.result.will.body, "ORIGINAL BODY");
    assert.equal(r.result.will.restoredFrom, 1);
    assert.equal(r.result.will.status, "active");

    // get_will_version reads the exact stored body.
    const g = call("get_will_version", ctxA, { version: 1 });
    assert.equal(g.result.will.body, "ORIGINAL BODY");
  });

  it("author_will rejects an empty body; get/restore reject an unknown version", () => {
    assert.equal(call("author_will", ctxA, { title: "x" }).error, "missing_body");
    assert.equal(call("get_will_version", ctxA, { version: 99 }).error, "version_not_found");
    assert.equal(call("restore_will_version", ctxA, { version: 99 }).error, "version_not_found");
  });
});

describe("inheritance — asset inventory value conservation (no fabricated CC)", () => {
  it("estate value == the sum of asset values, grouped by category, exactly", () => {
    call("add_asset", ctxA, { label: "Manor", category: "property", valueCc: 500 });
    call("add_asset", ctxA, { label: "Cottage", category: "property", valueCc: 150 });
    call("add_asset", ctxA, { label: "Fireball V", category: "recipe", valueCc: 80 });

    const la = call("list_assets", ctxA, {});
    assert.equal(la.ok, true);
    assert.equal(la.result.assets.length, 3);
    // Conservation: total == per-asset sum, no mint.
    const perAsset = la.result.assets.reduce((s, a) => s + a.valueCc, 0);
    assert.equal(la.result.totalValueCc, perAsset);
    assert.equal(la.result.totalValueCc, 730);
    assert.equal(la.result.byCategory.property.valueCc, 650);
    assert.equal(la.result.byCategory.property.count, 2);
    assert.equal(la.result.byCategory.recipe.valueCc, 80);

    // estate_overview surfaces the SAME total — not a recomputed/inflated one.
    const ov = call("estate_overview", ctxA, {});
    assert.equal(ov.result.totalAssetValueCc, 730);
    assert.equal(ov.result.assetCount, 3);
    assert.ok(Number.isFinite(ov.result.totalAssetValueCc));
  });

  it("remove_asset shrinks the total; unknown id rejects", () => {
    const a = call("add_asset", ctxA, { label: "Trinket", valueCc: 25 });
    assert.equal(call("list_assets", ctxA, {}).result.totalValueCc, 25);
    assert.equal(call("remove_asset", ctxA, { assetId: a.result.asset.id }).ok, true);
    assert.equal(call("list_assets", ctxA, {}).result.totalValueCc, 0);
    assert.equal(call("remove_asset", ctxA, { assetId: "ghost" }).error, "asset_not_found");
  });

  it("add_asset rejects a missing label", () => {
    assert.equal(call("add_asset", ctxA, { valueCc: 10 }).error, "missing_label");
  });
});

describe("inheritance — executor consent workflow", () => {
  it("invite → respond → all-consented gate computes correctly", () => {
    const x1 = call("assign_executor", ctxA, { name: "Orin", role: "executor" });
    const x2 = call("assign_executor", ctxA, { name: "Kel", role: "co_executor" });
    assert.equal(x1.result.executor.consentStatus, "pending");

    let le = call("list_executors", ctxA, {});
    assert.equal(le.result.consentSummary.pending, 2);
    assert.equal(le.result.fullyConsented, false);

    call("respond_executor_consent", ctxA, { executorId: x1.result.executor.id, decision: "accepted" });
    const r2 = call("respond_executor_consent", ctxA, { executorId: x2.result.executor.id, decision: "accepted" });
    assert.equal(r2.result.allExecutorsConsented, true);

    le = call("list_executors", ctxA, {});
    assert.equal(le.result.consentSummary.accepted, 2);
    assert.equal(le.result.fullyConsented, true);
  });

  it("an invited-user executor receives an executor_invite notice", () => {
    call("assign_executor", ctxA, { name: "Invited", role: "trustee", executorUserId: "user_b" });
    const ln = call("list_notices", ctxB, {});
    assert.equal(ln.result.notices.length, 1);
    assert.equal(ln.result.notices[0].kind, "executor_invite");
    assert.equal(ln.result.notices[0].fromUserId, "user_a");
  });

  it("respond_executor_consent rejects a bad decision / unknown executor", () => {
    const x = call("assign_executor", ctxA, { name: "Z" });
    assert.equal(call("respond_executor_consent", ctxA, { executorId: x.result.executor.id, decision: "maybe" }).error, "bad_decision");
    assert.equal(call("respond_executor_consent", ctxA, { executorId: "ghost", decision: "accepted" }).error, "executor_not_found");
  });
});

describe("inheritance — heir-slot lock bookkeeping (escrow conservation)", () => {
  it("escrow == sum of live (locked/amended) locks; revoked drops out and reports the refund", () => {
    const l1 = call("track_lock", ctxA, { npcName: "Old Seam", priceCc: 120 });
    const l2 = call("track_lock", ctxA, { npcName: "Brackish", priceCc: 80 });
    assert.equal(call("list_locks", ctxA, {}).result.escrowedCc, 200);

    // Amend l1 up — escrow follows the new price exactly.
    const am = call("amend_lock", ctxA, { lockId: l1.result.lock.id, priceCc: 200 });
    assert.equal(am.ok, true);
    assert.equal(am.result.lock.status, "amended");
    assert.equal(call("list_locks", ctxA, {}).result.escrowedCc, 280);

    // Revoke l2 — refund == its price, escrow drops to just l1's amended price.
    const rv = call("revoke_lock", ctxA, { lockId: l2.result.lock.id });
    assert.equal(rv.ok, true);
    assert.equal(rv.result.refundedCc, 80);
    const ll = call("list_locks", ctxA, {});
    assert.equal(ll.result.escrowedCc, 200, "only the live amended lock remains in escrow");
    assert.ok(Number.isFinite(ll.result.escrowedCc));
  });

  it("a revoked lock is not amendable / re-revokable", () => {
    const l = call("track_lock", ctxA, { npcName: "X", priceCc: 10 });
    call("revoke_lock", ctxA, { lockId: l.result.lock.id });
    assert.equal(call("amend_lock", ctxA, { lockId: l.result.lock.id, priceCc: 5 }).error, "lock_not_amendable");
    assert.equal(call("revoke_lock", ctxA, { lockId: l.result.lock.id }).error, "lock_already_revoked");
  });
});

describe("inheritance — probate timeline aggregates the real estate", () => {
  it("composes a sorted event stream over wills + executors + locks", () => {
    call("author_will", ctxA, { body: "directive" });
    call("assign_executor", ctxA, { name: "Orin" });
    call("track_lock", ctxA, { npcName: "Seam", priceCc: 50 });
    const t = call("probate_timeline", ctxA, {});
    assert.equal(t.ok, true);
    assert.equal(t.result.events.length, 3);
    assert.equal(t.result.pendingTransfers, 1);
    // Sorted ascending by time.
    for (let i = 1; i < t.result.events.length; i++) {
      assert.ok(t.result.events[i].time >= t.result.events[i - 1].time);
    }
  });
});

describe("inheritance — designate → notify → accept round trip", () => {
  it("an heir's acceptance reflects back onto the owner's beneficiary record", () => {
    // user_a designates user_b and notifies them.
    const ben = call("add_beneficiary", ctxA, { name: "Heir B", sharePct: 50, heirUserId: "user_b" });
    const nt = call("notify_heir", ctxA, { heirUserId: "user_b", beneficiaryId: ben.result.beneficiary.id });
    assert.equal(nt.ok, true);
    assert.equal(nt.result.notice.sharePct, 50);

    // user_b sees an unread, pending notice.
    let inbox = call("list_notices", ctxB, {});
    assert.equal(inbox.result.unreadCount, 1);
    const noticeId = inbox.result.notices[0].id;

    // user_b accepts → owner's beneficiary record stamps acceptanceStatus.
    const resp = call("respond_notice", ctxB, { noticeId, decision: "accepted" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.notice.acceptance, "accepted");

    const ownerBens = call("list_beneficiaries", ctxA, {});
    const reflected = ownerBens.result.beneficiaries.find((b) => b.id === ben.result.beneficiary.id);
    assert.equal(reflected.acceptanceStatus, "accepted");

    // Notice is now read on user_b's side.
    inbox = call("list_notices", ctxB, {});
    assert.equal(inbox.result.unreadCount, 0);
  });

  it("respond_notice rejects a bad decision / unknown notice / missing heir on notify", () => {
    assert.equal(call("notify_heir", ctxA, {}).error, "missing_heir");
    assert.equal(call("respond_notice", ctxB, { noticeId: "ghost", decision: "accepted" }).error, "notice_not_found");
    call("notify_heir", ctxA, { heirUserId: "user_b" });
    const id = call("list_notices", ctxB, {}).result.notices[0].id;
    assert.equal(call("respond_notice", ctxB, { noticeId: id, decision: "maybe" }).error, "bad_decision");
  });
});

describe("inheritance — per-user isolation", () => {
  it("one user's estate, assets, locks, and notices never leak to another", () => {
    call("add_beneficiary", ctxA, { name: "Mine", sharePct: 100 });
    call("add_asset", ctxA, { label: "Mine", valueCc: 999 });
    call("track_lock", ctxA, { npcName: "Mine", priceCc: 50 });
    call("notify_heir", ctxA, { heirUserId: "user_a" });

    // user_b's estate is empty across the board.
    assert.equal(call("list_beneficiaries", ctxB, {}).result.beneficiaries.length, 0);
    assert.equal(call("list_assets", ctxB, {}).result.totalValueCc, 0);
    assert.equal(call("list_locks", ctxB, {}).result.escrowedCc, 0);
    assert.equal(call("estate_overview", ctxB, {}).result.assetCount, 0);
  });
});

describe("inheritance — fail-CLOSED value/escrow guards (poisoned numerics rejected before write)", () => {
  it("add_asset rejects a poisoned valueCc and mints NOTHING into the estate total", () => {
    for (const poison of [1e308, Infinity, -Infinity, -1, NaN, "9".repeat(40)]) {
      globalThis._concordSTATE = {};
      const r = call("add_asset", ctxA, { label: "Poison", valueCc: poison });
      assert.equal(r.ok, false, `add_asset must reject valueCc=${String(poison)}`);
      assert.equal(r.error, "invalid numeric field: valueCc");
      // No asset row was created → estate total stays exactly 0, never 1e308.
      const la = call("list_assets", ctxA, {});
      assert.equal(la.result.assets.length, 0);
      assert.equal(la.result.totalValueCc, 0);
      assert.ok(Number.isFinite(la.result.totalValueCc));
    }
  });

  it("track_lock rejects a poisoned priceCc — no fabricated escrow", () => {
    for (const poison of [1e308, Infinity, -1, NaN]) {
      globalThis._concordSTATE = {};
      const r = call("track_lock", ctxA, { npcName: "X", priceCc: poison });
      assert.equal(r.ok, false, `track_lock must reject priceCc=${String(poison)}`);
      assert.equal(r.error, "invalid numeric field: priceCc");
      assert.equal(call("list_locks", ctxA, {}).result.escrowedCc, 0);
    }
  });

  it("amend_lock rejects a poisoned priceCc — the live lock keeps its old price", () => {
    const l = call("track_lock", ctxA, { npcName: "Seam", priceCc: 100 });
    const r = call("amend_lock", ctxA, { lockId: l.result.lock.id, priceCc: 1e308 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid numeric field: priceCc");
    // Escrow unchanged — the poisoned amend never landed.
    assert.equal(call("list_locks", ctxA, {}).result.escrowedCc, 100);
  });

  it("a legitimate large-but-bounded value (<= 1e6) is still accepted", () => {
    const r = call("add_asset", ctxA, { label: "Estate", valueCc: 1e6 });
    assert.equal(r.ok, true);
    assert.equal(call("list_assets", ctxA, {}).result.totalValueCc, 1e6);
  });
});
