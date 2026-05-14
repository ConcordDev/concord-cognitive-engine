// server/domains/stamina.js
//
// Concordia Phase 5 — player stamina macros.
//
// Macros:
//   stamina.get         — caller's current value + state (lazy projection)
//   stamina.start_climb — transition state → 'climbing'
//   stamina.release     — transition state → 'rest'
//   stamina.start_sprint — transition state → 'sprinting'
//   stamina.drain       — one-shot drain (jump, cast cost)
//   stamina.constants   — exposed thresholds for the HUD

import {
  getStamina,
  setState,
  drain,
  STAMINA_CONSTANTS,
} from "../lib/player-stamina.js";

const DEFAULT_WORLD = "concordia-hub";

export default function registerStaminaMacros(register) {
  register("stamina", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = String(input?.worldId || DEFAULT_WORLD);
    const s = getStamina(db, userId, worldId);
    return { ok: true, stamina: s };
  });

  register("stamina", "start_climb", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setState(db, userId, String(input?.worldId || DEFAULT_WORLD), "climbing");
  });

  register("stamina", "start_sprint", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setState(db, userId, String(input?.worldId || DEFAULT_WORLD), "sprinting");
  });

  register("stamina", "start_swim", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setState(db, userId, String(input?.worldId || DEFAULT_WORLD), "swimming");
  });

  register("stamina", "release", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setState(db, userId, String(input?.worldId || DEFAULT_WORLD), "rest");
  });

  register("stamina", "drain", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const amount = Number(input?.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "missing_inputs" };
    return drain(db, userId, String(input?.worldId || DEFAULT_WORLD), amount);
  });

  register("stamina", "constants", async () => {
    return { ok: true, constants: STAMINA_CONSTANTS };
  });
}
