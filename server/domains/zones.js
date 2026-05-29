// server/domains/zones.js
//
// T3.3 — read/author surface for the world-zone system (lib/world-zones.js +
// migration 262). Domain key: 'zones'.
//
//   zones.list_for_world  — every zone in a world (+ resolved rules) for the
//                           map overlay.
//   zones.at              — the governing zone + combat rule at a point.
//   zones.upsert          — author a zone (operator / world-owner tool).

import {
  listZones, zoneAt, combatRuleFor, upsertZone, ZONE_KINDS,
} from "../lib/world-zones.js";

export default function registerZonesMacros(register) {
  register("zones", "list_for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "missing_world_id" };
    const zones = listZones(db, input.worldId);
    return { ok: true, zones, count: zones.length };
  });

  register("zones", "at", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, x, z } = input;
    if (!worldId || !Number.isFinite(Number(x)) || !Number.isFinite(Number(z))) {
      return { ok: false, reason: "missing_inputs" };
    }
    const zone = zoneAt(db, worldId, Number(x), Number(z));
    const rule = combatRuleFor(db, worldId, Number(x), Number(z));
    return { ok: true, zone, rule };
  });

  register("zones", "upsert", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId || null;
    const { worldId, name, kind } = input;
    if (!worldId || !name) return { ok: false, reason: "missing_inputs" };
    if (!ZONE_KINDS.includes(kind)) return { ok: false, reason: "invalid_kind", validKinds: ZONE_KINDS };
    return upsertZone(db, {
      worldId, name, kind,
      centerX: Number(input.centerX) || 0,
      centerZ: Number(input.centerZ) || 0,
      radiusM: Number(input.radiusM) || 50,
      rules: input.rules && typeof input.rules === "object" ? input.rules : {},
      createdBy: userId,
    });
  });
}
