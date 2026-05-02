// server/lib/quest-archetype-bias.js
// Wave 1 deferral 9 — per-user variety bias for quest emergence.
//
// When the scheduler at server.js generates a quest for a user (Phase 3 wired
// the recipient mapping via cityPresence.getUserIdsInCity), this module:
//   1. recordArchetypeSeen(db, userId, archetype) — increments the counter
//   2. selectArchetypeWithBias(db, userId, candidates) — given a list of
//      candidate archetypes, returns one weighted INVERSELY to seen_count
//      so unseen / less-seen archetypes win more often.
//
// The bias is gentle (sqrt-decay) so a player still sees variety within a
// type they enjoy — not "you saw 'rescue' once, you'll never see it again."

/**
 * Increment the seen_count for (userId, archetype). Called when a quest is
 * delivered to a user via Phase 3's quest:new push.
 */
export function recordArchetypeSeen(db, userId, archetype) {
  if (!db || !userId || !archetype) return;
  try {
    db.prepare(`
      INSERT INTO user_quest_archetypes (user_id, archetype, seen_count, last_seen_at)
      VALUES (?, ?, 1, unixepoch())
      ON CONFLICT(user_id, archetype) DO UPDATE SET
        seen_count   = seen_count + 1,
        last_seen_at = unixepoch()
    `).run(userId, archetype);
  } catch { /* non-fatal */ }
}

/**
 * Pick one archetype from `candidates` weighted inversely to how many
 * times the user has seen each. Unseen archetypes get the highest weight.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string[]} candidates  archetype names to choose between
 * @returns {string|null}
 */
export function selectArchetypeWithBias(db, userId, candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!db || !userId) return candidates[Math.floor(Math.random() * candidates.length)];

  // Look up seen counts for all candidates in one query.
  const placeholders = candidates.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT archetype, seen_count FROM user_quest_archetypes
     WHERE user_id = ? AND archetype IN (${placeholders})
  `).all(userId, ...candidates);
  const seenMap = new Map(rows.map((r) => [r.archetype, r.seen_count]));

  // Weight: 1 / sqrt(1 + seen_count). Unseen → 1.0, seen-once → 0.707,
  // seen-9-times → 0.316. Gentle but real bias.
  const weights = candidates.map((a) => {
    const n = seenMap.get(a) ?? 0;
    return 1 / Math.sqrt(1 + n);
  });

  // Weighted random pick.
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/**
 * Convenience: extract the archetype from a quest emergence context.
 * The current quest-emergence code uses `need` ('purpose' | 'social' | etc)
 * as the closest analog. If a future schema adds an explicit `archetype`
 * field, this is the place to switch.
 */
export function archetypeFor(npc, need) {
  if (need) return `need:${need}`;
  if (npc?.archetype) return `npc:${npc.archetype}`;
  return "default";
}
