// server/domains/beats.js
//
// Phase 3 — macro surface for the personal beat scheduler.
//
// Read-only list + realise macros so the goddess HUD widget on the
// frontend can pull pending beats, mark them completed, or reject them.

import {
  realiseBeat,
  findOpenBeatBySubject,
  listBeatsForUser,
} from "../emergent/personal-beat-scheduler.js";

export default function registerBeatsMacros(register) {
  /**
   * beats.list — list a user's beats. Defaults to ctx.actor.userId.
   * input: { userId?, limit? }
   */
  register("beats", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100);
    return { ok: true, beats: listBeatsForUser(db, userId, limit) };
  }, { note: "list player's beats (open + completed)" });

  /**
   * beats.realise — mark a beat realised / rejected / ignored.
   * input: { beatId, outcome? }
   */
  register("beats", "realise", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.beatId) return { ok: false, reason: "no_beat_id" };
    const outcome = ["realised", "rejected", "ignored"].includes(input.outcome)
      ? input.outcome : "realised";
    return await realiseBeat(db, input.beatId, outcome);
  }, { note: "realise a beat (caller-driven)" });

  /**
   * beats.find_open_for_subject — for caller-side realisation hooks. Used
   * by quest-engine / dialogue / faction reputation paths to check
   * whether the player has an active beat targeting this subject before
   * completing the in-world action that would realise it.
   * input: { userId?, subjectKind, subjectId }
   */
  register("beats", "find_open_for_subject", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId || !input.subjectKind || !input.subjectId) {
      return { ok: false, reason: "missing_inputs" };
    }
    const beat = findOpenBeatBySubject(db, userId, input.subjectKind, input.subjectId);
    return { ok: true, beat: beat || null };
  }, { note: "find open beat targeting a subject" });
}
