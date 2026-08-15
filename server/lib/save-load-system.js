// server/lib/save-load-system.js
//
// Save/load player state: position, inventory, quests, divinity alignment.
// Persisted to /opt/concord-saves/*.json (one file per player).
//
// PlayerSave shape (loose, JSDoc only):
//   { version, playerId, timestamp,
//     position: { worldId, x, y, z, rotation },
//     inventory: [ { itemId, quantity, equipped } ],
//     quests: [ { questId, stage, completed } ],
//     divinity: { sovereign, witness, champion },
//     factionRep: { [factionId]: number },
//     skills: [ { skillId, level, xp } ],
//     stats: { hp, maxHp, energy, ... } }

import { promises as fs } from 'fs';
import path from 'path';

const SAVE_DIR = '/opt/concord-saves';
const SAVE_VERSION = 1;

/**
 * Save the player state to disk.
 */
export async function savePlayer(playerId, state) {
  await fs.mkdir(SAVE_DIR, { recursive: true });
  const save = {
    ...state,
    version: SAVE_VERSION,
    playerId,
    timestamp: Date.now(),
  };
  const filePath = path.join(SAVE_DIR, `${playerId}.json`);
  const json = JSON.stringify(save, null, 2);
  await fs.writeFile(filePath, json, 'utf-8');
  return { path: filePath, size: json.length };
}

/**
 * Load the player state from disk.
 */
export async function loadPlayer(playerId) {
  const filePath = path.join(SAVE_DIR, `${playerId}.json`);
  try {
    const json = await fs.readFile(filePath, 'utf-8');
    const save = JSON.parse(json);
    if (save.version !== SAVE_VERSION) {
      console.warn(`save version mismatch for ${playerId}: ${save.version} !== ${SAVE_VERSION}, attempting migration`);
      return migrateSave(save);
    }
    return save;
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Delete a save file.
 */
export async function deletePlayerSave(playerId) {
  const filePath = path.join(SAVE_DIR, `${playerId}.json`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Migrate an older save to current version.
 */
function migrateSave(save) {
  return { ...save, version: SAVE_VERSION };
}

/**
 * Auto-save every N seconds during gameplay.
 * Returns the timer handle — caller should pass it to stopAutoSave on cleanup.
 */
export function startAutoSave(getPlayerState, playerId, intervalMs = 30000) {
  /* @drift-ok: caller owns lifecycle via the returned handle */
  return setInterval(async () => {
    try {
      const state = getPlayerState();
      await savePlayer(playerId, state);
    } catch (e) {
      console.error('auto-save failed:', e);
    }
  }, intervalMs);
}

/**
 * Stop the auto-save timer started by startAutoSave().
 * Idempotent — safe to call with null/undefined.
 */
export function stopAutoSave(handle) {
  if (handle && typeof handle._onTimeout === 'function') {
    clearInterval(handle);
    return true;
  }
  return false;
}

export default { savePlayer, loadPlayer, deletePlayerSave, startAutoSave, stopAutoSave };
