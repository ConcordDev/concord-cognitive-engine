/**
 * Sprint 1 (Connection) — defensive combat loop, now wired.
 *
 * The dodge/block socket handlers used to echo `:ack` and nothing else, so
 * attemptDodge/attemptParry/grantIFrames were built-but-unwired (zero non-test
 * callers). This pins the lib contract the handlers now invoke:
 *   - grantIFrames → applyHitToState whiffs an incoming hit (zero damage)
 *   - attemptDodge scores a perfect dodge inside the window + time dilation
 *   - attemptParry scores a perfect parry + opens a riposte window
 *   - a late input misses (outside the window)
 *
 * Run: node --test tests/integration/defensive-combat-loop.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upPolish } from "../../migrations/140_combat_polish.js";
import { attemptDodge, attemptParry, getOrCreateActorState } from "../../lib/combat-polish.js";
import { grantIFrames, applyHitToState, resetCombatState } from "../../lib/combat-state.js";

function freshDb() {
  const db = new Database(":memory:");
  upPolish(db);
  return db;
}

describe("Sprint 1 — i-frames whiff incoming hits", () => {
  it("a hit inside the i-frame window deals zero damage", () => {
    resetCombatState("p-iframe");
    grantIFrames("p-iframe", 350);
    const r = applyHitToState("p-iframe", { damage: 40 });
    assert.equal(r.iframed, true);
    assert.equal(r.damageMul, 0);
  });

  it("a hit after the window lands normally", () => {
    resetCombatState("p-iframe2");
    grantIFrames("p-iframe2", -1); // already expired
    const r = applyHitToState("p-iframe2", { damage: 40 });
    assert.equal(r.iframed, undefined === r.iframed ? undefined : false);
    assert.notEqual(r.damageMul, 0);
  });
});

describe("Sprint 1 — perfect dodge scoring", () => {
  it("an input early in the dodge window scores a perfect dodge + dilation", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "p1", worldId: "w1", profileId: "sifu_brawler" });
    const now = 100000;
    // duel_arena dodge_window_ms 320; perfect = lead <= 160.
    const r = attemptDodge(db, { defenderKind: "player", defenderId: "p1", defenderInputAt: now, attackArrivesAt: now + 100 });
    assert.equal(r.dodged, true);
    assert.equal(r.perfect, true);
    assert.ok(r.time_dilation_pct > 0, "perfect dodge grants time dilation in this profile");
    db.close();
  });

  it("a late input misses the dodge window", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "p2", worldId: "w1", profileId: "sifu_brawler" });
    const now = 100000;
    const r = attemptDodge(db, { defenderKind: "player", defenderId: "p2", defenderInputAt: now, attackArrivesAt: now + 5000 });
    assert.equal(r.dodged, false);
    db.close();
  });
});

describe("Sprint 1 — perfect parry opens a riposte", () => {
  it("a parry early in the window is perfect + grants a riposte window", () => {
    const db = freshDb();
    getOrCreateActorState(db, { actorKind: "player", actorId: "p3", worldId: "w1", profileId: "sifu_brawler" });
    const now = 100000;
    const r = attemptParry(db, { defenderKind: "player", defenderId: "p3", defenderInputAt: now, attackArrivesAt: now + 50 });
    assert.equal(r.parried, true);
    assert.equal(r.perfect, true);
    assert.ok(r.riposte_window_ms > 0);
    db.close();
  });
});
