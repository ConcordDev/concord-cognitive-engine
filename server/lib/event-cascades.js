// server/lib/event-cascades.js
//
// Phase BD3 — event cascade engine.
//
// A cascade definition maps a parent event id to a child quest id
// for each outcome (success / failure). triggerCascade is idempotent
// on (parent_event_id, outcome) so re-realising never double-spawns.

import logger from "../logger.js";

const MAX_DEPTH = 10;

export function defineCascade(db, parentEventId, opts = {}) {
  if (!db || !parentEventId) return { ok: false, error: "missing_inputs" };
  const { onSuccess, onFailure, contentPack } = opts;
  const maxDepth = Math.max(1, Math.min(MAX_DEPTH, opts.maxDepth || MAX_DEPTH));
  try {
    db.prepare(`
      INSERT INTO cascade_definitions
        (parent_event_id, on_success, on_failure, max_depth, content_pack)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(parent_event_id) DO UPDATE SET
        on_success = excluded.on_success,
        on_failure = excluded.on_failure,
        max_depth = excluded.max_depth,
        content_pack = excluded.content_pack
    `).run(parentEventId, onSuccess || null, onFailure || null, maxDepth, contentPack || null);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Trigger a cascade for a completed parent event. Looks up the
 * definition, picks the child for the outcome, and stamps it onto a
 * lattice_born_quests row. Idempotent on (parent_event_id, outcome).
 *
 * Returns `{ ok, spawned: bool, childQuestId?, depth?, alreadyExisted? }`.
 */
export function triggerCascade(db, parentEventId, outcome, opts = {}) {
  if (!db || !parentEventId) return { ok: false, error: "missing_inputs" };
  if (!["success", "failure"].includes(outcome)) return { ok: false, error: "invalid_outcome" };

  try {
    const def = db.prepare(`SELECT * FROM cascade_definitions WHERE parent_event_id = ?`)
      .get(parentEventId);
    if (!def) return { ok: true, spawned: false, reason: "no_definition" };

    const childTemplate = outcome === "success" ? def.on_success : def.on_failure;
    if (!childTemplate) return { ok: true, spawned: false, reason: "no_branch" };

    // Check for idempotency / depth cap.
    const prev = db.prepare(`
      SELECT spawned_quest_id, depth FROM cascade_spawns
      WHERE parent_event_id = ? AND outcome = ?
    `).get(parentEventId, outcome);
    if (prev) {
      return { ok: true, spawned: false, alreadyExisted: true, childQuestId: prev.spawned_quest_id };
    }

    // Compute child depth from the parent's lattice_born_quests row, if any.
    let parentDepth = 0;
    try {
      const parentRow = db.prepare(`
        SELECT cascade_depth FROM lattice_born_quests WHERE quest_id = ?
      `).get(parentEventId);
      if (parentRow) parentDepth = parentRow.cascade_depth || 0;
    } catch { /* table may be missing */ }

    const childDepth = parentDepth + 1;
    if (childDepth > (def.max_depth || MAX_DEPTH)) {
      return { ok: true, spawned: false, reason: "max_depth_exceeded" };
    }

    // Build child quest id. Caller-supplied factory wins; otherwise
    // synthesize a deterministic id so re-trigger maps to the same id.
    const childQuestId = opts.makeChildId
      ? opts.makeChildId(childTemplate, parentEventId, outcome)
      : `lbq_cascade_${childTemplate}_${parentEventId.slice(0, 12)}_${outcome}`;

    db.prepare(`
      INSERT INTO cascade_spawns
        (parent_event_id, outcome, spawned_quest_id, depth)
      VALUES (?, ?, ?, ?)
    `).run(parentEventId, outcome, childQuestId, childDepth);

    // Stamp lineage on the child's lattice_born_quests row if it exists.
    try {
      db.prepare(`
        UPDATE lattice_born_quests
        SET parent_quest_id = ?, cascade_depth = ?
        WHERE quest_id = ?
      `).run(parentEventId, childDepth, childQuestId);
    } catch { /* missing column on minimal */ }

    logger.info?.("event-cascades", "spawned", { parentEventId, outcome, childQuestId, depth: childDepth });
    return { ok: true, spawned: true, childQuestId, depth: childDepth };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Recursive walk: from a quest, return its ancestor chain (oldest first). */
export function getCascadeChain(db, questId, opts = {}) {
  if (!db || !questId) return [];
  const limit = Math.max(1, Math.min(MAX_DEPTH, opts.limit || MAX_DEPTH));
  try {
    const chain = [];
    let cursor = questId;
    for (let i = 0; i < limit && cursor; i++) {
      const row = db.prepare(`
        SELECT quest_id, parent_quest_id FROM lattice_born_quests WHERE quest_id = ?
      `).get(cursor);
      if (!row) break;
      chain.unshift(row.quest_id);
      cursor = row.parent_quest_id;
    }
    return chain;
  } catch { return []; }
}

export { MAX_DEPTH };
