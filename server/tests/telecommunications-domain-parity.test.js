// Contract tests for server/domains/telecommunications.js — the legacy
// calculators plus the full RF network-planning suite (propagation,
// interference, capacity projection, topology, spectrum, outages/SLA,
// drive-test). Every macro must return { ok, ... } and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTelecommunicationsActions from "../domains/telecommunications.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`telecommunications.${name}`);
  if (!fn) throw new Error(`telecommunications.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerTelecommunicationsActions(register); });

// fresh per-user state for each test
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "telco_user_a" }, userId: "telco_user_a" };

describe("telecommunications — legacy calculators", () => {
  it("networkCapacity computes per-user Mbps + headroom", () => {
    const r = call("networkCapacity", ctxA, {}, {
      data: { bandwidthGbps: 10, utilizationPercent: 60, activeUsers: 1000 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.availablePerUser.includes("Mbps"));
    assert.equal(r.result.headroom, "40%");
  });

  it("signalQuality returns a MOS score and voice grade", () => {
    const r = call("signalQuality", ctxA, {}, {
      data: { snrDb: 25, bitErrorRate: 1e-6, latencyMs: 20, jitterMs: 4 },
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.mosScore >= 1 && r.result.mosScore <= 5);
    assert.equal(typeof r.result.videoCapable, "boolean");
  });

  it("coverageMap aggregates tower coverage", () => {
    const r = call("coverageMap", ctxA, {}, {
      data: { towers: [{ name: "T1", lat: 1, lon: 1, rangeKm: 5, technology: "5G" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.towers, 1);
    assert.ok(r.result.totalCoverageKm2 > 0);
  });

  it("costPerLine computes margin + breakeven", () => {
    const r = call("costPerLine", ctxA, {}, {
      data: { infrastructureCost: 120000, monthlyOpsCost: 5000, subscribers: 500, arpu: 50 },
    });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.profitable, "boolean");
  });
});

describe("telecommunications — tower CRUD", () => {
  it("towerList starts empty and towerSave persists a site", () => {
    assert.deepEqual(call("towerList", ctxA).result.towers, []);
    const r = call("towerSave", ctxA, { name: "Alpha", lat: 40.7, lon: -74 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tower.name, "Alpha");
    assert.equal(call("towerList", ctxA).result.towers.length, 1);
  });

  it("towerSave rejects missing coordinates", () => {
    const r = call("towerSave", ctxA, { name: "Bad" });
    assert.equal(r.ok, false);
  });

  it("towerDelete removes a saved site", () => {
    const saved = call("towerSave", ctxA, { name: "Gone", lat: 1, lon: 1 });
    const r = call("towerDelete", ctxA, { id: saved.result.tower.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.removed, 1);
    assert.equal(call("towerList", ctxA).result.towers.length, 0);
  });
});

describe("telecommunications — RF propagation model", () => {
  it("propagationModel rejects when no towers", () => {
    const r = call("propagationModel", ctxA);
    assert.equal(r.ok, false);
  });

  it("propagationModel computes terrain-aware coverage cells", () => {
    call("towerSave", ctxA, { name: "P1", lat: 40, lon: -74, terrain: "urban", powerWatts: 40 });
    const r = call("propagationModel", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.cells.length, 1);
    assert.ok(r.result.cells[0].effectiveRangeKm > 0);
    assert.ok(r.result.totalCoverageKm2 > 0);
    assert.match(r.result.model, /COST-231/);
  });
});

describe("telecommunications — interference analysis", () => {
  it("interferenceAnalysis needs at least 2 towers", () => {
    call("towerSave", ctxA, { name: "Lone", lat: 1, lon: 1 });
    const r = call("interferenceAnalysis", ctxA);
    assert.equal(r.ok, false);
  });

  it("detects overlapping co-channel cells", () => {
    call("towerSave", ctxA, { name: "A", lat: 40.000, lon: -74.000, freqMhz: 1800, powerWatts: 60 });
    call("towerSave", ctxA, { name: "B", lat: 40.005, lon: -74.000, freqMhz: 1801, powerWatts: 60 });
    const r = call("interferenceAnalysis", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.pairsAnalyzed, 1);
    assert.ok(r.result.overlappingPairs >= 1);
    assert.ok(r.result.coChannelConflicts >= 1);
  });
});

describe("telecommunications — capacity projection", () => {
  it("projects subscriber growth vs headroom", () => {
    const r = call("capacityProjection", ctxA, {
      bandwidthGbps: 1, currentSubscribers: 5000, monthlyGrowthPercent: 8, months: 24,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 25);
    assert.ok(r.result.recommendedBandwidthGbps > 0);
  });

  it("flags a breach month when capacity is exhausted", () => {
    const r = call("capacityProjection", ctxA, {
      bandwidthGbps: 0.5, currentSubscribers: 5000, monthlyGrowthPercent: 10, months: 36,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.breachMonth !== null);
  });
});

describe("telecommunications — network topology", () => {
  it("topology rejects when no towers", () => {
    assert.equal(call("topology", ctxA).ok, false);
  });

  it("builds a core/backhaul/tower tree", () => {
    call("towerSave", ctxA, { name: "T1", lat: 1, lon: 1, backhaul: "fiber" });
    call("towerSave", ctxA, { name: "T2", lat: 2, lon: 2, backhaul: "microwave" });
    const r = call("topology", ctxA, { coreNodeName: "Core EPC" });
    assert.equal(r.ok, true);
    assert.equal(r.result.towerCount, 2);
    assert.equal(r.result.aggregationHubs, 2);
    assert.equal(r.result.tree.label, "Core EPC");
    assert.ok(Array.isArray(r.result.links));
  });
});

describe("telecommunications — spectrum planner", () => {
  it("spectrumList starts empty; spectrumAllocate adds a block", () => {
    assert.deepEqual(call("spectrumList", ctxA).result.allocations, []);
    const r = call("spectrumAllocate", ctxA, { band: "n78", startMhz: 3300, widthMhz: 100 });
    assert.equal(r.ok, true);
    assert.equal(r.result.allocation.endMhz, 3400);
  });

  it("rejects an overlapping allocation without allowOverlap", () => {
    call("spectrumAllocate", ctxA, { band: "A", startMhz: 700, widthMhz: 20 });
    const r = call("spectrumAllocate", ctxA, { band: "B", startMhz: 710, widthMhz: 20 });
    assert.equal(r.ok, false);
    assert.match(r.error, /overlap/i);
  });

  it("spectrumPlan reports gaps + guard violations", () => {
    call("spectrumAllocate", ctxA, { band: "A", startMhz: 700, widthMhz: 20, guardBandMhz: 5 });
    call("spectrumAllocate", ctxA, { band: "B", startMhz: 800, widthMhz: 20, guardBandMhz: 5 });
    const r = call("spectrumPlan", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.totalAllocatedMhz > 0);
    assert.ok(Array.isArray(r.result.gaps));
    assert.ok(Array.isArray(r.result.byTechnology));
  });

  it("spectrumDelete removes an allocation", () => {
    const a = call("spectrumAllocate", ctxA, { band: "X", startMhz: 900, widthMhz: 10 });
    const r = call("spectrumDelete", ctxA, { id: a.result.allocation.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.removed, 1);
  });
});

describe("telecommunications — outage / SLA dashboard", () => {
  it("outageReport logs an incident; outageList returns it", () => {
    const r = call("outageReport", ctxA, { site: "S1", cause: "power", severity: "major" });
    assert.equal(r.ok, true);
    assert.equal(r.result.outage.status, "open");
    assert.equal(call("outageList", ctxA).result.outages.length, 1);
  });

  it("outageResolve closes an open incident", () => {
    const o = call("outageReport", ctxA, { site: "S2", cause: "fiber cut" });
    const r = call("outageResolve", ctxA, { id: o.result.outage.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.outage.status, "resolved");
  });

  it("slaReport computes availability + MTTR over a window", () => {
    const now = Date.now();
    call("outageReport", ctxA, {
      site: "S3", cause: "x", severity: "critical",
      startedAt: now - 2 * 3600 * 1000, resolvedAt: now - 1 * 3600 * 1000,
    });
    const r = call("slaReport", ctxA, { windowDays: 30, slaTargetPercent: 99.9 });
    assert.equal(r.ok, true);
    assert.ok(r.result.availabilityPercent <= 100);
    assert.equal(typeof r.result.slaMet, "boolean");
    assert.ok(Array.isArray(r.result.bySeverity));
  });
});

describe("telecommunications — drive-test validation", () => {
  it("driveTestImport stores measurements; driveTestList returns them", () => {
    const r = call("driveTestImport", ctxA, {
      measurements: [
        { lat: 40.71, lon: -74.0, rsrpDbm: -82, technology: "4G" },
        { lat: 40.72, lon: -74.01, rsrpDbm: -95 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    assert.equal(call("driveTestList", ctxA).result.measurements.length, 2);
  });

  it("driveTestImport rejects an empty array", () => {
    assert.equal(call("driveTestImport", ctxA, { measurements: [] }).ok, false);
  });

  it("driveTestValidate compares measured vs predicted RSRP", () => {
    call("towerSave", ctxA, { name: "DT", lat: 40.71, lon: -74.0, powerWatts: 40 });
    call("driveTestImport", ctxA, {
      measurements: [{ lat: 40.711, lon: -74.001, rsrpDbm: -85 }],
    });
    const r = call("driveTestValidate", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.sampleCount, 1);
    assert.ok(Number.isFinite(r.result.rmseDbm));
    assert.ok(typeof r.result.modelGrade === "string");
  });
});
