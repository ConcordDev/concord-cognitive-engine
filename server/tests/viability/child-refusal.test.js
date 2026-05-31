// SL6 — the child-refusal-field. Pins the headline contract: an under-matured
// target is refused (can't be harmed / can't harm), an adult is not, the field
// stops gating an entity once it matures, scoped fields persist + reload, and
// unscoped fields keep gating everyone (off == today).
//
// Run: node --test tests/viability/child-refusal.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import {
  applyTemporaryRefusal,
  isRefused,
  isRefusedFor,
  maturityOf,
  isUnderMatured,
  loadPersistedRefusalFields,
} from "../../lib/refusal-field.js";

const KIND = "harm_to_children_refused";
const CHILD_SCOPE = { maturity: ["infant", "child", "adolescent"] };

describe("isRefusedFor — scoped gate", () => {
  it("refuses harm to an under-matured target but not an adult", () => {
    const state = {};
    applyTemporaryRefusal(state, "w", KIND, { durationMs: 60000, appliesTo: CHILD_SCOPE });
    assert.equal(isRefusedFor(state, "w", KIND, { kind: "npc", id: "n1", maturity: "child" }), true);
    assert.equal(isRefusedFor(state, "w", KIND, { kind: "player", id: "p1", maturity: "adult" }), false);
  });

  it("the field stops gating an entity once it matures (coming-of-age)", () => {
    const state = {};
    applyTemporaryRefusal(state, "w", KIND, { durationMs: 60000, appliesTo: CHILD_SCOPE });
    const target = { kind: "npc", id: "n2", maturity: "adolescent" };
    assert.equal(isRefusedFor(state, "w", KIND, target), true);
    target.maturity = "adult"; // grew up
    assert.equal(isRefusedFor(state, "w", KIND, target), false);
  });

  it("an unscoped field gates everyone (back-compat with isRefused)", () => {
    const state = {};
    applyTemporaryRefusal(state, "w", "hostility_paused", { durationMs: 60000 }); // no appliesTo
    assert.equal(isRefused(state, "w", "hostility_paused"), true);
    assert.equal(isRefusedFor(state, "w", "hostility_paused", { maturity: "adult" }), true); // unscoped → all
  });

  it("isUnderMatured classifies the protected tiers", () => {
    assert.equal(isUnderMatured("child"), true);
    assert.equal(isUnderMatured("adult"), false);
  });
});

describe("persistence of scoped fields", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a scoped field round-trips through the DB (applies_to_json)", () => {
    const writeState = { db };
    applyTemporaryRefusal(writeState, "w", KIND, { durationMs: 600000, appliesTo: CHILD_SCOPE });
    // fresh process: reload from the table only
    const reloaded = { db };
    const r = loadPersistedRefusalFields(reloaded);
    assert.equal(r.ok, true);
    assert.equal(isRefusedFor(reloaded, "w", KIND, { maturity: "child" }), true);
    assert.equal(isRefusedFor(reloaded, "w", KIND, { maturity: "adult" }), false); // scope survived
  });

  it("maturityOf reads player_children.maturity, defaults adult", () => {
    db.prepare("INSERT INTO player_children (id, parent_user_id, other_parent_kind, name, maturity) VALUES ('c1','u1','npc','Sprout','child')").run();
    assert.equal(maturityOf(db, "child", "c1"), "child");
    assert.equal(maturityOf(db, "player", "nobody"), "adult");
  });
});
