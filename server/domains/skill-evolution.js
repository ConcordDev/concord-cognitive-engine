// server/domains/skill-evolution.js
//
// Phase 1 — macro surface for the skill evolution engine.
//
// Read-only / commit-only — no destructive macros. Player-facing flows:
//   skill_evolution.list_unlocks(userId)        → pending unlock rows
//   skill_evolution.preview(userId, recipeId, description?) → deterministic envelope
//   skill_evolution.commit(userId, recipeId, description, unlockId)
//   skill_evolution.history(recipeId)           → applied lineage rows

import {
  composeDeterministicEvolution,
  composeLLMEvolution,
  validateRevisionCoherence,
  applyEvolution,
  listPendingUnlocks,
  getEvolutionHistory,
  getRevisionCount,
} from "../lib/skill-evolution.js";

function getRecipe(db, recipeId) {
  return db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(recipeId);
}

export default function registerSkillEvolutionMacros(register) {
  /**
   * skill_evolution.list_unlocks
   * input: { entityKind?: 'player'|'npc', entityId? }
   *   defaults to ('player', ctx.actor.userId)
   */
  register("skill_evolution", "list_unlocks", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const entityKind = input.entityKind || "player";
    const entityId = input.entityId || ctx?.actor?.userId;
    if (!entityId) return { ok: false, reason: "no_entity_id" };
    const rows = listPendingUnlocks(db, entityKind, entityId);
    return { ok: true, unlocks: rows };
  }, { note: "list pending evolution unlocks" });

  /**
   * skill_evolution.preview
   * input: { recipeId, description?, entityKind?, entityId? }
   * Returns the deterministic envelope without persisting.
   */
  register("skill_evolution", "preview", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.recipeId) return { ok: false, reason: "no_recipe_id" };
    const recipe = getRecipe(db, input.recipeId);
    if (!recipe) return { ok: false, reason: "recipe_not_found" };

    const entityKind = input.entityKind || "player";
    const level = Number(input.levelAtRevision || recipe.skill_level || 1);
    const history = getEvolutionHistory(db, recipe.id, 50);
    const evolution = composeDeterministicEvolution(
      recipe, level, input.description || "", history, entityKind,
    );
    const coherence = validateRevisionCoherence(recipe, evolution, history);
    return { ok: true, evolution, coherence };
  }, { note: "preview deterministic envelope without commit" });

  /**
   * skill_evolution.commit
   * input: { recipeId, description, unlockId?, entityKind?, entityId?, useLLM? }
   *
   * Executes coherence validation → composes evolution (deterministic
   * or LLM-opt-in) → applies. Returns the revisionId on success.
   */
  register("skill_evolution", "commit", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.recipeId) return { ok: false, reason: "no_recipe_id" };
    if (!input.description || typeof input.description !== "string" || input.description.trim().length < 4) {
      return { ok: false, reason: "description_required" };
    }
    const recipe = getRecipe(db, input.recipeId);
    if (!recipe) return { ok: false, reason: "recipe_not_found" };

    const entityKind = input.entityKind || "player";
    const entityId = input.entityId || ctx?.actor?.userId;
    if (!entityId) return { ok: false, reason: "no_entity_id" };

    const level = Number(input.levelAtRevision || recipe.skill_level || 1);
    const history = getEvolutionHistory(db, recipe.id, 50);

    const useLLM = !!input.useLLM && process.env.CONCORD_SKILL_EVOLUTION_LLM === "1";
    const evolution = useLLM
      ? await composeLLMEvolution(recipe, level, input.description, history, entityKind, ctx)
      : composeDeterministicEvolution(recipe, level, input.description, history, entityKind);

    const coh = validateRevisionCoherence(recipe, evolution, history);
    if (!coh.ok) return { ok: false, reason: `coherence_${coh.reason}`, evidence: coh };

    const result = applyEvolution(db, entityKind, entityId, evolution, { unlockId: input.unlockId });
    if (!result?.ok) return { ok: false, reason: result?.reason || "apply_failed" };
    return { ok: true, revisionId: result.revisionId, recipeId: result.recipeId, evolution };
  }, { note: "commit a skill revision" });

  /**
   * skill_evolution.history
   * input: { recipeId, limit? }
   */
  register("skill_evolution", "history", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.recipeId) return { ok: false, reason: "no_recipe_id" };
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
    const rows = getEvolutionHistory(db, input.recipeId, limit);
    return { ok: true, rows, total: getRevisionCount(db, input.recipeId) };
  }, { note: "lineage history for a recipe" });
}
