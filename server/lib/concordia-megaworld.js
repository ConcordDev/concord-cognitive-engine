/**
 * Concordia persistent megaworld — topology laws + settlement identity.
 *
 * Worlds are regions in one universe. Flower Law is Hub-only. Abandoning a
 * settlement sets status; it never DELETEs the row. whyPlace returns only
 * beats that were recorded.
 *
 *   cd server && node --test tests/concordia-megaworld.test.js
 */

import crypto from "node:crypto";
import { createSettlement } from "./settlements.js";
import { composeEntry } from "./chronicle/compose.js";
import { recordEntry } from "./chronicle/chronicle.js";
import { recordConsequence } from "./world-consequence.js";

export const FLOWER_LAW_WORLDS = Object.freeze(["hub", "concordia-hub"]);

/** Content folders / kernel world ids for the core civilizations. */
export const CORE_CIVILIZATIONS = Object.freeze([
  "concordia-hub",
  "sovereign-ruins",
  "tunya",
  "fantasy",
  "crime",
  "cyber",
  "concord-link-frontier",
  "superhero",
  "sere",
  "lattice-crucible",
]);

export const SETTLEMENT_STATUSES = Object.freeze(["active", "abandoned", "conquered", "ghost"]);

/** What Unity Travel() does today. Overland streaming is not implemented. */
export const CURRENT_TRAVEL_MODE = "region_rebuild";

export function flowerLawGoverns(worldId) {
  const id = String(worldId || "").trim().toLowerCase();
  return FLOWER_LAW_WORLDS.includes(id);
}

/**
 * Intended mode after W3. Hub crossings and core-to-core use the Link.
 * Same-region travel should be overland. Not a claim that overland exists.
 */
export function intendedTravelMode(fromWorldId, toWorldId) {
  const from = String(fromWorldId || "").trim().toLowerCase();
  const to = String(toWorldId || "").trim().toLowerCase();
  if (!from || !to) return { mode: "invalid", reason: "missing_world" };
  if (from === to) return { mode: "stay" };
  if (flowerLawGoverns(from) || flowerLawGoverns(to)) return { mode: "link_gate" };
  return { mode: "overland" };
}

export function currentTravelMode() {
  return { mode: CURRENT_TRAVEL_MODE };
}

export function countPopulation(db, settlementId) {
  if (!db || !settlementId) return 0;
  try {
    return db.prepare(`
      SELECT COUNT(*) AS n FROM world_npcs
       WHERE settlement_id = ? AND COALESCE(is_dead,0)=0
    `).get(settlementId)?.n ?? 0;
  } catch { return 0; }
}

function hasColumn(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function getSettlement(db, settlementId) {
  if (!db || !settlementId) return null;
  try { return db.prepare(`SELECT * FROM settlements WHERE id = ?`).get(settlementId) || null; }
  catch { return null; }
}

function writePlaceBeat(db, settlementId, worldId, kind, payload) {
  const c = composeEntry(kind, payload);
  if (!c.ok) return c;
  const id = `sch_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO settlement_chronicle
        (id, settlement_id, world_id, kind, dedupe_key, title, body, actor_id, year_idx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(settlement_id, dedupe_key) DO NOTHING
    `).run(
      id, settlementId, worldId, kind, c.dedupeKey, c.title, c.body,
      payload.actor_id || payload.actorId || null,
      Number.isInteger(payload.year_idx) ? payload.year_idx : null,
    );
  } catch (e) {
    return { ok: false, reason: "place_persist_failed", error: e?.message };
  }
  try { recordEntry(db, worldId, kind, payload); } catch { /* world_chronicle optional */ }
  return { ok: true, id, title: c.title, body: c.body, dedupeKey: c.dedupeKey };
}

function tryConsequence(db, opts) {
  try { return recordConsequence(db, opts); }
  catch { return { ok: false, reason: "consequence_unavailable" }; }
}

/**
 * Found a settlement as a historical object. Wraps createSettlement.
 * Empty founders stay empty. Does not invent a spring or a road.
 */
