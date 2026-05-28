// Phase BA4 — wardrobe overlay (cosmetic vs replace) tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { equipOutfit, getCosmeticOverlay, clearCosmeticOverlay } from "../lib/wardrobe.js";
import { up as upWardrobeOverlay } from "../migrations/234_wardrobe_overlay.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      appearance_json TEXT
    );
    CREATE TABLE saved_outfits (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT,
      slots_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
  upWardrobeOverlay(db);
  return db;
}

function seedOutfit(db, userId, outfitId, slots) {
  db.prepare(`INSERT INTO saved_outfits VALUES (?, ?, ?, ?, unixepoch(), unixepoch())`)
    .run(outfitId, userId, "Test", JSON.stringify(slots));
}

describe("Phase BA4 — wardrobe overlay", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    db.prepare(`INSERT INTO users (id, appearance_json) VALUES (?, ?)`)
      .run("u1", JSON.stringify({ slots: { chest: { primary: "stat-armor" } } }));
  });

  it("cosmetic mode preserves underlying stat gear", () => {
    seedOutfit(db, "u1", "outfit-1", { chest: { primary: "fancy-tunic" } });
    const r = equipOutfit(db, "outfit-1", "u1", "cosmetic");
    assert.equal(r.ok, true);
    assert.equal(r.mode, "cosmetic");

    const base = db.prepare(`SELECT appearance_json FROM users WHERE id = ?`).get("u1");
    assert.equal(JSON.parse(base.appearance_json).slots.chest.primary, "stat-armor",
      "underlying stat gear preserved");

    const overlay = getCosmeticOverlay(db, "u1");
    assert.equal(overlay.outfitId, "outfit-1");
    assert.equal(overlay.slots.chest.primary, "fancy-tunic");
    assert.equal(overlay.mode, "cosmetic");
  });

  it("replace mode is back-compat (writes to appearance_json)", () => {
    seedOutfit(db, "u1", "outfit-1", { chest: { primary: "fancy-tunic" } });
    const r = equipOutfit(db, "outfit-1", "u1", "replace");
    assert.equal(r.mode, "replace");
    const base = db.prepare(`SELECT appearance_json FROM users WHERE id = ?`).get("u1");
    assert.equal(JSON.parse(base.appearance_json).slots.chest.primary, "fancy-tunic");
    assert.equal(getCosmeticOverlay(db, "u1"), null, "no overlay set in replace mode");
  });

  it("default mode is cosmetic (no arg defaults to overlay)", () => {
    seedOutfit(db, "u1", "outfit-1", { chest: { primary: "fancy-tunic" } });
    const r = equipOutfit(db, "outfit-1", "u1");
    assert.equal(r.mode, "cosmetic");
  });

  it("clearCosmeticOverlay nulls the column", () => {
    seedOutfit(db, "u1", "outfit-1", { chest: { primary: "fancy-tunic" } });
    equipOutfit(db, "outfit-1", "u1");
    assert.notEqual(getCosmeticOverlay(db, "u1"), null);
    clearCosmeticOverlay(db, "u1");
    assert.equal(getCosmeticOverlay(db, "u1"), null);
  });

  it("toggle between modes is idempotent", () => {
    seedOutfit(db, "u1", "outfit-1", { chest: { primary: "fancy-tunic" } });
    equipOutfit(db, "outfit-1", "u1", "cosmetic");
    equipOutfit(db, "outfit-1", "u1", "replace");
    equipOutfit(db, "outfit-1", "u1", "cosmetic");
    // After the cycle, overlay has the outfit and appearance_json has the prior replace value.
    assert.equal(getCosmeticOverlay(db, "u1").outfitId, "outfit-1");
  });
});
