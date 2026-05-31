// server/domains/skill-forge.js
//
// WAVE L1 — the Concord Link Forge macro surface. Exposes the dead-simple
// quickForge on-ramp (pick element + intent + name → a usable spell) so the
// ConcordLinkPanel Forge tab + onboarding can call it via POST /api/lens/run.
// Gated behind CONCORD_SKILL_FORGE (off → disabled).
//
//   skill_forge.quick  — forge a starter skill (element, intent, name)
//   skill_forge.menus  — the element + intent option lists (for the UI)

import { quickForge, ELEMENTS, INTENTS } from "../lib/skill-forge.js";

function enabled() { return process.env.CONCORD_SKILL_FORGE === "1"; }
function authed(ctx) { const u = ctx?.actor?.userId; return u ? String(u) : null; }

export default function registerSkillForgeMacros(register) {
  register("skill_forge", "quick", async (ctx, input = {}) => {
    if (!enabled()) return { ok: false, reason: "disabled" };
    if (!ctx?.db) return { ok: false, reason: "no_db" };
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return quickForge(ctx.db, {
      userId: uid,
      worldId: input.worldId || "concordia-hub",
      element: input.element,
      intent: input.intent,
      name: input.name,
    });
  }, { note: "skill-forge: forge a starter skill (element+intent+name)" });

  register("skill_forge", "menus", async () => {
    if (!enabled()) return { ok: false, reason: "disabled" };
    return { ok: true, elements: ELEMENTS, intents: INTENTS };
  }, { note: "skill-forge: element + intent option lists" });
}
