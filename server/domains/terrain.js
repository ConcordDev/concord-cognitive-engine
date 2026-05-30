// server/domains/terrain.js
//
// Living Society — Phase 0.6: destructible-world macro surface.
//
// dig          — lower a terrain cell, yield its propertied material, persist
//                the delta, and destabilise any building dug under (structural
//                support coupling).
// deformations — load-replay: the persisted deltas for a world/region.
// water_depth  — per-cell water column at a position (swim/drown truth).
// set_water    — seed a water source (spring/flood).
// flow_tick    — advance the hydrology solver one step (debug/admin; the
//                heartbeat runs it in production).

import crypto from "node:crypto";
import {
  applyDeformation, deformationsForWorld, getElevationAt, cellOf, CELL_SIZE,
} from "../lib/terrain-deformation.js";
import { setWater, waterDepthAt, tickWaterFlow } from "../lib/terrain-water.js";
import { propsFor } from "../lib/resources.js";

const DIG_AMOUNT = Number(process.env.CONCORD_DIG_AMOUNT_M) || 1.0; // metres per dig
const DIG_SUPPORT_RADIUS = 8; // metres — buildings within this of a dig lose support

export default function registerTerrainMacros(register) {
  register("terrain", "dig", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const worldId = input.worldId || "concordia-hub";
    const wx = Number(input.x), wz = Number(input.z);
    if (!Number.isFinite(wx) || !Number.isFinite(wz)) return { ok: false, reason: "bad_position" };
    const amount = Math.max(0.1, Math.min(5, Number(input.amount) || DIG_AMOUNT));

    const def = applyDeformation(db, worldId, wx, wz, amount, "excavate");
    if (!def.ok) return def;

    // Yield the cell's terrain material as a Phase-0 propertied resource.
    let yielded = null;
    if (def.material && Math.abs(def.appliedDelta) > 0.001) {
      const qty = Math.max(1, Math.round(Math.abs(def.appliedDelta)));
      const props = propsFor(def.material, { db });
      try {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name, quantity, quality, properties_json, acquired_at)
          VALUES (?, ?, ?, 'material', ?, ?, ?, 'gathered', ?, unixepoch())
        `).run(crypto.randomUUID(), userId, worldId, def.material, def.material,
          qty, JSON.stringify({ potency: props.potency, affinity: props.affinity, stability: props.stability, rarity_tier: props.rarity_tier }));
        yielded = { item: def.material, quantity: qty };
      } catch { /* inventory shape varies — yield best-effort */ }
    }

    // Structural-support coupling: a building above/near the dug cell loses support.
    let destabilised = null;
    try {
      const { cx, cz } = cellOf(wx, wz);
      const cxw = cx * CELL_SIZE + CELL_SIZE / 2, czw = cz * CELL_SIZE + CELL_SIZE / 2;
      const buildings = db.prepare(`
        SELECT id, x, z, state FROM world_buildings
        WHERE world_id = ? AND state != 'collapsed'
          AND x BETWEEN ? AND ? AND z BETWEEN ? AND ?
      `).all(worldId, cxw - DIG_SUPPORT_RADIUS, cxw + DIG_SUPPORT_RADIUS, czw - DIG_SUPPORT_RADIUS, czw + DIG_SUPPORT_RADIUS);
      if (buildings.length > 0) {
        const { applyStructuralStress } = await import("../lib/embodied/skill-environment.js");
        const stress = Math.min(0.4, Math.abs(def.appliedDelta) * 0.12); // dig depth → support loss
        for (const b of buildings) {
          const dist = Math.hypot(b.x - wx, b.z - wz);
          if (dist <= DIG_SUPPORT_RADIUS) {
            const r = applyStructuralStress(db, worldId, b.id, stress);
            if (!destabilised) destabilised = [];
            destabilised.push({ buildingId: b.id, ...(r || {}) });
          }
        }
      }
    } catch { /* structural coupling best-effort */ }

    // Realtime feed (the client replays the delta + rebuilds the heightfield).
    try {
      ctx?.realtime?.io?.to?.(`world:${worldId}`)?.emit?.("concordia:terrain-deformed", {
        cell: def.cell, newDelta: def.newDelta, newElevation: def.newElevation, kind: "excavate",
      });
    } catch { /* realtime optional */ }

    return { ok: true, ...def, yielded, destabilised };
  }, { note: "dig a terrain cell, yield material, persist the delta", destructive: true });

  register("terrain", "deformations", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || "concordia-hub";
    const opts = {};
    if (Number.isFinite(input.x) && Number.isFinite(input.z)) {
      opts.centreX = Number(input.x); opts.centreZ = Number(input.z);
      opts.cellRadius = Math.max(1, Math.min(64, Number(input.cellRadius) || 32));
    }
    return { ok: true, deformations: deformationsForWorld(db, worldId, opts), cellSize: CELL_SIZE };
  }, { note: "load-replay persisted terrain deltas" });

  register("terrain", "water_depth", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || "concordia-hub";
    const wx = Number(input.x), wz = Number(input.z);
    return {
      ok: true,
      waterDepth: waterDepthAt(db, worldId, wx, wz),
      elevation: getElevationAt(db, worldId, wx, wz),
    };
  }, { note: "per-cell water column + base+delta elevation" });

  register("terrain", "set_water", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || "concordia-hub";
    return setWater(db, worldId, Number(input.x), Number(input.z), Math.max(0, Number(input.height) || 0));
  }, { note: "seed a water source (spring/flood)" });

  register("terrain", "flow_tick", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return tickWaterFlow(db, input.worldId || "concordia-hub");
  }, { note: "advance the hydrology flow solver one step" });
}
