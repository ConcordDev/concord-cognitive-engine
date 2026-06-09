// server/lib/skill-evolution.js
//
// Phase 1 — the universal content engine for skill progression.
//
// Every 10 levels of skill XP, an entity (player OR NPC) gets to commit a
// REVISION to the recipe DTU. The revision is a narrative the entity
// supplies (or the deterministic composer fabricates for NPCs) that mutates
// the recipe's max_damage / range_m / costs / current_name on top of a
// coherence-bounded envelope.
//
// The Sovereign at level 20,000 has 2,000 such revisions chained through
// `skill_revisions.recipe_dtu_id`. A water gun at lvl 10 grows into a
// pressure jet at lvl 50 grows into a hydro pump at lvl 100, etc.
//
// Pattern follows server/lib/embodied/forward-sim.js — deterministic by
// default, LLM-opt-in via CONCORD_SKILL_EVOLUTION_LLM=1, coherence
// validator gates the player description so no type-jumps slip through.
//
// Invariants (CLAUDE.md additions):
//   1. max_damage may only grow via committed revisions.
//   2. LLM-proposed max_damage is capped at 1.5× the deterministic envelope.
//   3. Name progression must show lineage (no rebrands without history).
//   4. Element type cannot jump (water → fire = REJECT; water → ice = OK if
//      the lineage already has cold-adjacent terms).

import crypto from "node:crypto";
import logger from "../logger.js";
import { TASK_PROMPTS } from "./prompt-registry.js";
import { resolveCraft } from "./craft-resolve.js";
import { stampMoveMeta } from "./move-descriptor.js";

// Living Society P0 — optional resource fuel for a skill evolution. Same
// potency-proportional model as glyph-spell fuel: consuming high-potency mats
// (soul gems / aether / dragonbone) amplifies the evolution's damage/range
// growth. Player-only (NPC auto-evolution carries no fuel); no fuel =
// byte-identical to the pre-P0 growth. Floored at 1.0× so fuel only ever helps.
const EVOLUTION_FUEL_BOOST = Number(process.env.CONCORD_EVOLUTION_FUEL_BOOST) || 0.5;

// ── Tunables ────────────────────────────────────────────────────────────────

const REVISION_GROWTH_BASE = 1.15;     // per-tier max_damage multiplier
const REVISION_LLM_CEILING = 1.5;      // hard cap LLM can grow vs envelope
const NAME_LINEAGE_MIN_OVERLAP = 0.25; // 25% of tokens must overlap
const COSTS_GROWTH_RATE = 0.08;        // costs creep per revision
const RANGE_GROWTH_RATE = 0.05;
const COOLDOWN_DECAY_RATE = 0.04;      // cooldowns shrink slightly per tier

// Biomechanics integration. The frontend's combat-biomechanics.ts uses a
// 1..5 tier scale for animation amplitude / anticipation / follow-through.
// We map revision_num onto that scale (clamped at 5 since tier-5 is the
// visual ceiling — additional revisions still grow damage but not the
// visual hyperreality). Lineage continues to 2,000+ revisions for
// godlike-tier characters; their visual tier just stays at 5.
const ANIMATION_TIER_MAX = 5;

// Limb requirement derives from the recipe's skill_kind + element. Used by
// the combat path to short-circuit a cast when the casting limb is staggered
// (e.g. a hydro-pump from a broken arm only does 30% damage and triggers
// stagger feedback instead of the full effect).
const SKILL_KIND_LIMB_REQ = {
  fighting_style: ["right_arm", "left_arm"],
  spell:          ["right_arm", "left_arm"], // gestural casting
  biopower:       ["torso"],                  // body-source channelling
  cyber_ability:  ["right_arm"],              // implant-tap
  psionic:        ["head"],                   // mental focus
  tech_gadget:    ["right_arm"],
  mundane:        ["right_arm"],
};

