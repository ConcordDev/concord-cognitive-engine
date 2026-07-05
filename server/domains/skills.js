// server/domains/skills.js
//
// Dead-macro-call fix (verification-audit campaign): the world HUD's
// AtrophyWarningPanel called domain:'skills', name:'atrophy_risk' — never
// registered anywhere, guaranteed unknown_macro. lib/skill-atrophy.js
// already has the real decay math (getAtrophyRisk); this wires the
// current user's most-at-risk skill DTU through it.

import { getAtrophyRisk } from "../lib/skill-atrophy.js";

export default function registerSkillsActions(registerLensAction) {
  registerLensAction("skills", "atrophy_risk", (ctx, _artifact, _params = {}) => {
    const userId = (ctx && (ctx.userId || (ctx.actor && ctx.actor.userId))) || null;
    if (!userId) return { ok: false, error: "authentication required" };
    if (!ctx?.db) return { ok: true, result: { daysUnused: null, projectedLoss: 0, immune: false } };

    const rows = ctx.db.prepare(`
      SELECT skill_level, last_used_at FROM dtus
      WHERE type = 'skill' AND owner_user_id = ? AND last_used_at IS NOT NULL
    `).all(userId);

    if (!rows.length) return { ok: true, result: { daysUnused: null, projectedLoss: 0, immune: false } };

    // Surface the single most-at-risk skill (highest projected loss).
    let worst = null;
    for (const row of rows) {
      const risk = getAtrophyRisk(row);
      if (!worst || risk.projectedLoss > worst.projectedLoss) worst = risk;
    }
    return { ok: true, result: worst };
  });
}
