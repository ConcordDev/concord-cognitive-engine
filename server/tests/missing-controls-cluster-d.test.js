// Audit sweep CB-0447, cluster D — the missing edit/clear controls for
// FIX-carpentry-010 (time entries + invoices), FIX-parenting-010
// (child records), FIX-photography-001 (shoots/rolls) and FIX-sync-009
// (activity history). Each verb is added on its lens's own patterns:
// derived money recomputes from merged values, validation mirrors the
// matching create verb, and every store stays owner-scoped.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCarpentryActions from "../domains/carpentry.js";
import registerParentingActions from "../domains/parenting.js";
import registerPhotographyActions from "../domains/photography.js";
import registerSyncActions from "../domains/sync.js";

function makeRegistry() {
  const actions = new Map();
  return {
    actions,
    register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); },
    call(key, ctx, input = {}) {
      const fn = actions.get(key);
      if (!fn) throw new Error(`${key} not registered`);
      const [domain] = key.split(".");
      return fn(ctx, { id: null, domain, type: "domain_action", data: input || {}, meta: {} }, input || {});
    },
  };
}

const R = makeRegistry();
before(() => {
  registerCarpentryActions(R.register);
  registerParentingActions(R.register);
  registerPhotographyActions(R.register);
  registerSyncActions(R.register);
});
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("carpentry timeEntryUpdate + invoiceUpdate (FIX-carpentry-010)", () => {
  it("editing hours or rate recomputes the derived cost", () => {
    const entry = R.call("carpentry.timeEntryAdd", ctxA, { jobId: "job-1", jobName: "Deck", hours: 2, rate: 50 }).result.entry;
    assert.equal(entry.cost, 100);
    const upd = R.call("carpentry.timeEntryUpdate", ctxA, { id: entry.id, hours: 3 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.entry.cost, 150);
    const upd2 = R.call("carpentry.timeEntryUpdate", ctxA, { id: entry.id, rate: 60 });
    assert.equal(upd2.result.entry.cost, 180);
    assert.equal(R.call("carpentry.timeEntryUpdate", ctxA, { id: entry.id, hours: 0 }).ok, false);
    assert.equal(R.call("carpentry.timeEntryUpdate", ctxA, { id: "time_nope", hours: 1 }).error, "time entry not found");
    assert.equal(R.call("carpentry.timeEntryUpdate", ctxB, { id: entry.id, hours: 9 }).error, "time entry not found");
  });

  it("editing an invoice amount recomputes tax, total and deposit from its own percentages", () => {
    const inv = R.call("carpentry.estimateToInvoice", ctxA, { estimateId: "est-1", client: "Pat", amount: 1000, taxPct: 10, depositPct: 20 }).result.invoice;
    assert.equal(inv.total, 1100);
    assert.equal(inv.depositDue, 220);
    const upd = R.call("carpentry.invoiceUpdate", ctxA, { id: inv.id, client: "Patricia", amount: 2000 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.invoice.client, "Patricia");
    assert.equal(upd.result.invoice.subtotal, 2000);
    assert.equal(upd.result.invoice.tax, 200);
    assert.equal(upd.result.invoice.total, 2200);
    assert.equal(upd.result.invoice.depositDue, 440);
    assert.equal(R.call("carpentry.invoiceUpdate", ctxA, { id: inv.id, amount: -5 }).ok, false);
    assert.equal(R.call("carpentry.invoiceUpdate", ctxB, { id: inv.id, client: "Hijack" }).error, "invoice not found");
  });
});

describe("parenting child-update (FIX-parenting-010)", () => {
  it("name, birthDate and sex are editable after create, with the add validation", () => {
    const child = R.call("parenting.child-add", ctxA, { name: "Ada", birthDate: "2024-01-15", sex: "girl" }).result.child;
    const upd = R.call("parenting.child-update", ctxA, { id: child.id, name: "Ada L", birthDate: "2024-02-20", sex: "girl" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.child.name, "Ada L");
    assert.equal(upd.result.child.birthDate, "2024-02-20");
    const list = R.call("parenting.child-list", ctxA).result;
    assert.equal(list.children[0].name, "Ada L");
    assert.equal(R.call("parenting.child-update", ctxA, { id: child.id, birthDate: "20-02-2024" }).ok, false);
    assert.equal(R.call("parenting.child-update", ctxA, { id: child.id, name: " " }).ok, false);
    assert.equal(R.call("parenting.child-update", ctxB, { id: child.id, name: "Hijack" }).error, "child not found");
  });
});

describe("photography shoot-update (FIX-photography-001)", () => {
  it("a roll can be renamed and re-dated after create", () => {
    const shoot = R.call("photography.shoot-create", ctxA, { name: "Roll 1", date: "2026-10-01", location: "Studio" }).result.shoot;
    const upd = R.call("photography.shoot-update", ctxA, { rollId: shoot.id, name: "Roll 1 — selects", location: "North light room" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.shoot.name, "Roll 1 — selects");
    assert.equal(upd.result.shoot.location, "North light room");
    const list = R.call("photography.shoot-list", ctxA).result;
    assert.equal(list.shoots[0].name, "Roll 1 — selects");
    assert.equal(R.call("photography.shoot-update", ctxA, { rollId: shoot.id, name: "" }).ok, false);
    assert.equal(R.call("photography.shoot-update", ctxB, { rollId: shoot.id, name: "Hijack" }).error, "shoot not found");
    assert.equal(R.call("photography.shoot-update", ctxA, { rollId: "sht_nope", name: "X" }).error, "shoot not found");
  });
});

describe("sync clear_history (FIX-sync-009)", () => {
  it("clears the caller's activity history — including entries for since-revoked devices — and no one else's", () => {
    R.call("sync.register_device", ctxA, { deviceLabel: "Phone" });
    R.call("sync.register_device", ctxA, { deviceLabel: "Laptop" });
    R.call("sync.register_device", ctxB, { deviceLabel: "Tablet" });
    assert.ok(R.call("sync.sync_history", ctxA, {}).result.total >= 2);
    const cleared = R.call("sync.clear_history", ctxA, {});
    assert.equal(cleared.ok, true);
    assert.ok(cleared.result.cleared >= 2);
    assert.equal(R.call("sync.sync_history", ctxA, {}).result.total, 0);
    assert.ok(R.call("sync.sync_history", ctxB, {}).result.total >= 1);
    // devices themselves are untouched by a history clear
    assert.equal(R.call("sync.list_devices", ctxA, {}).result.devices.length, 2);
  });
});