// How much the cast suffers when the required limb is debuffed. Multiplier
// applied to final damage. The stagger duration extension (in ms) is added
// to the recipe's normal cooldown.
const LIMB_DEBUFF_TABLE = {
  arm_weakened:        { dmgMul: 0.85, staggerMs: 120 },
  arm_damaged:         { dmgMul: 0.55, staggerMs: 280 },
  arm_broken:          { dmgMul: 0.30, staggerMs: 500 },
  perception_impaired: { dmgMul: 0.85, staggerMs: 80 },
  vision_blurred:      { dmgMul: 0.65, staggerMs: 200 },
  concussed:           { dmgMul: 0.40, staggerMs: 400 },
  ribs_cracked:        { dmgMul: 0.75, staggerMs: 220 },
  chest_exposed:       { dmgMul: 0.50, staggerMs: 350 },
  leg_slowed:          { dmgMul: 0.90, staggerMs: 60 },
  leg_damaged:         { dmgMul: 0.70, staggerMs: 180 },
  leg_broken:          { dmgMul: 0.50, staggerMs: 320 },
};

// Element family graph — controls which type-jumps are coherent.
// (water → ice OK; water → fire NOT OK; physical → energy NOT OK.)
const ELEMENT_FAMILIES = {
  physical:    new Set(["physical", "kinetic", "force"]),
  water:       new Set(["water", "ice", "frost", "cold", "tide", "current"]),
  fire:        new Set(["fire", "flame", "heat", "ember", "molten"]),
  lightning:   new Set(["lightning", "electric", "shock", "thunder", "voltaic"]),
  bio:         new Set(["bio", "poison", "venom", "toxin", "biological"]),
  energy:      new Set(["energy", "psionic", "soul", "void", "arcane", "cosmic"]),
};

function elementFamily(element) {
  if (!element) return null;
  const e = String(element).toLowerCase();
  for (const [fam, set] of Object.entries(ELEMENT_FAMILIES)) {
    if (set.has(e)) return fam;
  }
  return null;
}

// ── Unlock gating ───────────────────────────────────────────────────────────

/**
 * Called from awardExperience after a level update. If the new integer level
 * crosses a multiple of 10 since the previous level, insert a row into
 * skill_evolution_unlocks (idempotent via UNIQUE constraint).
 *
 * Returns { unlocked: bool, level: int|null, unlockId: string|null }.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {'player'|'npc'} entityKind
 * @param {string} entityId
 * @param {string} recipeId  — the skill DTU id
 * @param {number} previousLevel  — float level before this XP grant
 * @param {number} newLevel       — float level after
 */
