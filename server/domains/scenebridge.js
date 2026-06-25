// server/domains/scenebridge.js
//
// Engine Bridge (#29) — macros over lib/scene-export.js. Serializes real
// world_buildings geometry into a neutral glTF-flavoured scene graph an external
// engine can ingest. Read-only.
//
// Registered from server.js: registerSceneBridgeMacros(register).

import { exportScene, sceneStats } from "../lib/scene-export.js";

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
}
