/**
 * Live NPCs for Unity / Godot world:snapshot.
 * Same rows GET /api/worlds/:worldId/npcs reads — presentation, not a second sim.
 * Missing tables return [] (honest empty), never fabricated citizens.
 */

function parseJson(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

export function listNpcsForGatewaySnapshot(db, worldId, { limit = 48 } = {}) {
  if (!db || typeof db.prepare !== "function" || !worldId) return [];
  const cap = Math.min(64, Math.max(1, Number(limit) || 48));
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT n.id, n.archetype, n.npc_type, n.faction, n.current_location, n.state,
             r.activity_kind AS routine_activity_kind
        FROM world_npcs n
        LEFT JOIN npc_routine_state r ON r.npc_id = n.id
       WHERE n.world_id = ? AND n.is_dead = 0
       ORDER BY n.created_at ASC
       LIMIT ?
    `).all(worldId, cap);
  } catch {
    try {
      rows = db.prepare(`
        SELECT id, archetype, npc_type, faction, current_location, state
          FROM world_npcs
         WHERE world_id = ? AND is_dead = 0
         LIMIT ?
      `).all(worldId, cap);
    } catch {
      return [];
    }
  }
  return rows.map((r) => {
    const state = parseJson(r.state, {});
    const loc = parseJson(r.current_location, { x: 0, y: 0, z: 0 });
    const x = Number(loc.x) || 0;
    const y = Number(loc.y) || 0;
    const z = Number(loc.z) || 0;
    const name = state.name || r.archetype || `${r.npc_type || "npc"}-${String(r.id || "").slice(0, 4)}`;
    const title = state.occupation || r.archetype || r.npc_type || "citizen";
    return {
      id: r.id,
      name,
      title,
      faction: r.faction || null,
      activity: r.routine_activity_kind || state.currentActivity || null,
      x, y, z,
    };
  });
}
