// @sql-loop-ok: skill lineage application is order-dependent — each
// revision mutates the recipe's meta_json that the next revision reads.
// Bounded loops (5 pending unlocks per NPC; targetDepth for named-character
// seeding). Cannot be batched without losing lineage semantics.
// server/lib/npc-skill-author.js
//
// Phase 1 — NPCs author their own recipe DTUs over time.
//
// At milestone levels (5, 25, 100), a deterministic composer picks an
// archetype-appropriate skill kind + element + base name and creates a
// recipe DTU with `creator_id = npc_id`, `meta.author_kind = 'npc'`. The
// skill is then leveled by the existing skill-progression engine + evolved
// by skill-evolution at every 10-level boundary.
//
// Lineage seeding for named characters (Sovereign / Concordia goddess /
// Coalition leaders) lives in `seedNamedCharacterLineage` — called lazily
// on first marketplace view rather than at boot to avoid an expensive
// startup cost.
//
// Determinism: all selections are seeded by sha1(npc_id + skill_kind) so
// the same NPC always authors the same skill at the same level.

import crypto from "node:crypto";
import logger from "../logger.js";
import { tryUnlockEvolution, composeDeterministicEvolution, applyEvolution } from "./skill-evolution.js";

const MILESTONE_LEVELS = [5, 25, 100];

// Archetype → preferred skill kind + element family. NPCs from a water-
// tradition warrior faction tend toward fighting_style + water lineages.
const ARCHETYPE_PROFILE = {
  warrior:        { skill_kind: "fighting_style", elements: ["physical", "fire", "water"] },
  guard:          { skill_kind: "fighting_style", elements: ["physical", "lightning"] },
  scholar:        { skill_kind: "spell",          elements: ["energy", "water", "lightning"] },
  mystic:         { skill_kind: "spell",          elements: ["energy", "bio", "water"] },
  healer:         { skill_kind: "biopower",       elements: ["bio", "energy"] },
  hunter:         { skill_kind: "fighting_style", elements: ["physical", "bio"] },
  trader:         { skill_kind: "tech_gadget",    elements: ["physical", "energy"] },
  refusal_keeper: { skill_kind: "psionic",        elements: ["energy"] },
  cyber:          { skill_kind: "cyber_ability",  elements: ["lightning", "energy"] },
  default:        { skill_kind: "fighting_style", elements: ["physical"] },
};

// Faction tradition → preferred element. Overrides archetype when the
// faction has a strong tradition (set in content/world/<world>/factions.json).
const FACTION_TRADITIONS = {
  pinewood_coalition: "water",
  ember_keepers:      "fire",
  storm_wardens:      "lightning",
  bioshift_collective: "bio",
  void_archive:       "energy",
};

const NAME_ROOTS = {
  fighting_style: ["strike", "kata", "stance", "blow", "guard"],
  spell:          ["bolt", "ward", "sigil", "rune", "weave"],
  biopower:       ["bloom", "pulse", "wave", "graft", "vein"],
  cyber_ability:  ["packet", "fork", "probe", "spike", "loop"],
  psionic:        ["thought", "pierce", "veil", "fold", "echo"],
  tech_gadget:    ["device", "rig", "tool", "mount", "frame"],
  mundane:        ["technique", "method", "way", "form"],
};

function pickFromSeed(seedBuf, idx, arr) {
  return arr[seedBuf[idx % seedBuf.length] % arr.length];
}

function seedFor(npcId, suffix) {
  return crypto.createHash("sha1").update(`${npcId}|${suffix}`).digest();
}

function deriveProfile(npc) {
  const archetype = String(npc?.archetype || "default").toLowerCase();
  const profile = ARCHETYPE_PROFILE[archetype] || ARCHETYPE_PROFILE.default;
  const factionElement = FACTION_TRADITIONS[String(npc?.faction || "").toLowerCase()];
  return {
    skill_kind: profile.skill_kind,
    element: factionElement || profile.elements[0],
    elements: profile.elements,
  };
}

function composeBaseName(npc, profile, seedBuf) {
  const element = profile.element;
  const root = pickFromSeed(seedBuf, 0, NAME_ROOTS[profile.skill_kind] || NAME_ROOTS.mundane);
  const npcStub = (npc?.name || npc?.id || "kael")
    .toString().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 12);
  return `${npcStub}_${element}_${root}`;
}

