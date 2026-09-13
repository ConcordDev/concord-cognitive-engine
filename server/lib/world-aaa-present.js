/**
 * Unity/Godot world:snapshot extras — quests, warrants, vehicles, consequences,
 * authored lore. Empty arrays when tables/files are missing. Never fabricated.
 */
import { listConsequences } from "./world-consequence.js";
import { listNpcsForGatewaySnapshot } from "./world-npc-snapshot.js";
import { getPainBudget } from "./embodied/pain.js";
import { verbsFromPain } from "./combat/limb-verbs.js";
import {
  listLoreLandmarks,
  listAuthoredQuests,
  refusalForWorld,
} from "./world-lore-present.js";

function tryAll(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

export function listWorldQuestsForSnapshot(db, worldId, userId) {
  if (!db || !worldId) return [];
  const out = [];
  if (userId) {
    try {
      const rows = db.prepare(`
        SELECT q.id, q.title, q.status AS quest_status, pq.status AS player_status
          FROM world_quests q
          JOIN player_quests pq ON pq.quest_id = q.id
         WHERE pq.user_id = ? AND pq.world_id = ?
           AND (pq.status IS NULL OR pq.status = 'active')
         LIMIT 16
      `).all(userId, worldId);
      for (const r of rows) {
        out.push({
          id: r.id,
          title: r.title || r.id,
          origin: "player",
          status: r.player_status || r.quest_status || "active",
        });
      }
    } catch { /* player_quests optional */ }
  }
  try {
    const rows = db.prepare(`
      SELECT id, title, status, kind
        FROM lattice_born_quests
       WHERE world_id = ? AND (status IS NULL OR status IN ('open','active','offered'))
       LIMIT 16
    `).all(worldId);
    for (const r of rows) {
      out.push({
        id: r.id,
        title: r.title || r.id,
        origin: "lattice",
        status: r.status || "open",
        kind: r.kind || null,
      });
    }
  } catch { /* lattice optional */ }
  return out;
}

export function listWarrantsForSnapshot(db, worldId) {
  if (!db || !worldId) return [];
  return tryAll(() => db.prepare(`
    SELECT a.id, a.suspect_id, a.suspect_type, a.bounty_amount, c.crime_type
      FROM arrest_records a
      JOIN crime_events c ON c.id = a.crime_event_id
     WHERE a.world_id = ? AND a.status = 'active'
     ORDER BY a.bounty_amount DESC
     LIMIT 16
  `).all(worldId).map((r) => ({
    id: r.id,
    suspectId: r.suspect_id,
    suspectType: r.suspect_type,
    bounty: r.bounty_amount,
    crimeType: r.crime_type,
  })), []);
}

export function listVehiclesForSnapshot(db, worldId) {
  if (!db || !worldId) return [];
  return tryAll(() => db.prepare(`
    SELECT id, kind, pos_x, pos_y, pos_z, heading, capacity, fare_cc
      FROM world_vehicles WHERE world_id = ? LIMIT 24
  `).all(worldId).map((r) => ({
    id: r.id,
    kind: r.kind,
    x: r.pos_x || 0,
    y: r.pos_y || 0,
    z: r.pos_z || 0,
    heading: r.heading || 0,
    capacity: r.capacity,
    fare: r.fare_cc,
  })), []);
}

export function limbsForSnapshot(db, userId) {
  if (!db || !userId) return null;
  return tryAll(() => {
    const budget = getPainBudget(db, userId);
    const v = verbsFromPain(budget?.byRegion || {});
    return {
      brokenArm: !!v.brokenArm,
      brokenLeg: !!v.brokenLeg,
      dodgeDisabled: !!v.dodgeDisabled,
      damageMul: v.damageMul,
    };
  }, null);
}

export function packAaaSnapshot(db, worldId, { userId = null } = {}) {
  const npcs = listNpcsForGatewaySnapshot(db, worldId);
  const consequences = tryAll(
    () => listConsequences(db, { worldId, limit: 12 }).map((r) => ({
      id: r.id,
      action: r.action,
      actorId: r.actorId,
      targetId: r.targetId,
      importance: r.importance,
    })),
    [],
  );
  const kernelQuests = listWorldQuestsForSnapshot(db, worldId, userId);
  const authored = tryAll(() => listAuthoredQuests(worldId), []);
  const seen = new Set(kernelQuests.map((q) => q.id));
  const quests = kernelQuests.concat(authored.filter((q) => q && !seen.has(q.id)));
  return {
    npcs,
    quests,
    warrants: listWarrantsForSnapshot(db, worldId),
    vehicles: listVehiclesForSnapshot(db, worldId),
    consequences,
    lore: tryAll(() => listLoreLandmarks(worldId), []),
    refusal: tryAll(() => refusalForWorld(worldId), null),
    limbs: limbsForSnapshot(db, userId),
    voice: { cellM: 50, ice: "/api/webrtc/ice-servers" },
  };
}