export function tryUnlockEvolution(db, entityKind, entityId, recipeId, previousLevel, newLevel) {
  if (!db || !recipeId || !entityId) return { unlocked: false, level: null, unlockId: null };

  const prevTier = Math.floor((previousLevel || 0) / 10);
  const newTier = Math.floor((newLevel || 0) / 10);
  if (newTier <= prevTier) return { unlocked: false, level: null, unlockId: null };

  // Insert a row at the most recent crossed boundary.
  const levelBoundary = newTier * 10;
  const unlockId = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO skill_evolution_unlocks (
        id, entity_kind, entity_id, recipe_dtu_id, level_at_unlock, unlocked_at
      ) VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(unlockId, entityKind, entityId, recipeId, levelBoundary);
  } catch (err) {
    try { logger.warn?.("skill-evolution", "unlock_insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { unlocked: false, level: null, unlockId: null };
  }

  // Check whether THIS call inserted (vs hit the UNIQUE conflict).
  const row = db.prepare(`
    SELECT id FROM skill_evolution_unlocks
    WHERE entity_kind = ? AND entity_id = ? AND recipe_dtu_id = ? AND level_at_unlock = ?
  `).get(entityKind, entityId, recipeId, levelBoundary);
  return {
    unlocked: row?.id === unlockId,
    level: levelBoundary,
    unlockId: row?.id || null,
  };
}

// E3 — the dramatic named beat for an evolution unlock. Solo-Leveling "Arise"
// register: a deterministic title keyed by (skill, milestone level) so the same
// skill crossing the same boundary always reads the same. No RNG.
const EVOLUTION_VERBS = ["Awakened", "Ascended", "Transcended", "Unbound", "Reforged", "Crowned", "Apotheosised"];
const EVOLUTION_EPITHETS = [
  "the technique remembers every hand that shaped it",
  "muscle and intent fuse into something new",
  "the form sheds its old limits",
  "a decade of practice crystallises in an instant",
  "the move answers to no master but its wielder now",
];
export function composeEvolutionBeat(skillName, levelBoundary) {
  const name = String(skillName || "Your skill").trim() || "Your skill";
  const tier = Math.max(1, Math.floor((Number(levelBoundary) || 10) / 10));
  // Deterministic index from the (name, tier) pair.
  let h = 0;
  const key = `${name}::${tier}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const verb = EVOLUTION_VERBS[Math.min(EVOLUTION_VERBS.length - 1, tier - 1)] || EVOLUTION_VERBS[h % EVOLUTION_VERBS.length];
  const epithet = EVOLUTION_EPITHETS[h % EVOLUTION_EPITHETS.length];
  return {
    title: `${verb}: ${name}`,
    subtitle: `Mastery ${levelBoundary} — ${epithet}.`,
    tier,
  };
}

/** List pending (uncompleted) unlocks for an entity. */
export function listPendingUnlocks(db, entityKind, entityId) {
  return db.prepare(`
    SELECT * FROM skill_evolution_unlocks
    WHERE entity_kind = ? AND entity_id = ? AND completed_at IS NULL
    ORDER BY unlocked_at ASC
  `).all(entityKind, entityId);
}

// ── Recipe meta helpers ─────────────────────────────────────────────────────

function parseRecipeMeta(recipeRow) {
  let meta = {};
  try { meta = recipeRow?.meta_json ? JSON.parse(recipeRow.meta_json) : {}; }
  catch { meta = {}; }
  return meta;
}

function getRecipe(db, recipeId) {
  // dtus table column shape varies across migrations; try meta_json then fall
  // back to a separate 'meta' or scan everything.
  const row = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(recipeId);
  if (!row) return null;
  return row;
}

function recipeShape(row) {
  const meta = parseRecipeMeta(row);
  return {
    id: row.id,
    name: meta.current_name || meta.name || row.title || "untitled-skill",
    skillKind: meta.skill_kind || "fighting_style",
    element: meta.element || "physical",
    maxDamage: Number(meta.max_damage ?? 10),
    rangeM: Number(meta.range_m ?? 5),
    costs: meta.costs || {},
    revisionNum: Number(meta.revision_num ?? 0),
    revisionHistory: Array.isArray(meta.revision_history) ? meta.revision_history : [],
    formula: meta.formula || "",
    // Biomechanics integration — tier scales animation amplitude / anticipation
    // / follow-through. Capped at ANIMATION_TIER_MAX (5) since that's the
    // visual ceiling; revisions beyond keep growing damage but visual tier holds.
    animationTier: Number(meta.animation_tier ?? 1),
    // Target hit zones — which limb the procedural-combat hit-zone roll favors.
    // null = uniform (default biomech roll); array of zone names = weighted picks.
    targetZones: Array.isArray(meta.target_zones) ? meta.target_zones : null,
    // Required casting limbs — from SKILL_KIND_LIMB_REQ unless overridden.
    requiredLimbs: Array.isArray(meta.required_limbs) ? meta.required_limbs
                 : (SKILL_KIND_LIMB_REQ[meta.skill_kind || "fighting_style"] || ["right_arm"]),
  };
}

/**
 * Maps a revision_num onto the 1..ANIMATION_TIER_MAX scale used by
 * concord-frontend/lib/concordia/combat-biomechanics.ts.
 *
 *   revision 0   → tier 1 (no anticipation, minimal follow-through)
 *   revision 5   → tier 2
 *   revision 15  → tier 3
 *   revision 50  → tier 4
 *   revision 150+ → tier 5 (slightly hyperreal, full hip drive + recoil tail)
 *
 * Picks the curve that gives early-game players visible payoff for the first
 * few revisions while still leaving room for godlike (revision 2,000+)
 * characters to read as tier-5 specialists.
 */
export function computeAnimationTier(revisionNum) {
  const n = Math.max(0, Math.floor(Number(revisionNum) || 0));
  if (n >= 150) return 5;
  if (n >= 50) return 4;
  if (n >= 15) return 3;
  if (n >= 5) return 2;
  return 1;
}

/**
 * Evaluate whether a caster's required limbs are ready. Returns a multiplier
 * + extra cooldown to apply to the cast.
 *
 *   { ok: true, dmgMul: 1.0, staggerMs: 0 }                  — fully ready
 *   { ok: true, dmgMul: 0.55, staggerMs: 280, cause: "..." } — partial cast
 *   { ok: false, reason: "limb_unusable" }                   — block entirely
 *
 * `casterState` shape (matching city-presence.js): {
 *   limbHealth: { head, torso, left_arm, right_arm, left_leg, right_leg },
 *   limbArmor: same shape,
 *   activeDebuffs: Set<debuff_name>
 * }
 */
export function evaluateLimbReadiness(recipeShapeOrMeta, casterState) {
  if (!casterState || !casterState.activeDebuffs) {
    return { ok: true, dmgMul: 1.0, staggerMs: 0 };
  }
  const required = Array.isArray(recipeShapeOrMeta?.requiredLimbs)
    ? recipeShapeOrMeta.requiredLimbs
    : (SKILL_KIND_LIMB_REQ[recipeShapeOrMeta?.skill_kind || "fighting_style"] || ["right_arm"]);

  const debuffs = casterState.activeDebuffs instanceof Set
    ? casterState.activeDebuffs
    : new Set(Array.isArray(casterState.activeDebuffs) ? casterState.activeDebuffs : []);

  // Worst limb dictates the multiplier. Block entirely if a required limb is
  // at 0% health (broken AND severed).
  let worstMul = 1.0;
  let worstStagger = 0;
  let worstCause = null;
  let blocked = false;

  for (const limb of required) {
    const limbHealth = casterState.limbHealth?.[limb];
    if (limbHealth != null && limbHealth <= 0) { blocked = true; worstCause = `${limb}_severed`; break; }
    // Walk the debuff table for any debuff that names this limb or its zone.
    for (const debuff of debuffs) {
      // arm_broken applies whether it's left or right; so does leg_*. The
      // table below uses the zone-agnostic key.
      const entry = LIMB_DEBUFF_TABLE[debuff];
      if (!entry) continue;
      const matchesLimb = (limb.includes("arm") && debuff.startsWith("arm_"))
                       || (limb.includes("leg") && debuff.startsWith("leg_"))
                       || (limb === "head" && (debuff === "concussed" || debuff === "vision_blurred" || debuff === "perception_impaired"))
                       || (limb === "torso" && (debuff === "ribs_cracked" || debuff === "chest_exposed" || debuff === "armor_damaged"));
      if (!matchesLimb) continue;
      if (entry.dmgMul < worstMul) { worstMul = entry.dmgMul; worstCause = debuff; }
      if (entry.staggerMs > worstStagger) worstStagger = entry.staggerMs;
    }
  }

  if (blocked) return { ok: false, reason: "limb_unusable", cause: worstCause };
  return { ok: true, dmgMul: worstMul, staggerMs: worstStagger, cause: worstCause };
}

// ── Deterministic envelope ──────────────────────────────────────────────────

/**
 * Deterministic upgrade — runs without LLM. Bumps max_damage on a per-tier
 * curve, scales range/costs, generates a name continuation seeded by
 * sha1(recipe.id + revision_num). Player or NPC, same shape.
 *
 * For NPC-deterministic compositions, `description` is constructed from
 * archetype + faction tradition tokens; see npc-skill-author.js.
 */
export function composeDeterministicEvolution(recipe, levelAtRevision, description, history, authorKind = "player") {
  const shape = recipeShape(recipe);
  const nextRevision = shape.revisionNum + 1;
  const growthExponent = nextRevision; // revision 1 = 1.15× over base, etc.

  const seedBase = `${recipe.id}|${nextRevision}|${authorKind}`;
  const seed = crypto.createHash("sha1").update(seedBase).digest();
  const variance = 0.9 + (seed[0] / 255) * 0.2;       // 0.9–1.1× variance per revision
  const newMaxDamage = Math.round(
    shape.maxDamage * Math.pow(REVISION_GROWTH_BASE, 1) * variance,
  );
  const newRangeM = Math.round(
    (shape.rangeM * (1 + RANGE_GROWTH_RATE) + Number.EPSILON) * 100,
  ) / 100;

  // Costs creep up slightly per revision. Cooldown shrinks.
  const newCosts = {};
  for (const [k, v] of Object.entries(shape.costs)) {
    if (k === "cooldown_s" || k === "cooldown") {
      newCosts[k] = Math.round((Number(v) || 0) * (1 - COOLDOWN_DECAY_RATE) * 100) / 100;
    } else {
      newCosts[k] = Math.round((Number(v) || 0) * (1 + COSTS_GROWTH_RATE) * 100) / 100;
    }
  }

  // Name continuation — pick a familial token from the recipe's element family
  // that hasn't appeared in the lineage yet. If exhausted, append a tier suffix.
  const newName = composeNameContinuation(shape, nextRevision, seed);

  // Biomechanics tier — scales animation amplitude in
  // concord-frontend/lib/concordia/combat-biomechanics.ts.
  const newAnimationTier = computeAnimationTier(nextRevision);

  // Required limbs default from the skill kind, but each revision can refine
  // the target zone (e.g. "now my hydro pump targets the head"). For
  // deterministic composition we keep target zones stable across revisions —
  // the player's text description is the only thing that can move them, via
  // the LLM path. Deterministic composer respects the prior revision's
  // target_zones if any.
  const targetZones = shape.targetZones; // pass-through

  return {
    recipeId: recipe.id,
    revisionNum: nextRevision,
    levelAtRevision,
    description: description || `Tier-${nextRevision} refinement of ${shape.name}`,
    composer: authorKind === "npc" ? "npc_deterministic" : "deterministic",
    maxDamageBefore: shape.maxDamage,
    maxDamageAfter: newMaxDamage,
    rangeMBefore: shape.rangeM,
    rangeMAfter: newRangeM,
    costsBefore: { ...shape.costs },
    costsAfter: newCosts,
    nameBefore: shape.name,
    nameAfter: newName,
    effectDelta: { growthExponent, variance },
    // Biomechanics fields — carried into the recipe meta on apply.
    animationTierBefore: shape.animationTier,
    animationTierAfter: newAnimationTier,
    targetZones,
    requiredLimbs: shape.requiredLimbs,
    envelope: {
      base: REVISION_GROWTH_BASE,
      ceiling: REVISION_GROWTH_BASE * REVISION_LLM_CEILING,
      tier: nextRevision,
      animationTier: newAnimationTier,
    },
  };
}

function composeNameContinuation(shape, revisionNum, seedBuf) {
  const fam = elementFamily(shape.element);
  const family = fam ? ELEMENT_FAMILIES[fam] : new Set();
  const usedTokens = new Set();
  for (const r of shape.revisionHistory) {
    for (const tok of String(r?.name_after || "").toLowerCase().split(/[\s_-]+/)) {
      usedTokens.add(tok);
    }
  }
  for (const tok of shape.name.toLowerCase().split(/[\s_-]+/)) usedTokens.add(tok);

  const candidates = Array.from(family).filter(t => !usedTokens.has(t));
  if (candidates.length > 0) {
    const pick = candidates[seedBuf[1] % candidates.length];
    return `${shape.name}_${pick}`.replace(/[\s]+/g, "_");
  }
  return `${shape.name}_mk${revisionNum}`;
}

// ── LLM-opt-in composer ─────────────────────────────────────────────────────

/**
 * Optional LLM-enhanced upgrade. Only enabled with CONCORD_SKILL_EVOLUTION_LLM=1.
 * Bounded by the deterministic envelope so the LLM can't 10× the cap.
 *
 * Falls back to deterministic on timeout / error.
 *
 * @param {object} ctx — { llmCall: async (prompt) => string }
 */
export async function composeLLMEvolution(recipe, levelAtRevision, description, history, authorKind, ctx = {}) {
  if (process.env.CONCORD_SKILL_EVOLUTION_LLM !== "1") {
    return composeDeterministicEvolution(recipe, levelAtRevision, description, history, authorKind);
  }
  if (typeof ctx?.llmCall !== "function") {
    return composeDeterministicEvolution(recipe, levelAtRevision, description, history, authorKind);
  }
  const envelope = composeDeterministicEvolution(recipe, levelAtRevision, description, history, authorKind);
  try {
    const prompt = buildLLMPrompt(recipe, levelAtRevision, description, history, envelope);
    const raw = await Promise.race([
      ctx.llmCall(prompt),
      new Promise((_, rej) => { setTimeout(() => rej(new Error("llm_timeout")), 8000); }),
    ]);
    const parsed = parseLLMResponse(raw, envelope);
    if (!parsed) return envelope;
    // Cap LLM-proposed max_damage at REVISION_LLM_CEILING × envelope.
    const cap = envelope.maxDamageBefore * REVISION_GROWTH_BASE * REVISION_LLM_CEILING;
    parsed.maxDamageAfter = Math.min(parsed.maxDamageAfter, Math.round(cap));
    parsed.composer = "subconscious_llm";
    return parsed;
  } catch (err) {
    try { logger.debug?.("skill-evolution", "llm_failed_fallback", { error: err?.message }); }
    catch { /* ignore */ }
    return envelope;
  }
}

function buildLLMPrompt(recipe, levelAtRevision, description, history, envelope) {
  const shape = recipeShape(recipe);
  return TASK_PROMPTS.skillEvolutionDirective({
    recipe,
    shape,
    levelAtRevision,
    description,
    envelope,
    growthCeiling: Math.round(envelope.maxDamageBefore * REVISION_GROWTH_BASE * REVISION_LLM_CEILING),
    familyConstraint: elementFamily(shape.element),
  });
}

function parseLLMResponse(raw, envelope) {
  if (!raw) return null;
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (typeof obj.name_after !== "string" || !Number.isFinite(obj.max_damage_after)) return null;
    return {
      ...envelope,
      nameAfter: obj.name_after,
      maxDamageAfter: Math.max(envelope.maxDamageBefore, Math.round(obj.max_damage_after)),
      description: obj.summary || envelope.description,
    };
  } catch { return null; }
}

// ── Coherence validation ────────────────────────────────────────────────────

/**
 * Gate the evolution before commit. Returns { ok: bool, reason?: string }.
 *
 * Three rules per CLAUDE.md invariant:
 *  1. Element family must not jump (water → fire = REJECT).
 *  2. Max damage must stay within REVISION_LLM_CEILING × deterministic envelope.
 *  3. Name lineage must show overlap with the previous name (Jaccard ≥ NAME_LINEAGE_MIN_OVERLAP).
 */
export function validateRevisionCoherence(recipe, evolution, history) {
  if (!recipe || !evolution) return { ok: false, reason: "missing_inputs" };
  const shape = recipeShape(recipe);

  // Rule 1 — element family
  const fam = elementFamily(shape.element);
  if (fam && evolution.elementHint) {
    const newFam = elementFamily(evolution.elementHint);
    if (newFam && newFam !== fam) {
      return { ok: false, reason: "type_jump_unsupported", from: fam, to: newFam };
    }
  }

  // Rule 2 — damage envelope
  const ceiling = shape.maxDamage * REVISION_GROWTH_BASE * REVISION_LLM_CEILING;
  if (evolution.maxDamageAfter > ceiling + 0.5) {
    return { ok: false, reason: "max_damage_exceeds_envelope", proposed: evolution.maxDamageAfter, ceiling };
  }
  if (evolution.maxDamageAfter < shape.maxDamage) {
    return { ok: false, reason: "max_damage_regressed" };
  }

  // Rule 3 — name lineage continuity
  const overlap = nameTokenOverlap(shape.name, evolution.nameAfter);
  if (overlap < NAME_LINEAGE_MIN_OVERLAP) {
    return { ok: false, reason: "name_lineage_broken", overlap, prev: shape.name, next: evolution.nameAfter };
  }

  return { ok: true };
}

function tokenize(s) {
  return new Set(String(s || "").toLowerCase().split(/[\s_-]+/).filter(Boolean));
}

function nameTokenOverlap(a, b) {
  const aTok = tokenize(a);
  const bTok = tokenize(b);
  if (aTok.size === 0 || bTok.size === 0) return 0;
  let inter = 0;
  for (const t of aTok) if (bTok.has(t)) inter++;
  const union = new Set([...aTok, ...bTok]);
  return inter / union.size;
}

// ── Apply ───────────────────────────────────────────────────────────────────

/**
 * Commit the evolution. Single transaction:
 *   - Mark the unlock row as completed.
 *   - Insert the skill_revisions row.
 *   - Mutate the recipe DTU's meta JSON (max_damage, range_m, costs,
 *     current_name, revision_num, revision_history[]).
 *
 * Returns { ok: bool, revisionId?, recipe?, reason? }.
 */
export function applyEvolution(db, entityKind, entityId, evolution, opts = {}) {
  if (!db || !evolution || !evolution.recipeId) return { ok: false, reason: "missing_inputs" };

  const tx = db.transaction(() => {
    const recipe = getRecipe(db, evolution.recipeId);
    if (!recipe) throw new Error("recipe_not_found");
    const shape = recipeShape(recipe);

    // Coherence guard at apply-time too — defence in depth.
    const coh = validateRevisionCoherence(recipe, evolution, shape.revisionHistory);
    if (!coh.ok) throw new Error(`coherence_${coh.reason}`);

    // Optional resource fuel (Living Society P0): scale the evolution's
    // damage/range growth by the fuel potency before persisting. Player-only,
    // world-scoped inventory, single-tx consume. Guarded throughout.
    let fuel = null;
    const fuelIds = (entityKind === "player" && opts.userId && opts.worldId
      && Array.isArray(opts.fuelItemIds) && process.env.CONCORD_CRAFT_RESOLVE !== "0")
      ? opts.fuelItemIds.filter(Boolean).slice(0, 4) : [];
    if (fuelIds.length > 0) {
      try {
        const owned = [];
        const sumQty = db.prepare(`
            SELECT COALESCE(SUM(quantity),0) AS qty FROM player_inventory
            WHERE user_id = ? AND world_id = ? AND item_id = ?
          `);
        for (const itemId of fuelIds) {
          const row = sumQty.get(opts.userId, opts.worldId, itemId);
          if ((row?.qty ?? 0) >= 1) owned.push(itemId);
        }
        if (owned.length > 0) {
          const resolved = resolveCraft({ inputs: owned.map((id) => ({ itemId: id, qty: 1 })), db });
          if (resolved?.ok) {
            const mult = Math.max(1.0, 1 + (resolved.outputPotency / 100) * EVOLUTION_FUEL_BOOST);
            const selFuelSlot = db.prepare(`
                SELECT id, quantity FROM player_inventory
                WHERE user_id = ? AND world_id = ? AND item_id = ? AND quantity > 0
                ORDER BY acquired_at ASC LIMIT 1
              `);
            const decFuelSlot = db.prepare(`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?`);
            const delFuelSlot = db.prepare(`DELETE FROM player_inventory WHERE id = ?`);
            for (const itemId of owned) {
              const slot = selFuelSlot.get(opts.userId, opts.worldId, itemId);
              if (!slot) continue;
              if (slot.quantity > 1) decFuelSlot.run(slot.id);
              else delFuelSlot.run(slot.id);
            }
            if (Number.isFinite(evolution.maxDamageAfter)) {
              evolution.maxDamageAfter = Math.round(evolution.maxDamageAfter * mult * 10) / 10;
            }
            if (Number.isFinite(evolution.rangeMAfter)) {
              evolution.rangeMAfter = Math.max(0, Math.round(evolution.rangeMAfter * mult));
            }
            fuel = { items: owned, multiplier: Math.round(mult * 1000) / 1000, affinity: resolved.outputAffinity };
          }
        }
      } catch { fuel = null; }
    }

    const revisionId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO skill_revisions (
        id, recipe_dtu_id, revision_num, level_at_revision,
        author_kind, author_id, description, composer,
        max_damage_before, max_damage_after,
        range_m_before, range_m_after,
        costs_json, effect_delta_json,
        name_before, name_after,
        status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', unixepoch())
    `).run(
      revisionId,
      evolution.recipeId,
      evolution.revisionNum,
      evolution.levelAtRevision,
      entityKind,
      entityId,
      evolution.description,
      evolution.composer,
      evolution.maxDamageBefore,
      evolution.maxDamageAfter,
      evolution.rangeMBefore,
      evolution.rangeMAfter,
      JSON.stringify(evolution.costsAfter || {}),
      JSON.stringify(evolution.effectDelta || {}),
      evolution.nameBefore,
      evolution.nameAfter,
    );

    const meta = parseRecipeMeta(recipe);
    meta.max_damage = evolution.maxDamageAfter;
    meta.range_m = evolution.rangeMAfter;
    meta.costs = evolution.costsAfter || meta.costs;
    meta.current_name = evolution.nameAfter;
    meta.revision_num = evolution.revisionNum;
    // Biomechanics — propagate the tier + zone metadata into the recipe so
    // the combat path (worlds.js) and the procedural animation system
    // (combat-biomechanics.ts) can read them off the recipe DTU.
    if (Number.isFinite(evolution.animationTierAfter)) {
      meta.animation_tier = evolution.animationTierAfter;
    }
    if (Array.isArray(evolution.targetZones)) {
      meta.target_zones = evolution.targetZones;
    }
    if (Array.isArray(evolution.requiredLimbs)) {
      meta.required_limbs = evolution.requiredLimbs;
    }
    // Universal Move System P1 — backfill the motion descriptor so recipes minted
    // before stamping gain an explicit animation block on their next evolution
    // (no-op when already present; kill-switch CONCORD_MOVE_RESOLVER=0).
    stampMoveMeta(meta, { skillKind: meta.skill_kind, element: meta.element, worldId: opts.worldId });
    meta.revision_history = (Array.isArray(meta.revision_history) ? meta.revision_history : [])
      .concat([{
        revision_num: evolution.revisionNum,
        name_before: evolution.nameBefore,
        name_after: evolution.nameAfter,
        max_damage_after: evolution.maxDamageAfter,
        description: String(evolution.description || "").slice(0, 240),
        composer: evolution.composer,
        author_kind: entityKind,
        author_id: entityId,
        committed_at: Math.floor(Date.now() / 1000),
      }]);
    if (meta.revision_history.length > 200) {
      // Keep the chain bounded in memory; the full chain lives in skill_revisions.
      meta.revision_history = meta.revision_history.slice(-200);
    }

    db.prepare(`UPDATE dtus SET data = ? WHERE id = ?`)
      .run(JSON.stringify(meta), evolution.recipeId);

    // Mark the matching unlock as completed.
    if (opts.unlockId) {
      db.prepare(`
        UPDATE skill_evolution_unlocks SET completed_at = unixepoch(), revision_id = ?
        WHERE id = ?
      `).run(revisionId, opts.unlockId);
    } else {
      // Best-effort: the latest pending unlock for this entity+recipe.
      db.prepare(`
        UPDATE skill_evolution_unlocks SET completed_at = unixepoch(), revision_id = ?
        WHERE entity_kind = ? AND entity_id = ? AND recipe_dtu_id = ? AND completed_at IS NULL
        ORDER BY unlocked_at ASC LIMIT 1
      `).run(revisionId, entityKind, entityId, evolution.recipeId);
    }

    return { revisionId, recipeId: evolution.recipeId, fuel };
  });

  try {
    const result = tx();
    return { ok: true, revisionId: result.revisionId, recipeId: result.recipeId, fuel: result.fuel };
  } catch (err) {
    return { ok: false, reason: err?.message || "apply_failed" };
  }
}

// ── Read helpers ────────────────────────────────────────────────────────────

export function getEvolutionHistory(db, recipeId, limit = 200) {
  return db.prepare(`
    SELECT id, revision_num, level_at_revision, author_kind, author_id,
           description, composer, max_damage_before, max_damage_after,
           name_before, name_after, created_at
    FROM skill_revisions
    WHERE recipe_dtu_id = ? AND status = 'applied'
    ORDER BY revision_num ASC
    LIMIT ?
  `).all(recipeId, limit);
}

export function getRevisionCount(db, recipeId) {
  const r = db.prepare(`SELECT COUNT(*) AS n FROM skill_revisions WHERE recipe_dtu_id = ? AND status = 'applied'`).get(recipeId);
  return r?.n || 0;
}

// ── Helpers for tests + domain layer ────────────────────────────────────────

export const _internal = {
  REVISION_GROWTH_BASE,
  REVISION_LLM_CEILING,
  NAME_LINEAGE_MIN_OVERLAP,
  ANIMATION_TIER_MAX,
  ELEMENT_FAMILIES,
  SKILL_KIND_LIMB_REQ,
  LIMB_DEBUFF_TABLE,
  elementFamily,
  recipeShape,
  composeNameContinuation,
  nameTokenOverlap,
};
