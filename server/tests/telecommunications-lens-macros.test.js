// Behavioral macro tests for server/domains/telecommunications.js — the telecom
// network-planning substrate the /lenses/telecommunications lens drives via
// lensRun('telecommunications', …).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39156-39160):
// handlers registered through `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, data)` — the 3-ARG convention,
// where the server first PEELS exactly one redundant `{ artifact: { data } }`
// wrapper (lib/lens-input-normalize.js#peelRedundantArtifactWrapper), then sets
// BOTH `virtualArtifact.data = data` AND passes `data` as the 3rd `params` arg.
// Our `call()` harness reproduces that EXACTLY (peel + double-set), so a
// regression that confuses the param positions OR the double-wrap shape surfaces
// here — the carpentry-class "dead calculator" defect.
//
// COMPONENT-EXACT SHAPE. The four calculators below are driven with the EXACT
// inner-data object the TelecommunicationsActionPanel sends and assert the EXACT
// fields it renders from `r.result`:
//   networkCapacity  ← { bandwidthGbps, utilizationPercent, activeUsers }
//                    → { totalBandwidth, utilization, activeUsers, availablePerUser, headroom, status, upgrade }
//   signalQuality    ← { snrDb, bitErrorRate, latencyMs, jitterMs }
//                    → { snr, bitErrorRate, latencyMs, jitterMs, mosScore, voiceQuality, videoCapable }
//   coverageMap      ← { towers: [...] }
//                    → { towers, activeTowers, totalCoverageKm2, technologies }
//   costPerLine      ← { infrastructureCost, monthlyOpsCost, subscribers, arpu }
//                    → { subscribers, arpu, costPerSubscriber, margin, marginPercent, profitable, breakeven }
// The RFPlanner suite (towers/spectrum/outages/propagation/interference/
// capacity/topology/drivetest) is driven with its FLAT-params shape.
//
// These are NOT shape-only assertions. Every test pins ACTUAL computed values:
// per-user bandwidth, MOS/voice quality, coverage km², margin %, COST-231 link
// budget + effective range, co-channel C/I, subscriber-growth breach month, SLA
// availability. Plus validation-rejection, degrade-graceful, per-user isolation,
// and fail-CLOSED poisoned-numeric cases (Infinity/NaN never reach a total).
//
// Hermetic: no server boot, no network, no LLM.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTelecommunicationsActions from "../domains/telecommunications.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "telecommunications", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch EXACTLY: peel the redundant artifact wrapper, then
// invoke handler(ctx, virtualArtifact, data) with virtualArtifact.data === data.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`telecommunications.${name} not registered`);
  const data = peelRedundantArtifactWrapper(input || {});
  const virtualArtifact = { id: null, domain: "telecommunications", type: "domain_action", data, meta: {} };
  return fn(ctx, virtualArtifact, data);
}

before(() => { registerTelecommunicationsActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// ── Registration ─────────────────────────────────────────────────

describe("telecommunications — registration", () => {
  it("registers every macro the lens calls via lensRun", () => {
    for (const m of [
      // TelecommunicationsActionPanel calculators
      "networkCapacity", "signalQuality", "coverageMap", "costPerLine",
      // RFPlanner — tower CRUD
      "towerList", "towerSave", "towerDelete",
      // RFPlanner — RF analysis
      "propagationModel", "interferenceAnalysis", "capacityProjection", "topology",
      // RFPlanner — spectrum
      "spectrumList", "spectrumAllocate", "spectrumDelete", "spectrumPlan",
      // RFPlanner — outages / SLA
      "outageList", "outageReport", "outageResolve", "slaReport",
      // RFPlanner — drive test
      "driveTestImport", "driveTestList", "driveTestValidate",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing telecommunications.${m}`);
    }
  });
});

// ── networkCapacity (COMPONENT-EXACT shape + DOUBLE-WRAP wiring) ──

describe("telecommunications — networkCapacity", () => {
  // The TelecommunicationsActionPanel sends:
  //   callMacro('networkCapacity', { artifact: { data: { bandwidthGbps, utilizationPercent, activeUsers } } })
  // which the dispatch peels to the inner object. The handler reads
  // artifact.data.{bandwidthGbps,utilizationPercent,activeUsers} and the panel
  // renders r.result.{status,utilization,totalBandwidth,availablePerUser,activeUsers,headroom,upgrade}.
  it("computes per-user bandwidth through the EXACT panel payload", () => {
    // 10 Gbps, 60% util, 1000 users:
    // perUser = (10*1000 * (1-0.6)) / 1000 = 4000/1000 = 4 Mbps.
    const r = call("networkCapacity", ctxA, { artifact: { data: { bandwidthGbps: 10, utilizationPercent: 60, activeUsers: 1000 } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.totalBandwidth, "10 Gbps");
    assert.equal(r.result.utilization, "60%");
    assert.equal(r.result.activeUsers, 1000);
    assert.equal(r.result.availablePerUser, "4 Mbps");
    assert.equal(r.result.headroom, "40%");
    assert.equal(r.result.status, "normal");
    assert.equal(r.result.upgrade, "Sufficient capacity");
  });

  it("flags critical status + upgrade above the 85% / 80% thresholds", () => {
    const r = call("networkCapacity", ctxA, { artifact: { data: { bandwidthGbps: 5, utilizationPercent: 90, activeUsers: 500 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "critical");
    assert.equal(r.result.upgrade, "Capacity upgrade recommended");
    // perUser = (5*1000 * 0.1) / 500 = 500/500 = 1 Mbps
    assert.equal(r.result.availablePerUser, "1 Mbps");
    assert.equal(r.result.headroom, "10%");
  });

  it("also accepts a bare-params payload (single shape, back-compat)", () => {
    const r = call("networkCapacity", ctxA, { bandwidthGbps: 20, utilizationPercent: 75, activeUsers: 2000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "high"); // >70, <85
    // perUser = (20*1000 * 0.25) / 2000 = 5000/2000 = 2.5 Mbps
    assert.equal(r.result.availablePerUser, "2.5 Mbps");
  });

  it("fail-CLOSED on a poisoned (Infinity) bandwidth — falls back to default, never NaN-leaks", () => {
    // 1e309 overflows to Infinity → num() rejects → fallback 10 Gbps.
    const r = call("networkCapacity", ctxA, { artifact: { data: { bandwidthGbps: 1e309, utilizationPercent: 60, activeUsers: 1000 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBandwidth, "10 Gbps"); // fell back to finite default
    // and the rendered per-user number is finite
    const perUser = parseFloat(r.result.availablePerUser);
    assert.equal(Number.isFinite(perUser), true);
  });

  it("never NaN-leaks with a NaN-string utilization (poisoned numeric)", () => {
    const r = call("networkCapacity", ctxA, { artifact: { data: { bandwidthGbps: 10, utilizationPercent: "NaN", activeUsers: 1000 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.utilization, "60%"); // fell back to default 60
    assert.equal(Number.isFinite(parseFloat(r.result.availablePerUser)), true);
  });
});

// ── signalQuality (COMPONENT-EXACT shape: SNR/BER → MOS) ─────────

describe("telecommunications — signalQuality", () => {
  it("computes MOS + voice/video verdicts through the EXACT panel payload", () => {
    // snr 20, ber 1e-6, latency 30, jitter 5:
    // mos = 4.5 - 30/100 - 5/20 - 0 = 4.5 - 0.3 - 0.25 = 3.95 → 4.0 (rounded).
    const r = call("signalQuality", ctxA, { artifact: { data: { snrDb: 20, bitErrorRate: 1e-6, latencyMs: 30, jitterMs: 5 } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.snr, "20 dB");
    assert.equal(r.result.bitErrorRate, 1e-6);
    assert.equal(r.result.latencyMs, 30);
    assert.equal(r.result.jitterMs, 5);
    assert.equal(r.result.mosScore, 4.0); // rounded display value
    // voiceQuality is keyed off the UNROUNDED mos (3.95 < 4) → "good", not "excellent".
    assert.equal(r.result.voiceQuality, "good");
    assert.equal(r.result.videoCapable, true); // latency<100 && jitter<30
  });

  it("rates excellent voice quality when MOS clears 4.0 (unrounded)", () => {
    // latency 20, jitter 5: mos = 4.5 - 0.2 - 0.25 = 4.05 → excellent.
    const r = call("signalQuality", ctxA, { artifact: { data: { snrDb: 25, bitErrorRate: 1e-6, latencyMs: 20, jitterMs: 5 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mosScore, 4.1); // round(4.05*10)/10
    assert.equal(r.result.voiceQuality, "excellent");
  });

  it("drops MOS + voice quality + video capability when BER + latency are bad", () => {
    // ber > 1e-4 subtracts 2; latency 150 (>100) → video false.
    const r = call("signalQuality", ctxA, { artifact: { data: { snrDb: 8, bitErrorRate: 1e-3, latencyMs: 150, jitterMs: 10 } } });
    assert.equal(r.ok, true);
    // mos = 4.5 - 1.5 - 0.5 - 2 = 0.5 → clamped to floor 1.
    assert.equal(r.result.mosScore, 1.0);
    assert.equal(r.result.voiceQuality, "poor"); // mos < 3
    assert.equal(r.result.videoCapable, false); // latency >= 100
  });

  it("classifies fair voice quality in the 3.0–3.5 MOS band", () => {
    // latency 120, jitter 5: mos = 4.5 - 1.2 - 0.25 = 3.05 → 3.1 → fair, video false (latency>=100)
    const r = call("signalQuality", ctxA, { artifact: { data: { snrDb: 15, bitErrorRate: 1e-6, latencyMs: 120, jitterMs: 5 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mosScore, 3.1);
    assert.equal(r.result.voiceQuality, "fair");
    assert.equal(r.result.videoCapable, false);
  });

  it("fail-CLOSED on poisoned numerics — Infinity latency falls back, MOS stays finite", () => {
    const r = call("signalQuality", ctxA, { artifact: { data: { snrDb: 20, bitErrorRate: 1e-6, latencyMs: 1e309, jitterMs: 5 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.latencyMs, 30); // fell back to finite default
    assert.equal(Number.isFinite(r.result.mosScore), true);
    assert.equal(r.result.mosScore >= 1 && r.result.mosScore <= 5, true);
  });
});

// ── coverageMap (COMPONENT-EXACT shape: towers array) ────────────

describe("telecommunications — coverageMap", () => {
  it("aggregates coverage area + active towers + technologies from the towers array", () => {
    // π·5² + π·10² = π·(25+100) = π·125 ≈ 392.7 → rounded 393.
    const r = call("coverageMap", ctxA, { artifact: { data: { towers: [
      { name: "Site A", lat: 40.7, lon: -74.0, rangeKm: 5, technology: "5G", status: "active" },
      { name: "Site B", lat: 40.8, lon: -74.1, rangeKm: 10, technology: "4G", status: "planned" },
    ] } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.towers, 2);
    assert.equal(r.result.activeTowers, 1); // only Site A is active
    assert.equal(r.result.totalCoverageKm2, 393);
    assert.deepEqual(r.result.technologies, ["5G", "4G"]);
  });

  it("returns a guidance message for an empty towers array (not an error)", () => {
    const r = call("coverageMap", ctxA, { artifact: { data: { towers: [] } } });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add tower locations/);
  });

  it("dedupes technologies + defaults missing fields", () => {
    const r = call("coverageMap", ctxA, { artifact: { data: { towers: [
      { id: "t1", rangeKm: 3 }, // no technology → "4G", no status → "active"
      { id: "t2", rangeKm: 3, technology: "4G" },
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.activeTowers, 2);
    assert.deepEqual(r.result.technologies, ["4G"]); // deduped
  });

  it("fail-CLOSED on a poisoned (Infinity) range — coverage stays finite", () => {
    const r = call("coverageMap", ctxA, { artifact: { data: { towers: [
      { name: "Bad", rangeKm: 1e309 }, // Infinity → num falls back to 5
    ] } } });
    assert.equal(r.ok, true);
    assert.equal(Number.isFinite(r.result.totalCoverageKm2), true);
    // π·5² ≈ 78.5 → 79 (fell back to default range 5)
    assert.equal(r.result.totalCoverageKm2, 79);
  });
});

// ── costPerLine (COMPONENT-EXACT shape: unit economics) ──────────

describe("telecommunications — costPerLine", () => {
  it("computes margin + break-even through the EXACT panel payload", () => {
    // infra 600000, ops 50000/mo, 10000 subs, arpu 50:
    // costPerSub = (600000/60 + 50000) / 10000 = (10000 + 50000)/10000 = 6.
    // margin = 50 - 6 = 44; marginPercent = round(44/50*100) = 88.
    const r = call("costPerLine", ctxA, { artifact: { data: { infrastructureCost: 600000, monthlyOpsCost: 50000, subscribers: 10000, arpu: 50 } } });
    assert.equal(r.ok, true, `double-wrap should resolve, got: ${r.error}`);
    assert.equal(r.result.subscribers, 10000);
    assert.equal(r.result.arpu, 50);
    assert.equal(r.result.costPerSubscriber, 6);
    assert.equal(r.result.margin, 44);
    assert.equal(r.result.marginPercent, 88);
    assert.equal(r.result.profitable, true);
    assert.equal(typeof r.result.breakeven, "string");
    assert.match(r.result.breakeven, /months$/);
  });

  it("flags unprofitable economics when cost exceeds ARPU", () => {
    // infra 6_000_000, ops 100000, 1000 subs, arpu 50:
    // costPerSub = (6000000/60 + 100000)/1000 = (100000+100000)/1000 = 200.
    // margin = 50 - 200 = -150 → not profitable.
    const r = call("costPerLine", ctxA, { artifact: { data: { infrastructureCost: 6000000, monthlyOpsCost: 100000, subscribers: 1000, arpu: 50 } } });
    assert.equal(r.ok, true);
    assert.equal(r.result.costPerSubscriber, 200);
    assert.equal(r.result.margin, -150);
    assert.equal(r.result.profitable, false);
  });

  it("accepts a bare-params payload too (single shape)", () => {
    const r = call("costPerLine", ctxA, { infrastructureCost: 1200000, monthlyOpsCost: 30000, subscribers: 5000, arpu: 40 });
    assert.equal(r.ok, true);
    // costPerSub = (1200000/60 + 30000)/5000 = (20000+30000)/5000 = 10
    assert.equal(r.result.costPerSubscriber, 10);
    assert.equal(r.result.margin, 30);
  });

  it("fail-CLOSED on a poisoned (Infinity) infrastructure cost — margin stays finite", () => {
    const r = call("costPerLine", ctxA, { artifact: { data: { infrastructureCost: 1e309, monthlyOpsCost: 50000, subscribers: 10000, arpu: 50 } } });
    assert.equal(r.ok, true);
    // Infinity infra → num falls back to 0 → costPerSub = (0 + 50000)/10000 = 5
    assert.equal(r.result.costPerSubscriber, 5);
    assert.equal(r.result.margin, 45);
    assert.equal(Number.isFinite(r.result.margin), true);
    assert.equal(Number.isFinite(r.result.marginPercent), true);
  });
});

// ── Tower CRUD (RFPlanner persistent inventory, params shape) ────

describe("telecommunications — tower CRUD + isolation", () => {
  it("saves a tower with sensible defaults + sequence id, lists it back", () => {
    const r = call("towerSave", ctxA, { name: "North", lat: 40.7, lon: -74.0, freqMhz: 1800, powerWatts: 40 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tower.id, "twr_1");
    assert.equal(r.result.tower.name, "North");
    assert.equal(r.result.tower.terrain, "suburban"); // default
    assert.equal(r.result.tower.status, "active"); // default
    assert.equal(r.result.count, 1);
    const list = call("towerList", ctxA, {});
    assert.equal(list.result.towers.length, 1);
    assert.equal(list.result.towers[0].name, "North");
  });

  it("rejects a tower with missing/non-numeric coordinates (validation-rejection)", () => {
    assert.equal(call("towerSave", ctxA, { name: "X", lon: -74 }).ok, false); // no lat
    const bad = call("towerSave", ctxA, { name: "Y", lat: "abc", lon: -74 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /lat and lon are required numbers/);
  });

  it("deletes a tower by id", () => {
    const saved = call("towerSave", ctxA, { name: "Z", lat: 1, lon: 1 });
    const id = saved.result.tower.id;
    const del = call("towerDelete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(del.result.removed, 1);
    assert.equal(call("towerList", ctxA, {}).result.towers.length, 0);
  });

  it("isolates per-user tower inventories", () => {
    call("towerSave", ctxA, { name: "A-tower", lat: 1, lon: 1 });
    call("towerSave", ctxB, { name: "B-tower", lat: 2, lon: 2 });
    assert.equal(call("towerList", ctxA, {}).result.towers.length, 1);
    assert.equal(call("towerList", ctxB, {}).result.towers.length, 1);
    assert.equal(call("towerList", ctxA, {}).result.towers[0].name, "A-tower");
  });
});

// ── propagationModel (COST-231 Hata link budget) ────────────────

describe("telecommunications — propagationModel", () => {
  it("computes a terrain-aware link budget + effective range from saved towers", () => {
    call("towerSave", ctxA, { name: "P1", lat: 40.7, lon: -74.0, powerWatts: 40, gainDbi: 16, freqMhz: 1800, heightM: 30, terrain: "suburban" });
    const r = call("propagationModel", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.cells.length, 1);
    const c = r.result.cells[0];
    // EIRP = 10·log10(40000) + 16 = 46.02 + 16 = 62.02 → 62 dBm.
    assert.equal(c.eirpDbm, 62);
    // link budget = EIRP - rxSens(-100) - fade(8) = 62.02 + 100 - 8 = 154.02 → 154 dB.
    assert.equal(c.linkBudgetDb, 154);
    assert.equal(c.effectiveRangeKm > 0, true);
    assert.equal(Number.isFinite(c.coverageKm2), true);
    assert.equal(["good", "fair", "weak"].includes(c.edgeQuality), true);
    assert.equal(r.result.model, "COST-231 Hata + terrain attenuation");
  });

  it("rejects when no towers are present (validation-rejection)", () => {
    const r = call("propagationModel", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /No towers/);
  });

  it("urban terrain attenuates the effective range below suburban", () => {
    call("towerSave", ctxA, { name: "Urb", lat: 1, lon: 1, terrain: "urban" });
    call("towerSave", ctxB, { name: "Sub", lat: 1, lon: 1, terrain: "rural" });
    const urb = call("propagationModel", ctxA, {}).result.cells[0];
    const rural = call("propagationModel", ctxB, {}).result.cells[0];
    assert.equal(urb.effectiveRangeKm < rural.effectiveRangeKm, true);
  });
});

// ── interferenceAnalysis (cell overlap + co-channel C/I) ────────

describe("telecommunications — interferenceAnalysis", () => {
  it("detects overlapping co-channel cells and reports a worst-case C/I", () => {
    // two towers ~0.5km apart on the same 1800 MHz freq → overlap + co-channel.
    call("towerSave", ctxA, { name: "I1", lat: 40.700, lon: -74.000, freqMhz: 1800, powerWatts: 40 });
    call("towerSave", ctxA, { name: "I2", lat: 40.704, lon: -74.000, freqMhz: 1800, powerWatts: 40 });
    const r = call("interferenceAnalysis", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.pairsAnalyzed, 1);
    assert.equal(r.result.overlappingPairs, 1);
    assert.equal(r.result.coChannelConflicts, 1);
    assert.equal(Number.isFinite(r.result.worstCiDb), true);
    assert.equal(r.result.conflicts[0].coChannel, true);
    assert.equal(r.result.conflicts[0].freqGapMhz, 0);
    assert.match(r.result.recommendation, /co-channel/i);
  });

  it("rejects with fewer than 2 towers (validation-rejection)", () => {
    call("towerSave", ctxA, { name: "Solo", lat: 1, lon: 1 });
    const r = call("interferenceAnalysis", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 2 towers/);
  });

  it("reports no co-channel conflict when frequencies are ≥5 MHz apart", () => {
    call("towerSave", ctxA, { name: "F1", lat: 40.700, lon: -74.000, freqMhz: 1800 });
    call("towerSave", ctxA, { name: "F2", lat: 40.702, lon: -74.000, freqMhz: 1900 });
    const r = call("interferenceAnalysis", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.coChannelConflicts, 0);
  });
});

// ── capacityProjection (subscriber growth vs headroom) ──────────

describe("telecommunications — capacityProjection", () => {
  it("projects subscriber growth and flags the headroom breach month", () => {
    // 10 Gbps = 10000 Mbps capacity; 1.5 Mbps/sub; target 80% → demand budget 8000 Mbps.
    // breach when subs * 1.5 >= 8000 → subs >= ~5333.
    const r = call("capacityProjection", ctxA, {
      bandwidthGbps: 10, currentSubscribers: 5000, monthlyGrowthPercent: 4,
      months: 24, mbpsPerSubscriber: 1.5, targetUtilizationPercent: 80,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.horizonMonths, 24);
    assert.equal(r.result.series.length, 25); // month 0..24 inclusive
    // month 0: demand = 5000*1.5 = 7500 Mbps → util 75%.
    assert.equal(r.result.series[0].utilizationPercent, 75);
    assert.equal(r.result.series[0].subscribers, 5000);
    assert.equal(typeof r.result.breachMonth, "number");
    assert.equal(r.result.breachMonth > 0, true);
    assert.equal(Number.isFinite(r.result.recommendedBandwidthGbps), true);
    assert.match(r.result.breachWarning, /Headroom exhausted at month/);
  });

  it("reports no breach when capacity holds the whole horizon", () => {
    const r = call("capacityProjection", ctxA, {
      bandwidthGbps: 100, currentSubscribers: 1000, monthlyGrowthPercent: 1,
      months: 12, mbpsPerSubscriber: 1, targetUtilizationPercent: 80,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.breachMonth, null);
    assert.match(r.result.breachWarning, /Capacity holds/);
  });

  it("fail-CLOSED on poisoned numerics — series utilization stays finite", () => {
    const r = call("capacityProjection", ctxA, {
      bandwidthGbps: 1e309, currentSubscribers: 5000, monthlyGrowthPercent: 4, months: 6,
    });
    assert.equal(r.ok, true);
    // bandwidth falls back to finite default 10; every utilization is finite.
    assert.equal(r.result.series.every((p) => Number.isFinite(p.utilizationPercent)), true);
  });
});

// ── topology (towers + backhaul + core) ─────────────────────────

describe("telecommunications — topology", () => {
  it("builds a core→aggregation→tower tree with backhaul demand", () => {
    call("towerSave", ctxA, { name: "T1", lat: 1, lon: 1, backhaul: "fiber", sectors: 3, status: "active" });
    call("towerSave", ctxA, { name: "T2", lat: 2, lon: 2, backhaul: "satellite", sectors: 2, status: "active" });
    const r = call("topology", ctxA, { coreNodeName: "EPC-1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.towerCount, 2);
    assert.equal(r.result.aggregationHubs, 2); // fiber + satellite
    // satelliteHops counts EVERY satellite-kind link: core→satellite-hub (1) + hub→T2 (1) = 2.
    assert.equal(r.result.satelliteHops, 2);
    assert.equal(Number.isFinite(r.result.totalBackhaulGbps), true);
    assert.equal(r.result.tree.label, "EPC-1");
    assert.equal(r.result.tree.children.length, 2);
  });

  it("rejects when no towers are present (validation-rejection)", () => {
    const r = call("topology", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /No towers/);
  });
});

// ── spectrum planner (allocate / overlap / plan) ────────────────

describe("telecommunications — spectrum planner", () => {
  it("allocates a band and rejects overlapping allocations unless forced", () => {
    const a = call("spectrumAllocate", ctxA, { band: "n78", startMhz: 3300, widthMhz: 100, technology: "5G" });
    assert.equal(a.ok, true);
    assert.equal(a.result.allocation.endMhz, 3400);
    assert.equal(a.result.totalAllocatedMhz, 100);
    // overlapping block is rejected
    const overlap = call("spectrumAllocate", ctxA, { band: "dup", startMhz: 3350, widthMhz: 50 });
    assert.equal(overlap.ok, false);
    assert.match(overlap.error, /overlap/i);
    // forced overlap is accepted
    const forced = call("spectrumAllocate", ctxA, { band: "dup", startMhz: 3350, widthMhz: 50, allowOverlap: true });
    assert.equal(forced.ok, true);
  });

  it("rejects a non-positive width (validation-rejection)", () => {
    assert.equal(call("spectrumAllocate", ctxA, { startMhz: 700, widthMhz: 0 }).ok, false);
    assert.equal(call("spectrumAllocate", ctxA, { startMhz: 700 }).ok, false);
  });

  it("plan reports total/span/utilization + gaps + guard violations", () => {
    call("spectrumAllocate", ctxA, { band: "A", startMhz: 700, widthMhz: 10, guardBandMhz: 1 });
    call("spectrumAllocate", ctxA, { band: "B", startMhz: 720, widthMhz: 10, guardBandMhz: 1 });
    const plan = call("spectrumPlan", ctxA, {});
    assert.equal(plan.ok, true);
    assert.equal(plan.result.totalAllocatedMhz, 20);
    assert.equal(plan.result.spectralSpanMhz, 30); // 730 - 700
    assert.equal(plan.result.gaps.length, 1); // 710..720 gap
    assert.equal(plan.result.gaps[0].widthMhz, 10);
  });

  it("plan rejects when nothing is allocated (validation-rejection)", () => {
    const r = call("spectrumPlan", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /No allocations/);
  });
});

// ── outages + SLA ───────────────────────────────────────────────

describe("telecommunications — outages + SLA", () => {
  it("reports, resolves and rolls up an SLA availability figure", () => {
    const now = Date.now();
    const rep = call("outageReport", ctxA, {
      site: "Site-7", cause: "power loss", severity: "major",
      affectedSubscribers: 1200, startedAt: now - 3600 * 1000,
    });
    assert.equal(rep.ok, true);
    assert.equal(rep.result.outage.status, "open");
    assert.equal(rep.result.openCount, 1);
    const id = rep.result.outage.id;
    const res = call("outageResolve", ctxA, { id, resolvedAt: now });
    assert.equal(res.ok, true);
    assert.equal(res.result.outage.status, "resolved");
    const sla = call("slaReport", ctxA, { windowDays: 30, slaTargetPercent: 99.9 });
    assert.equal(sla.ok, true);
    assert.equal(Number.isFinite(sla.result.availabilityPercent), true);
    assert.equal(sla.result.availabilityPercent <= 100, true);
    assert.equal(sla.result.incidents, 1);
    assert.equal(Number.isFinite(sla.result.mttrHours), true);
    assert.equal(sla.result.mttrHours, 1); // 1h outage
  });

  it("rejects resolving an unknown outage (validation-rejection)", () => {
    const r = call("outageResolve", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("SLA report with no outages returns 100% availability", () => {
    const sla = call("slaReport", ctxA, { windowDays: 30, slaTargetPercent: 99.9 });
    assert.equal(sla.ok, true);
    assert.equal(sla.result.availabilityPercent, 100);
    assert.equal(sla.result.slaMet, true);
    assert.equal(sla.result.mttrHours, null);
  });
});

// ── drive test (import + validate vs predicted) ─────────────────

describe("telecommunications — drive test", () => {
  it("imports measurements then validates measured vs predicted RSRP", () => {
    call("towerSave", ctxA, { name: "DT1", lat: 40.700, lon: -74.000, powerWatts: 40, freqMhz: 1800, heightM: 30 });
    const imp = call("driveTestImport", ctxA, { measurements: [
      { lat: 40.701, lon: -74.001, rsrpDbm: -85, technology: "4G" },
      { lat: 40.702, lon: -74.002, rsrpDbm: -95 },
      { lat: 40.703, lon: -74.003, rsrpDbm: "junk" }, // dropped (non-finite)
    ] });
    assert.equal(imp.ok, true);
    assert.equal(imp.result.imported, 2);
    const val = call("driveTestValidate", ctxA, {});
    assert.equal(val.ok, true);
    assert.equal(val.result.sampleCount, 2);
    assert.equal(Number.isFinite(val.result.rmseDbm), true);
    assert.equal(Number.isFinite(val.result.meanErrorDbm), true);
    assert.equal(Number.isFinite(val.result.calibrationOffsetDbm), true);
    assert.equal(["good fit", "acceptable", "needs re-calibration"].includes(val.result.modelGrade), true);
    assert.equal(val.result.points.every((p) => Number.isFinite(p.predictedDbm) && Number.isFinite(p.errorDbm)), true);
  });

  it("rejects an empty measurements array (validation-rejection)", () => {
    const r = call("driveTestImport", ctxA, { measurements: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /measurements array required/);
  });

  it("validate rejects when there are no measurements or no towers", () => {
    // towers but no measurements
    call("towerSave", ctxA, { name: "X", lat: 1, lon: 1 });
    assert.equal(call("driveTestValidate", ctxA, {}).ok, false);
  });
});

// ── degrade-graceful (no STATE never throws) ────────────────────

describe("telecommunications — robustness", () => {
  it("the four calculators degrade gracefully with no STATE (pure compute, never throw)", () => {
    delete globalThis._concordSTATE;
    // calculators don't touch STATE — they must still resolve.
    assert.equal(call("networkCapacity", ctxA, { artifact: { data: { bandwidthGbps: 10, utilizationPercent: 60, activeUsers: 1000 } } }).ok, true);
    assert.equal(call("signalQuality", ctxA, { artifact: { data: { snrDb: 20, bitErrorRate: 1e-6, latencyMs: 30, jitterMs: 5 } } }).ok, true);
    assert.equal(call("coverageMap", ctxA, { artifact: { data: { towers: [{ rangeKm: 5 }] } } }).ok, true);
    assert.equal(call("costPerLine", ctxA, { artifact: { data: { infrastructureCost: 600000, monthlyOpsCost: 50000, subscribers: 10000, arpu: 50 } } }).ok, true);
  });

  it("STATE-backed macros lazily (re)initialise STATE rather than throwing", () => {
    delete globalThis._concordSTATE;
    // ensureState() rebuilds the telecom maps on demand → list is empty, not a throw.
    const r = call("towerList", ctxA, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.towers, []);
  });
});