function baseRecipeMeta(profile, baseName) {
  const baseMaxDamage = profile.skill_kind === "spell" ? 12
                      : profile.skill_kind === "biopower" ? 9
                      : profile.skill_kind === "cyber_ability" ? 14
                      : profile.skill_kind === "psionic" ? 16
                      : 10;
  return {
    author_kind: "npc",
    skill_kind: profile.skill_kind,
    element: profile.element,
    name: baseName,
    current_name: baseName,
    revision_num: 0,
    revision_history: [],
    max_damage: baseMaxDamage,
    range_m: profile.skill_kind === "fighting_style" ? 3 : 12,
    costs: { stamina: 4, mana: profile.skill_kind === "spell" ? 8 : 0, cooldown_s: 6 },
    formula: `(basePower + level * 0.5) * envBoost`,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Ensure the NPC has authored at least one recipe at each milestone they've
 * crossed. Idempotent. Returns the list of recipes touched (created or
 * pre-existing).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} npc — row from world_npcs
 */
export function ensureNpcAuthoredSkills(db, npc) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };
  const level = Number(npc.level ?? 1);
  const touched = [];

  for (const milestone of MILESTONE_LEVELS) {
    if (level < milestone) continue;
    // Has the NPC already authored a recipe of the matching kind?
    const profile = deriveProfile(npc);
    const existing = db.prepare(`
      SELECT id FROM dtus
      WHERE creator_id = ?
        AND kind IN ('skill', 'spell_recipe', 'fighting_style_recipe', 'recipe', 'code_artifact')
        AND meta_json LIKE ?
      LIMIT 1
    `).get(npc.id, `%"author_kind":"npc"%`);
    if (existing) { touched.push({ id: existing.id, action: "already_existed" }); continue; }

    const seedBuf = seedFor(npc.id, `milestone_${milestone}`);
    const baseName = composeBaseName(npc, profile, seedBuf);
    const meta = baseRecipeMeta(profile, baseName);

    const recipeId = `npcskill:${npc.id}:${milestone}:${seedBuf.toString("hex").slice(0, 6)}`;
    const dtuKind = profile.skill_kind === "fighting_style" ? "fighting_style_recipe"
                  : profile.skill_kind === "spell" ? "spell_recipe"
                  : "skill";

    try {
      db.prepare(`
        INSERT OR IGNORE INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 0, unixepoch())
      `).run(
        recipeId,
        dtuKind,
        baseName,
        npc.id,
        JSON.stringify(meta),
        Math.min(level, milestone), // skill starts at the milestone level
      );
      touched.push({ id: recipeId, action: "authored", milestone, kind: dtuKind });
    } catch (err) {
      try { logger.debug?.("npc-skill-author", "insert_failed", { npcId: npc.id, error: err?.message }); }
      catch { /* ignore */ }
    }
  }
  return { ok: true, touched };
}

/**
 * Auto-evolve any pending unlocks for an NPC. Called from the
 * npc-skill-evolve-cycle heartbeat. Returns the count of revisions applied.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} npcId
 * @param {object} ctx — { llmCall? } for opt-in LLM evolution
 */
