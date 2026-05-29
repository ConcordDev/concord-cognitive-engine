/**
 * F4.1 — shared in-run draft engine.
 *
 * Pins:
 *   - rollDraft is deterministic (same step → same offering) + excludes picked
 *   - recordPick validates unknown / already-picked
 *   - getRunModifiers accumulates STRUCTURED effects (not strings)
 *   - synergies fire when their required boons are all held
 *   - picks are per (run_kind, run_id) — modes don't bleed into each other
 *
 * Run: node --test tests/integration/run-draft.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up267 } from "../../migrations/267_run_draft.js";
import {
  rollDraft, recordPick, getRunModifiers, pickedFor, DRAFT_POOL,
} from "../../lib/run-draft.js";

function freshDb() { const db = new Database(":memory:"); up267(db); return db; }

describe("F4.1 — rollDraft", () => {
  it("is deterministic for the same step + excludes already-picked", () => {
    const db = freshDb();
    const a = rollDraft(db, "roguelite", "run1", 3).map((b) => b.id);
    const b = rollDraft(db, "roguelite", "run1", 3).map((b) => b.id);
    assert.deepEqual(a, b, "same step → same offering");
    assert.equal(a.length, 3);
    recordPick(db, { runKind: "roguelite", runId: "run1", userId: "u1", pickId: a[0] });
    const next = rollDraft(db, "roguelite", "run1", 3).map((b) => b.id);
    assert.ok(!next.includes(a[0]), "picked boon no longer offered");
    db.close();
  });
});

describe("F4.1 — recordPick validation", () => {
  it("rejects unknown + already-picked", () => {
    const db = freshDb();
    assert.equal(recordPick(db, { runKind: "horde", runId: "r", userId: "u1", pickId: "nope" }).reason, "unknown_boon");
    const real = DRAFT_POOL[0].id;
    assert.equal(recordPick(db, { runKind: "horde", runId: "r", userId: "u1", pickId: real }).ok, true);
    assert.equal(recordPick(db, { runKind: "horde", runId: "r", userId: "u1", pickId: real }).reason, "already_picked");
    db.close();
  });
});

describe("F4.1 — getRunModifiers accumulates structured effects", () => {
  it("sums boon effects into a live modifier bundle", () => {
    const db = freshDb();
    recordPick(db, { runKind: "roguelite", runId: "r1", userId: "u1", pickId: "blade_storm" }); // damageMult +0.25
    recordPick(db, { runKind: "roguelite", runId: "r1", userId: "u1", pickId: "crit_oath" });   // critChance +0.10
    const m = getRunModifiers(db, "roguelite", "r1");
    assert.equal(m.modifiers.damageMult, 0.25);
    assert.equal(m.modifiers.critChance, 0.10);
    assert.equal(m.synergies.length, 0);
    db.close();
  });

  it("fires a synergy when both required boons are held", () => {
    const db = freshDb();
    recordPick(db, { runKind: "roguelite", runId: "r2", userId: "u1", pickId: "ember_lash" });  // fireDot +4
    recordPick(db, { runKind: "roguelite", runId: "r2", userId: "u1", pickId: "inferno_core" });// fireDot +6
    const m = getRunModifiers(db, "roguelite", "r2");
    // 4 + 6 + Inferno synergy bonus 6 = 16
    assert.equal(m.modifiers.fireDotPerHit, 16);
    assert.ok(m.synergies.some((s) => s.id === "inferno"));
    db.close();
  });
});

describe("F4.1 — per-run isolation", () => {
  it("picks don't bleed across run kinds / ids", () => {
    const db = freshDb();
    recordPick(db, { runKind: "roguelite", runId: "r1", userId: "u1", pickId: "iron_hide" });
    assert.deepEqual(pickedFor(db, "extraction", "r1"), []);
    assert.deepEqual(pickedFor(db, "roguelite", "r2"), []);
    assert.deepEqual(pickedFor(db, "roguelite", "r1"), ["iron_hide"]);
    db.close();
  });
});
