// server/lib/hook-artifacts.js
//
// Concordia Phase 1 — hook-as-artifact lifecycle.
//
// A hook artifact is a world-positioned wrapper around an existing
// `secrets` row or `npc_scheme_evidence` row. The player can carry
// it, drop it somewhere, hide it (drop at a position only they know),
// destroy it (final state), or have it stolen back by the NPC who
// owns the secret/evidence.
//
// The hook does NOT carry the secret's body in its own columns — it
// references the parent row. That keeps the privacy invariant intact
// (secret bodies still live in `secrets`, narrative-bridge canary
// scan stays valid).

import crypto from "node:crypto";
import logger from "../logger.js";
import { recordOpinionEvent } from "./npc-opinions.js";

function makeHookId() {
  return `hook_${crypto.randomUUID().slice(0, 16)}`;
}

function locationJson(loc) {
  if (!loc) return null;
  const x = Number.isFinite(loc.x) ? Number(loc.x) : null;
  const y = Number.isFinite(loc.y) ? Number(loc.y) : null;
  const z = Number.isFinite(loc.z) ? Number(loc.z) : null;
  if (x == null && y == null && z == null) return null;
  return JSON.stringify({ x: x ?? 0, y: y ?? 0, z: z ?? 0 });
}

/**
 * Drop a new hook into the world (or directly into a player's satchel).
 * Caller specifies which substrate row this hook handles:
 *   - { secretId } — wraps a row from `secrets`
 *   - { evidenceId } — wraps a row from `npc_scheme_evidence`
 *
 * Returns { ok, hookId }.
 */
