// server/lib/mentorship.js
//
// Phase 1.5 — Mentorship semantics.
//
// Two flows:
//   1. NPC teaches player — player approaches a high-tier NPC, pays a fee
//      proportional to revision depth, gets a skill_revisions row for
//      THEIR copy of the recipe at the mentor's depth-minus-one. One
//      revision per session, capped.
//
//   2. Player teaches NPC (via demonstration) — when a player casts an
//      evolved skill in combat AND a friendly NPC observes, the
//      `skill_demonstration_log` row gets recorded. The next NPC
//      revision pass biases its name continuation toward the player's
//      branch (see consumeDemonstrationsForNpc below).
//
// Both flows leverage the existing royalty cascade. NPC mentorship pays
// out via wealth_sparks UPDATE; player teaching cites the player's
// recipe lineage so future students of THAT NPC pay the original player
// through the cascade.

import crypto from "node:crypto";
import logger from "../logger.js";
import {
  composeDeterministicEvolution,
  applyEvolution,
  getEvolutionHistory,
} from "./skill-evolution.js";

const SESSION_PRICE_BASE = 25;
const SESSION_PRICE_PER_DEPTH = 8;
const MAX_SESSIONS_PER_MENTORSHIP = 3;

// ── NPC teaches player ──────────────────────────────────────────────────────

/**
 * Player requests mentorship from an NPC. Pays a fee proportional to the
 * NPC's recipe depth. Creates a mentorship row with sessions_remaining = 1.
 *
 * @returns { ok, mentorshipId?, price?, reason? }
 */
