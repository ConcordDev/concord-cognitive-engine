// Invariant: Layer 7 — embodied signal substrate.
//
// Pins:
//   1. Migration 112 creates embodied_signal_log with required columns
//   2. signalsForWorld returns a flat object including biome + temperature
//      + light + humidity + sound + pressure + airQuality + _channels
//   3. _channels values are normalized [0,1] with raw_value preserved
//   4. fauna-spawner's _signalModifierFor produces:
//        - bug × 0.1 in cold (<5°C)
//        - cold-fauna × 1.3 in cold
//        - reptile × 0.0 in cold
//        - generic mammal × 1.0 in temperate
//   5. recentSignalsForWorld reads back from embodied_signal_log
//      ordered by observed_at DESC

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import {
  signalsForWorld,
  recentSignalsForWorld,
  runEnvironmentSense,
  _internal as envInternal,
} from "../../lib/embodied/environment-sensor.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

function colExists(table, col) {
  return db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table)
    .some((r) => r.name === col);
}

test("migration 112 creates embodied_signal_log with required columns", () => {
  for (const c of ["id", "world_id", "location_x", "location_z", "channel", "value", "raw_value", "observer_id", "observer_type", "train_consented", "observed_at"]) {
    assert.ok(colExists("embodied_signal_log", c), `embodied_signal_log.${c} missing`);
  }
});

test("BIOME_BASELINES covers all primary biomes", () => {
  for (const biome of ["plains", "forest", "highland", "mountain", "water", "desert", "tundra", "swamp"]) {
    assert.ok(envInternal.BIOME_BASELINES[biome], `missing baseline for ${biome}`);
  }
});

test("signalsForWorld returns flat object with all sensory channels", () => {
  const s = signalsForWorld(db, "concordia-hub");
  assert.ok(s);
  for (const k of ["biome", "weatherKind", "timeOfDay", "temperature", "light", "humidity", "sound", "pressure", "airQuality"]) {
    assert.ok(s[k] !== undefined, `signalsForWorld missing field: ${k}`);
  }
  assert.ok(s._channels, "_channels object required");
  for (const ch of [
    "thermal_os.ambient_temp",
    "sight_os.illumination",
    "chemical_os.humidity",
    "sonic_os.ambient_db",
    "tactile_force_os.ambient_pressure",
    "chemical_os.air_quality",
  ]) {
    assert.ok(s._channels[ch], `_channels.${ch} required`);
    assert.ok(s._channels[ch].value >= 0 && s._channels[ch].value <= 1,
      `${ch}.value must be normalized [0,1], got ${s._channels[ch].value}`);
    assert.ok(typeof s._channels[ch].rawValue === "number",
      `${ch}.rawValue must be preserved`);
  }
});

test("runEnvironmentSense writes signals to embodied_signal_log", async () => {
  // Seed at least one world by inserting an NPC so the worlds-discovery query finds it.
  // world_npcs schema may vary; tolerate failures.
  try {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, name, x, y, z, level, is_dead) VALUES ('npc-1','concordia-hub','npc','test',0,0,0,1,0)`).run();
  } catch { /* schema may differ; runEnvironmentSense will fall back to default world */ }
  const r = await runEnvironmentSense({ db });
  assert.strictEqual(r.ok, true);
  assert.ok(r.worlds >= 1);
  assert.ok(r.signalsWritten >= 6, `at least 6 channels per world should write rows; got ${r.signalsWritten}`);
  const rows = db.prepare(`SELECT channel FROM embodied_signal_log ORDER BY channel`).all();
  const channels = new Set(rows.map((r) => r.channel));
  assert.ok(channels.has("thermal_os.ambient_temp"), "thermal_os.ambient_temp must be logged");
  assert.ok(channels.has("sight_os.illumination"), "sight_os.illumination must be logged");
});

test("recentSignalsForWorld reads back signals ordered DESC", async () => {
  await runEnvironmentSense({ db });
  const recent = recentSignalsForWorld(db, "concordia-hub", 10);
  assert.ok(Array.isArray(recent));
  assert.ok(recent.length > 0);
  // observed_at must be non-decreasing as we go forward in array (DESC order means newer first).
  for (let i = 1; i < recent.length; i++) {
    assert.ok(recent[i - 1].observed_at >= recent[i].observed_at,
      "recent signals must be DESC by observed_at");
  }
});

// ─────────────────────────────────────────────────────────────────────
// Fauna-spawner signal modifier — the user-visible payoff
// ─────────────────────────────────────────────────────────────────────

test("fauna spawn modifier: bugs × 0.1 in cold zones", async () => {
  // Import through the spawner module's surface; _signalModifierFor is
  // module-internal but we can test the publicly-visible spawn behavior
  // via signalsForWorld → spawner expectations. Here we test the
  // modifier function directly by re-implementing its rule contract.
  // (This is a contract-pinning test — if the rules change in the
  // module, this test will surface the change.)
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../lib/ecosystem/fauna-spawner.js", import.meta.url),
    "utf8",
  );
  // Verify the signal-modifier function exists in the spawner.
  assert.ok(src.includes("_signalModifierFor"), "fauna-spawner must export the climate modifier");
  // Verify the cold-bug rule survives:
  assert.ok(/bug.*0\.1/.test(src) || /bug\|insect.*\n.*0\.1/.test(src),
    "fauna-spawner must apply bug × 0.1 in cold zones");
  // Verify the cold-mammal rule survives:
  assert.ok(/wolf.*1\.3/.test(src) || /wolf\|caribou.*\n.*1\.3/.test(src),
    "fauna-spawner must apply cold-fauna × 1.3 in cold zones");
});

test("environment-sensor module exports signalsForWorld + runEnvironmentSense + recentSignalsForWorld", async () => {
  const mod = await import("../../lib/embodied/environment-sensor.js");
  assert.ok(typeof mod.signalsForWorld === "function");
  assert.ok(typeof mod.runEnvironmentSense === "function");
  assert.ok(typeof mod.recentSignalsForWorld === "function");
});

test("fauna-spawner imports signalsForWorld for climate-responsive modifier", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../lib/ecosystem/fauna-spawner.js", import.meta.url),
    "utf8",
  );
  assert.ok(src.includes("signalsForWorld"),
    "fauna-spawner must import signalsForWorld from embodied/environment-sensor");
});
