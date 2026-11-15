// FIX-mining-011 (audit sweep CB-0447) — sites, drill-holes, fleet
// units and assay intervals gain the edit controls the ticket found
// missing. site-update and equipment-update existed but only accepted
// status/tonnage-style fields, and the frontend never called them for
// an edit; drill-holes and intervals had no update verb at all, and
// an interval could only be removed by deleting its parent hole.
// Pins the widened/new verbs: in-place updates on the lens's own
// validation, owner scope, honest not-found errors.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMiningActions from "../domains/mining.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "mining", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`mining.${name} not registered`);
  return fn(ctx, { id: null, domain: "mining", type: "domain_action", data: input || {}, meta: {} }, input || {});
}

before(() => { registerMiningActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("mining edit controls (FIX-mining-011)", () => {
  it("site-update renames and re-kinds a site in place", () => {
    const site = call("site-add", ctxA, { name: "North Pit", kind: "surface", commodity: "iron" }).result.site;
    const upd = call("site-update", ctxA, { id: site.id, name: "North Pit Extension", kind: "underground", commodity: "magnetite" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.site.id, site.id);
    const list = call("site-list", ctxA).result;
    assert.equal(list.count, 1);
    assert.equal(list.sites[0].name, "North Pit Extension");
    assert.equal(list.sites[0].kind, "underground");
    assert.equal(list.sites[0].commodity, "magnetite");
    assert.equal(call("site-update", ctxA, { id: site.id, name: "  " }).ok, false);
    assert.equal(call("site-update", ctxB, { id: site.id, name: "Hijack" }).error, "site not found");
  });

  it("drillhole-update edits collar, angles and depth with the add clamps", () => {
    const hole = call("drillhole-add", ctxA, { name: "DDH-001", collarX: 1, collarY: 2, collarZ: 3, azimuth: 10, dip: -80, totalDepth: 100 }).result.hole;
    const upd = call("drillhole-update", ctxA, { id: hole.id, name: "DDH-001A", azimuth: 400, dip: -95, totalDepth: 150 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.hole.name, "DDH-001A");
    assert.equal(upd.result.hole.azimuth, 360);
    assert.equal(upd.result.hole.dip, -90);
    assert.equal(upd.result.hole.totalDepth, 150);
    assert.equal(call("drillhole-update", ctxA, { id: "dh_nope", name: "X" }).error, "drill-hole not found");
    assert.equal(call("drillhole-update", ctxA, { id: hole.id, siteId: "ms_nope" }).error, "site not found");
  });

  it("an assay interval can be edited and deleted without touching its hole", () => {
    const hole = call("drillhole-add", ctxA, { name: "DDH-002", totalDepth: 200 }).result.hole;
    const iv1 = call("drillhole-log-interval", ctxA, { holeId: hole.id, from: 10, to: 20, lithology: "fresh_ore", assayGrade: 1.5, recovery: 95 }).result.interval;
    call("drillhole-log-interval", ctxA, { holeId: hole.id, from: 20, to: 30, lithology: "oxide", assayGrade: 0.8, recovery: 90 });
    const upd = call("drillhole-update-interval", ctxA, { holeId: hole.id, intervalId: iv1.id, assayGrade: 2.25, to: 22 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.interval.assayGrade, 2.25);
    assert.equal(upd.result.interval.to, 22);
    assert.equal(call("drillhole-update-interval", ctxA, { holeId: hole.id, intervalId: iv1.id, from: 25, to: 24 }).ok, false);
    assert.equal(call("drillhole-update-interval", ctxA, { holeId: hole.id, intervalId: "iv_nope", assayGrade: 1 }).error, "interval not found");
    const del = call("drillhole-delete-interval", ctxA, { holeId: hole.id, intervalId: iv1.id });
    assert.equal(del.ok, true);
    const after = call("drillhole-list", ctxA).result.holes[0];
    assert.equal(after.intervalCount, 1);
    assert.equal(after.intervals[0].lithology, "oxide");
    assert.equal(call("drillhole-delete-interval", ctxA, { holeId: hole.id, intervalId: iv1.id }).error, "interval not found");
  });

  it("equipment-update renames a unit and edits its schedule fields", () => {
    const unit = call("equipment-add", ctxA, { name: "HT-1", kind: "haul_truck", engineHours: 100, scheduledHours: 200, fuelLitres: 50, nextServiceHours: 500 }).result.unit;
    const upd = call("equipment-update", ctxA, { id: unit.id, name: "HT-1 Prime", kind: "excavator", scheduledHours: 260 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.unit.name, "HT-1 Prime");
    assert.equal(upd.result.unit.kind, "excavator");
    assert.equal(upd.result.unit.scheduledHours, 260);
    const dash = call("fleet-dashboard", ctxA).result;
    assert.equal(dash.units[0].scheduledHours, 260);
    assert.equal(dash.units[0].nextServiceHours, 500);
    assert.equal(call("equipment-update", ctxA, { id: unit.id, name: "" }).ok, false);
  });
});
