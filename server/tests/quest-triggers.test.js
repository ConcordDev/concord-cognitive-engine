/**
 * Tier-2 contract tests for the hidden quest triggers substrate
 * (Theme deferred, game-feel pass).
 *
 * Pins:
 *   - defineQuestTrigger upserts (idempotent on id)
 *   - bad kind rejected
 *   - evaluateTriggersAtPosition returns triggers in radius and ready
 *     (visits ≥ requiresVisits AND fires < cap)
 *   - re-entering same trigger within debounce doesn't re-bank visits
 *   - fireTrigger respects max_fires_per_user
 *   - fireTrigger refuses without enough visits
 *   - listTriggers respects enabled flag
 *
 * Run: node --test tests/quest-triggers.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  defineQuestTrigger,
  listTriggers,
  evaluateTriggersAtPosition,
  recordTriggerVisit,
  fireTrigger,
  TRIGGER_KINDS,
} from "../lib/quest-triggers.js";
import { up as up147 } from "../migrations/147_quest_triggers.js";

function setupDb() {
  const db = new Database(":memory:");
  up147(db);
  return db;
}

describe("defineQuestTrigger", () => {
  it("rejects unknown kinds", () => {
    const db = setupDb();
    const r = defineQuestTrigger(db, {
      worldId: "w1", triggerKind: "smoke_signal",
      payload: {}, targetQuestId: "q1",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_kind");
  });

  it("rejects missing fields", () => {
    const db = setupDb();
    assert.equal(defineQuestTrigger(db, { triggerKind: "proximity" }).ok, false);
  });

  it("registers proximity trigger and is upsert-idempotent", () => {
    const db = setupDb();
    const r1 = defineQuestTrigger(db, {
      id: "trig_a", worldId: "w1", triggerKind: "proximity",
      payload: { x: 10, z: 10, radiusM: 5 }, targetQuestId: "q_haunting",
      requiresVisits: 3, maxFiresPerUser: 1,
    });
    assert.equal(r1.ok, true);
    const r2 = defineQuestTrigger(db, {
      id: "trig_a", worldId: "w1", triggerKind: "proximity",
      payload: { x: 10, z: 10, radiusM: 8 }, targetQuestId: "q_haunting",
      requiresVisits: 5, maxFiresPerUser: 2,
    });
    assert.equal(r2.ok, true);
    const list = listTriggers(db, { worldId: "w1" });
    assert.equal(list.length, 1);
    assert.equal(list[0].requiresVisits, 5);
    assert.equal(list[0].payload.radiusM, 8);
  });

  it("listTriggers respects enabled flag", () => {
    const db = setupDb();
    defineQuestTrigger(db, {
      id: "t_on", worldId: "w1", triggerKind: "proximity",
      payload: { x: 0, z: 0 }, targetQuestId: "q1", enabled: true,
    });
    defineQuestTrigger(db, {
      id: "t_off", worldId: "w1", triggerKind: "proximity",
      payload: { x: 1, z: 1 }, targetQuestId: "q2", enabled: false,
    });
    const list = listTriggers(db, { worldId: "w1" });
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "t_on");
  });
});

describe("evaluateTriggersAtPosition", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    defineQuestTrigger(db, {
      id: "t_close", worldId: "w1", triggerKind: "proximity",
      payload: { x: 10, z: 10, radiusM: 5 }, targetQuestId: "q1",
      requiresVisits: 1,
    });
    defineQuestTrigger(db, {
      id: "t_far", worldId: "w1", triggerKind: "proximity",
      payload: { x: 200, z: 200, radiusM: 5 }, targetQuestId: "q2",
      requiresVisits: 1,
    });
    defineQuestTrigger(db, {
      id: "t_visits3", worldId: "w1", triggerKind: "visits",
      payload: { x: 12, z: 12, radiusM: 6 }, targetQuestId: "q3",
      requiresVisits: 3,
    });
  });

  it("returns triggers within radius and ready", () => {
    const r = evaluateTriggersAtPosition(db, {
      userId: "u1", worldId: "w1", position: { x: 11, z: 11 },
    });
    // First visit banks for both nearby triggers; t_close requires 1 (ready), t_visits3 requires 3 (not yet)
    const ids = r.map((x) => x.trigger.id);
    assert.ok(ids.includes("t_close"));
    assert.ok(!ids.includes("t_far"));
  });

  it("re-entering within debounce doesn't bank a second visit", () => {
    evaluateTriggersAtPosition(db, {
      userId: "u1", worldId: "w1", position: { x: 11, z: 11 },
    });
    const before = db.prepare(`
      SELECT visits FROM quest_trigger_visits WHERE trigger_id = ? AND user_id = ?
    `).get("t_visits3", "u1").visits;
    // Immediate re-eval; debounce TIME_PROXIMITY_S=30 → no new visit
    evaluateTriggersAtPosition(db, {
      userId: "u1", worldId: "w1", position: { x: 11, z: 11 },
    });
    const after = db.prepare(`
      SELECT visits FROM quest_trigger_visits WHERE trigger_id = ? AND user_id = ?
    `).get("t_visits3", "u1").visits;
    assert.equal(after, before);
  });

  it("non-proximity trigger kinds excluded from position eval", () => {
    defineQuestTrigger(db, {
      id: "t_dialogue", worldId: "w1", triggerKind: "dialogue",
      payload: { npcId: "npc_alric", optionId: "secret" }, targetQuestId: "q4",
    });
    const r = evaluateTriggersAtPosition(db, {
      userId: "u1", worldId: "w1", position: { x: 0, z: 0 },
    });
    assert.ok(r.every((x) => x.trigger.id !== "t_dialogue"));
  });
});

describe("fireTrigger", () => {
  let db;
  beforeEach(() => {
    db = setupDb();
    defineQuestTrigger(db, {
      id: "t1", worldId: "w1", triggerKind: "proximity",
      payload: { x: 0, z: 0, radiusM: 5 }, targetQuestId: "q_visited",
      requiresVisits: 2, maxFiresPerUser: 1,
    });
  });

  it("refuses without enough visits", () => {
    recordTriggerVisit(db, "t1", "u1");
    const r = fireTrigger(db, "t1", "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "needs_visits");
    assert.equal(r.have, 1);
    assert.equal(r.needs, 2);
  });

  it("fires when visits met; subsequent fire hits the cap", () => {
    recordTriggerVisit(db, "t1", "u1");
    recordTriggerVisit(db, "t1", "u1");
    const r1 = fireTrigger(db, "t1", "u1");
    assert.equal(r1.ok, true);
    assert.equal(r1.firedCount, 1);
    assert.equal(r1.targetQuestId, "q_visited");

    const r2 = fireTrigger(db, "t1", "u1");
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "fire_cap");
  });

  it("refuses on disabled triggers", () => {
    defineQuestTrigger(db, {
      id: "t1", worldId: "w1", triggerKind: "proximity",
      payload: { x: 0, z: 0, radiusM: 5 }, targetQuestId: "q_visited",
      requiresVisits: 1, maxFiresPerUser: 1, enabled: false,
    });
    recordTriggerVisit(db, "t1", "u1");
    const r = fireTrigger(db, "t1", "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  it("returns not_found for unknown ids", () => {
    const r = fireTrigger(db, "trig_nonexistent", "u1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
});

describe("TRIGGER_KINDS sanity", () => {
  it("contains the documented six kinds", () => {
    assert.deepEqual(
      Array.from(TRIGGER_KINDS).sort(),
      ["dialogue", "item_handover", "proximity", "time_window", "visits", "world_state"],
    );
  });
});
