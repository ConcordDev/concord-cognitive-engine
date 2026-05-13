/**
 * Tier-2 contract test — canon worlds + Tunya country structure.
 *
 * Pins:
 *   - The 9 canon worlds all exist and have valid meta.json
 *   - The 12 fake-world country directories DO NOT exist (migrated into Tunya)
 *   - content/world/tunya/countries.json declares ≥ 12 countries with capital + faction_id
 *   - Every Tunyan country's faction_id resolves to a faction in tunya/factions.json
 *   - Tunya NPCs include country_id for migrated rows
 *
 * Run: node --test tests/world-content-validate.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WORLD_ROOT = path.join(REPO_ROOT, "content", "world");

const CANON_WORLDS = [
  "concordia-hub", "tunya", "cyber", "crime", "fantasy",
  "superhero", "sovereign-ruins", "lattice-crucible", "concord-link-frontier",
];

const REMOVED_FAKE_WORLDS = [
  "dinye", "aekon", "asbir", "fluxom", "nil", "akeia",
  "sangree", "medici", "sahm", "bahiij",
  "ancient-tunyan-ruins", "cactem-strip",
];

describe("Canon worlds", () => {
  it("9 canon worlds exist", () => {
    for (const name of CANON_WORLDS) {
      const dir = path.join(WORLD_ROOT, name);
      assert.ok(fs.existsSync(dir), `missing canon world dir: ${name}`);
    }
  });

  it("each canon world has either meta.json or a recognised hub structure", () => {
    for (const name of CANON_WORLDS) {
      const dir = path.join(WORLD_ROOT, name);
      const hasMeta = fs.existsSync(path.join(dir, "meta.json"));
      // concordia-hub uses a different structure (festivals/recipes/fauna/cultures/tracks subdirs + no meta).
      const isHub = name === "concordia-hub" && fs.existsSync(path.join(dir, "cultures.json"));
      assert.ok(hasMeta || isHub, `${name}: missing meta.json AND not the hub`);
    }
  });

  it("the 12 fake country worlds DO NOT exist (migrated into Tunya)", () => {
    for (const name of REMOVED_FAKE_WORLDS) {
      const dir = path.join(WORLD_ROOT, name);
      assert.ok(!fs.existsSync(dir), `fake country dir should be deleted: ${name}`);
    }
  });
});

describe("Tunya country structure", () => {
  it("content/world/tunya/countries.json exists + has countries array", () => {
    const file = path.join(WORLD_ROOT, "tunya", "countries.json");
    assert.ok(fs.existsSync(file), "countries.json missing");
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    assert.ok(Array.isArray(data.countries), "countries.json must have 'countries' array");
    assert.ok(data.countries.length >= 12, `expected ≥ 12 countries, got ${data.countries.length}`);
  });

  it("each country has country_id + faction_id + capital with x/z", () => {
    const data = JSON.parse(fs.readFileSync(path.join(WORLD_ROOT, "tunya", "countries.json"), "utf-8"));
    for (const c of data.countries) {
      assert.ok(typeof c.country_id === "string" && c.country_id.length > 0, `country missing country_id`);
      assert.ok(typeof c.faction_id === "string" && c.faction_id.length > 0, `${c.country_id}: missing faction_id`);
      assert.ok(c.capital, `${c.country_id}: missing capital`);
      assert.ok(Number.isFinite(c.capital.x), `${c.country_id}: capital.x must be number`);
      assert.ok(Number.isFinite(c.capital.z), `${c.country_id}: capital.z must be number`);
    }
  });

  it("every country's faction_id resolves to a faction in tunya/factions.json", () => {
    const countries = JSON.parse(fs.readFileSync(path.join(WORLD_ROOT, "tunya", "countries.json"), "utf-8")).countries;
    const factions = JSON.parse(fs.readFileSync(path.join(WORLD_ROOT, "tunya", "factions.json"), "utf-8"));
    const factionList = Array.isArray(factions) ? factions : (factions.factions || []);
    const ids = new Set(factionList.map((f) => f.id));
    for (const c of countries) {
      assert.ok(ids.has(c.faction_id), `${c.country_id}: faction_id "${c.faction_id}" not in tunya/factions.json`);
    }
  });

  it("Tunya npcs.json has at least 30 NPCs (10 original + ≥ 20 migrated country NPCs)", () => {
    const file = path.join(WORLD_ROOT, "tunya", "npcs.json");
    const npcs = JSON.parse(fs.readFileSync(file, "utf-8"));
    assert.ok(npcs.length >= 30, `expected ≥ 30 NPCs in Tunya, got ${npcs.length}`);
  });

  it("migrated NPCs have country_id field", () => {
    const npcs = JSON.parse(fs.readFileSync(path.join(WORLD_ROOT, "tunya", "npcs.json"), "utf-8"));
    const withCountry = npcs.filter((n) => typeof n.country_id === "string");
    assert.ok(withCountry.length >= 20, `expected ≥ 20 NPCs with country_id, got ${withCountry.length}`);
  });
});
