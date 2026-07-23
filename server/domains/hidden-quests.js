// server/domains/hidden-quests.js
//
// Theme deferred (game-feel pass): macros for the quest-triggers
// substrate. Authors call hiddenQuests.define to plant a trigger;
// runtime callers (combat / dialogue / movement code) call
// hiddenQuests.evaluate to surface ready triggers and hiddenQuests.fire
// to mark one consumed.

import {
  defineQuestTrigger,
  listTriggers,
  evaluateTriggersAtPosition,
  recordTriggerVisit,
  fireTrigger,
  TRIGGER_KINDS,
} from "../lib/quest-triggers.js";

export default function registerHiddenQuestsMacros(register) {
  register("hiddenQuests", "define", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return defineQuestTrigger(db, input);
  }, { note: "register a hidden quest trigger" });

  register("hiddenQuests", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, triggers: listTriggers(db, input) };
  }, { note: "list enabled triggers in a world", publicReadable: true });

  register("hiddenQuests", "evaluate", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return {
      ok: true,
      ready: evaluateTriggersAtPosition(db, {
        userId, worldId: input.worldId, position: input.position,
      }),
    };
  }, { note: "evaluate proximity/visits triggers at a position" });

  register("hiddenQuests", "visit", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const result = recordTriggerVisit(db, input.triggerId, userId);
    return result || { ok: false, reason: "trigger_not_found" };
  }, { note: "record a visit to a non-proximity trigger (dialogue / item)" });

  register("hiddenQuests", "fire", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    const result = fireTrigger(db, input.triggerId, userId);
    // DET-C dead-event fix — this module's own header comment ("Caller
    // decides what to do... emit a socket event, etc.") always intended
    // this, but no caller ever did: AdaptiveMusicBridge.tsx has subscribed
    // to 'quest:triggered' since it was written and it never fired (a
    // real dead subscriber, not a false positive — verified via the
    // runtime detector, not grep). Scoped to the firing user only (this
    // is a personal quest-progress beat, not a world broadcast).
    if (result?.ok) {
      try {
        const emit = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
        emit?.("quest:triggered", {
          triggerId: input.triggerId,
          targetQuestId: result.targetQuestId,
          firedCount: result.firedCount,
        }, { userId });
      } catch { /* realtime best-effort — never block the fire */ }
    }
    return result;
  }, { note: "consume a trigger and start its target quest" });

  register("hiddenQuests", "kinds", async () => {
    return { ok: true, kinds: Array.from(TRIGGER_KINDS) };
  }, { note: "list valid trigger kinds", publicReadable: true });
}
