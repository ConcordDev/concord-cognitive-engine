// Contract tests for the mining lens — drill-hole database, block model,
// grade-tonnage curve, pit design, production scheduling, fleet
// management, JORC/NI 43-101 reserve reporting and the GIS layer.
// Covers the buildable backlog from docs/lens-specs/mining.md.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMiningActions from "../domains/mining.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mining.${name}`);
  assert.ok(fn, `mining.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMiningActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// helper — build a drill-hole with two positive-grade intervals.
function seedHole(ctx, name = "DDH-1", siteId = null) {
  const hole = call("drillhole-add", ctx, {
    name, siteId, collarX: 0, collarY: 0, collarZ: 100,
    azimuth: 0, dip: -90, totalDepth: 100,
  }).result.hole;
  call("drillhole-log-interval", ctx, { holeId: hole.id, from: 10, to: 20, lithology: "fresh_ore", assayGrade: 2.5 });
  call("drillhole-log-interval", ctx, { holeId: hole.id, from: 20, to: 30, lithology: "fresh_ore", assayGrade: 1.2 });
  return hole;
}

describe("mining.drillhole database", () => {
  it("adds a hole scoped per user and lists it", () => {
    call("drillhole-add", ctxA, { name: "DDH-1", totalDepth: 80 });
    const list = call("drillhole-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(call("drillhole-list", ctxB, {}).result.count, 0);
  });

  it("rejects a nameless hole", () => {
    assert.equal(call("drillhole-add", ctxA, {}).ok, false);
  });

  it("logs intervals sorted by depth and rejects to<=from", () => {
    const h = call("drillhole-add", ctxA, { name: "DDH-2" }).result.hole;
    call("drillhole-log-interval", ctxA, { holeId: h.id, from: 20, to: 30, assayGrade: 1 });
    call("drillhole-log-interval", ctxA, { holeId: h.id, from: 5, to: 10, assayGrade: 1 });
    const bad = call("drillhole-log-interval", ctxA, { holeId: h.id, from: 40, to: 40 });
    assert.equal(bad.ok, false);
    const listed = call("drillhole-list", ctxA, {}).result.holes[0];
    assert.equal(listed.intervals[0].from, 5);
    assert.equal(listed.intervalCount, 2);
  });

  it("deletes a hole", () => {
    const h = call("drillhole-add", ctxA, { name: "DDH-3" }).result.hole;
    assert.equal(call("drillhole-delete", ctxA, { id: h.id }).ok, true);
    assert.equal(call("drillhole-list", ctxA, {}).result.count, 0);
  });
});

describe("mining.block-model", () => {
  it("returns an empty note when no intervals are logged", () => {
    const r = call("block-model", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.composites, 0);
  });

  it("builds an IDW block model from logged drill data", () => {
    seedHole(ctxA);
    const r = call("block-model", ctxA, { blockSize: 15, cutoffGrade: 0.5 });
    assert.equal(r.ok, true);
    assert.ok(r.result.composites >= 2);
    assert.ok(r.result.totalBlocks > 0);
    assert.ok(r.result.dimensions.nx >= 1);
  });
});

describe("mining.grade-tonnage-curve", () => {
  it("produces a monotonic decreasing tonnage curve", () => {
    seedHole(ctxA);
    const r = call("grade-tonnage-curve", ctxA, { blockSize: 15, densityTonM3: 2.7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.curve.length > 0);
    const t = r.result.curve.map((p) => p.tonnes);
    for (let i = 1; i < t.length; i++) assert.ok(t[i] <= t[i - 1]);
  });
});

describe("mining.pit-design", () => {
  it("designs an open-pit shell with benches and strip ratio", () => {
    const r = call("pit-design", ctxA, { surfaceRL: 100, pitDepth: 120, benchHeight: 15, slopeAngle: 45, targetStripRatio: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.benchCount, r.result.benches.length);
    assert.equal(r.result.pitBottomRL, -20);
    assert.equal(r.result.oreTonnage + r.result.wasteTonnage, r.result.totalTonnage);
  });
});

describe("mining.production-schedule", () => {
  it("computes haul-cycle daily targets", () => {
    const r = call("production-schedule", ctxA, { targetTonnage: 100000, truckCount: 6, days: 30 });
    assert.equal(r.ok, true);
    assert.ok(r.result.schedule.dailyCapacity > 0);
    assert.ok(r.result.schedule.dailyPlan.length > 0);
  });

  it("persists a schedule when save is set and lists it", () => {
    call("production-schedule", ctxA, { targetTonnage: 50000, days: 20, save: true });
    const list = call("schedule-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(call("schedule-list", ctxB, {}).result.count, 0);
  });
});

describe("mining.equipment / fleet management", () => {
  it("adds, lists via dashboard, updates and deletes equipment", () => {
    const u = call("equipment-add", ctxA, { name: "CAT 793", kind: "haul_truck", engineHours: 100, scheduledHours: 200, nextServiceHours: 500 }).result.unit;
    let dash = call("fleet-dashboard", ctxA, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.fleetSize, 1);
    assert.equal(dash.result.units[0].utilization, 50);
    call("equipment-update", ctxA, { id: u.id, status: "maintenance", engineHours: 520 });
    dash = call("fleet-dashboard", ctxA, {});
    assert.equal(dash.result.inMaintenance, 1);
    assert.equal(dash.result.units[0].serviceDue, true);
    assert.equal(call("equipment-delete", ctxA, { id: u.id }).ok, true);
    assert.equal(call("fleet-dashboard", ctxA, {}).result.fleetSize, 0);
  });

  it("rejects a nameless unit", () => {
    assert.equal(call("equipment-add", ctxA, {}).ok, false);
  });
});

describe("mining.reserve-report", () => {
  it("splits resources by drill density into JORC categories", () => {
    const r = call("reserve-report", ctxA, { tonnage: 1000000, avgGrade: 1.5, drillSpacingMeters: 25, recoveryPercent: 90, code: "jorc" });
    assert.equal(r.ok, true);
    assert.equal(r.result.code, "JORC 2012");
    assert.equal(r.result.resources.length, 3);
    assert.equal(r.result.reserves.totalReserveTonnes, r.result.reserves.proved.tonnage + r.result.reserves.probable.tonnage);
  });

  it("honours the NI 43-101 code", () => {
    const r = call("reserve-report", ctxA, { tonnage: 500000, avgGrade: 2, drillSpacingMeters: 150, code: "ni43-101" });
    assert.equal(r.result.code, "NI 43-101");
    assert.equal(r.result.confidenceClass, "exploration");
  });
});

describe("mining.gis-layer", () => {
  it("projects geo-referenced sites and drill collars", () => {
    const site = call("site-add", ctxA, { name: "Pit 9", commodity: "gold" }).result.site;
    call("site-set-location", ctxA, { id: site.id, lat: -23.4, lng: 119.7 });
    seedHole(ctxA, "DDH-9", site.id);
    const r = call("gis-layer", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.sites, 1);
    assert.equal(r.result.drillholes, 1);
    assert.ok(r.result.count >= 2);
  });

  it("site-set-location rejects invalid coordinates", () => {
    const site = call("site-add", ctxA, { name: "S" }).result.site;
    assert.equal(call("site-set-location", ctxA, { id: site.id, lat: 999, lng: 0 }).ok, false);
  });
});