export function requestMentorship(db, { mentorNpcId, studentUserId, recipeDtuId }) {
  if (!db || !mentorNpcId || !studentUserId || !recipeDtuId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const recipe = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(recipeDtuId);
  if (!recipe) return { ok: false, reason: "recipe_not_found" };
  if (recipe.creator_id !== mentorNpcId) return { ok: false, reason: "recipe_not_owned_by_mentor" };

  let meta = {};
  try { meta = JSON.parse(recipe.meta_json || "{}"); } catch { /* ignore */ }
  const mentorDepth = Number(meta.revision_num) || 0;
  if (mentorDepth < 1) return { ok: false, reason: "mentor_depth_insufficient" };

  // Already an active mentorship between these two on this recipe?
  const existing = db.prepare(`
    SELECT id FROM mentorships
    WHERE mentor_kind='npc' AND mentor_id=?
      AND student_kind='player' AND student_id=?
      AND recipe_dtu_id=? AND status='active'
    LIMIT 1
  `).get(mentorNpcId, studentUserId, recipeDtuId);
  if (existing) return { ok: false, reason: "already_active", mentorshipId: existing.id };

  const price = SESSION_PRICE_BASE + Math.min(mentorDepth, 50) * SESSION_PRICE_PER_DEPTH;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO mentorships (
      id, mentor_kind, mentor_id, student_kind, student_id,
      recipe_dtu_id, sessions_total, sessions_remaining, price_paid,
      started_at, status
    ) VALUES (?, 'npc', ?, 'player', ?, ?, ?, ?, ?, unixepoch(), 'active')
  `).run(id, mentorNpcId, studentUserId, recipeDtuId, MAX_SESSIONS_PER_MENTORSHIP, MAX_SESSIONS_PER_MENTORSHIP, price);

  // Pay the NPC. Best-effort; if the world_npcs row has no wealth_sparks
  // column we just skip the payout side-effect.
  try {
    db.prepare(`UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks, 0) + ? WHERE id = ?`).run(price, mentorNpcId);
  } catch { /* ignore */ }

  return { ok: true, mentorshipId: id, price, sessionsRemaining: MAX_SESSIONS_PER_MENTORSHIP };
}

/**
 * Player completes one session. Creates a skill_revisions row on the
 * STUDENT's copy of the recipe (or the mentor's recipe if the student
 * doesn't have their own — in which case a personal-scope fork is
 * created first via the standard DTU creation path).
 *
 * Capped at mentor depth - 1 so the student can't surpass the mentor
 * via sessions alone. To go past mentor depth the student has to
 * grind levels and author their own evolutions.
 */
export function completeMentorshipSession(db, { mentorshipId, studentRecipeId }) {
  if (!db || !mentorshipId) return { ok: false, reason: "missing_inputs" };
  const m = db.prepare(`SELECT * FROM mentorships WHERE id = ? AND status = 'active'`).get(mentorshipId);
  if (!m) return { ok: false, reason: "mentorship_not_active" };
  if ((m.sessions_remaining || 0) <= 0) return { ok: false, reason: "no_sessions_remaining" };

  const mentorRecipe = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(m.recipe_dtu_id);
  if (!mentorRecipe) return { ok: false, reason: "mentor_recipe_gone" };
  let mentorMeta = {};
  try { mentorMeta = JSON.parse(mentorRecipe.meta_json || "{}"); } catch { /* ignore */ }
  const mentorDepth = Number(mentorMeta.revision_num) || 0;
  const cap = Math.max(1, mentorDepth - 1);

  // Student's own recipe: caller passes studentRecipeId (the player's fork).
  // For now we keep it simple — caller must have minted a personal fork
  // before requesting the session. If not, we synthesize a fork from
  // the mentor's recipe under the student's creator_id.
  let studentRecipe = studentRecipeId
    ? db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(studentRecipeId)
    : null;

  if (!studentRecipe) {
    // Fork the mentor recipe to the student. Personal scope (CLAUDE.md
    // invariant: personal_dtus_never_leak — the player's copy is theirs).
    const forkId = `student:${m.student_id}:${crypto.randomUUID().slice(0, 8)}`;
    const studentMeta = {
      ...mentorMeta,
      author_kind: "player",
      revision_num: 0,
      revision_history: [],
      forked_from: m.recipe_dtu_id,
      mentor_id: m.mentor_id,
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, ?, ?, ?, ?, 1, 0, unixepoch())
      `).run(forkId, mentorRecipe.kind, mentorMeta.current_name || mentorRecipe.title, m.student_id, JSON.stringify(studentMeta));
      studentRecipe = db.prepare(`SELECT * FROM dtus WHERE id = ?`).get(forkId);
    } catch (err) {
      try { logger.warn?.("mentorship", "fork_failed", { error: err?.message }); } catch { /* ignore */ }
      return { ok: false, reason: "fork_failed" };
    }
  }

  let studentMeta = {};
  try { studentMeta = JSON.parse(studentRecipe.meta_json || "{}"); } catch { /* ignore */ }
  const studentDepth = Number(studentMeta.revision_num) || 0;
  if (studentDepth >= cap) {
    return { ok: false, reason: "student_at_cap", cap, studentDepth, mentorDepth };
  }

  // Compose a deterministic revision biased by the mentor's name lineage —
  // the student inherits the next name in the mentor's chain, attributable
  // to the mentor for cascade purposes.
  const history = getEvolutionHistory(db, studentRecipe.id, 50);
  const description = `Lesson ${m.sessions_total - m.sessions_remaining + 1}/${m.sessions_total} — taught by mentor ${m.mentor_id}.`;
  const evolution = composeDeterministicEvolution(studentRecipe, studentRecipe.skill_level || 1, description, history, "player");

  // Bias: name continuation pulled from mentor's lineage (overrides the
  // default name continuation). Look up the mentor's revision_history for
  // a name token at the student's current depth.
  if (Array.isArray(mentorMeta.revision_history) && mentorMeta.revision_history.length > studentDepth) {
    const mentorNext = mentorMeta.revision_history[studentDepth];
    if (mentorNext?.name_after) {
      evolution.nameAfter = mentorNext.name_after;
    }
  }

  const result = applyEvolution(db, "player", m.student_id, evolution);
  if (!result?.ok) return { ok: false, reason: result?.reason || "apply_failed" };

  // Decrement sessions remaining; mark completed if zero.
  db.prepare(`
    UPDATE mentorships
    SET sessions_remaining = sessions_remaining - 1,
        status = CASE WHEN sessions_remaining - 1 = 0 THEN 'completed' ELSE 'active' END,
        completed_at = CASE WHEN sessions_remaining - 1 = 0 THEN unixepoch() ELSE NULL END
    WHERE id = ?
  `).run(m.id);

  return {
    ok: true,
    revisionId: result.revisionId,
    studentRecipeId: studentRecipe.id,
    studentDepth: studentDepth + 1,
    cap,
    sessionsRemaining: (m.sessions_remaining || 1) - 1,
  };
}

// ── Player teaches NPC (demonstration) ──────────────────────────────────────

/**
 * Record a demonstration event. Called from the combat path when a
 * `skill:tier-witnessed` socket event fires AND there are friendly NPCs
 * in the chunk. The next npc-skill-evolve-cycle reads consumed_at IS NULL
 * rows to bias the NPC's revision composition toward the player's branch.
 */
