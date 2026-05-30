// server/lib/npc-name.js
//
// Schema/query-drift fix: world_npcs has NO `name` column — the NPC name lives in
// the `state` JSON (npc-spawning.js writes JSON.stringify({ name, ... }) into it).
// Multiple sites did `SELECT name FROM world_npcs`, which throws at prepare. This
// is the canonical name derivation (mirrors routes/worlds.js: state.name ||
// archetype || a short-id label). Leaf module — no imports, no circular risk.

export function npcNameFromRow(row) {
  if (!row) return null;
  let name = null;
  try { name = JSON.parse(row.state || "{}")?.name; } catch { /* malformed state */ }
  return name || row.archetype || (row.id ? `${row.npc_type || "npc"}-${String(row.id).slice(0, 4)}` : "NPC");
}
