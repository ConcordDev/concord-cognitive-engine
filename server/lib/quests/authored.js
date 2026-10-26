// server/lib/quests/authored.js
//
// world_quests.authored (migration 491) marks the shared catalog quests from
// content/. The procedural lifecycle (TTL expiry, NPC claims, closing the row
// when one player finishes) must skip them. Older schemas have no column, so
// callers ask first and fall back to their original query.

const _known = new WeakMap();

export function hasAuthoredColumn(db) {
  if (!db) return false;
  if (_known.has(db)) return _known.get(db);
  let has = false;
  try { has = db.prepare("PRAGMA table_info(world_quests)").all().some((c) => c.name === "authored"); }
  catch { has = false; }
  // Cache only a positive answer: a DB migrated later in the process must be seen.
  if (has) _known.set(db, true);
  return has;
}
