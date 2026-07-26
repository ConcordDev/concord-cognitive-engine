// server/lib/sovereign-spells.js
//
// sovereign-ruins bespoke mechanic — "Still-Running Spells".
//
// Grounded in authored lore (see migration 392 for the full citation):
// The Sovereign Ruins is defined by spells cast before the Refusal
// Cascade that never stopped casting. The Spell Spirits faction's
// entire goal is "Complete every spell that was cast before the
// Cascade. Some have been completing for 200+ years." (factions.json).
// The Long Summons spirit has called a dead recipient's name once per
// diurnal for 187 annums, and would accelerate to completion within an
// hour if a player told it the recipient is dead (npcs.json). Iby the
// Spell-Reader's whole profession is identifying these sites before
// they're safe to touch ("This one is a binding. Older than you. Walk
// around it.") and the Scavenger Crews' defining fear is "a still-
// running spell that locks them in" (factions.json). The Archivists'
// stated goal — "Catalog every Refusal that has ever been written into
// the Sovereign Archive" — is the payoff loop: cataloguing a site earns
// memory_shards, this world's own named currency (meta.json
// primary_currencies) that no prior code ever wired up.
//
// The mechanic, end to end:
//   1. READ a site — a real refusal_glyph_reading skill check against
//      user_skills. Success reveals spell_kind/age/stability and nudges
//      stability down (observation moves it toward completion, per the
//      "aware spirits have begun to wonder whether completion is a
//      release or a death" framing). Failure is HONEST: revealed:false
//      with the required/actual level, never a fabricated reveal.
//   2. CATALOGUE a site — the Archivists' goal. Requires the caller to
//      have genuinely read it first. Awards memory_shards, marks the
//      site permanently 'catalogued' (no further completion).
//   3. COMPLETE a 'summons' site — the Long Summons's own mechanic.
//      Requires a prior read. Completes either once stability has
//      decayed under the floor from repeated reads, OR immediately if
//      the caller explicitly acknowledges the recipient is dead (the
//      literal lore mechanic). Marks the site permanently 'dissipated'.
//
// Honest-by-construction: every branch that isn't a genuine success
// returns an explicit ok:false / revealed:false reason. No fabricated
// reveal, no fabricated shard grant, no fabricated completion.

import crypto from "node:crypto";

export const SOVEREIGN_RUINS_WORLD_ID = "sovereign-ruins";
export const SPELL_KINDS = Object.freeze(["binding", "summons", "blessing", "curse"]);

const SKILL_ID = "refusal_glyph_reading";
const READ_STABILITY_DECAY = 0.05;
const COMPLETION_STABILITY_FLOOR = 0.15;
const CATALOGUE_SHARDS_BASE = 10;

function getSkillLevel(db, userId, skillId) {
  try {
    const row = db.prepare(`SELECT level FROM user_skills WHERE user_id = ? AND skill_id = ?`).get(userId, skillId);
    return row?.level ?? 0;
  } catch {
    // user_skills missing on a minimal build — degrade honestly to
    // "unskilled" rather than fabricating a pass.
    return 0;
  }
}

/**
 * Seed a still-running spell site. Deterministic identity lives with
 * the caller (content-seeder / admin tooling) — this just persists it.
 */
export function seedSite(db, { worldId = SOVEREIGN_RUINS_WORLD_ID, district, spellKind, ageAnnums = 0, difficulty = 1, x = 0, z = 0 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== SOVEREIGN_RUINS_WORLD_ID) return { ok: false, reason: "not_sovereign_ruins" };
  if (!district) return { ok: false, reason: "missing_district" };
  if (!SPELL_KINDS.includes(spellKind)) return { ok: false, reason: "bad_spell_kind" };

  const id = `srs_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO sovereign_spell_sites
      (id, world_id, district, spell_kind, age_annums, difficulty, stability, status, x, z)
    VALUES (?, ?, ?, ?, ?, ?, 1.0, 'active', ?, ?)
  `).run(id, worldId, district, spellKind, Math.max(0, Number(ageAnnums) || 0), Math.max(1, Number(difficulty) || 1), Number(x) || 0, Number(z) || 0);

  return { ok: true, siteId: id };
}

/**
 * List sites in a world. Deliberately withholds spell_kind/stability/
 * difficulty for every site — listing is not reading. That gate is
 * Iby's whole profession; only readSite() reveals them.
 */
export function listSites(db, { worldId = SOVEREIGN_RUINS_WORLD_ID } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== SOVEREIGN_RUINS_WORLD_ID) return { ok: false, reason: "not_sovereign_ruins" };

  const rows = db.prepare(`
    SELECT id, district, status, age_annums, x, z
    FROM sovereign_spell_sites WHERE world_id = ? ORDER BY created_at ASC
  `).all(worldId);

  return { ok: true, sites: rows };
}

function hasReadSite(db, siteId, userId) {
  const row = db.prepare(`
    SELECT 1 FROM sovereign_spell_reads WHERE site_id = ? AND user_id = ? AND revealed = 1 LIMIT 1
  `).get(siteId, userId);
  return !!row;
}

/**
 * Attempt to read a still-running spell site's true nature. Real
 * skill-gated: succeeds only when the caller's refusal_glyph_reading
 * level meets the site's difficulty. Every read (success or failure)
 * is logged; a successful read nudges stability down slightly.
 */
