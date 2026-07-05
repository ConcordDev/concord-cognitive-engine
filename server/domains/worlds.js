// server/domains/worlds.js
//
// Dead-macro-call fix (verification-audit campaign): LandmarkSpires.tsx's
// Tsushima-style "look at the spire" navigation UI called domain:'worlds',
// name:'anchors_for_world' — never registered anywhere, guaranteed
// unknown_macro (the component's own header comment even documents the
// contract it expected but nobody built). No authored per-world "spire"
// data exists (content/world/*/meta.json's "anchors" are Concord Link
// network access points — a different feature, no x/z positions) — so
// this wires to the real positional data that DOES exist: named,
// player-visible world_buildings, which is a faithful navigational
// landmark set, not a fabricated one.

export default function registerWorldsActions(registerLensAction) {
  registerLensAction("worlds", "anchors_for_world", (ctx, _artifact, params = {}) => {
    const worldId = String(params.worldId || "").trim();
    if (!worldId) return { ok: false, error: "worldId required" };
    if (!ctx?.db) return { ok: true, result: { anchors: [] } };

    const rows = ctx.db.prepare(`
      SELECT id, name, x, z, building_type, owner_type
      FROM world_buildings
      WHERE world_id = ? AND name IS NOT NULL AND state != 'collapsed'
      ORDER BY (is_seed = 1) DESC, height DESC
      LIMIT 40
    `).all(worldId);

    const anchors = rows.map((r) => ({
      id: r.id,
      name: r.name,
      x: r.x,
      z: r.z,
      kind: r.building_type,
    }));

    return { ok: true, result: { anchors } };
  });
}
