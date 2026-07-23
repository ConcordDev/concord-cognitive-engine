// server/domains/scenebridge.js
//
// Engine Bridge (#29) — macros over lib/scene-export.js. Serializes real
// world_buildings geometry into a neutral glTF-flavoured scene graph an external
// engine can ingest. Read-only.
//
// Registered from server.js: registerSceneBridgeMacros(register).

import { exportScene, sceneStats } from "../lib/scene-export.js";
import { listDistricts } from "../lib/districts.js";
import {
  validDistrictIds,
  conceptForDistrict,
  buildingsForDistrict,
  CITY_LAYOUT_WORLD_ID,
} from "../lib/building-purpose.js";

export default function registerSceneBridgeMacros(register) {
  register("scenebridge", "export", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "no_world" };
    return exportScene(db, input.worldId, { includeCollapsed: input.includeCollapsed === true });
  }, { note: "export a world's buildings as a neutral scene graph for an external engine (#29)" });

  register("scenebridge", "stats", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "no_world" };
    return sceneStats(db, input.worldId);
  }, { note: "building counts by type for a world (#29)" });

  // Central Plaza directory/map (master-spec A1). Composes REAL district
  // geometry (migration-374 `districts` table, via lib/districts.js) with
  // the REAL authored building purposes (lib/building-purpose.js, itself
  // sourced from content/world/concordia-hub/city-layout.json — the same
  // registry scene-export's per-node `extras.purpose` already reads, so
  // this is not a second/competing registry). A world with no authored
  // layout (anything but concordia-hub today) gets an honest empty
  // directory, never a fabricated one.
  register("scenebridge", "map", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const worldId = typeof input.worldId === "string" && input.worldId ? input.worldId : CITY_LAYOUT_WORLD_ID;
    const authored = worldId === CITY_LAYOUT_WORLD_ID;

    let geometric = [];
    try {
      geometric = listDistricts(db, worldId);
    } catch {
      geometric = [];
    }
    // Prefer the authored district-id set (so a fresh DB with no seeded
    // `districts` rows yet still returns the real authored directory);
    // fall back to whatever geometric rows exist for a world with no
    // authored layout at all.
    const districtIds = authored ? validDistrictIds() : geometric.map((d) => d.id);

    const districtsOut = districtIds.map((districtId) => {
      const geo = geometric.find((d) => d.id === districtId) || null;
      const buildings = authored
        ? buildingsForDistrict(districtId).map((b) => ({
            id: b.id,
            name: b.name,
            purpose: b.purpose,
            lens: b.lens ?? null,
            source: b.source,
          }))
        : [];
      return {
        districtId,
        concept: authored ? conceptForDistrict(districtId) : null,
        name: geo?.name ?? null,
        palette: geo?.palette ?? null,
        lightingTag: geo?.lightingTag ?? null,
        buildingCount: buildings.length,
        buildings,
      };
    });

    const plazaDistrictId = `${worldId}:plaza`;
    const plazaEntry = districtsOut.find((d) => d.districtId === plazaDistrictId) || null;

    return {
      ok: true,
      worldId,
      authored,
      plaza: plazaEntry
        ? { districtId: plazaEntry.districtId, name: plazaEntry.name, concept: plazaEntry.concept }
        : null,
      districts: districtsOut,
      totalBuildings: districtsOut.reduce((s, d) => s + d.buildingCount, 0),
    };
  }, { note: "district+building directory for the Central Plaza orientation UI (master-spec A1); composes real geometry + authored purpose, never invents a duplicate registry" });
}