export function foundSettlement(db, opts = {}) {
  const made = createSettlement(db, opts);
  if (!made.ok) return made;
  if (hasColumn(db, "settlements", "status")) {
    try {
      db.prepare(`UPDATE settlements SET status = 'active', founded_at = COALESCE(founded_at, unixepoch()) WHERE id = ?`)
        .run(made.id);
    } catch { /* optional cols */ }
  }
  if (Array.isArray(opts.founders) && hasColumn(db, "settlements", "founders_json")) {
    try {
      db.prepare(`UPDATE settlements SET founders_json = ? WHERE id = ?`)
        .run(JSON.stringify(opts.founders), made.id);
    } catch { /* noop */ }
  }
  const worldId = opts.worldId;
  writePlaceBeat(db, made.id, worldId, "settlement_founded", {
    id: made.id,
    name: opts.name,
    world_id: worldId,
    dedupeKey: `settlement_founded:${made.id}`,
  });
  tryConsequence(db, {
    worldId,
    actorKind: opts.actorKind || "system",
    actorId: opts.actorId || "inhabitation",
    action: "settle",
    targetKind: "settlement",
    targetId: made.id,
    location: made.id,
    importance: 0.7,
    immediate: { name: opts.name },
  });
  return { ok: true, id: made.id };
}

/**
 * Abandon a settlement. The row remains. Buildings are not deleted here.
 */
export function abandonSettlement(db, settlementId, { reason = null, actorId = null } = {}) {
  if (!db || !settlementId) return { ok: false, reason: "missing_inputs" };
  const row = getSettlement(db, settlementId);
  if (!row) return { ok: false, reason: "not_found" };
  if (!hasColumn(db, "settlements", "status")) return { ok: false, reason: "schema" };
  try {
    db.prepare(`
      UPDATE settlements
         SET status = 'abandoned', abandoned_at = unixepoch()
       WHERE id = ?
    `).run(settlementId);
  } catch (e) { return { ok: false, reason: "update_failed", error: e?.message }; }
  writePlaceBeat(db, settlementId, row.world_id, "settlement_abandoned", {
    id: settlementId,
    name: row.name,
    world_id: row.world_id,
    reason,
    dedupeKey: `settlement_abandoned:${settlementId}`,
  });
  tryConsequence(db, {
    worldId: row.world_id,
    actorKind: "system",
    actorId: actorId || "inhabitation",
    action: "abandon",
    targetKind: "settlement",
    targetId: settlementId,
    location: settlementId,
    importance: 0.8,
    longTerm: { reason, buildings_remain: true },
  });
  return { ok: true, id: settlementId, status: "abandoned" };
}

export function listPlaceHistory(db, settlementId, limit = 50) {
  if (!db || !settlementId) return [];
  const cap = Math.min(200, Math.max(1, Number(limit) || 50));
  try {
    return db.prepare(`
      SELECT id, kind, title, body, actor_id, year_idx, created_at
        FROM settlement_chronicle
       WHERE settlement_id = ?
       ORDER BY created_at ASC, rowid ASC
       LIMIT ?
    `).all(settlementId, cap);
  } catch { return []; }
}

/**
 * Why is this place here? Identity + recorded beats only.
 * Empty history is a valid answer — never a fabricated spring or mill.
 */
export function whyPlace(db, settlementId) {
  if (!db || !settlementId) return { ok: false, reason: "missing_inputs" };
  const row = getSettlement(db, settlementId);
  if (!row) return { ok: false, reason: "not_found" };
  const history = listPlaceHistory(db, settlementId);
  const population = Number.isInteger(row.population) ? row.population : countPopulation(db, settlementId);
  return {
    ok: true,
    settlement: {
      id: row.id,
      worldId: row.world_id,
      name: row.name,
      status: row.status || "active",
      foundedAt: row.founded_at || row.created_at || null,
      abandonedAt: row.abandoned_at || null,
      population,
      factionId: row.faction_id || null,
      formerNames: row.former_names_json ? safeJson(row.former_names_json) : [],
      founders: row.founders_json ? safeJson(row.founders_json) : [],
    },
    history,
  };
}

function safeJson(raw) {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

/**
 * Kernel → Unity card. No buildings invented. Missing tables → empty arrays.
 */
export function presentationForSettlement(db, settlementId) {
  const why = whyPlace(db, settlementId);
  if (!why.ok) return why;
  return {
    ok: true,
    settlement: why.settlement,
    history: why.history,
    livePopulation: why.settlement.population,
  };
}
