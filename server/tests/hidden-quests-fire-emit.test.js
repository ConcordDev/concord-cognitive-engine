/**
 * DET-C dead-event fix — `hiddenQuests.fire` now emits 'quest:triggered'
 * on a successful fire.
 *
 * AdaptiveMusicBridge.tsx (concord-frontend/components/world/AdaptiveMusicBridge.tsx)
 * has subscribed to 'quest:triggered' since it was written, but nothing
 * server-side ever emitted it — quest-triggers.js#fireTrigger is a pure
 * DB-write function with no realtime access, and its own header comment
 * says the CALLER was always meant to emit ("Caller decides what to
 * do... emit a socket event, etc."). Verified via the runtime dead-event
 * detector (server/lib/detectors/dead-event-listener-detector.js), not
 * grep — this test pins the fix at the macro layer (domains/hidden-quests.js),
 * the one real caller of fireTrigger reachable from the frontend.
 *
 * Run: node --test server/tests/hidden-quests-fire-emit.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerHiddenQuestsMacros from "../domains/hidden-quests.js";
import { defineQuestTrigger, recordTriggerVisit } from "../lib/quest-triggers.js";
import { up as upQuestTriggers } from "../migrations/150_quest_triggers.js";

function setupDb() {
  const db = new Database(":memory:");
  upQuestTriggers(db);
  return db;
}

function collectMacros() {
  const macros = new Map(); // "domain.name" -> handler
  const register = (domain, name, handler) => {
    macros.set(`${domain}.${name}`, handler);
  };
  registerHiddenQuestsMacros(register);
  return macros;
}

describe("hiddenQuests.fire — realtime emit on success", () => {
  let db;
  let macros;
  let originalEmit;
  let emitted;

  beforeEach(() => {
    db = setupDb();
    macros = collectMacros();
    defineQuestTrigger(db, {
      id: "t_emit", worldId: "w1", triggerKind: "proximity",
      payload: { x: 0, z: 0, radiusM: 5 }, targetQuestId: "q_emit_target",
      requiresVisits: 1, maxFiresPerUser: 1,
    });
    originalEmit = globalThis._concordRealtimeEmit;
    emitted = [];
    globalThis._concordRealtimeEmit = (name, payload, opts) => emitted.push({ name, payload, opts });
  });

  afterEach(() => {
    globalThis._concordRealtimeEmit = originalEmit;
  });

  it("emits quest:triggered scoped to the firing user on a successful fire", async () => {
    recordTriggerVisit(db, "t_emit", "user_1");
    const fireHandler = macros.get("hiddenQuests.fire");
    assert.ok(fireHandler, "hiddenQuests.fire macro must be registered");

    const result = await fireHandler(
      { db, actor: { userId: "user_1" } },
      { triggerId: "t_emit" },
    );

    assert.equal(result.ok, true);
    assert.equal(result.targetQuestId, "q_emit_target");

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].name, "quest:triggered");
    assert.equal(emitted[0].payload.triggerId, "t_emit");
    assert.equal(emitted[0].payload.targetQuestId, "q_emit_target");
    assert.equal(emitted[0].payload.firedCount, 1);
    // Must be scoped to the firing user, never a global broadcast —
    // this is a personal quest-progress beat, not world-wide news.
    assert.deepEqual(emitted[0].opts, { userId: "user_1" });
  });

  it("does NOT emit when the fire is refused (not enough visits)", async () => {
    // No recordTriggerVisit call — requiresVisits: 1 is unmet.
    const fireHandler = macros.get("hiddenQuests.fire");
    const result = await fireHandler(
      { db, actor: { userId: "user_2" } },
      { triggerId: "t_emit" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "needs_visits");
    assert.equal(emitted.length, 0);
  });

  it("does NOT emit for an unknown trigger id", async () => {
    const fireHandler = macros.get("hiddenQuests.fire");
    const result = await fireHandler(
      { db, actor: { userId: "user_3" } },
      { triggerId: "trig_nonexistent" },
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_found");
    assert.equal(emitted.length, 0);
  });

  it("never throws when no realtime emitter is installed (best-effort)", async () => {
    globalThis._concordRealtimeEmit = undefined;
    globalThis.realtimeEmit = undefined;
    recordTriggerVisit(db, "t_emit", "user_4");
    const fireHandler = macros.get("hiddenQuests.fire");
    const result = await fireHandler(
      { db, actor: { userId: "user_4" } },
      { triggerId: "t_emit" },
    );
    assert.equal(result.ok, true);
  });
});
