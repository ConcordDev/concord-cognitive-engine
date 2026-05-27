// Phase AD — disease realism tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getTransmissionProbability,
  contaminateFood,
  getFoodContamination,
  contaminateWaterSource,
  waterContaminationAt,
  sweepWaterContamination,
} from "../lib/disease-engine.js";
import {
  getHygiene,
  improveHygiene,
  decayHygiene,
} from "../lib/medical-profession.js";
import { up as upRealism } from "../migrations/228_disease_realism.js";

function freshDb() {
  const db = new Database(":memory:");
  upRealism(db);
  return db;
}

const fluCommon = {
  id: "common_flu",
  contagionRadiusM: 5,
  transmissionProbabilities: {
    airborne: 0.15, touch: 0.30, foodborne: 0, bloodborne: 0, waterborne: 0,
  },
};

const hepatitis = {
  id: "hep",
  contagionRadiusM: 2,
  transmissionProbabilities: {
    airborne: 0, touch: 0, foodborne: 0, bloodborne: 0.60, waterborne: 0,
  },
  vectorRequirements: { needsOpenWound: true },
};

const dysentery = {
  id: "dys",
  transmissionProbabilities: {
    airborne: 0, touch: 0, foodborne: 0.40, bloodborne: 0, waterborne: 0.25,
  },
};

describe("Phase AD — transmission probability table", () => {
  it("airborne probability decays with distance and zeroes past radius", () => {
    const close = getTransmissionProbability(fluCommon, "airborne", { distanceM: 0, hygiene: 0 });
    const farInside = getTransmissionProbability(fluCommon, "airborne", { distanceM: 4, hygiene: 0 });
    const beyond = getTransmissionProbability(fluCommon, "airborne", { distanceM: 6, hygiene: 0 });
    assert.ok(close > farInside, "closer should be higher probability");
    assert.equal(beyond, 0, "past radius is zero");
  });

  it("hygiene halves airborne and touch probability at 1.0", () => {
    const dirty = getTransmissionProbability(fluCommon, "airborne", { distanceM: 0, hygiene: 0 });
    const clean = getTransmissionProbability(fluCommon, "airborne", { distanceM: 0, hygiene: 1 });
    assert.ok(clean < dirty);
    assert.equal(clean, dirty * 0.5);
  });

  it("touch requires zero distance — any gap zeroes it", () => {
    const contact = getTransmissionProbability(fluCommon, "touch", { distanceM: 0, hygiene: 0 });
    const nearMiss = getTransmissionProbability(fluCommon, "touch", { distanceM: 1, hygiene: 0 });
    assert.ok(contact > 0);
    assert.equal(nearMiss, 0);
  });

  it("foodborne requires contamination ≥ minimum (0.2)", () => {
    const low = getTransmissionProbability(dysentery, "foodborne", { contaminationLevel: 0.1 });
    const high = getTransmissionProbability(dysentery, "foodborne", { contaminationLevel: 0.5 });
    assert.equal(low, 0);
    assert.ok(high > 0);
  });

  it("bloodborne requires open wound", () => {
    const noWound = getTransmissionProbability(hepatitis, "bloodborne", { openWound: false });
    const withWound = getTransmissionProbability(hepatitis, "bloodborne", { openWound: true });
    assert.equal(noWound, 0);
    assert.ok(withWound > 0);
  });

  it("waterborne scales with contamination level (linear)", () => {
    const half = getTransmissionProbability(dysentery, "waterborne", { waterContamination: 0.5 });
    const full = getTransmissionProbability(dysentery, "waterborne", { waterContamination: 1.0 });
    assert.ok(full > half);
    assert.equal(full, 2 * half);
  });

  it("unknown vector returns 0", () => {
    assert.equal(getTransmissionProbability(fluCommon, "psychic", {}), 0);
  });
});

describe("Phase AD — food contamination", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("contaminateFood is idempotent — re-marking raises level", () => {
    contaminateFood(db, { foodDtuId: "food-1", diseaseId: "dys", level: 0.3 });
    const r = contaminateFood(db, { foodDtuId: "food-1", diseaseId: "dys", level: 0.4 });
    assert.equal(r.ok, true);
    assert.equal(r.contaminationLevel, 0.7);
  });

  it("getFoodContamination returns per-disease levels", () => {
    contaminateFood(db, { foodDtuId: "food-1", diseaseId: "dys", level: 0.3 });
    contaminateFood(db, { foodDtuId: "food-1", diseaseId: "hep", level: 0.5 });
    const list = getFoodContamination(db, "food-1");
    assert.equal(list.length, 2);
    assert.ok(list.find(x => x.diseaseId === "dys" && x.level === 0.3));
  });
});

describe("Phase AD — water source contamination", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("waterContaminationAt returns hit inside radius, null outside", () => {
    contaminateWaterSource(db, {
      worldId: "tunya", x: 100, z: 200,
      radiusM: 20, diseaseId: "dys", level: 0.6,
    });
    const inside = waterContaminationAt(db, "tunya", 110, 195);
    const outside = waterContaminationAt(db, "tunya", 200, 200);
    assert.ok(inside);
    assert.equal(inside.diseaseId, "dys");
    assert.equal(outside, null);
  });

  it("sweepWaterContamination drops expired rows", () => {
    contaminateWaterSource(db, {
      worldId: "tunya", x: 100, z: 200, radiusM: 20,
      diseaseId: "dys", level: 0.6,
    });
    db.prepare(`UPDATE water_source_contamination SET expires_at = 1`).run();
    const s = sweepWaterContamination(db);
    assert.equal(s.ok, true);
    assert.equal(s.removed, 1);
  });
});

describe("Phase AD — hygiene", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("getHygiene defaults to 1.0 for new user", () => {
    assert.equal(getHygiene(db, "u1"), 1.0);
  });

  it("improveHygiene clamps at 1.0", () => {
    improveHygiene(db, "u1", 0.5);
    improveHygiene(db, "u1", 0.5);
    improveHygiene(db, "u1", 0.5);
    assert.equal(getHygiene(db, "u1"), 1.0);
  });

  it("decayHygiene reduces by ~5% per day", () => {
    // Seed with hygiene 1.0, last_decay_at one day ago.
    improveHygiene(db, "u1", 1.0);
    db.prepare(`UPDATE player_hygiene SET last_decay_at = unixepoch() - 86400 WHERE user_id = ?`).run("u1");
    decayHygiene(db, "u1");
    const h = getHygiene(db, "u1");
    assert.ok(h >= 0.94 && h <= 0.96, `expected ~0.95, got ${h}`);
  });

  it("decay is a no-op when no time has elapsed", () => {
    improveHygiene(db, "u1", 1.0);
    decayHygiene(db, "u1");
    assert.equal(getHygiene(db, "u1"), 1.0);
  });
});
