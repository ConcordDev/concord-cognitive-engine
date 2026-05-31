// WAVE L1 — the dead-simple skill-forge on-ramp. Pins that pick element+intent
// +name mints a usable spell through glyph-spells, distinct-glyph minimum is
// always met, and bad inputs degrade to sane defaults.
//
// Run: node --test tests/skill-forge.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { quickForge, ELEMENTS, INTENTS } from "../lib/skill-forge.js";
import { listSpellsForUser } from "../lib/glyph-spells.js";

describe("quickForge", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    try { db.prepare("INSERT INTO users (id, username) VALUES ('u1','alice')").run(); } catch { /* users shape varies */ }
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("pick element + intent + name → a minted, usable spell in <2 steps", () => {
    const r = quickForge(db, { userId: "u1", worldId: "w", element: "fire", intent: "bolt", name: "Flame Bolt" });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.spellId || r.name);
    const mine = listSpellsForUser(db, "u1");
    assert.ok(mine.length >= 1);
  });

  it("element whose primary == intent glyph still mints (distinct-component min met)", () => {
    // ice element primary is g_frost_seal; intent 'ward' also maps to g_frost_seal
    const r = quickForge(db, { userId: "u1", worldId: "w", element: "ice", intent: "ward", name: "Frost Guard" });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("bad element/intent degrade to defaults (fire/bolt), still mints", () => {
    const r = quickForge(db, { userId: "u1", worldId: "w", element: "plasma", intent: "yeet" });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("missing inputs are rejected", () => {
    assert.equal(quickForge(db, { worldId: "w", element: "fire" }).ok, false);
    assert.equal(quickForge(db, { userId: "u1", element: "fire" }).ok, false);
  });

  it("exposes the starter element + intent menus", () => {
    assert.ok(ELEMENTS.includes("fire") && ELEMENTS.includes("ice"));
    assert.deepEqual(INTENTS, ["strike", "bolt", "ward", "dash"]);
  });
});