export function readSite(db, { worldId = SOVEREIGN_RUINS_WORLD_ID, userId, siteId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== SOVEREIGN_RUINS_WORLD_ID) return { ok: false, reason: "not_sovereign_ruins" };
  if (!userId) return { ok: false, reason: "no_actor" };

  const site = db.prepare(`SELECT * FROM sovereign_spell_sites WHERE id = ? AND world_id = ?`).get(siteId, worldId);
  if (!site) return { ok: false, reason: "site_not_found" };
  if (site.status !== "active") return { ok: false, reason: "site_not_active", status: site.status };

  const level = getSkillLevel(db, userId, SKILL_ID);
  const logId = `ssr_${crypto.randomUUID()}`;

  if (level < site.difficulty) {
    db.prepare(`
      INSERT INTO sovereign_spell_reads (id, site_id, user_id, revealed, shards_awarded, action)
      VALUES (?, ?, ?, 0, 0, 'read')
    `).run(logId, siteId, userId);
    return { ok: true, revealed: false, reason: "insufficient_skill", requiredLevel: site.difficulty, yourLevel: level };
  }

  const newStability = Math.max(0, Math.round((site.stability - READ_STABILITY_DECAY) * 100) / 100);
  db.prepare(`UPDATE sovereign_spell_sites SET stability = ? WHERE id = ?`).run(newStability, siteId);
  db.prepare(`
    INSERT INTO sovereign_spell_reads (id, site_id, user_id, revealed, shards_awarded, action)
    VALUES (?, ?, ?, 1, 0, 'read')
  `).run(logId, siteId, userId);

  return {
    ok: true,
    revealed: true,
    spellKind: site.spell_kind,
    ageAnnums: site.age_annums,
    stability: newStability,
  };
}

/**
 * The Archivists' goal made real: catalogue a site into the Sovereign
 * Archive. Requires the caller to have genuinely read it first (a real
 * precondition, never bypassable). Awards memory_shards and closes the
 * site off from further completion.
 */
export function catalogueSite(db, { worldId = SOVEREIGN_RUINS_WORLD_ID, userId, siteId } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== SOVEREIGN_RUINS_WORLD_ID) return { ok: false, reason: "not_sovereign_ruins" };
  if (!userId) return { ok: false, reason: "no_actor" };

  const site = db.prepare(`SELECT * FROM sovereign_spell_sites WHERE id = ? AND world_id = ?`).get(siteId, worldId);
  if (!site) return { ok: false, reason: "site_not_found" };
  if (site.status === "catalogued") return { ok: false, reason: "already_catalogued" };
  if (site.status === "dissipated") return { ok: false, reason: "site_dissipated" };
  if (!hasReadSite(db, siteId, userId)) return { ok: false, reason: "not_yet_read" };

  const shardsAwarded = CATALOGUE_SHARDS_BASE + Math.round(site.age_annums / 20);
  db.prepare(`UPDATE sovereign_spell_sites SET status = 'catalogued' WHERE id = ?`).run(siteId);
  const logId = `ssr_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO sovereign_spell_reads (id, site_id, user_id, revealed, shards_awarded, action)
    VALUES (?, ?, ?, 1, ?, 'catalogue')
  `).run(logId, siteId, userId, shardsAwarded);

  return { ok: true, shardsAwarded, status: "catalogued" };
}

/**
 * The Long Summons's own mechanic, generalised to every 'summons'
 * site: complete it once stability has decayed under the floor from
 * repeated observation, OR immediately if the caller explicitly
 * acknowledges the recipient is dead — exactly the lore's "If a player
 * tells it the recipient is dead, it accelerates the completion to
 * within an hour." Non-summons sites can never be completed this way
 * (a blessing/binding/curse doesn't have a "recipient" to answer for).
 */
export function completeSite(db, { worldId = SOVEREIGN_RUINS_WORLD_ID, userId, siteId, acknowledgeRecipientDead = false } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (worldId !== SOVEREIGN_RUINS_WORLD_ID) return { ok: false, reason: "not_sovereign_ruins" };
  if (!userId) return { ok: false, reason: "no_actor" };

  const site = db.prepare(`SELECT * FROM sovereign_spell_sites WHERE id = ? AND world_id = ?`).get(siteId, worldId);
  if (!site) return { ok: false, reason: "site_not_found" };
  if (site.spell_kind !== "summons") return { ok: false, reason: "not_a_summons" };
  if (site.status !== "active") return { ok: false, reason: "site_not_active", status: site.status };
  if (!hasReadSite(db, siteId, userId)) return { ok: false, reason: "not_yet_read" };

  const canComplete = acknowledgeRecipientDead === true || site.stability <= COMPLETION_STABILITY_FLOOR;
  if (!canComplete) {
    return { ok: false, reason: "still_stable", stability: site.stability, floor: COMPLETION_STABILITY_FLOOR };
  }

  db.prepare(`UPDATE sovereign_spell_sites SET status = 'dissipated', stability = 0, dissipated_at = unixepoch() WHERE id = ?`).run(siteId);
  const shardsAwarded = CATALOGUE_SHARDS_BASE * 2 + Math.round(site.age_annums / 10);
  const logId = `ssr_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO sovereign_spell_reads (id, site_id, user_id, revealed, shards_awarded, action)
    VALUES (?, ?, ?, 1, ?, 'complete')
  `).run(logId, siteId, userId, shardsAwarded);

  return { ok: true, shardsAwarded, status: "dissipated", acceleratedByAcknowledgement: acknowledgeRecipientDead === true };
}

/** Total memory_shards a user has earned across every read/catalogue/complete action. */
export function totalShardsEarned(db, { userId } = {}) {
  if (!db || !userId) return 0;
  const row = db.prepare(`SELECT COALESCE(SUM(shards_awarded), 0) AS total FROM sovereign_spell_reads WHERE user_id = ?`).get(userId);
  return row?.total ?? 0;
}
