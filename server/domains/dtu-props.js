// server/domains/dtu-props.js
//
// Master-spec §3.3 (units B6-B9) — DTUs as tangible interactive world props.
//
// Macros only — see server/lib/dtu-props.js for the model + governance rules
// this thinly wraps. Frontend/Godot reach these via POST /api/lens/run with
// { domain: "dtu_props", name: "list" | "interact", input }.
//
// STATUS (honest — read before assuming this is live): this file is
// registered here but, per the audit performed while building this unit,
// server.js imports+invokes only 172 of the 409 files under server/domains/
// — registration is NOT automatic by directory presence (confirmed by grep;
// several other domain files, e.g. domains/personas.js, are in the same
// unwired state despite doc claims elsewhere). To make these two macros
// reachable at runtime, an orchestrator must add, near the existing
// `import registerDiscoveryMacros from "./domains/discovery.js"` /
// `registerDiscoveryMacros(register);` pair in server.js:
//
//   import registerDtuPropsMacros from "./domains/dtu-props.js";
//   registerDtuPropsMacros(register);
//
// That two-line addition was deliberately NOT made by this unit — server.js
// was under concurrent edit by other units in this session (see the unit's
// final report) and this file's own contract tests exercise the macros
// directly via `register()`, independent of server.js wiring. This mirrors
// docs/GODOT_INTEGRATION.md's Phase-1 "built, NOT mounted" precedent.

import {
  propPlacementsForWorld,
  interactWithProp,
} from "../lib/dtu-props.js";

export default function registerDtuPropsMacros(register) {
  register("dtu_props", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || input.world_id;
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    return propPlacementsForWorld(db, String(worldId), {
      buildingId: input.buildingId || input.building_id || null,
      requesterId: ctx?.actor?.userId && ctx.actor.userId !== "anon" ? ctx.actor.userId : null,
      limit: input.limit,
    });
  }, { note: "list DTU-prop placements for a world/building; public-read, per-row visibility filtered (same rule as discovery.search)" });

  register("dtu_props", "interact", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const dtuId = input.dtuId || input.dtu_id;
    const action = input.action;
    if (!dtuId) return { ok: false, reason: "missing_dtu_id" };
    if (!["inspect", "take", "leave", "arrange"].includes(action)) {
      return { ok: false, reason: "invalid_action" };
    }
    const userId = ctx?.actor?.userId && ctx.actor.userId !== "anon" ? ctx.actor.userId : null;
    if (action !== "inspect" && !userId) return { ok: false, reason: "auth_required" };
    return interactWithProp(db, userId, String(dtuId), action, { placement: input.placement });
  }, { note: "inspect/take/leave/arrange a DTU world-prop — routes through canInteract governance + the real citation/ownership macros, never a fabricated mutation path" });
}
