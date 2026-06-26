// Content pillar 2 (materials) — authored lore materials (items.json) →
// resource_properties, read by propsFor (the craft-resolve input path). Pins the
// round-trip, idempotency, validation, and authored JSON validity.
//
// Run: node --test tests/item-blueprints-seed.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedItemBlueprints, validateItemBlueprint, propsFor } from "../lib/resources.js";

const ITEMS = [
  { item_id: "lattice_shard", potency: 58, affinity: "magic", stability: 60, rarity_tier: 4, source_type: "verge_salvage", magical_sub: "aether" },
  { item_id: "refusal_iron", potency: 30, affinity: "physical", stability: 99, rarity_tier: 3, source_type: "keep_forge" },
];

test("authored materials seed and resolve through propsFor", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  assert.equal(seedItemBlueprints(db, ITEMS), 2);

  const shard = propsFor("lattice_shard", { db });
  assert.equal(shard.potency, 58);
  assert.equal(shard.affinity, "magic");
  assert.equal(shard.rarity_tier, 4);
  assert.equal(shard.magical_sub, "aether");

  // Unknown material falls back to defaults (never throws).
  const unknown = propsFor("no_such_item", { db });
  assert.ok(Number.isFinite(unknown.potency));
  db.close();
});

test("re-seed is idempotent (upsert on item_id, no duplicates)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  seedItemBlueprints(db, ITEMS);
  seedItemBlueprints(db, ITEMS);
  const c = db.prepare("SELECT COUNT(*) c FROM resource_properties WHERE item_id IN ('lattice_shard','refusal_iron')").get().c;
  assert.equal(c, 2, "upsert in place");
  db.close();
});

test("validateItemBlueprint rejects malformed entries", () => {
  assert.equal(validateItemBlueprint({ item_id: "x" }).ok, true);
  assert.equal(validateItemBlueprint({ potency: 5 }).ok, false);          // no item_id
  assert.equal(validateItemBlueprint({ item_id: "x", potency: "NaN" }).ok, false);
  assert.equal(validateItemBlueprint(null).ok, false);
});

test("authored content/items.json is valid", async () => {
  const { readFileSync } = await import("node:fs");
  const url = new URL("../../content/items.json", import.meta.url);
  const arr = JSON.parse(readFileSync(url, "utf8"));
  assert.ok(Array.isArray(arr) && arr.length >= 1);
  for (const it of arr) assert.equal(validateItemBlueprint(it).ok, true, `${it.item_id} valid`);
});
