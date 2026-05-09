// server/lib/world-emergents.js
// Cross-world emergent specialization — spawning, affinity tracking, Cipher-tier detection.

import crypto from "crypto";

/**
 * Spawn an emergent whose identity is seeded from a world's substrate DTUs.
 * Inserts into the emergents table (if it exists) and world_emergent_affinity.
 *
 * @param {string} worldId
 * @param {import('better-sqlite3').Database} db
 * @param {Function} selectBrain
 * @returns {Promise<object|null>}
 */
export async function spawnWorldNativeEmergent(worldId, db, selectBrain) {
  let identity;

  try {
    const { handle } = await selectBrain("subconscious", {
      brainOverride: "subconscious",
      callerId: "world:spawn-emergent",
    });

    // TODO: project explicit columns (auto-fix suggestion)

    const world = db.prepare("SELECT * FROM worlds WHERE id = ?").get(worldId);
    const prompt = `Generate a world-native emergent entity for this world:
World: ${world?.name || worldId}
Universe type: ${world?.universe_type || "unknown"}
Description: ${world?.description || ""}

Return JSON:
{
  "name": "<emergent name>",
  "archetype": "<archetype>",
  "personality": "<2 sentences>",
  "specializations": ["<tag1>", "<tag2>"]
}`;

    const raw   = await handle.generate(prompt);
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) identity = JSON.parse(match[0]);
  } catch (_e) {
    identity = {
      name:            `${worldId}-guardian`,
      archetype:       "guardian",
      personality:     "A silent watcher of this world.",
      specializations: [],
    };
  }

  const emergentId = crypto.randomUUID();

  // Insert into emergents table if it exists
  try {
    db.prepare(`
      INSERT INTO emergents (id, name, archetype, personality_json, world_id, created_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(
      emergentId,
      identity.name,
      identity.archetype,
      JSON.stringify({ personality: identity.personality }),
      worldId,
    );
  } catch (_e) {
    // emergents table may have different schema — non-fatal
  }

  db.prepare(`
    INSERT OR REPLACE INTO world_emergent_affinity
      (emergent_id, world_id, affinity_level, specialization_tags, active_since)
    VALUES (?, ?, 1.0, ?, unixepoch())
  `).run(emergentId, worldId, JSON.stringify(identity.specializations || []));

  return { id: emergentId, worldId, ...identity };
}

/**
 * Return emergents with affinity across 3+ worlds — the Cipher-tier observers.
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getCrossWorldEmergents(db) {
  return db.prepare(`
    SELECT emergent_id, COUNT(DISTINCT world_id) as world_count,
           GROUP_CONCAT(world_id) as worlds
    FROM world_emergent_affinity
    GROUP BY emergent_id
    HAVING world_count >= 3
  `).all();
}

/**
 * Return emergents native to or active in a specific world.
 * @param {string} worldId
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function getWorldEmergents(worldId, db) {
  return db.prepare(`
    SELECT wea.*, wea.specialization_tags
    FROM world_emergent_affinity wea
    WHERE wea.world_id = ?
    ORDER BY wea.affinity_level DESC
  `).all(worldId).map(r => ({
    ...r,
    specialization_tags: _tryParseJSON(r.specialization_tags, []),
  }));
}

/**
 * Grow an emergent's affinity with a world (called when it acts there).
 * @param {string} emergentId
 * @param {string} worldId
 * @param {number} delta
 * @param {import('better-sqlite3').Database} db
 */
export function growAffinity(emergentId, worldId, delta, db) {
  db.prepare(`
    INSERT INTO world_emergent_affinity (emergent_id, world_id, affinity_level, specialization_tags)
    VALUES (?, ?, ?, '[]')
    ON CONFLICT(emergent_id, world_id) DO UPDATE SET
      affinity_level = affinity_level + excluded.affinity_level
  `).run(emergentId, worldId, delta);
}

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
