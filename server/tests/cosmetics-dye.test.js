// Phase BA3 — cosmetic dye tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { setDye, removeDye, getOverrides, applyAppearanceOverride } from "../lib/cosmetics.js";
import { up as upOverrides } from "../migrations/233_cosmetic_overrides.js";

function freshDb() { const db = new Database(":memory:"); upOverrides(db); return db; }

describe("Phase BA3 — cosmetic dye", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("setDye writes a row, idempotent on PK", () => {
    const a = setDye(db, "u1", "default", "chest", "primary", "#FF00FF");
    assert.equal(a.ok, true);
    const b = setDye(db, "u1", "default", "chest", "primary", "#00FFFF");
    assert.equal(b.ok, true);
    const o = getOverrides(db, "u1", "default");
    assert.equal(o.chest.primary, "#00FFFF", "PK upsert updates color");
  });

  it("rejects invalid channel + invalid hex", () => {
    assert.equal(setDye(db, "u1", "default", "chest", "stripe", "#FF0000").ok, false);
    assert.equal(setDye(db, "u1", "default", "chest", "primary", "red").ok, false);
    assert.equal(setDye(db, "u1", "default", "chest", "primary", "#FFFF").ok, false);
  });

  it("removeDye is idempotent (missing returns removed:false)", () => {
    setDye(db, "u1", "default", "chest", "primary", "#FF00FF");
    const a = removeDye(db, "u1", "default", "chest", "primary");
    assert.equal(a.ok, true); assert.equal(a.removed, true);
    const b = removeDye(db, "u1", "default", "chest", "primary");
    assert.equal(b.removed, false);
  });

  it("getOverrides groups by slot then channel", () => {
    setDye(db, "u1", "default", "chest", "primary", "#FF0000");
    setDye(db, "u1", "default", "chest", "trim", "#00FF00");
    setDye(db, "u1", "default", "legs", "primary", "#0000FF");
    const o = getOverrides(db, "u1", "default");
    assert.equal(o.chest.primary, "#FF0000");
    assert.equal(o.chest.trim, "#00FF00");
    assert.equal(o.legs.primary, "#0000FF");
  });

  it("applyAppearanceOverride composes without mutating base", () => {
    const base = { slots: { chest: { primary: "#000000", secondary: "#111111" } } };
    const overrides = { chest: { primary: "#FF00FF" }, legs: { primary: "#00FF00" } };
    const out = applyAppearanceOverride(base, overrides);
    assert.equal(out.slots.chest.primary, "#FF00FF", "override applied");
    assert.equal(out.slots.chest.secondary, "#111111", "non-overridden channel preserved");
    assert.equal(out.slots.legs.primary, "#00FF00", "new slot added");
    assert.equal(base.slots.chest.primary, "#000000", "base unmodified");
  });

  it("different avatar ids are isolated", () => {
    setDye(db, "u1", "avatar-a", "chest", "primary", "#FF0000");
    setDye(db, "u1", "avatar-b", "chest", "primary", "#00FF00");
    assert.equal(getOverrides(db, "u1", "avatar-a").chest.primary, "#FF0000");
    assert.equal(getOverrides(db, "u1", "avatar-b").chest.primary, "#00FF00");
  });
});
