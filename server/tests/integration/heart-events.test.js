/**
 * H3 — heart-event milestones + spouse behavior.
 *
 * Pins:
 *   - authored scenes load + milestoneCrossed detects a threshold crossing
 *   - courtInteraction fires a heart event once when affinity crosses a tier
 *   - the same milestone doesn't replay
 *   - a wed NPC reads as a spouse → "devoted" dialogue phase + follows
 *
 * Run: node --test tests/integration/heart-events.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up206 } from "../../migrations/206_romance.js";
import { up as up274 } from "../../migrations/274_heart_events.js";
import { courtInteraction, propose, wed } from "../../lib/romance-engine.js";
import {
  loadHeartEvents, milestoneCrossed, checkHeartEvent,
  isSpouse, spousesFollowingPlayer, spouseDialoguePhase, _resetHeartEvents,
} from "../../lib/heart-events.js";

function freshDb() {
  const db = new Database(":memory:");
  up206(db); up274(db);
  return db;
}

describe("H3 — heart events", () => {
  it("loads authored scenes ordered by threshold", () => {
    _resetHeartEvents();
    const scenes = loadHeartEvents();
    assert.ok(scenes.length >= 3, "expected the 3 default heart events");
    for (let i = 1; i < scenes.length; i++) {
      assert.ok(scenes[i].threshold >= scenes[i - 1].threshold, "sorted ascending");
    }
    // every scene has a playable body
    for (const s of scenes) {
      assert.ok(s.milestoneId && s.title && Array.isArray(s.scene) && s.scene.length >= 1);
    }
  });

  it("milestoneCrossed detects exactly the newly-crossed tier", () => {
    assert.equal(milestoneCrossed(0.0, 0.1), null);              // no crossing
    assert.equal(milestoneCrossed(0.2, 0.35).milestoneId, "first_spark"); // crosses 0.3
    assert.equal(milestoneCrossed(0.5, 0.62).milestoneId, "deepening");   // crosses 0.6
    // a big jump returns the HIGHEST crossed tier
    assert.equal(milestoneCrossed(0.0, 0.9).milestoneId, "devotion");
  });

  it("checkHeartEvent records once per (partner, milestone)", () => {
    const db = freshDb();
    const first = checkHeartEvent(db, "u1", "npc", "npc_a", 0.2, 0.35);
    assert.equal(first.milestoneId, "first_spark");
    // re-crossing the same tier doesn't replay
    assert.equal(checkHeartEvent(db, "u1", "npc", "npc_a", 0.2, 0.35), null);
    db.close();
  });

  it("courtInteraction surfaces a heart event when it crosses a tier", () => {
    const db = freshDb();
    // seed an existing courtship just under the first-spark threshold
    db.prepare(`INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u1','npc','npc_b',0.28,'acquainted')`).run();
    const r = courtInteraction(db, "u1", "npc", "npc_b", 1); // +0.05 → 0.33, crosses 0.3
    assert.ok(r.ok);
    assert.ok(r.heartEvent, "expected a heart event on crossing");
    assert.equal(r.heartEvent.milestoneId, "first_spark");
    // affinity bonus folded in
    assert.ok(r.affinity > 0.33, "scene affinity bonus applied");
    db.close();
  });
});

describe("H3 — spouse behavior", () => {
  it("a wed NPC reads as a spouse → devoted phase + follows", () => {
    const db = freshDb();
    // climb to marriage threshold
    db.prepare(`INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u1','npc','npc_c',0.9,'courting')`).run();
    assert.ok(propose(db, "u1", "npc", "npc_c").ok);
    const w = wed(db, "u1", "npc", "npc_c");
    assert.ok(w.ok, `wed failed: ${JSON.stringify(w)}`);
    assert.equal(isSpouse(db, "u1", "npc_c"), true);
    assert.deepEqual(spousesFollowingPlayer(db, "u1"), ["npc_c"]);
    assert.equal(spouseDialoguePhase(db, "u1", "npc_c"), "devoted");
    // a non-spouse NPC uses affinity-based phase
    assert.equal(spouseDialoguePhase(db, "u1", "stranger", 0.7), "warm");
    assert.equal(spouseDialoguePhase(db, "u1", "stranger", -0.2), "cold");
    db.close();
  });
});
