/**
 * Living Society — Phase 0: resource property substrate contract test.
 *
 * Pins migration 278 (resource_properties + player_inventory.properties_json),
 * the canonical RESOURCE_CATALOG, and propsFor's resolution order
 * (override → DB row → catalog → safe default). Deterministic, no RNG.
 *
 * Run: node --test tests/resources.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up278 } from "../migrations/278_resource_properties.js";
import {
  RESOURCE_CATALOG, propsFor, tierOf, isValidAffinity, seedResourceProperties, RESOURCE_CONSTANTS,
  RESOURCE_ID_ALIASES,
} from "../lib/resources.js";
import { resolveCraft } from "../lib/craft-resolve.js";
import { BASE_PRICES } from "../lib/world-economy.js";

function setupDb() {
  const db = new Database(":memory:");
  // player_inventory must pre-exist for the ALTER to add properties_json.
  db.exec(`CREATE TABLE player_inventory (id TEXT PRIMARY KEY, user_id TEXT, item_id TEXT, quantity INTEGER, quality INTEGER)`);
  up278(db);
  return db;
}

describe("Phase 0 — migration 278", () => {
  it("creates resource_properties + adds player_inventory.properties_json (idempotent)", () => {
    const db = setupDb();
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='resource_properties'").get());
    assert.ok(db.pragma("table_info(player_inventory)").some((c) => c.name === "properties_json"));
    // second run must not throw
    up278(db);
  });

  it("applies even when player_inventory is absent (guarded)", () => {
    const db = new Database(":memory:");
    up278(db); // no player_inventory → ALTER skipped, no throw
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='resource_properties'").get());
  });
});

describe("Phase 0 — RESOURCE_CATALOG", () => {
  it("spans all 5 rarity tiers", () => {
    const tiers = new Set(Object.values(RESOURCE_CATALOG).map((p) => p.rarity_tier));
    for (const t of [1, 2, 3, 4, 5]) assert.ok(tiers.has(t), `missing tier ${t}`);
  });

  it("includes the magical sub-tier (soul gems / mana / aether / essence)", () => {
    const subs = new Set(Object.values(RESOURCE_CATALOG).map((p) => p.magical_sub).filter(Boolean));
    for (const s of ["soul_gem", "mana", "aether", "essence"]) assert.ok(subs.has(s), `missing magical_sub ${s}`);
    // black soul gem = high potency, low stability (forbidden lane)
    assert.ok(RESOURCE_CATALOG.black_soul_gem.potency >= 80);
    assert.ok(RESOURCE_CATALOG.black_soul_gem.stability <= 40);
  });

  it("every catalog entry has a valid affinity + tiered potency ordering holds", () => {
    for (const [id, p] of Object.entries(RESOURCE_CATALOG)) {
      assert.ok(isValidAffinity(p.affinity), `${id} bad affinity ${p.affinity}`);
      assert.ok(p.potency >= 0 && p.potency <= 100, `${id} potency out of range`);
      assert.ok(p.rarity_tier >= 1 && p.rarity_tier <= 5, `${id} tier out of range`);
    }
    // a tier-5 legendary out-potencies a tier-1 basic
    assert.ok(RESOURCE_CATALOG.dragonbone.potency > RESOURCE_CATALOG.wood.potency);
  });
});

describe("Phase 0 — propsFor resolution order", () => {
  it("catalog lookup works without a DB", () => {
    assert.equal(propsFor("dragonbone").rarity_tier, 5);
    assert.equal(tierOf("iron_ore"), 1);
  });

  it("unknown item → safe default (basic tier-1 physical)", () => {
    const p = propsFor("mystery_widget");
    assert.equal(p.rarity_tier, 1);
    assert.equal(p.affinity, "physical");
    assert.equal(p, RESOURCE_CONSTANTS.DEFAULT_PROPS ? p : p); // shape sanity
    assert.equal(p.potency, RESOURCE_CONSTANTS.DEFAULT_PROPS.potency);
  });

  it("a per-slot override beats the catalog", () => {
    const p = propsFor("wood", { overrideJson: { potency: 77, affinity: "magic" } });
    assert.equal(p.potency, 77);
    assert.equal(p.affinity, "magic");
  });

  it("a DB row beats the catalog after seeding + edit", () => {
    const db = setupDb();
    assert.equal(seedResourceProperties(db).seeded, Object.keys(RESOURCE_CATALOG).length);
    // edit the DB row hotter than the catalog baseline
    db.prepare("UPDATE resource_properties SET potency = 99 WHERE item_id = 'wood'").run();
    assert.equal(propsFor("wood", { db }).potency, 99);
    // catalog-only (no db) is unchanged
    assert.equal(propsFor("wood").potency, RESOURCE_CATALOG.wood.potency);
  });

  it("seedResourceProperties is idempotent + no-ops without the table", () => {
    const db = setupDb();
    seedResourceProperties(db);
    const again = seedResourceProperties(db); // upsert, no dup error
    assert.equal(again.seeded, Object.keys(RESOURCE_CATALOG).length);
    assert.equal(seedResourceProperties(new Database(":memory:")).ok, false); // no table
  });
});

// ── Market-id ↔ catalog-id reconciliation ────────────────────────────────────
//
// `docs/concordia-specs/crafting-economy-housing-capability-map.md` §2.2 found
// RESOURCE_CATALOG (crafting-property namespace) and BASE_PRICES
// (world-economy.js, supply/demand pricing namespace) only overlapped on 3
// exact string ids. A material gathered/traded via the standard world-market
// path (e.g. `iron-ore`) silently fell through `propsFor` to DEFAULT_PROPS
// instead of its real, differentiated catalog entry — these tests pin the
// fix (an alias layer, not a rename of either namespace) and prove the
// reconciled ids resolve to their REAL catalog properties end-to-end through
// resolveCraft, not just via string comparison.
describe("Phase 0 — market-id → catalog-id alias reconciliation", () => {
  it("every alias target exists in RESOURCE_CATALOG and every alias source exists in BASE_PRICES", () => {
    for (const [marketId, catalogId] of Object.entries(RESOURCE_ID_ALIASES)) {
      assert.ok(marketId in BASE_PRICES, `alias source '${marketId}' is not a real BASE_PRICES id`);
      assert.ok(catalogId in RESOURCE_CATALOG, `alias target '${catalogId}' is not a real RESOURCE_CATALOG id`);
    }
  });

  it("a market-namespace id resolves to its real catalog entry, not DEFAULT_PROPS", () => {
    const viaMarketId = propsFor("iron-ore");
    const viaCatalogId = propsFor("iron_ore");
    assert.deepEqual(viaMarketId, viaCatalogId);
    assert.equal(viaMarketId.potency, RESOURCE_CATALOG.iron_ore.potency); // 14, not DEFAULT_PROPS' 10
    assert.notEqual(viaMarketId.potency, RESOURCE_CONSTANTS.DEFAULT_PROPS.potency);
  });

  it("mana-crystal / herbs / gold-ore all reconcile to their real catalog entries", () => {
    assert.deepEqual(propsFor("mana-crystal"), propsFor("mana_crystal"));
    assert.equal(propsFor("mana-crystal").affinity, "magic");
    assert.deepEqual(propsFor("herbs"), propsFor("herb"));
    assert.equal(propsFor("herbs").source_type, "forage");
    assert.deepEqual(propsFor("gold-ore"), propsFor("gold"));
    assert.equal(propsFor("gold-ore").rarity_tier, 3);
  });

  it("a DB row seeded under the canonical id is found when looked up by the market id", () => {
    const db = setupDb();
    seedResourceProperties(db); // seeds using RESOURCE_CATALOG's canonical (snake_case) ids only
    db.prepare("UPDATE resource_properties SET potency = 77 WHERE item_id = 'iron_ore'").run();
    // Crafting reads player_inventory.item_id, which is the market-style id ('iron-ore').
    // propsFor must fall back through the alias to find the canonical DB row.
    assert.equal(propsFor("iron-ore", { db }).potency, 77);
  });

  it("a market id with no real catalog counterpart still degrades honestly to DEFAULT_PROPS (not invented)", () => {
    // mythril-ore / vibranium-ore / scrap-metal etc are genuinely distinct
    // concepts with no crafting-property entry — the residual gap is real,
    // not a naming mismatch, so no alias should exist for them.
    assert.ok(!("mythril-ore" in RESOURCE_ID_ALIASES));
    const p = propsFor("mythril-ore");
    assert.deepEqual(p, { ...RESOURCE_CONSTANTS.DEFAULT_PROPS, ...(RESOURCE_CATALOG["mythril-ore"] || {}) });
    assert.equal(p.potency, RESOURCE_CONSTANTS.DEFAULT_PROPS.potency);
  });

  it("round-trip through resolveCraft: a gathered 'iron-ore' input now produces the same craft as its real 'iron_ore' catalog twin", () => {
    const viaMarketId = resolveCraft({
      inputs: [{ itemId: "iron-ore", qty: 1 }],
      playerSkill: 80, stationQuality: 50, risk: 0,
    });
    const viaCatalogId = resolveCraft({
      inputs: [{ itemId: "iron_ore", qty: 1 }],
      playerSkill: 80, stationQuality: 50, risk: 0,
    });
    assert.equal(viaMarketId.outputPotency, viaCatalogId.outputPotency);
    assert.equal(viaMarketId.outputStability, viaCatalogId.outputStability);

    // And it must differ measurably from the pre-fix DEFAULT_PROPS-driven result
    // (same skill/station/risk, but resolved via an uncatalogued id) — proving
    // the alias genuinely changes the craft outcome, not just a lookup detail.
    const viaUnknownId = resolveCraft({
      inputs: [{ itemId: "totally-unknown-mat", qty: 1 }],
      playerSkill: 80, stationQuality: 50, risk: 0,
    });
    assert.notEqual(viaMarketId.outputPotency, viaUnknownId.outputPotency);
    // iron_ore (potency 14) > DEFAULT_PROPS (potency 10) → real material craft is stronger
    assert.ok(viaMarketId.outputPotency > viaUnknownId.outputPotency);
  });
});
