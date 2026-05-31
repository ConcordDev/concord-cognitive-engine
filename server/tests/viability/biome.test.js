// Wave 5 #24 — procedural biome. Pins the cone-based biome classifier (the
// environment's best-fitting survival cone labels the terrain) + lux light
// normalisation + the additive `biome` field on the signal bundle.
//
// Run: node --test tests/viability/biome.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import { classifyBiome, BIOMES } from "../../lib/viability/biome.js";
import { signalsForWorld } from "../../lib/embodied/signals.js";

describe("classifyBiome", () => {
  it("cold → arctic, hot+dry → desert, hot+humid → tropical", () => {
    assert.equal(classifyBiome({ temperature: -20, humidity: 40 }).biome, "arctic");
    assert.equal(classifyBiome({ temperature: 42, humidity: 15 }).biome, "desert");
    assert.equal(classifyBiome({ temperature: 35, humidity: 60 }).biome, "tropical");
    // a very humid hot cell reads as aquatic (single-axis water cone) — by design
    assert.equal(classifyBiome({ temperature: 30, humidity: 95 }).biome, "aquatic");
  });

  it("normalises a lux light reading for the cave cone (dark + mild → cave habitable)", () => {
    // lux ~0 (pitch dark) + mild temp → cave is among the habitable set
    const c = classifyBiome({ temperature: 14, humidity: 50, light: 0 });
    assert.ok(c.habitable.includes("cave"), `habitable=${c.habitable}`);
  });

  it("an out-of-all-cones environment is barren", () => {
    const c = classifyBiome({ temperature: 200, humidity: 50 });
    assert.equal(c.biome, "barren");
    assert.equal(c.viability, 0);
  });

  it("ranks every known biome with a viability score", () => {
    const c = classifyBiome({ temperature: 20, humidity: 60 });
    assert.equal(c.ranked.length, BIOMES.length);
    assert.ok(c.ranked.every((r) => r.V >= 0 && r.V <= 1));
  });
});

describe("signal bundle carries an additive biome label", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("signalsForWorld attaches a `biome` field (barren when no data)", () => {
    const s = signalsForWorld(db, "no-such-world");
    assert.ok("biome" in s, "biome field present");
    assert.equal(typeof s.biome, "string");
  });
});
