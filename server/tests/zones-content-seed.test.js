// Content pillar 1 — authored lore zones (zones.json) → world_zones, gating
// combat/spawn via combatRuleFor. Seeds through the same upsertZone path the
// runtime uses; pins the round-trip + idempotency + that the lore safe plaza /
// pvp arena / hazard ruins become real rules.
//
// Run: node --test tests/zones-content-seed.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedZonesFromContent, combatRuleFor, validateZone } from "../lib/world-zones.js";

const ZONES = [
  { name: "The Seven Spokes Inn", kind: "sanctuary", x: 60, z: 40, radius: 30,
    rules: { combat: false, pvp: false, regenPerTick: 5, noAggro: true } },
  { name: "The Proving Ring", kind: "pvp", x: -120, z: 90, radius: 45,
    rules: { combat: true, pvp: true } },
  { name: "The Sundered Verge", kind: "hazard", x: 280, z: -240, radius: 70,
    rules: { combat: true, pvp: false, hazard: 8, element: "energy" } },
];

test("authored zones seed and gate combat at their centers", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);

  assert.equal(seedZonesFromContent(db, "concordia-hub", ZONES), 3);

  // PvP arena → combat + pvp ON.
  const ring = combatRuleFor(db, "concordia-hub", -120, 90);
  assert.equal(ring.combatAllowed, true);
  assert.equal(ring.pvpAllowed, true);
  assert.equal(ring.zone.kind, "pvp");

  // Sanctuary inn → combat OFF.
  const inn = combatRuleFor(db, "concordia-hub", 60, 40);
  assert.equal(inn.combatAllowed, false);
  assert.equal(inn.pvpAllowed, false);

  // Hazard verge → real per-tick damage + element.
  const verge = combatRuleFor(db, "concordia-hub", 280, -240);
  assert.ok(verge.hazardDps > 0, "hazard zone deals damage");
  assert.equal(verge.hazardElement, "energy");

  // Outside any authored zone → world default (combat on, pvp off).
  const open = combatRuleFor(db, "concordia-hub", 900, 900);
  assert.equal(open.combatAllowed, true);
  assert.equal(open.pvpAllowed, false);

  db.close();
});

test("re-seed is idempotent (upsert on world+name, no duplicates)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedZonesFromContent(db, "concordia-hub", ZONES);
  seedZonesFromContent(db, "concordia-hub", ZONES);
  const c = db.prepare("SELECT COUNT(*) c FROM world_zones WHERE world_id='concordia-hub'").get().c;
  assert.equal(c, 3, "re-seed updates in place");
  db.close();
});

test("validateZone rejects malformed entries", () => {
  assert.equal(validateZone({ name: "x", kind: "pvp" }).ok, true);
  assert.equal(validateZone({ name: "x", kind: "nonsense" }).ok, false);
  assert.equal(validateZone({ kind: "pvp" }).ok, false);          // no name
  assert.equal(validateZone({ name: "x", kind: "pvp", radius: "nope" }).ok, false);
  assert.equal(validateZone(null).ok, false);
});

test("the authored hub zones.json is valid + parses", async () => {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../../content/world/concordia-hub/zones.json", import.meta.url);
  const arr = JSON.parse(readFileSync(url, "utf8"));
  assert.ok(Array.isArray(arr) && arr.length >= 3);
  for (const z of arr) assert.equal(validateZone(z).ok, true, `zone ${z.name} valid`);
});