export async function autoEvolveNpcSkills(db, npcId, ctx = {}) {
  if (!db || !npcId) return { applied: 0 };

  const pending = db.prepare(`
    SELECT id, recipe_dtu_id, level_at_unlock
    FROM skill_evolution_unlocks
    WHERE entity_kind = 'npc' AND entity_id = ? AND completed_at IS NULL
    ORDER BY unlocked_at ASC
    LIMIT 5
  `).all(npcId);

  let applied = 0;
  for (const unlock of pending) {
    const recipe = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(unlock.recipe_dtu_id);
    if (!recipe) continue;

    // History fed in if we want LLM coherence; deterministic doesn't read it.
    const history = db.prepare(`
      SELECT name_after, description, revision_num
      FROM skill_revisions
      WHERE recipe_dtu_id = ? AND status = 'applied'
      ORDER BY revision_num ASC
      LIMIT 50
    `).all(recipe.id);

    // Phase 1.5 — read demonstrations this NPC has witnessed, bias the
    // evolution narrative toward the witnessed branch (player teaches NPC).
    let demonstrations = [];
    try {
      const mentorship = await import("./mentorship.js");
      demonstrations = mentorship.consumeDemonstrationsForNpc(db, npcId);
    } catch { /* mentorship module optional in some builds */ }

    let description = `Tier-${(history.length || 0) + 1} drill at level ${unlock.level_at_unlock}.`;
    if (demonstrations.length > 0) {
      const sources = demonstrations.map(d => d.caster_user_id || d.caster_npc_id).filter(Boolean);
      const tiers = demonstrations.map(d => `tier-${d.revision_num}`);
      description = `Adapting from witnessed ${tiers.join(", ")} demonstration(s) by ${sources.join(", ")}.`;
    }
    const evolution = await maybeLLMEvolve(recipe, unlock.level_at_unlock, description, history, ctx);

    // If the NPC witnessed a demonstration of a player's recipe, bias the
    // name continuation toward the player's lineage. Royalty-cascade-wise
    // this means the NPC's revision cites the player's recipe as parent
    // (registered separately by the cycle caller via royalty-cascade).
    if (demonstrations.length > 0) {
      const witnessedRecipe = db.prepare(`SELECT meta_json FROM dtus WHERE id = ?`).get(demonstrations[0].recipe_dtu_id);
      try {
        const witnessedMeta = JSON.parse(witnessedRecipe?.meta_json || "{}");
        const witnessedCurrent = witnessedMeta.current_name;
        if (witnessedCurrent && typeof witnessedCurrent === "string") {
          // Append a token from the witnessed name to the NPC's continuation.
          const witnessedTokens = witnessedCurrent.split(/[\s_-]+/);
          const lastTok = witnessedTokens[witnessedTokens.length - 1];
          if (lastTok && !evolution.nameAfter.includes(lastTok)) {
            evolution.nameAfter = `${evolution.nameAfter}_${lastTok}`;
          }
          evolution.witnessedFrom = demonstrations[0].recipe_dtu_id;
        }
      } catch { /* ignore parse errors */ }
    }

    const result = applyEvolution(db, "npc", npcId, evolution, { unlockId: unlock.id });
    if (result?.ok) {
      applied++;
      // Phase 8 — when an NPC's revision is biased by a witnessed
      // demonstration, emit a `mentorship:npc-adopted` socket event so
      // the player whose lineage was witnessed gets a HUD notification
      // ("Hild adopted your striking pattern"). Best-effort; doesn't
      // break the apply path if the realtime layer is absent.
      if (demonstrations.length > 0 && evolution.witnessedFrom) {
        try {
          const casterUserId = demonstrations.find((d) => d.caster_user_id)?.caster_user_id;
          if (casterUserId && globalThis?.__CONCORD_REALTIME__?.io) {
            globalThis.__CONCORD_REALTIME__.io.to(`user:${casterUserId}`).emit("mentorship:npc-adopted", {
              npcId,
              recipeDtuId: evolution.recipeId,
              witnessedFromDtuId: evolution.witnessedFrom,
              newName: evolution.nameAfter,
              revisionNum: evolution.revisionNum,
              ts: Date.now(),
            });
          }
        } catch { /* realtime is best-effort */ }
      }
    }
  }
  return { applied };
}

async function maybeLLMEvolve(recipe, level, description, history, ctx) {
  if (process.env.CONCORD_SKILL_EVOLUTION_LLM === "1" && typeof ctx?.llmCall === "function") {
    const mod = await import("./skill-evolution.js");
    return mod.composeLLMEvolution(recipe, level, description, history, "npc", ctx);
  }
  return composeDeterministicEvolution(recipe, level, description, history, "npc");
}

/**
 * Lazily seed a deep lineage for named characters (Sovereign / Concordia
 * goddess / Coalition leaders) on first read. Generates revisions
 * deterministically from sha1(npc_id + n) so the same character always has
 * the same lineage regardless of when it's first encountered.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} npcId
 * @param {number} targetDepth — desired number of revisions (1..2000)
 */
export function seedNamedCharacterLineage(db, npcId, targetDepth) {
  if (!db || !npcId || !Number.isFinite(targetDepth) || targetDepth <= 0) return { seeded: 0 };
  const npc = db.prepare(`SELECT * FROM world_npcs WHERE id = ?`).get(npcId);
  if (!npc) return { ok: false, reason: "npc_not_found" };

  // Ensure the NPC has at least one recipe.
  ensureNpcAuthoredSkills(db, npc);
  const recipe = db.prepare(`
    SELECT * FROM dtus WHERE creator_id = ? AND meta_json LIKE ? LIMIT 1
  `).get(npcId, `%"author_kind":"npc"%`);
  if (!recipe) return { ok: false, reason: "no_recipe_after_seed" };

  let seeded = 0;
  for (let i = 0; i < targetDepth; i++) {
    const refresh = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(recipe.id);
    const evolution = composeDeterministicEvolution(
      refresh,
      (i + 1) * 10,
      `Seeded lineage rev ${i + 1} for named character ${npcId}.`,
      [],
      "npc",
    );
    const r = applyEvolution(db, "npc", npcId, evolution);
    if (r?.ok) seeded++;
    else break;     // stop on first failure to avoid runaway loops
  }
  return { ok: true, seeded, recipeId: recipe.id };
}

export const _internal = {
  MILESTONE_LEVELS,
  ARCHETYPE_PROFILE,
  FACTION_TRADITIONS,
  deriveProfile,
  composeBaseName,
  baseRecipeMeta,
  pickFromSeed,
};
