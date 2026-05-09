/**
 * Tier-2 contract tests for Phase 5e — Procgen Wilderness.
 *
 * Run: node --test tests/procgen-regions.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateRegionFromAlert,
  regionAt,
  applyRegionBiases,
  recordRegionVisit,
  decayRegion,
  listActiveRegions,
  _internal,
} from "../lib/procgen-regions.js";

function makeFakeDb() {
  const tables = { procgen_regions: new Map(), procgen_region_visits: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO procgen_regions")) {
      const [id, worldId, sig, driftType, regionKind, ax, az, radius, narrative] = args;
      // UNIQUE on drift_alert_signature
      for (const r of tables.procgen_regions.values()) {
        if (r.drift_alert_signature === sig) {
          const err = new Error("UNIQUE constraint failed: procgen_regions.drift_alert_signature");
          throw err;
        }
      }
      tables.procgen_regions.set(id, {
        id, world_id: worldId, drift_alert_signature: sig,
        drift_type: driftType, region_kind: regionKind,
        anchor_x: ax, anchor_z: az, radius_m: radius,
        narrative, composed_at: Math.floor(Date.now() / 1000),
        decayed_at: null, decay_reason: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO procgen_region_visits")) {
      const [id, regionId, userId] = args;
      tables.procgen_region_visits.set(id, {
        id, region_id: regionId, user_id: userId,
        visited_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE procgen_regions SET decayed_at")) {
      const [reason, id] = args;
      const r = tables.procgen_regions.get(id);
      if (r && r.decayed_at == null) {
        r.decayed_at = Math.floor(Date.now() / 1000);
        r.decay_reason = reason;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT id FROM procgen_regions WHERE drift_alert_signature = ?")) {
      const [sig] = args;
      for (const r of tables.procgen_regions.values()) if (r.drift_alert_signature === sig) return { id: r.id };
      return null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, region_kind, anchor_x, anchor_z, radius_m, narrative, drift_type FROM procgen_regions")) {
      const [worldId] = args;
      return Array.from(tables.procgen_regions.values())
        .filter(r => r.world_id === worldId && r.decayed_at == null);
    }
    if (sql.startsWith("SELECT * FROM procgen_regions WHERE world_id = ? AND decayed_at IS NULL")) {
      const [worldId, limit] = args;
      return Array.from(tables.procgen_regions.values())
        .filter(r => r.world_id === worldId && r.decayed_at == null)
        .slice(0, limit);
    }
    return [];
  }
  return { prepare, _tables: tables };
}

function makeAlert(opts = {}) {
  return {
    type: opts.type || "memetic_drift",
    severity: "warning",
    message: opts.message || "test alert",
    detected_at: opts.detected_at ?? Date.now(),
  };
}

describe("generateRegionFromAlert", () => {
  it("memetic_drift → haunted_glade", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert({ type: "memetic_drift" }), signature: "sig-mem" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "created");
    const region = Array.from(db._tables.procgen_regions.values())[0];
    assert.equal(region.region_kind, "haunted_glade");
  });

  it("goodhart → corrupt_market", () => {
    const db = makeFakeDb();
    generateRegionFromAlert(db, { worldId: "w", alert: makeAlert({ type: "goodhart" }), signature: "sig-good" });
    const region = Array.from(db._tables.procgen_regions.values())[0];
    assert.equal(region.region_kind, "corrupt_market");
  });

  it("idempotent — re-spawning same signature returns already_exists", () => {
    const db = makeFakeDb();
    const r1 = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "dup" });
    const r2 = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "dup" });
    assert.equal(r1.action, "created");
    assert.equal(r2.action, "already_exists");
    assert.equal(r1.regionId, r2.regionId);
    assert.equal(db._tables.procgen_regions.size, 1);
  });

  it("rejects unknown drift type", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: { type: "totally_unknown" }, signature: "sig-x" });
    assert.equal(r.ok, false);
  });

  it("anchor position is deterministic from signature", () => {
    const db1 = makeFakeDb();
    const db2 = makeFakeDb();
    const a = generateRegionFromAlert(db1, { worldId: "w", alert: makeAlert(), signature: "stable" });
    const b = generateRegionFromAlert(db2, { worldId: "w", alert: makeAlert(), signature: "stable" });
    assert.equal(a.anchor.x, b.anchor.x);
    assert.equal(a.anchor.z, b.anchor.z);
  });
});

describe("regionAt + applyRegionBiases", () => {
  it("regionAt returns the region a point falls inside", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert({ type: "memetic_drift" }), signature: "s1" });
    // The anchor is deterministic; query at the anchor.
    const region = regionAt(db, "w", r.anchor.x, r.anchor.z);
    assert.ok(region);
    assert.equal(region.region_kind, "haunted_glade");
  });

  it("regionAt returns null outside any region", () => {
    const db = makeFakeDb();
    generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "s1" });
    const region = regionAt(db, "w", 10000, 10000);
    assert.equal(region, null);
  });

  it("applyRegionBiases shifts temperature in a haunted_glade", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert({ type: "memetic_drift" }), signature: "s1" });
    const base = { temperature: 20, humidity: 50, light: 30000, airQuality: 0.92 };
    const biased = applyRegionBiases(db, "w", r.anchor.x, r.anchor.z, base);
    assert.equal(biased._regionKind, "haunted_glade");
    assert.equal(biased.temperature, 17);  // -3 bias
    assert.equal(biased.humidity, 55);     // +5 bias
  });

  it("applyRegionBiases passes through outside any region", () => {
    const db = makeFakeDb();
    const base = { temperature: 20 };
    const result = applyRegionBiases(db, "w", 10000, 10000, base);
    assert.deepEqual(result, base);
  });
});

describe("recordRegionVisit + decayRegion", () => {
  it("records visit", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "s1" });
    const v = recordRegionVisit(db, r.regionId, "user:a");
    assert.equal(v.ok, true);
    assert.equal(db._tables.procgen_region_visits.size, 1);
  });

  it("decayRegion marks decayed_at", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "s1" });
    const d = decayRegion(db, r.regionId);
    assert.equal(d.ok, true);
    const region = db._tables.procgen_regions.get(r.regionId);
    assert.notEqual(region.decayed_at, null);
    assert.equal(region.decay_reason, "drift_resolved");
  });

  it("decayed regions are excluded from regionAt", () => {
    const db = makeFakeDb();
    const r = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "s1" });
    decayRegion(db, r.regionId);
    const region = regionAt(db, "w", r.anchor.x, r.anchor.z);
    assert.equal(region, null);
  });
});

describe("listActiveRegions", () => {
  it("lists active only", () => {
    const db = makeFakeDb();
    const r1 = generateRegionFromAlert(db, { worldId: "w", alert: makeAlert(), signature: "s1" });
    generateRegionFromAlert(db, { worldId: "w", alert: makeAlert({ type: "goodhart" }), signature: "s2" });
    decayRegion(db, r1.regionId);
    const list = listActiveRegions(db, "w");
    assert.equal(list.length, 1);
  });
});

describe("internals", () => {
  it("DRIFT_TO_REGION covers all 6 drift types", () => {
    const types = ["memetic_drift", "goodhart", "self_reference", "capability_creep", "echo_chamber", "metric_divergence"];
    for (const t of types) assert.ok(_internal.DRIFT_TO_REGION[t]);
  });
  it("REGION_BIASES has all 5 region_kinds", () => {
    for (const k of ["haunted_glade", "corrupt_market", "hollow_chamber", "overgrown_wild", "silent_field"]) {
      assert.ok(_internal.REGION_BIASES[k]);
    }
  });
});
