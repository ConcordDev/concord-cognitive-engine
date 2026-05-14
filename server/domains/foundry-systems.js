// server/domains/foundry-systems.js
//
// Foundry Phase 7 — macro surface for the four net-new gameplay
// systems built this phase: Size Scaling, per-player Skill Affinity,
// Status Window, and Isekai Reincarnation.
//
// These are gameplay operations (not Foundry-builder operations, which
// live in domains/foundry.js). Each is world-scoped: the per-world
// config comes from the published world's rule_modulators, written by
// the Foundry compiler when the world's worldspec enables the system.

import {
  setPlayerScale, getPlayerScale, scaleEffects, scaledCombatProfile,
} from "../lib/foundry/size-scaling.js";
import {
  recordSkillUse, getPlayerAffinity, effectiveAffinity,
} from "../lib/foundry/skill-affinity.js";
import {
  awardTitle, listTitles, composeStatusWindow,
} from "../lib/foundry/status-window.js";
import { reincarnate, getLives } from "../lib/foundry/reincarnation.js";

/** Pull a world's per-system config out of its rule_modulators. */
function worldSystemConfig(db, worldId, key) {
  if (!db || !worldId) return {};
  const row = db.prepare(`SELECT rule_modulators FROM worlds WHERE id = ?`).get(worldId);
  if (!row) return {};
  try {
    const mods = JSON.parse(row.rule_modulators || "{}");
    return (mods && typeof mods[key] === "object" && mods[key]) || {};
  } catch {
    return {};
  }
}

export default function registerFoundrySystemsMacros(register) {
  // ===== Size Scaling ========================================================

  /** size.get — a player's current scale + its gameplay effects. */
  register("size", "get", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const config = worldSystemConfig(db, worldId, "size_scaling");
    const scale = getPlayerScale(db, userId, worldId);
    return { ok: true, scale, effects: scaleEffects(scale, config) };
  });

  /** size.set — set a player's scale; returns resolved scale + the
   *  change cost the caller debits (free/stamina/cooldown/item). */
  register("size", "set", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const config = worldSystemConfig(db, worldId, "size_scaling");
    return setPlayerScale(db, userId, worldId, input.scale, config);
  });

  /** size.combat_profile — the size-scaled-combat damage model for the
   *  player's current scale. */
  register("size", "combat_profile", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const config = worldSystemConfig(db, worldId, "size_scaling");
    const scale = getPlayerScale(db, userId, worldId);
    return { ok: true, profile: scaledCombatProfile(scale, config) };
  });

  // ===== Per-player Skill Affinity ===========================================

  /** skill_affinity.record — register a skill use; grows personal affinity. */
  register("skill_affinity", "record", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const skillId = String((input && input.skillId) || "");
    if (!skillId) return { ok: false, reason: "missing_skill_id" };
    const config = input.worldId
      ? worldSystemConfig(db, String(input.worldId), "skill-affinity-player")
      : {};
    return recordSkillUse(db, userId, skillId, config);
  });

  /** skill_affinity.get — a player's effective affinity for a skill,
   *  optionally combined with a world's per-domain modulator. */
  register("skill_affinity", "get", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    const skillId = String((input && input.skillId) || "");
    if (!skillId) return { ok: false, reason: "missing_skill_id" };
    const config = input.worldId
      ? worldSystemConfig(db, String(input.worldId), "skill-affinity-player")
      : {};
    const playerAffinity = getPlayerAffinity(db, userId, skillId, config);
    const worldAffinityPct = Number(input.worldAffinityPct);
    return {
      ok: true,
      skillId,
      playerAffinity,
      effective: effectiveAffinity(playerAffinity, Number.isFinite(worldAffinityPct) ? worldAffinityPct : 100),
    };
  });

  // ===== Status Window =======================================================

  /** status.window — compose a player's world-adaptive status panel. */
  register("status", "window", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const config = worldSystemConfig(db, worldId, "status_window");
    // `sources` (stats/skills/effects) is caller-supplied — the macro
    // composes titles + style; richer stat panels enrich it client-side.
    return composeStatusWindow(db, userId, worldId, config, input.sources || {});
  });

  /** status.award_title — grant a player a world-scoped title. */
  register("status", "award_title", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return awardTitle(db, userId, worldId, input.title);
  });

  /** status.titles — a player's earned titles in a world. */
  register("status", "titles", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return { ok: true, titles: listTitles(db, userId, worldId) };
  });

  // ===== Isekai Reincarnation ================================================

  /** reincarnation.reincarnate — start a new life, carrying an
   *  inherited boon from the prior one. The caller's death handler
   *  invokes this with the dying character's state. */
  register("reincarnation", "reincarnate", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const config = worldSystemConfig(db, worldId, "reincarnation");
    return reincarnate(db, userId, worldId, input.priorState || {}, config);
  });

  /** reincarnation.lives — a player's life ledger in a world. */
  register("reincarnation", "lives", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.actor?.id;
    const worldId = String((input && input.worldId) || "");
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_actor" };
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return { ok: true, lives: getLives(db, userId, worldId) };
  });
}
