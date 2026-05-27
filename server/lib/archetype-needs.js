// server/lib/archetype-needs.js
//
// Phase H — computes per-faction archetype demand based on recent world
// activity. Powers the population cycle's spawn-bias.
//
// Reads the last 24h of:
//   - damage_events     → demand for warrior + guard + healer
//   - economy_flows     → demand for trader + scholar (intel)
//   - npc_conversations → demand for mystic + scholar
//   - npc_schemes       → demand for hunter + scholar
//
// Returns deltas. Positive = under-represented, negative = over-represented.

const ARCHETYPES = ["warrior", "scholar", "trader", "mystic", "guard", "healer", "hunter"];

/**
 * @param {object} db - better-sqlite3 handle
 * @param {string} worldId
 * @param {string} factionId
 * @returns {Record<string, number>} archetype → delta (positive = needed)
 */
export function getArchetypeNeeds(db, worldId, factionId) {
  const needs = {};
  for (const a of ARCHETYPES) needs[a] = 0;
  if (!db || !worldId || !factionId) return needs;

  const windowSecs = Number(process.env.CONCORD_ARCHETYPE_NEEDS_WINDOW_S) || 86400;
  const since = Math.floor(Date.now() / 1000) - windowSecs;

  // 1. Combat pressure → warriors + guards + healers in demand.
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM damage_events
      WHERE COALESCE(world_id, '') = ? AND COALESCE(occurred_at, 0) >= ?
    `).get(worldId, since);
    const combat = Number(r?.n) || 0;
    if (combat > 20) {
      needs.warrior += 2;
      needs.guard   += 1;
      needs.healer  += 2;
    } else if (combat < 3) {
      needs.warrior -= 1;
    }
  } catch { /* table optional in minimal builds */ }

  // 2. Economy flow → traders + scholars in demand.
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM economy_flows
      WHERE world_id = ? AND faction = ? AND ts >= ?
    `).get(worldId, factionId, since);
    const flows = Number(r?.n) || 0;
    if (flows > 30) {
      needs.trader  += 2;
      needs.scholar += 1;
    } else if (flows < 5) {
      needs.trader -= 1;
    }
  } catch { /* table shape may differ */ }

  // 3. Conversation density → mystics + scholars.
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM npc_conversations
      WHERE world_id = ? AND started_at >= ?
    `).get(worldId, since);
    const conv = Number(r?.n) || 0;
    if (conv > 15) {
      needs.mystic  += 1;
      needs.scholar += 1;
    }
  } catch { /* table optional */ }

  // 4. Active schemes → hunters + scholars.
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n FROM npc_schemes
      WHERE world_id = ? AND status = 'active'
    `).get(worldId);
    const schemes = Number(r?.n) || 0;
    if (schemes > 8) {
      needs.hunter  += 2;
      needs.scholar += 1;
    }
  } catch { /* table optional */ }

  return needs;
}

export const ARCHETYPE_LIST = ARCHETYPES;
