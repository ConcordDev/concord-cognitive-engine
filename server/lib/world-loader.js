// server/lib/world-loader.js
// Load and hydrate world records from the database.

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @returns {object|null}
 */
export function loadWorld(db, worldId) {
  const world = db.prepare("SELECT * FROM worlds WHERE id = ? AND status = 'active'").get(worldId);
  if (!world) return null;

  world.substrate_dtu_ids  = _parseJSON(world.substrate_dtu_ids,  []);
  world.physics_modulators = _parseJSON(world.physics_modulators, {});
  world.rule_modulators    = _parseJSON(world.rule_modulators,    {});


  const substrateDtus = db.prepare("SELECT * FROM world_substrate_dtus WHERE world_id = ?").all(worldId);
  world._substrateDtus = substrateDtus;

  return applyPhysicsModulators(applyRuleModulators(world, world.rule_modulators), world.physics_modulators);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {object[]}
 */
export function listWorlds(db) {
  const rows = db.prepare("SELECT * FROM worlds WHERE status = 'active' ORDER BY created_at ASC").all();
  return rows.map(w => ({
    ...w,
    substrate_dtu_ids:  _parseJSON(w.substrate_dtu_ids,  []),
    physics_modulators: _parseJSON(w.physics_modulators, {}),
    rule_modulators:    _parseJSON(w.rule_modulators,    {}),
  }));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @returns {string}
 */
export function getActiveWorldForPlayer(db, userId) {
  const row = db.prepare("SELECT world_id FROM player_world_state WHERE user_id = ?").get(userId);
  return row?.world_id || "concordia-hub";
}

/**
 * Merge physics override keys onto the base world object.
 * @param {object} world
 * @param {object} modulators
 * @returns {object}
 */
export function applyPhysicsModulators(world, modulators) {
  if (!modulators || !Object.keys(modulators).length) return world;
  return { ...world, _physics: modulators };
}

/**
 * Merge skill effectiveness rules into the world object.
 * @param {object} world
 * @param {object} modulators
 * @returns {object}
 */
export function applyRuleModulators(world, modulators) {
  if (!modulators || !Object.keys(modulators).length) return world;
  return { ...world, _rules: modulators };
}

function _parseJSON(val, fallback) {
  if (!val) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}