export function dropHook(db, {
  worldId,
  secretId = null,
  evidenceId = null,
  holderKind = "world",
  holderId = "",
  label = null,
  location = null,
} = {}) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  if (!secretId && !evidenceId) return { ok: false, reason: "no_substrate_link" };
  if (secretId && evidenceId) return { ok: false, reason: "two_substrate_links" };
  if (!["world", "player", "npc"].includes(holderKind)) return { ok: false, reason: "bad_holder_kind" };
  if (holderKind !== "world" && !holderId) return { ok: false, reason: "holder_id_required" };

  const id = makeHookId();
  const computedLabel = label || (secretId ? `secret-handle:${secretId.slice(0, 12)}` : `evidence-handle:${(evidenceId || "").slice(0, 12)}`);
  try {
    db.prepare(`
      INSERT INTO hook_artifacts (id, world_id, holder_kind, holder_id, secret_id, evidence_id, label, location_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, holderKind, holderId, secretId, evidenceId, computedLabel, locationJson(location));
    return { ok: true, hookId: id };
  } catch (err) {
    try { logger.warn?.("hook_drop_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

/** Pick up a hook from the world into a player's satchel. */
export function pickupHook(db, userId, hookId) {
  if (!db || !userId || !hookId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`SELECT id, holder_kind, holder_id, destroyed_at FROM hook_artifacts WHERE id = ?`).get(hookId);
  if (!row) return { ok: false, reason: "hook_not_found" };
  if (row.destroyed_at) return { ok: false, reason: "hook_destroyed" };
  if (row.holder_kind === "player" && row.holder_id === userId) {
    return { ok: true, action: "already_held" };
  }
  if (row.holder_kind !== "world") return { ok: false, reason: "not_in_world" };
  const r = db.prepare(`
    UPDATE hook_artifacts
    SET holder_kind = 'player', holder_id = ?, location_json = NULL, updated_at = unixepoch()
    WHERE id = ? AND holder_kind = 'world'
  `).run(userId, hookId);
  if (r.changes === 0) return { ok: false, reason: "lost_race" };
  return { ok: true, action: "picked_up" };
}

/** Drop a hook the player is carrying back into the world. */
export function dropFromSatchel(db, userId, hookId, location) {
  if (!db || !userId || !hookId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`SELECT holder_kind, holder_id, destroyed_at FROM hook_artifacts WHERE id = ?`).get(hookId);
  if (!row) return { ok: false, reason: "hook_not_found" };
  if (row.destroyed_at) return { ok: false, reason: "hook_destroyed" };
  if (row.holder_kind !== "player" || row.holder_id !== userId) return { ok: false, reason: "not_yours" };
  const r = db.prepare(`
    UPDATE hook_artifacts
    SET holder_kind = 'world', holder_id = '', location_json = ?, updated_at = unixepoch()
    WHERE id = ?
  `).run(locationJson(location), hookId);
  if (r.changes === 0) return { ok: false, reason: "update_failed" };
  return { ok: true, action: "dropped" };
}

/** Destroy a hook the player is carrying. Final state. */
export function destroyHook(db, userId, hookId) {
  if (!db || !userId || !hookId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`SELECT holder_kind, holder_id, destroyed_at, secret_id, evidence_id FROM hook_artifacts WHERE id = ?`).get(hookId);
  if (!row) return { ok: false, reason: "hook_not_found" };
  if (row.destroyed_at) return { ok: true, action: "already_destroyed" };
  if (row.holder_kind !== "player" || row.holder_id !== userId) return { ok: false, reason: "not_yours" };
  db.prepare(`
    UPDATE hook_artifacts
    SET holder_kind = 'destroyed', holder_id = '', destroyed_at = unixepoch(), updated_at = unixepoch()
    WHERE id = ?
  `).run(hookId);
  return { ok: true, action: "destroyed", linked: { secretId: row.secret_id, evidenceId: row.evidence_id } };
}

/**
 * NPC steals a hook back from a player's satchel. Caller (e.g. a
 * scheme cycle, or a quest beat) decides when this triggers; we just
 * apply the state change and record opinion deltas.
 *
 * Returns { ok, action }.
 */
export function stealHook(db, hookId, stealerNpcId, victimUserId, { reason = "recovered_evidence" } = {}) {
  if (!db || !hookId || !stealerNpcId || !victimUserId) return { ok: false, reason: "missing_inputs" };
  const row = db.prepare(`SELECT holder_kind, holder_id, destroyed_at FROM hook_artifacts WHERE id = ?`).get(hookId);
  if (!row) return { ok: false, reason: "hook_not_found" };
  if (row.destroyed_at) return { ok: false, reason: "hook_destroyed" };
  if (row.holder_kind !== "player" || row.holder_id !== victimUserId) return { ok: false, reason: "victim_not_holder" };
  const r = db.prepare(`
    UPDATE hook_artifacts
    SET holder_kind = 'npc', holder_id = ?, updated_at = unixepoch()
    WHERE id = ? AND holder_kind = 'player' AND holder_id = ?
  `).run(stealerNpcId, hookId, victimUserId);
  if (r.changes === 0) return { ok: false, reason: "lost_race" };
  try {
    // Theft is hostile — victim opinion of stealer takes a hit.
    recordOpinionEvent(db,
      { npcId: stealerNpcId, targetKind: "player", targetId: victimUserId },
      -10, reason);
  } catch { /* opinion table optional */ }
  return { ok: true, action: "stolen" };
}

/** List hooks in a player's satchel. */
export function listHooksForPlayer(db, userId, { worldId = null } = {}) {
  if (!db || !userId) return [];
  const sql = worldId
    ? `SELECT id, world_id, secret_id, evidence_id, label, created_at, updated_at
         FROM hook_artifacts
         WHERE holder_kind = 'player' AND holder_id = ? AND world_id = ?
           AND destroyed_at IS NULL
         ORDER BY created_at DESC LIMIT 200`
    : `SELECT id, world_id, secret_id, evidence_id, label, created_at, updated_at
         FROM hook_artifacts
         WHERE holder_kind = 'player' AND holder_id = ?
           AND destroyed_at IS NULL
         ORDER BY created_at DESC LIMIT 200`;
  const stmt = db.prepare(sql);
  return worldId ? stmt.all(userId, worldId) : stmt.all(userId);
}

/** List hooks currently lying in the world (for nearby-pickup queries). */
export function listHooksInWorld(db, worldId, { limit = 100 } = {}) {
  if (!db || !worldId) return [];
  return db.prepare(`
    SELECT id, world_id, secret_id, evidence_id, label, location_json, created_at
    FROM hook_artifacts
    WHERE holder_kind = 'world' AND world_id = ? AND destroyed_at IS NULL
    ORDER BY created_at DESC LIMIT ?
  `).all(worldId, limit);
}
