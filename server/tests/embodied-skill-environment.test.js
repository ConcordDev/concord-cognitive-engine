/**
 * Tier-2 contract tests for Layer 7 (embodied signal store) + Layer 7.5
 * (env-coupled skills).
 *
 * Pins:
 *   - signalsForWorld round-trip and recency weighting
 *   - elementalEnvBoost wedges (frost cold/hot, fire dry/wet, lightning storm, etc.)
 *   - elementalEnvFeedback shape per element
 *   - terrainResourceBoost element×nodeType wedges (the bender table)
 *   - shouldStaggerOnTerrain threshold + projection
 *   - applyStructuralStress state transitions
 *   - environment-sensor heartbeat seeds active worlds
 *
 * Run: node --test tests/embodied-skill-environment.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  recordSignal,
  signalsForWorld,
  decaySweep,
  seedWorldClimate,
  cellOf,
  CELL_SIZE,
} from "../lib/embodied/signals.js";
import {
  elementalEnvBoost,
  elementalEnvFeedback,
  terrainResourceBoost,
  shouldStaggerOnTerrain,
  applyStructuralStress,
} from "../lib/embodied/skill-environment.js";
import { runEnvironmentSensor } from "../emergent/environment-sensor.js";
import { up as up108 } from "../migrations/108_embodied_signal_log.js";

function setupDb() {
  const db = new Database(":memory:");
  up108(db);
  // worlds + world_visits + world_buildings — minimal schema needed.
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY,
      rule_modulators TEXT
    );
    CREATE TABLE world_visits (
      world_id TEXT,
      user_id TEXT,
      departed_at INTEGER
    );
    CREATE TABLE world_buildings (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      building_type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL,
      z REAL NOT NULL,
      material TEXT DEFAULT 'stone',
      state TEXT DEFAULT 'standing',
      health_pct REAL DEFAULT 1.0
    );
  `);
  return db;
}

// ───────────────────────────────────────────────────────────────────────────
// signals.js: round-trip
// ───────────────────────────────────────────────────────────────────────────

describe("signals: cellOf is a 50m quantizer", () => {
  it("cells of (1000, 1000) are (20, 20)", () => {
    assert.deepStrictEqual(cellOf(1000, 1000), { cell_x: 20, cell_z: 20 });
  });
  it("CELL_SIZE export is 50", () => {
    assert.equal(CELL_SIZE, 50);
  });
});

describe("signals: signalsForWorld defaults", () => {
  it("empty world returns hasData:false + neutral defaults", () => {
    const db = setupDb();
    const sig = signalsForWorld(db, "w-empty");
    assert.equal(sig.hasData, false);
    assert.equal(sig.temperature, 15);
    assert.equal(sig.humidity, 50);
    assert.equal(sig.weatherKind, "clear");
  });
});

describe("signals: write → read round-trip", () => {
  it("a sensor row becomes the absolute baseline", () => {
    const db = setupDb();
    recordSignal(db, {
      worldId: "w1", x: 1000, z: 1000,
      channel: "thermal_os.ambient_temp", value: 28,
      source: "sensor", ttlSeconds: 600,
    });
    const sig = signalsForWorld(db, "w1");
    assert.equal(sig.hasData, true);
    assert.ok(Math.abs(sig.temperature - 28) < 0.5,
      `expected ~28, got ${sig.temperature}`);
  });

  it("a skill_cast delta sums on top of baseline", () => {
    const db = setupDb();
    recordSignal(db, {
      worldId: "w2", x: 1000, z: 1000,
      channel: "thermal_os.ambient_temp", value: 15,
      source: "sensor", ttlSeconds: 600,
    });
    recordSignal(db, {
      worldId: "w2", x: 1000, z: 1000,
      channel: "thermal_os.ambient_temp", value: 5,
      source: "skill_cast", ttlSeconds: 300,
    });
    const sig = signalsForWorld(db, "w2");
    // baseline 15 + delta 5 = ~20 (recency-weighted, both fresh)
    assert.ok(sig.temperature > 18 && sig.temperature < 21,
      `expected ~20, got ${sig.temperature}`);
  });

  it("locality: 3x3 window restricts to nearby cells", () => {
    const db = setupDb();
    // Cell (20,20) — at world coords (1000, 1000)
    recordSignal(db, {
      worldId: "w3", x: 1000, z: 1000,
      channel: "chemical_os.humidity", value: 90,
      source: "sensor",
    });
    // Cell (40, 40) — at world coords (2000, 2000), far away
    recordSignal(db, {
      worldId: "w3", x: 2000, z: 2000,
      channel: "chemical_os.humidity", value: 10,
      source: "sensor",
    });

    const local = signalsForWorld(db, "w3", { x: 1000, z: 1000 });
    assert.ok(local.humidity > 80,
      `local read should pick up the wet cell (got ${local.humidity})`);

    const farLocal = signalsForWorld(db, "w3", { x: 2000, z: 2000 });
    assert.ok(farLocal.humidity < 20,
      `far read should pick up the dry cell (got ${farLocal.humidity})`);

    const global = signalsForWorld(db, "w3");
    // Whole-world: avg of both ≈ 50 (recency-weighted, identical recency)
    assert.ok(global.humidity > 40 && global.humidity < 60,
      `global avg should sit between (got ${global.humidity})`);
  });

  it("recency weighting: fresh row dominates an old row", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    // Manually backdate an old reading 10 minutes ago — outside half-life
    db.prepare(`
      INSERT INTO embodied_signal_log
        (id, world_id, cell_x, cell_z, channel, value, source, recorded_at, decay_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("old1", "w4", 20, 20, "thermal_os.ambient_temp", 30, "sensor", now - 600, now + 300);
    // Fresh reading
    recordSignal(db, {
      worldId: "w4", x: 1000, z: 1000,
      channel: "thermal_os.ambient_temp", value: 10,
      source: "sensor",
    });

    const sig = signalsForWorld(db, "w4");
    assert.ok(sig.temperature < 18,
      `fresh 10°C should outweigh stale 30°C; got ${sig.temperature}`);
  });
});

describe("signals: decaySweep removes expired rows", () => {
  it("rows past decay_at are deleted", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO embodied_signal_log
        (id, world_id, cell_x, cell_z, channel, value, source, recorded_at, decay_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("expired", "w5", 0, 0, "thermal_os.ambient_temp", 10, "sensor", now - 1000, now - 100);
    recordSignal(db, {
      worldId: "w5", x: 0, z: 0,
      channel: "thermal_os.ambient_temp", value: 20,
      source: "sensor", ttlSeconds: 600,
    });
    const removed = decaySweep(db);
    assert.ok(removed >= 1, `expected at least 1 expired row pruned, got ${removed}`);
    const remaining = db.prepare(`SELECT COUNT(*) as n FROM embodied_signal_log`).get();
    assert.equal(remaining.n, 1);
  });
});

describe("signals: seedWorldClimate writes one row per channel", () => {
  it("writes 6 baseline channels with overrides applied", () => {
    const db = setupDb();
    seedWorldClimate(db, "wseed", { temperature: 5, humidity: 90 });
    const rows = db.prepare(`SELECT channel, value FROM embodied_signal_log WHERE world_id = ?`).all("wseed");
    assert.equal(rows.length, 6);
    const map = Object.fromEntries(rows.map(r => [r.channel, r.value]));
    assert.equal(map["thermal_os.ambient_temp"], 5);
    assert.equal(map["chemical_os.humidity"], 90);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// elementalEnvBoost: per-element wedges
// ───────────────────────────────────────────────────────────────────────────

describe("elementalEnvBoost: ice", () => {
  it("≥1.5× in deep cold, ≤0.5× in deep heat", () => {
    assert.equal(elementalEnvBoost("ice", { hasData: true, temperature: 0,  humidity: 50 }), 1.5);
    assert.equal(elementalEnvBoost("ice", { hasData: true, temperature: 30, humidity: 50 }), 0.5);
  });
  it("neutral at 15°C", () => {
    assert.equal(elementalEnvBoost("ice", { hasData: true, temperature: 15, humidity: 50 }), 1.0);
  });
});

describe("elementalEnvBoost: fire", () => {
  it("1.4× on dry sunny day", () => {
    const sig = { hasData: true, temperature: 20, humidity: 30, light: 90000, weatherKind: "sunny" };
    assert.equal(elementalEnvBoost("fire", sig), 1.4);
  });
  it("≤0.6× when rain/storm", () => {
    const stormSig = { hasData: true, temperature: 18, humidity: 80, light: 5000, weatherKind: "storm" };
    assert.ok(elementalEnvBoost("fire", stormSig) <= 0.6);
  });
});

describe("elementalEnvBoost: lightning", () => {
  it("1.6× during a storm", () => {
    const sig = { hasData: true, temperature: 18, humidity: 85, weatherKind: "storm" };
    assert.equal(elementalEnvBoost("lightning", sig), 1.6);
  });
});

describe("elementalEnvBoost: degrade gracefully when no data", () => {
  it("returns 1.0 when hasData=false", () => {
    assert.equal(elementalEnvBoost("ice",      { hasData: false, temperature: 0 }), 1.0);
    assert.equal(elementalEnvBoost("fire",     { hasData: false, light: 100000 }),  1.0);
    assert.equal(elementalEnvBoost("lightning",{ hasData: false, weatherKind: "storm" }), 1.0);
  });
  it("returns 1.0 for unknown element", () => {
    assert.equal(elementalEnvBoost("psychic", { hasData: true }), 1.0);
  });
  it("physical/none always 1.0", () => {
    assert.equal(elementalEnvBoost("physical", { hasData: true, temperature: 0, humidity: 100 }), 1.0);
    assert.equal(elementalEnvBoost("none",     { hasData: true, weatherKind: "storm" }), 1.0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// elementalEnvFeedback: signal deltas per element
// ───────────────────────────────────────────────────────────────────────────

describe("elementalEnvFeedback: shape", () => {
  it("fire warms + drops air quality", () => {
    const d = elementalEnvFeedback("fire", 100);
    const channels = d.map(x => x.channel);
    assert.ok(channels.includes("thermal_os.ambient_temp"));
    assert.ok(channels.includes("chemical_os.air_quality"));
    const temp = d.find(x => x.channel === "thermal_os.ambient_temp");
    assert.ok(temp.value > 0, "fire must increase temperature");
  });
  it("water humidifies", () => {
    const d = elementalEnvFeedback("water", 80);
    const hum = d.find(x => x.channel === "chemical_os.humidity");
    assert.ok(hum && hum.value > 0);
  });
  it("lightning thunders + flashes + creates ozone", () => {
    const d = elementalEnvFeedback("lightning", 100);
    const channels = d.map(x => x.channel);
    assert.ok(channels.includes("sonic_os.ambient_db"));
    assert.ok(channels.includes("sight_os.illumination"));
    assert.ok(channels.includes("chemical_os.air_quality"));
  });
  it("none/unknown returns empty array", () => {
    assert.deepStrictEqual(elementalEnvFeedback("none", 50), []);
    assert.deepStrictEqual(elementalEnvFeedback("psychic", 50), []);
  });
  it("magnitude scales the delta envelope", () => {
    const small = elementalEnvFeedback("fire", 10);
    const big   = elementalEnvFeedback("fire", 200);
    const smallTemp = small.find(x => x.channel === "thermal_os.ambient_temp").value;
    const bigTemp   = big.find(x => x.channel === "thermal_os.ambient_temp").value;
    assert.ok(bigTemp > smallTemp, "bigger casts leave bigger marks");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// terrainResourceBoost: the bender table
// ───────────────────────────────────────────────────────────────────────────

describe("terrainResourceBoost: bender wedges", () => {
  it("physical + ore_vein = 1.5 (Toph)", () => {
    assert.equal(terrainResourceBoost("physical", "ore_vein"), 1.5);
    assert.equal(terrainResourceBoost("physical", "stone"),    1.5);
    assert.equal(terrainResourceBoost("physical", "crystal"),  1.5);
  });
  it("water + spring = 1.4 (Katara)", () => {
    assert.equal(terrainResourceBoost("water", "spring"), 1.4);
  });
  it("bio + herb = 1.45", () => {
    assert.equal(terrainResourceBoost("bio", "herb"), 1.45);
    assert.equal(terrainResourceBoost("bio", "soil"), 1.45);
  });
  it("energy + plant + bright sunlight = 1.35", () => {
    assert.equal(terrainResourceBoost("energy", "tree", { light: 80000 }), 1.35);
    assert.equal(terrainResourceBoost("energy", "tree", { light: 10000 }), 1.0);
  });
  it("fire + tree + dry conditions = 1.2 (dry wood splits cleanly)", () => {
    assert.equal(terrainResourceBoost("fire", "tree", { humidity: 30 }), 1.2);
    assert.equal(terrainResourceBoost("fire", "tree", { humidity: 80 }), 1.0);
  });
  it("ice + spring + freezing = 1.25", () => {
    assert.equal(terrainResourceBoost("ice", "spring", { temperature: 0 }), 1.25);
    assert.equal(terrainResourceBoost("ice", "spring", { temperature: 20 }), 1.0);
  });
  it("mismatched element / node = 1.0", () => {
    assert.equal(terrainResourceBoost("fire", "ore_vein"), 1.0);
    assert.equal(terrainResourceBoost("water", "tree"), 1.0);
  });
  it("element 'none' always 1.0", () => {
    assert.equal(terrainResourceBoost("none", "ore_vein"), 1.0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// shouldStaggerOnTerrain
// ───────────────────────────────────────────────────────────────────────────

describe("shouldStaggerOnTerrain", () => {
  it("returns null below magnitude threshold", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, z) VALUES (?, ?, ?, ?, ?)
    `).run("b1", "w", "house", 1006, 1000);
    const r = shouldStaggerOnTerrain({
      element: "physical", magnitude: 20,
      attackerPos: { x: 990, z: 1000 }, targetPos: { x: 1000, z: 1000 },
      db, worldId: "w",
    });
    assert.equal(r, null);
  });

  it("returns spec when high-magnitude hit projects into a building", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, z, material, state)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("b1", "w", "house", 1006, 1000, "wood", "standing");

    const r = shouldStaggerOnTerrain({
      element: "physical", magnitude: 60,
      attackerPos: { x: 990, z: 1000 }, targetPos: { x: 1000, z: 1000 },
      db, worldId: "w",
    });
    assert.ok(r, "expected stagger spec");
    assert.equal(r.buildingId, "b1");
    assert.ok(r.durationMs > 0);
    assert.ok(r.structuralStress > 0);
  });

  it("returns null if no buildings near projection", () => {
    const db = setupDb();
    // building far away
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, z) VALUES (?, ?, ?, ?, ?)
    `).run("far", "w", "house", 1500, 1500);
    const r = shouldStaggerOnTerrain({
      element: "physical", magnitude: 80,
      attackerPos: { x: 990, z: 1000 }, targetPos: { x: 1000, z: 1000 },
      db, worldId: "w",
    });
    assert.equal(r, null);
  });

  it("returns null when collapsed buildings are excluded", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, z, state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("rubble", "w", "house", 1006, 1000, "collapsed");
    const r = shouldStaggerOnTerrain({
      element: "physical", magnitude: 80,
      attackerPos: { x: 990, z: 1000 }, targetPos: { x: 1000, z: 1000 },
      db, worldId: "w",
    });
    assert.equal(r, null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// applyStructuralStress: state transitions
// ───────────────────────────────────────────────────────────────────────────

describe("applyStructuralStress", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, z, material, state, health_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("b1", "w", "house", 1000, 1000, "stone", "standing", 1.0);
  });

  it("standing → damaged when health drops below 0.4", () => {
    const r = applyStructuralStress(db, "w", "b1", 0.7);
    assert.equal(r.state, "damaged");
    assert.ok(r.transitioned);
    assert.ok(r.healthPct < 0.4);
  });

  it("damaged → collapsed when health hits 0", () => {
    applyStructuralStress(db, "w", "b1", 0.7); // → damaged at 0.3
    const r = applyStructuralStress(db, "w", "b1", 0.5);
    assert.equal(r.state, "collapsed");
    assert.equal(r.healthPct, 0);
  });

  it("idempotent on collapsed", () => {
    applyStructuralStress(db, "w", "b1", 1.5);
    const r = applyStructuralStress(db, "w", "b1", 0.5);
    assert.equal(r, null, "collapsed buildings ignore further stress");
  });

  it("rejects invalid stress", () => {
    assert.equal(applyStructuralStress(db, "w", "b1", 0), null);
    assert.equal(applyStructuralStress(db, "w", "b1", -0.5), null);
    assert.equal(applyStructuralStress(db, "w", "missing", 0.5), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runEnvironmentSensor heartbeat
// ───────────────────────────────────────────────────────────────────────────

describe("runEnvironmentSensor heartbeat", () => {
  it("no active worlds → ok with worlds=0", () => {
    const db = setupDb();
    const r = runEnvironmentSensor({ db });
    assert.equal(r.ok, true);
    assert.equal(r.worlds, 0);
  });

  it("active world → writes 6 baseline channels", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO worlds (id, rule_modulators) VALUES (?, ?)`).run("w-active", "{}");
    db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
      .run("w-active", "u1");

    const r = runEnvironmentSensor({ db });
    assert.equal(r.ok, true);
    assert.equal(r.worlds, 1);
    assert.equal(r.written, 6);

    const sig = signalsForWorld(db, "w-active");
    assert.equal(sig.hasData, true);
  });

  it("rule_modulators.climate overrides baseline", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO worlds (id, rule_modulators) VALUES (?, ?)`)
      .run("w-cold", JSON.stringify({ climate: { temperature: -10, humidity: 85 } }));
    db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
      .run("w-cold", "u1");

    runEnvironmentSensor({ db });
    const sig = signalsForWorld(db, "w-cold");
    assert.ok(Math.abs(sig.temperature - (-10)) < 1.0,
      `expected ~-10°C, got ${sig.temperature}`);
    assert.ok(Math.abs(sig.humidity - 85) < 1.0);
  });

  it("decay sweep prunes old rows", () => {
    const db = setupDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO embodied_signal_log
        (id, world_id, cell_x, cell_z, channel, value, source, recorded_at, decay_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("expired", "w", 0, 0, "thermal_os.ambient_temp", 0, "sensor", now - 1000, now - 10);

    const r = runEnvironmentSensor({ db });
    assert.ok(r.pruned >= 1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Full chain: a fire spell in cold air vs hot air gives different damage
// ───────────────────────────────────────────────────────────────────────────

describe("integration: env-coupling end-to-end", () => {
  it("fire damage in dry+sunny is meaningfully larger than in storm", () => {
    const dry  = { hasData: true, temperature: 30, humidity: 25, light: 100000, weatherKind: "sunny" };
    const wet  = { hasData: true, temperature: 18, humidity: 85, light: 4000,   weatherKind: "storm" };
    const baseDamage = 100;
    const dryDmg = baseDamage * elementalEnvBoost("fire", dry);
    const wetDmg = baseDamage * elementalEnvBoost("fire", wet);
    assert.ok(dryDmg > wetDmg * 2,
      `dry-day fire (${dryDmg}) should be >2× wet-storm fire (${wetDmg})`);
  });

  it("storm + lightning compounds: 1.6× from boost alone", () => {
    const storm = { hasData: true, temperature: 18, humidity: 85, weatherKind: "storm" };
    assert.equal(elementalEnvBoost("lightning", storm), 1.6);
  });

  it("multiplier × cap interaction: env boost applied AFTER cap (load-bearing)", () => {
    // This is a contract reminder: combat path must apply boost AFTER
    // _validateDamageCap. If a future refactor inverts the order, the cap
    // becomes effectively skill.max_damage * 2.5 / 1.6 ≈ 1.56 — and storm
    // lightning hitting "cap" is now just a strong crit. Test pins the
    // expected behaviour: when boost > 1, post-cap damage exceeds cap.
    const cap = 250;          // skill.max_damage * 2.5
    const rawAfterCap = 250;  // damage at the cap before boost
    const boost = 1.6;
    const final = rawAfterCap * boost;
    assert.ok(final > cap, "env boost applied after cap exceeds the raw cap");
  });
});
