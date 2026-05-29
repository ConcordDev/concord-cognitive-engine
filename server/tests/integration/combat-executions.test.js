/**
 * F3.1 hyperarmor + F3.2 execution moves.
 *
 * Pins:
 *   - applyHyperarmorDowngrade absorbs flinch/rocked, NOT knockdown
 *   - triggerStaggerFromImpact with hyperarmor=true absorbs a rocked hit
 *   - resolveExecution: deathblow (broken target) > backstab (off-axis) > none
 *   - grantHyperarmor / hasHyperarmor window round-trips
 *
 * Run: node --test tests/integration/combat-executions.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upPolish } from "../../migrations/140_combat_polish.js";
import { up as up268 } from "../../migrations/268_combat_hyperarmor.js";
import {
  applyHyperarmorDowngrade, resolveExecution, grantHyperarmor, hasHyperarmor,
  currentStaggerSeverity, EXECUTION_CONSTANTS,
} from "../../lib/combat/executions.js";
import { triggerStaggerFromImpact, getOrCreateActorState } from "../../lib/combat-polish.js";

function freshDb() {
  const db = new Database(":memory:");
  upPolish(db); up268(db);
  return db;
}

describe("F3.1 — hyperarmor downgrade (pure)", () => {
  it("absorbs flinch + rocked but never knockdown", () => {
    assert.equal(applyHyperarmorDowngrade("flinch", true).severity, "none");
    assert.equal(applyHyperarmorDowngrade("flinch", true).absorbed, true);
    assert.equal(applyHyperarmorDowngrade("rocked", true).severity, "none");
    assert.equal(applyHyperarmorDowngrade("knockdown", true).severity, "knockdown");
    // no hyperarmor → passes through
    assert.equal(applyHyperarmorDowngrade("rocked", false).severity, "rocked");
  });
});

describe("F3.1 — hyperarmor in the stagger path", () => {
  it("a heavy-momentum hit that would rock is absorbed under hyperarmor", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n1", worldId: "w1", profileId: "sifu_brawler" });
    // a momentum that rocks without hyperarmor...
    const base = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "n1", momentum: 220, massKg: 70 });
    assert.notEqual(base.severity, "none");
    // ...is absorbed with hyperarmor (unless it's a knockdown).
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n2", worldId: "w1", profileId: "sifu_brawler" });
    const armored = triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "n2", momentum: 220, massKg: 70, hyperarmor: true });
    if (base.severity === "rocked" || base.severity === "flinch") {
      assert.equal(armored.severity, "none");
      assert.equal(armored.hyperarmorAbsorbed, true);
    }
    db.close();
  });
});

describe("F3.1 — hyperarmor window", () => {
  it("grant + has round-trips and expires", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "p1", worldId: "w1" });
    const now = 100000;
    grantHyperarmor(db, { actorKind: "player", actorId: "p1", durationMs: 400, nowMs: now });
    assert.equal(hasHyperarmor(db, { actorKind: "player", actorId: "p1", nowMs: now + 100 }), true);
    assert.equal(hasHyperarmor(db, { actorKind: "player", actorId: "p1", nowMs: now + 500 }), false);
    db.close();
  });
});

describe("F3.2 — execution resolution", () => {
  it("deathblow on a broken target; backstab off-axis; none otherwise", () => {
    assert.equal(resolveExecution({ offAxis: 0, targetSeverity: "rocked" }).kind, "deathblow");
    assert.equal(resolveExecution({ offAxis: 0, targetSeverity: "knockdown" }).kind, "deathblow");
    assert.equal(resolveExecution({ offAxis: 0.8, targetSeverity: "none" }).kind, "backstab");
    assert.equal(resolveExecution({ offAxis: 0.2, targetSeverity: "none" }).kind, "none");
    // deathblow wins over backstab when both apply
    assert.equal(resolveExecution({ offAxis: 0.9, targetSeverity: "rocked" }).kind, "deathblow");
  });
  it("multipliers match the constants", () => {
    assert.equal(resolveExecution({ targetSeverity: "rocked" }).multiplier, EXECUTION_CONSTANTS.DEATHBLOW_MULT);
    assert.equal(resolveExecution({ offAxis: 0.7 }).multiplier, EXECUTION_CONSTANTS.BACKSTAB_MULT);
    assert.equal(resolveExecution({}).multiplier, 1);
  });
});

describe("F3.2 — currentStaggerSeverity", () => {
  it("reports rocked while the window is live", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "npc", actorId: "n3", worldId: "w1", profileId: "sifu_brawler" });
    triggerStaggerFromImpact(db, { actorKind: "npc", actorId: "n3", momentum: 400, massKg: 60 }); // big → rocked/knockdown
    const sev = currentStaggerSeverity(db, { actorKind: "npc", actorId: "n3" });
    assert.equal(sev, "rocked");
    db.close();
  });
});
