// server/lib/career-employers.js
//
// WAVE JOBS — employer discovery. Answers "which NPCs are hiring, at what
// track/tier, right now" so a player can ORIGINATE a contract offer from the
// careers lens instead of only responding to an offer a counterparty already
// made. This closes the genuine gap tracked in
// docs/lens-specs/careers-capability-map.md ("Originate a new contract offer
// to an NPC/employer from the lens itself") and docs/WAVE4_INVENTORY.md.
//
// READ-ONLY against world_npcs — no NPC behavior is created, scheduled, or
// changed here; this module never writes. An NPC's employer status for a
// track is DERIVED deterministically from its real, already-seeded
// `archetype` column (world_npcs.archetype — the exact column
// npc-economy.js's ARCHETYPE_GATHER_TARGETS reads for gather behavior) via
// the fixed archetype → track(s) table below, mirroring that established
// pattern (archetype → real behavior) but applied to the careers system's
// professional-trade axis instead of raw-resource gathering.
//
// Honesty rule: an archetype absent from ARCHETYPE_HIRES_FOR is NOT an
// employer for any track. We never guess a track for a persona that doesn't
// plausibly hire for one of the 12 professions.js TRACKS — a flavor
// archetype like "syndicate_matriarch" or "vampire_noble" is not silently
// turned into a "trader" just to pad the directory. That is why the mapping
// below only covers archetypes with a clear, defensible correspondence to a
// track's real activity (chef/medic/smith/guard/musician/detective/trader/
// mage/athlete/fighter/hacker/farmer) and leaves everything else unmapped.
//
// The NPC's OWN standing (world_npcs.level, a real column since migration
// 060) caps the tier it can plausibly offer — a level-3 guard captain isn't
// offering a tier-9 contract. tierOffered = clamp(ceil(level / 3), 1, 10):
// a coarse level→tier band consistent with professions.js's own 10-tier
// ladder spanning the level range, not an invented number.

import { TRACKS, isTrack, tierInfo } from "./professions.js";
import { npcNameFromRow } from "./npc-name.js";

export const ARCHETYPE_HIRES_FOR = Object.freeze({
  warrior: ["guard", "fighter"],
  soldier: ["guard", "fighter"],
  hunter: ["guard"],
  scholar: ["mage", "detective"],
  mystic: ["mage"],
  healer: ["medic"],
  priest: ["medic"],
  trader: ["trader"],
  broker: ["trader"],
  merchant: ["trader"],
  guard: ["guard"],
  farmer: ["farmer"],
  builder: ["smith"],
  miner: ["smith"],
  logger: ["smith"],
  engineer: ["smith", "hacker"],
  artisan: ["smith"],
  miller: ["chef"],
  fisher: ["chef"],
  cook: ["chef"],
  laborer: ["smith"],
  investigator: ["detective"],
  musician: ["musician"],
  performer: ["musician"],
});

/** The career track(s) an archetype plausibly hires for. Empty = not an employer. */
export function tracksForArchetype(archetype) {
  return ARCHETYPE_HIRES_FOR[String(archetype || "").toLowerCase()] || [];
}

function tierOffered(level) {
  const l = Math.max(1, Math.floor(Number(level) || 1));
  return Math.max(1, Math.min(10, Math.ceil(l / 3)));
}

/**
 * List NPCs in a world who plausibly employ for `trackId` (or, when omitted,
 * every track their archetype maps to). Pure read — never throws, never
 * writes; returns [] if world_npcs doesn't exist yet (a minimal/test build)
 * or the world has no matching NPCs.
 * @returns {Array<{npcId,name,archetype,faction,trackId,category,tier,tierTitle,suggestedWage,level,x,z}>}
 */
export function findEmployers(db, { worldId = "concordia-hub", trackId = null, limit = 30 } = {}) {
  if (!db) return [];
  if (trackId != null && !isTrack(trackId)) return [];
  const cap = Math.max(1, Math.min(100, Number(limit) || 30));

  let rows;
  try {
    rows = db.prepare(`
      SELECT id, archetype, faction, level, x, z, state
      FROM world_npcs
      WHERE world_id = ? AND COALESCE(is_dead, 0) = 0
      LIMIT 500
    `).all(worldId);
  } catch {
    return [];
  }

  const out = [];
  for (const row of rows) {
    const tracks = tracksForArchetype(row.archetype);
    if (tracks.length === 0) continue;
    const offeredTracks = trackId ? (tracks.includes(trackId) ? [trackId] : []) : tracks;
    if (offeredTracks.length === 0) continue;
    const tier = tierOffered(row.level);
    for (const tid of offeredTracks) {
      const info = tierInfo(tid, tier);
      out.push({
        npcId: row.id,
        name: npcNameFromRow(row),
        archetype: row.archetype,
        faction: row.faction || null,
        trackId: tid,
        category: TRACKS[tid]?.category || null,
        tier,
        tierTitle: info?.title || null,
        suggestedWage: info?.wageBase ?? null,
        level: Math.max(1, Math.floor(Number(row.level) || 1)),
        x: row.x ?? null,
        z: row.z ?? null,
      });
      if (out.length >= cap) return out;
    }
  }
  return out;
}
