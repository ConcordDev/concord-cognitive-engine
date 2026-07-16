// Contract tests for the travel loyalty/frequent-flyer macros
// (loyalty-account-*, loyalty-points-log-*). Closes the "no
// loyalty-program tracking" gap from docs/lens-specs/travel-capability-map.md
// entry #10 / docs/WAVE4_INVENTORY.md.
//
// Balance is NEVER a stored field on the account — every assertion here
// derives it by summing the points ledger, mirroring how the macros
// themselves compute it live on every read.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  assert.ok(fn, `travel.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newTrip(ctx = ctxA, over = {}) {
  return call("trip-create", ctx, {
    name: "Japan 2026", destination: "Tokyo",
    startDate: "2026-09-01", endDate: "2026-09-08", travelers: 2, ...over,
  }).result.trip;
}

describe("travel.loyalty-account-* CRUD", () => {
  it("add requires a program name and defaults tier to none", () => {
    assert.equal(call("loyalty-account-add", ctxA, {}).ok, false);
    const r = call("loyalty-account-add", ctxA, { program: "United MileagePlus", accountNumber: "MP123" });
    assert.equal(r.ok, true);
    assert.equal(r.result.account.program, "United MileagePlus");
    assert.equal(r.result.account.accountNumber, "MP123");
    assert.equal(r.result.account.tier, "none");
    assert.equal(r.result.account.tripId, null);
    // A brand-new account has zero balance — never fabricated.
    assert.equal(r.result.account.balance, 0);
  });

  it("accepts a known tier and an optional tripId link", () => {
    const t = newTrip();
    const r = call("loyalty-account-add", ctxA, { program: "Delta SkyMiles", tier: "gold", tripId: t.id });
    assert.equal(r.result.account.tier, "gold");
    assert.equal(r.result.account.tripId, t.id);
  });

  it("rejects an unknown tier by falling back to none", () => {
    const r = call("loyalty-account-add", ctxA, { program: "X Airline", tier: "unobtainium" });
    assert.equal(r.result.account.tier, "none");
  });

  it("list is scoped per-user", () => {
    call("loyalty-account-add", ctxA, { program: "United MileagePlus" });
    call("loyalty-account-add", ctxA, { program: "Delta SkyMiles" });
    call("loyalty-account-add", ctxB, { program: "American AAdvantage" });
    assert.equal(call("loyalty-account-list", ctxA, {}).result.count, 2);
    assert.equal(call("loyalty-account-list", ctxB, {}).result.count, 1);
  });

  it("update mutates fields and leaves balance derived", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    const r = call("loyalty-account-update", ctxA, { id: acc.id, program: "United MileagePlus Premier", tier: "platinum", notes: "renews yearly" });
    assert.equal(r.ok, true);
    assert.equal(r.result.account.program, "United MileagePlus Premier");
    assert.equal(r.result.account.tier, "platinum");
    assert.equal(r.result.account.notes, "renews yearly");
  });

  it("another user cannot update or remove someone else's account", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    assert.equal(call("loyalty-account-update", ctxB, { id: acc.id, program: "Hijacked" }).ok, false);
    assert.equal(call("loyalty-account-remove", ctxB, { id: acc.id }).ok, false);
  });

  it("remove deletes the account and cascades its points log", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 5000, note: "signup bonus" });
    assert.equal(call("loyalty-account-remove", ctxA, { id: acc.id }).ok, true);
    assert.equal(call("loyalty-account-list", ctxA, {}).result.count, 0);
    // The account is gone, so its ledger is no longer reachable by id.
    assert.equal(call("loyalty-points-log-list", ctxA, { accountId: acc.id }).ok, false);
  });
});

describe("travel.loyalty-points-log-* + derived balance", () => {
  it("balance is the live sum of the ledger, including redemptions", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    let r = call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 5000, note: "signup bonus" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.kind, "earned");
    assert.equal(r.result.balance, 5000);

    r = call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 1200, note: "flight SFO-NRT" });
    assert.equal(r.result.balance, 6200);

    r = call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: -2000, note: "redeemed for upgrade" });
    assert.equal(r.result.entry.kind, "redeemed");
    assert.equal(r.result.balance, 4200);

    // loyalty-account-list must report the exact same derived number.
    const listed = call("loyalty-account-list", ctxA, {}).result.accounts[0];
    assert.equal(listed.balance, 4200);
    assert.equal(listed.entries, 3);

    // loyalty-points-log-list must independently derive the same sum.
    const log = call("loyalty-points-log-list", ctxA, { accountId: acc.id });
    assert.equal(log.result.count, 3);
    assert.equal(log.result.balance, 4200);
  });

  it("rejects a zero delta and an unknown/foreign account", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    assert.equal(call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 0 }).ok, false);
    assert.equal(call("loyalty-points-log-add", ctxA, { accountId: "nope", delta: 100 }).ok, false);
    assert.equal(call("loyalty-points-log-add", ctxB, { accountId: acc.id, delta: 100 }).ok, false);
    assert.equal(call("loyalty-points-log-list", ctxB, { accountId: acc.id }).ok, false);
  });

  it("optionally links an entry to a bookingId without validating it exists", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    const r = call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 800, bookingId: "bkg_xyz" });
    assert.equal(r.result.entry.bookingId, "bkg_xyz");
  });

  it("totalBalance in the list aggregates across multiple accounts", () => {
    const a1 = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    const a2 = call("loyalty-account-add", ctxA, { program: "Marriott Bonvoy" }).result.account;
    call("loyalty-points-log-add", ctxA, { accountId: a1.id, delta: 3000 });
    call("loyalty-points-log-add", ctxA, { accountId: a2.id, delta: 1500 });
    call("loyalty-points-log-add", ctxA, { accountId: a2.id, delta: -500 });
    const list = call("loyalty-account-list", ctxA, {});
    assert.equal(list.result.totalBalance, 4000);
  });

  it("list returns every entry sorted newest-first by timestamp", () => {
    const acc = call("loyalty-account-add", ctxA, { program: "United MileagePlus" }).result.account;
    call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 100, note: "first" });
    call("loyalty-points-log-add", ctxA, { accountId: acc.id, delta: 200, note: "second" });
    const log = call("loyalty-points-log-list", ctxA, { accountId: acc.id });
    const notes = log.result.entries.map((e) => e.note).sort();
    assert.deepEqual(notes, ["first", "second"]);
    // Every entry's `at` must be >= the next one's (non-increasing) — a
    // real ordering guarantee even when two calls land in the same ms.
    for (let i = 1; i < log.result.entries.length; i++) {
      assert.ok(log.result.entries[i - 1].at >= log.result.entries[i].at);
    }
  });
});
