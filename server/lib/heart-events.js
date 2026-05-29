// server/lib/heart-events.js
//
// H3 — affinity-milestone "heart events". Authored vignette scenes that fire
// once when a courtship's affinity crosses a milestone threshold (Stardew-
// pattern), plus the spouse-behavior helpers a wed NPC reads to follow/help/
// shift dialogue. Scenes are authored content (content/heart-events/), never
// LLM-generated, so the milestone beats are deterministic + secret-safe.

import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const HEART_EVENTS_ROOT = join(__dir, "../../content/heart-events");

let _scenes = null; // milestoneId → scene (lazy-loaded, sorted by threshold asc)

/** Load + cache authored heart-event scenes. Sorted ascending by threshold. */
export function loadHeartEvents() {
  if (_scenes) return _scenes;
  const byId = new Map();
  try {
    for (const fname of readdirSync(HEART_EVENTS_ROOT)) {
      if (!fname.endsWith(".json")) continue;
      const arr = JSON.parse(readFileSync(join(HEART_EVENTS_ROOT, fname), "utf8"));
      if (Array.isArray(arr)) {
        for (const s of arr) if (s?.milestoneId && typeof s.threshold === "number") byId.set(s.milestoneId, s);
      }
    }
  } catch { /* no heart-events dir — empty set */ }
  _scenes = [...byId.values()].sort((a, b) => a.threshold - b.threshold);
  return _scenes;
}

/** Test-only — drop the cache so a fresh load re-reads disk. */
export function _resetHeartEvents() { _scenes = null; }

/**
 * The milestone (if any) that an affinity transition prevAffinity→nextAffinity
 * newly crosses. Pure — does not touch the DB. Returns the scene or null.
 */
export function milestoneCrossed(prevAffinity, nextAffinity) {
  const scenes = loadHeartEvents();
  // The highest threshold strictly above prev and at-or-below next.
  let hit = null;
  for (const s of scenes) {
    if (s.threshold > prevAffinity && nextAffinity >= s.threshold) hit = s;
  }
  return hit;
}

function tableExists(db) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_heart_events_seen'").get(); }
  catch { return false; }
}

/**
 * Resolve + record a heart event for an affinity crossing. Returns the scene
 * to play (once), or null if no milestone crossed or it was already seen.
 */
export function checkHeartEvent(db, playerUserId, partnerKind, partnerId, prevAffinity, nextAffinity) {
  if (!db || !playerUserId || !partnerId || !tableExists(db)) return null;
  const scene = milestoneCrossed(prevAffinity, nextAffinity);
  if (!scene) return null;
  const already = db.prepare(`
    SELECT 1 FROM player_heart_events_seen
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ? AND milestone_id = ?
  `).get(playerUserId, partnerKind, partnerId, scene.milestoneId);
  if (already) return null;
  db.prepare(`
    INSERT INTO player_heart_events_seen (player_user_id, partner_kind, partner_id, milestone_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(playerUserId, partnerKind, partnerId, scene.milestoneId);
  return scene;
}

/** Heart events a player has already seen with a partner (HUD helper). */
export function seenHeartEvents(db, playerUserId, partnerKind, partnerId) {
  if (!db || !tableExists(db)) return [];
  return db.prepare(`
    SELECT milestone_id AS milestoneId, seen_at AS seenAt FROM player_heart_events_seen
    WHERE player_user_id = ? AND partner_kind = ? AND partner_id = ? ORDER BY seen_at ASC
  `).all(playerUserId, partnerKind, partnerId);
}

// ── Spouse behavior ────────────────────────────────────────────────────────
/** Is this NPC the player's (current, non-dissolved) spouse? */
export function isSpouse(db, playerUserId, npcId) {
  if (!db || !playerUserId || !npcId) return false;
  try {
    return !!db.prepare(`
      SELECT 1 FROM player_marriages
      WHERE player_user_id = ? AND partner_kind = 'npc' AND partner_id = ? AND dissolved_at IS NULL
    `).get(playerUserId, npcId);
  } catch { return false; }
}

/** The NPC ids currently wed to a player — the set that should follow/help. */
export function spousesFollowingPlayer(db, playerUserId) {
  if (!db || !playerUserId) return [];
  try {
    return db.prepare(`
      SELECT partner_id AS npcId FROM player_marriages
      WHERE player_user_id = ? AND partner_kind = 'npc' AND dissolved_at IS NULL
    `).all(playerUserId).map((r) => r.npcId);
  } catch { return []; }
}

/**
 * The dialogue phase a partner speaks in, shifted by relationship status. A
 * spouse speaks in the warmest register; the narrative bridge / dialogue path
 * passes this as the `phase` so a wed NPC's lines change.
 */
export function spouseDialoguePhase(db, playerUserId, npcId, baseAffinity = 0) {
  if (isSpouse(db, playerUserId, npcId)) return "devoted";
  if (baseAffinity >= 0.6) return "warm";
  if (baseAffinity < 0) return "cold";
  return "neutral";
}