export function recordDemonstration(db, { witnessedNpcId, casterUserId, casterNpcId, recipeDtuId, revisionNum, element, worldId }) {
  if (!db || !witnessedNpcId || !recipeDtuId) return { ok: false, reason: "missing_inputs" };
  const id = crypto.randomUUID();
  try {
    db.prepare(`
      INSERT INTO skill_demonstration_log (
        id, witnessed_npc_id, caster_user_id, caster_npc_id,
        recipe_dtu_id, revision_num, element, world_id, witnessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, witnessedNpcId, casterUserId || null, casterNpcId || null,
           recipeDtuId, Number(revisionNum) || 0, element || null, worldId || null);
    return { ok: true, id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

/**
 * Pull pending demonstrations for an NPC (consumed_at IS NULL). Returns
 * up to 5 most recent. Also marks them consumed.
 */
export function consumeDemonstrationsForNpc(db, npcId) {
  if (!db || !npcId) return [];
  const rows = db.prepare(`
    SELECT id, recipe_dtu_id, revision_num, element, caster_user_id, caster_npc_id, witnessed_at
    FROM skill_demonstration_log
    WHERE witnessed_npc_id = ? AND consumed_at IS NULL
    ORDER BY witnessed_at DESC
    LIMIT 5
  `).all(npcId);
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE skill_demonstration_log SET consumed_at = unixepoch() WHERE id IN (${placeholders})`).run(...ids);
  return rows;
}

// ── Read helpers ────────────────────────────────────────────────────────────

export function listMentorshipsForStudent(db, studentKind, studentId) {
  return db.prepare(`
    SELECT * FROM mentorships
    WHERE student_kind = ? AND student_id = ?
    ORDER BY started_at DESC LIMIT 50
  `).all(studentKind, studentId);
}

export function listMentorshipsForMentor(db, mentorKind, mentorId) {
  return db.prepare(`
    SELECT * FROM mentorships
    WHERE mentor_kind = ? AND mentor_id = ?
    ORDER BY started_at DESC LIMIT 50
  `).all(mentorKind, mentorId);
}

// ── Phase BC2 — mentor registry (in-world badge support) ───────────────

/**
 * Register / update an NPC as a mentor. Idempotent on PK (npc_id).
 * Authored NPCs seeded via content-seeder; procgen NPCs promote at
 * skill_revisions.revision_num >= 5 via maybePromoteToMentor.
 */
export function registerMentorProfile(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  const {
    npcId, worldId, skillCategory,
    depth = 1, feeCc = 0, languages = [], available = true,
    promotedFrom = null,
  } = opts;
  if (!npcId || !worldId || !skillCategory) return { ok: false, error: "missing_inputs" };
  try {
    db.prepare(`
      INSERT INTO npc_mentor_profiles
        (npc_id, world_id, skill_category, depth, fee_cc, languages_json, available, promoted_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(npc_id) DO UPDATE SET
        world_id = excluded.world_id,
        skill_category = excluded.skill_category,
        depth = excluded.depth,
        fee_cc = excluded.fee_cc,
        languages_json = excluded.languages_json,
        available = excluded.available
    `).run(
      npcId, worldId, skillCategory,
      Math.max(1, Number(depth) || 1),
      Math.max(0, Number(feeCc) || 0),
      JSON.stringify(languages),
      available ? 1 : 0,
      promotedFrom,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function setMentorAvailability(db, npcId, available) {
  if (!db || !npcId) return { ok: false, error: "missing_inputs" };
  try {
    db.prepare(`UPDATE npc_mentor_profiles SET available = ? WHERE npc_id = ?`)
      .run(available ? 1 : 0, npcId);
    return { ok: true };
  } catch (err) { return { ok: false, error: err?.message }; }
}

export function listMentorsInWorld(db, worldId, opts = {}) {
  if (!db || !worldId) return [];
  try {
    const filters = ["world_id = ?", "available = 1"];
    const args = [worldId];
    if (opts.skillCategory) { filters.push("skill_category = ?"); args.push(opts.skillCategory); }
    args.push(Math.max(1, Math.min(200, opts.limit || 50)));
    return db.prepare(`
      SELECT npc_id, skill_category, depth, fee_cc, languages_json, registered_at
      FROM npc_mentor_profiles WHERE ${filters.join(" AND ")}
      ORDER BY depth DESC, registered_at ASC
      LIMIT ?
    `).all(...args);
  } catch { return []; }
}

export function getMentorProfile(db, npcId) {
  if (!db || !npcId) return null;
  try {
    return db.prepare(`SELECT * FROM npc_mentor_profiles WHERE npc_id = ?`).get(npcId) || null;
  } catch { return null; }
}

/**
 * Auto-promote a procgen NPC to mentor on revision threshold.
 * Idempotent — re-promotion is a no-op.
 */
export function maybePromoteToMentor(db, opts = {}) {
  const { npcId, worldId, skillCategory, revisionNum } = opts;
  if (!npcId || !worldId || !skillCategory) return { ok: false, error: "missing_inputs" };
  const threshold = 5;
  if (!Number.isInteger(revisionNum) || revisionNum < threshold) {
    return { ok: true, promoted: false };
  }
  const existing = getMentorProfile(db, npcId);
  if (existing) return { ok: true, promoted: false, reason: "already_registered" };
  const r = registerMentorProfile(db, {
    npcId, worldId, skillCategory,
    depth: revisionNum, promotedFrom: "skill_evolution",
  });
  return { ok: r.ok, promoted: r.ok, error: r.error };
}

export const _internal = {
  SESSION_PRICE_BASE,
  SESSION_PRICE_PER_DEPTH,
  MAX_SESSIONS_PER_MENTORSHIP,
};
