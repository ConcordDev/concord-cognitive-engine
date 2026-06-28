// server/domains/training-room.js
//
// Phase AF — macro surface for the Training Room dojo.
//
// Read-only frame-data lookup + skill list. Every macro delegates to
// server/lib/combat-frame-data.js (the single source of truth — no frame
// math is duplicated here). The dojo surfaces "what does this skill
// actually do": startup / active / recovery / parry / dodge envelope.
//
// Resolution is honest by construction:
//   - a persisted skill DTU resolves to its derived frame data,
//   - a built-in weapon kind ("sword", "fist", …) resolves to its canonical
//     frame envelope (so default skills never 404 — PLAYTEST #21),
//   - anything else returns { ok:false, reason:'no_skill' } so the lens can
//     render an honest not-found state instead of fabricated numbers.

import {
  getFrameDataForSkillId,
  getFrameDataForKind,
  BUILTIN_SKILL_KINDS,
} from "../lib/combat-frame-data.js";

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before it can
// silently clamp through the Math.min/max bounds. An absent field is fine (the
// macro uses its default). Returns null when clean, or the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

export default function registerTrainingRoomMacros(register) {
  /**
   * training-room.frame_data — derive frame data for one skill.
   * input: { skillId }
   * Resolves a persisted skill DTU OR a built-in weapon kind id.
   */
  register("training-room", "frame_data", async (ctx, input = {}) => {
    const skillId = input.skillId;
    if (!skillId || typeof skillId !== "string") {
      return { ok: false, reason: "no_skill_id" };
    }
    const frameData = getFrameDataForSkillId(ctx?.db, skillId);
    if (!frameData) return { ok: false, reason: "no_skill" };
    return { ok: true, frameData };
  }, { note: "frame data (startup/active/recovery/parry/dodge) for one skill" });

  /**
   * training-room.kind_frame_data — canonical frame data for a built-in
   * weapon kind, with no DB required. input: { kind }
   */
  register("training-room", "kind_frame_data", async (_ctx, input = {}) => {
    const frameData = getFrameDataForKind(input.kind);
    if (!frameData) return { ok: false, reason: "unknown_kind" };
    return { ok: true, frameData };
  }, { note: "frame data for a built-in weapon kind (no DB)" });

  /**
   * training-room.list_kinds — the built-in weapon kinds the dojo can
   * always train against, regardless of acquired skills.
   */
  register("training-room", "list_kinds", async (_ctx, _input = {}) => {
    const kinds = BUILTIN_SKILL_KINDS.map((kind) => {
      const fd = getFrameDataForKind(kind);
      return {
        kind,
        name: fd?.name || kind,
        startup_ms: fd?.startup_ms ?? null,
        active_ms: fd?.active_ms ?? null,
        recovery_ms: fd?.recovery_ms ?? null,
        parry_window_ms: fd?.parry_window_ms ?? null,
        dodge_window_ms: fd?.dodge_window_ms ?? null,
      };
    });
    return { ok: true, kinds };
  }, { note: "list built-in weapon kinds with their frame envelopes" });

  /**
   * training-room.list_skills — a user's persisted skill DTUs (for the
   * dojo skill picker). Defaults to ctx.actor.userId.
   * input: { userId?, limit? }
   */
  register("training-room", "list_skills", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    try {
      const rows = db.prepare(`
        SELECT id, title
        FROM dtus
        WHERE type = 'skill' AND (creator_id = ? OR owner_user_id = ?)
        ORDER BY COALESCE(last_used_at, 0) DESC, created_at DESC
        LIMIT ?
      `).all(userId, userId, limit);
      return { ok: true, skills: rows };
    } catch {
      return { ok: true, skills: [] };
    }
  }, { note: "list a user's persisted skill DTUs for the dojo picker" });
}
