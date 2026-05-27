// server/lib/npc-relationships.js
//
// Phase AB — Nemesis-pattern NPC↔NPC graph.
//
// Shadow-of-Mordor's "yes and..." rule expressed as a graph:
// every player action that touches NPC A is a candidate to escalate A's
// existing relationships with other NPCs. The graph lives in
// npc_relationships (sorted pair), every escalation drops a row into
// npc_relationship_events.
//
// This module is plumbing only. The rule engine that decides WHEN to
// form/escalate lives in server/emergent/nemesis-cycle.js — this file
// just exposes the primitives.

import crypto from "node:crypto";
import logger from "../logger.js";

// All 9 relationship kinds the migration's CHECK allows.
export const RELATIONSHIP_KINDS = Object.freeze([
  "rival", "mentor", "apprentice", "blood_brother",
  "family_enemy", "spy", "bodyguard", "former_lover", "debt_holder",
]);

// Decay sweep removes relationships untouched for > 60 days game time.
// Configurable so tests can use a tiny window.
const DEFAULT_DECAY_THRESHOLD_S = 60 * 24 * 60 * 60;

function _sortPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function _newId() {
  return `nrel-${crypto.randomBytes(8).toString("hex")}`;
}

function _newEventId() {
  return `nrelev-${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Form a relationship between two NPCs. Idempotent on the (sorted-pair,
 * kind) UNIQUE constraint — returns the existing row if it's already
 * there. Asymmetric kinds (mentor/apprentice) bake direction into the
 * intensity sign: a positive intensity row with kind='mentor' on the
 * sorted pair means npc_a is the mentor; negative means npc_b is.
 */
export function formRelationship(db, npcA, npcB, kind, intensity = 0, opts = {}) {
  if (!RELATIONSHIP_KINDS.includes(kind)) {
    return { ok: false, error: "invalid_kind" };
  }
  if (npcA === npcB) {
    return { ok: false, error: "self_relationship" };
  }
  if (typeof intensity !== "number" || intensity < -1 || intensity > 1) {
    return { ok: false, error: "invalid_intensity" };
  }

  const [a, b] = _sortPair(npcA, npcB);
  const worldId = opts.worldId || "concordia-hub";
  const formedFromEvent = opts.formedFromEvent || null;

  try {
    const existing = db.prepare(`
      SELECT id, intensity FROM npc_relationships
      WHERE npc_a_id = ? AND npc_b_id = ? AND kind = ?
    `).get(a, b, kind);

    if (existing) {
      return { ok: true, relationshipId: existing.id, alreadyExisted: true };
    }

    const id = _newId();
    db.prepare(`
      INSERT INTO npc_relationships
        (id, world_id, npc_a_id, npc_b_id, kind, intensity, formed_from_event)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, a, b, kind, intensity, formedFromEvent);

    return { ok: true, relationshipId: id, alreadyExisted: false };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * Append an escalation event to an existing relationship. Bumps the
 * intensity (clamped) and updates last_event_at so the decay sweep
 * leaves it alone.
 */
export function escalate(db, relationshipId, eventKind, summary, opts = {}) {
  const intensityDelta = typeof opts.intensityDelta === "number"
    ? opts.intensityDelta : 0.1;
  const witnessedBy = opts.witnessedByPlayerId || null;

  try {
    const r = db.prepare(`SELECT intensity FROM npc_relationships WHERE id = ?`)
      .get(relationshipId);
    if (!r) return { ok: false, error: "no_relationship" };

    const eventId = _newEventId();
    db.prepare(`
      INSERT INTO npc_relationship_events
        (id, relationship_id, kind, summary, witnessed_by_player_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(eventId, relationshipId, eventKind, summary, witnessedBy);

    const next = Math.max(-1, Math.min(1, (r.intensity || 0) + intensityDelta));
    db.prepare(`
      UPDATE npc_relationships
      SET intensity = ?, last_event_at = unixepoch()
      WHERE id = ?
    `).run(next, relationshipId);

    return { ok: true, eventId, newIntensity: next };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * Sweep old relationships. Default: anything untouched for > 60 days.
 * The events table cascades on delete via FK. Returns count removed.
 */
export function decay(db, ageThresholdS = DEFAULT_DECAY_THRESHOLD_S) {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - ageThresholdS;
    const r = db.prepare(`
      DELETE FROM npc_relationships WHERE last_event_at < ?
    `).run(cutoff);
    return { ok: true, removed: r.changes || 0 };
  } catch (err) {
    return { ok: false, error: err?.message || "db_error" };
  }
}

/**
 * List every relationship an NPC participates in. Result includes the
 * other NPC's id and the kind; caller decides what to render.
 */
export function listForNpc(db, npcId) {
  try {
    const rows = db.prepare(`
      SELECT id, npc_a_id, npc_b_id, kind, intensity, formed_at, last_event_at
      FROM npc_relationships
      WHERE npc_a_id = ? OR npc_b_id = ?
      ORDER BY last_event_at DESC
    `).all(npcId, npcId);
    return rows.map(r => ({
      id: r.id,
      otherNpcId: r.npc_a_id === npcId ? r.npc_b_id : r.npc_a_id,
      kind: r.kind,
      intensity: r.intensity,
      formedAt: r.formed_at,
      lastEventAt: r.last_event_at,
    }));
  } catch {
    return [];
  }
}

/**
 * List relationships in a world, optionally filtered by kind.
 */
export function listInWorld(db, worldId, opts = {}) {
  try {
    const kindFilter = opts.kind ? `AND kind = ?` : ``;
    const limit = Math.max(1, Math.min(500, opts.limit || 100));
    const sql = `
      SELECT id, npc_a_id, npc_b_id, kind, intensity, last_event_at
      FROM npc_relationships
      WHERE world_id = ? ${kindFilter}
      ORDER BY last_event_at DESC
      LIMIT ?
    `;
    const args = opts.kind ? [worldId, opts.kind, limit] : [worldId, limit];
    return db.prepare(sql).all(...args);
  } catch {
    return [];
  }
}

/**
 * Pagination-friendly gossip feed: every relationship event in a world
 * since the given ms timestamp, newest first. Joins so consumer doesn't
 * need to chase the parent row.
 */
export function getVillageGossipFeed(db, worldId, opts = {}) {
  try {
    const sinceS = typeof opts.sinceS === "number"
      ? opts.sinceS
      : Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    const limit = Math.max(1, Math.min(200, opts.limit || 50));
    const rows = db.prepare(`
      SELECT
        e.id              AS event_id,
        e.relationship_id AS relationship_id,
        e.kind            AS event_kind,
        e.summary         AS summary,
        e.ts              AS ts,
        e.witnessed_by_player_id AS witnessed_by,
        r.npc_a_id        AS npc_a_id,
        r.npc_b_id        AS npc_b_id,
        r.kind            AS relationship_kind,
        r.intensity       AS intensity
      FROM npc_relationship_events e
      JOIN npc_relationships r ON r.id = e.relationship_id
      WHERE r.world_id = ? AND e.ts >= ?
      ORDER BY e.ts DESC
      LIMIT ?
    `).all(worldId, sinceS, limit);
    return rows;
  } catch (err) {
    logger.error?.("npc-relationships", "gossip_feed_error", { error: err?.message });
    return [];
  }
}
