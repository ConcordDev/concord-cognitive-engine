// server/domains/bloodline.js
//
// Concordia Phase 2 — player-facing macro surface for bloodline
// ancestry. Lookups + the choose-bloodline flow (one-time
// character-creation pick by default, but unrestricted here so test
// fixtures and Phase 12 dynasty cascade can rewrite).
//
// Macros:
//   bloodline.list_known        — enumerate recognised bloodlines + elements
//   bloodline.get_ancestry      — caller's ancestry row (or null)
//   bloodline.choose            — set caller's ancestry (idempotent)
//   bloodline.preview_skill     — what would my multiplier be on this skill?

import {
  KNOWN_BLOODLINES,
  elementsForBloodline,
  describeBloodline,
  getUserAncestry,
  setUserAncestry,
  getBloodlineMultiplier,
} from "../lib/bloodline-powers.js";

export default function registerBloodlineMacros(register) {
  /**
   * bloodline.list_known — table of recognised bloodlines + their
   * preferred elements. Static, safe for public reads.
   */
  register("bloodline", "list_known", async () => {
    const bloodlines = KNOWN_BLOODLINES.map((id) => ({
      id,
      elements: elementsForBloodline(id),
      description: describeBloodline(id),
    }));
    return { ok: true, bloodlines };
  });

  /**
   * bloodline.get_ancestry — caller's current ancestry row, or null.
   */
  register("bloodline", "get_ancestry", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const ancestry = getUserAncestry(db, userId);
    return { ok: true, ancestry };
  });

  /**
   * bloodline.choose — set caller's ancestry. Idempotent on userId.
   * Phase 12 will tighten this to "only at character-creation OR heir
   * succession" — for Phase 2 we keep it unrestricted so the lens
   * test surface can drive it.
   * input: { bloodline, dilution? }
   */
  register("bloodline", "choose", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const bloodline = String(input?.bloodline || "").trim();
    const dilution = Number.isFinite(input?.dilution) ? Number(input.dilution) : 0.5;
    if (!bloodline) return { ok: false, reason: "missing_inputs" };
    return setUserAncestry(db, userId, bloodline, dilution);
  });

  /**
   * bloodline.preview_skill — preview the multiplier the caller's
   * ancestry would yield against a given skill element. Useful for
   * the BloodlineBadge HUD and for craft/cast UIs that want to warn
   * the player before spending resources.
   * input: { skillElement }
   */
  register("bloodline", "preview_skill", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const skillElement = String(input?.skillElement || "").trim();
    if (!skillElement) return { ok: false, reason: "missing_inputs" };
    const ancestry = getUserAncestry(db, userId);
    if (!ancestry) {
      return { ok: true, ancestry: null, multiplier: 1.0, kind: "no_ancestry", refused: false };
    }
    const m = getBloodlineMultiplier(ancestry.primary_bloodline, ancestry.dilution, skillElement);
    return { ok: true, ancestry, ...m };
  });
}
