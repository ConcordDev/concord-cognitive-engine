// server/lib/npc-legacy.js
//
// Phase 5b — Death + Legacy.
//
// When an NPC dies, their interiority transfers to an heir or
// disperses across faction. Specifically:
//
//   - Last words composed deterministically from sha1(npc_id + cause)
//   - Legacy row written (tomb position = NPC's last known location)
//   - Grudges → most-related heir (children → faction-mates of same
//     archetype) so the killing player still has consequence
//   - Preoccupations (kind != 'faction_phase') → heir of any kind
//   - Desires (open status) → heir; offered desires expire
//   - Recipes (DTUs creator_id = deceased) → top heir's lineage via
//     citation marker (ownership of the DTU stays with the dead so
//     forgetting-engine retention works; the heir gets a citation)
//   - Wealth_sparks → split among heirs proportional to count
//
// Tomb dialogue is a separate authored surface — this module just
// records the legacy + inheritance links so the dialogue endpoint can
// read it and inject "you stand at Kael's tomb" into the prompt.

import crypto from "node:crypto";
import logger from "../logger.js";
import { inheritHooks } from "./hooks.js";
import { handleNpcDeathVacancy } from "./settlements.js";

// Living Society Phase 1.5c — open a settlement vacancy when a role-holder dies.
function _openSettlementVacancyOnDeath(db, npc, opts) {
  const killerId = opts.killerId || opts.killer_id || null;
  const killerKind = opts.killerKind || opts.killer_kind || (opts.killerType === "player" ? "player" : (killerId ? "npc" : null));
  if (!killerId && !npc.settlement_role) return;
  handleNpcDeathVacancy(db, npc, { killerId, killerKind });
}

// ── Last-words composer ─────────────────────────────────────────────────────

const LAST_WORDS_BY_CAUSE = {
  combat:    [
    "Tell my brother the lock was never broken.",
    "I should have refused.",
    "The grove. Plant something there.",
    "I leave nothing unsaid.",
    "Carry it for me.",
  ],
  ageing:    [
    "The river runs the same as the day I was born.",
    "I held what I could.",
    "Don't shorten the day to fit your grief.",
    "My oar is yours now.",
    "Every season was the right one.",
  ],
  starvation: [
    "Salt. We needed salt.",
    "The road was longer than I told them.",
    "I should have stayed.",
    "Plant herbs by the threshold.",
  ],
  refusal_dome: [
    "I refused, and I am refused.",
    "The dome rang true.",
    "Speak the count one more time.",
  ],
  unknown:   [
    "Something I forgot.",
    "Tell them I was here.",
    "I had more to say.",
  ],
};

export function composeLastWords(npc, cause = "unknown") {
  const pool = LAST_WORDS_BY_CAUSE[cause] || LAST_WORDS_BY_CAUSE.unknown;
  const seed = crypto.createHash("sha1").update(`${npc?.id || ""}|${cause}`).digest();
  return pool[seed[0] % pool.length];
}

// ── Heir discovery ──────────────────────────────────────────────────────────

/**
 * Find heirs for the deceased. Priority:
 *   1. Children (npc_relations parent links, if table exists)
 *   2. Faction-mates of same archetype (most "similar")
 *   3. Faction-mates of any archetype
 *   4. None (legacy still recorded but no inheritance)
 *
 * Returns up to 3 heirs.
 */
export function findHeirs(db, deceasedNpc) {
  if (!db || !deceasedNpc?.id) return [];
  const heirs = [];
  const seen = new Set();

  // Children — npc_relations table is best-effort.
  try {
    const children = db.prepare(`
      SELECT n.id, n.archetype, n.faction
      FROM npc_relations r
      JOIN world_npcs n ON n.id = r.npc_id
      WHERE r.related_to = ? AND r.relation_kind IN ('child', 'apprentice')
        AND COALESCE(n.is_dead, 0) = 0
      LIMIT 5
    `).all(deceasedNpc.id);
    for (const c of children) {
      if (!seen.has(c.id)) { heirs.push(c); seen.add(c.id); }
      if (heirs.length >= 3) return heirs;
    }
  } catch { /* table optional */ }

  // Same-faction same-archetype peers.
  if (deceasedNpc.faction) {
    try {
      const peers = db.prepare(`
        SELECT id, archetype, faction FROM world_npcs
        WHERE faction = ? AND archetype = ? AND id != ?
          AND COALESCE(is_dead, 0) = 0
        ORDER BY id LIMIT 3
      `).all(deceasedNpc.faction, deceasedNpc.archetype, deceasedNpc.id);
      for (const p of peers) {
        if (!seen.has(p.id)) { heirs.push(p); seen.add(p.id); }
        if (heirs.length >= 3) return heirs;
      }
    } catch { /* ignore */ }

    // Fallback to any faction-mate.
    try {
      const peers = db.prepare(`
        SELECT id, archetype, faction FROM world_npcs
        WHERE faction = ? AND id != ?
          AND COALESCE(is_dead, 0) = 0
        ORDER BY id LIMIT 3
      `).all(deceasedNpc.faction, deceasedNpc.id);
      for (const p of peers) {
        if (!seen.has(p.id)) { heirs.push(p); seen.add(p.id); }
        if (heirs.length >= 3) return heirs;
      }
    } catch { /* ignore */ }
  }

  return heirs;
}

// ── Inheritance helpers ─────────────────────────────────────────────────────

function inheritGrudges(db, deceased, heir) {
  if (!db || !deceased?.id || !heir?.id) return 0;
  let n = 0;
  try {
    const rows = db.prepare(`SELECT * FROM npc_grudges WHERE npc_id = ? AND resolved_at IS NULL`).all(deceased.id);
    for (const g of rows) {
      try {
        db.prepare(`
          INSERT INTO npc_grudges
            (id, npc_id, target_kind, target_id, narrative, severity, event_at)
          VALUES (?, ?, ?, ?, ?, ?, unixepoch())
        `).run(
          crypto.randomUUID(), heir.id, g.target_kind, g.target_id,
          `Inherited from the dead: ${g.narrative}`,
          Math.max(1, Math.min(10, (g.severity || 5) - 1)),  // grief softens severity
        );
        recordInheritanceLink(db, deceased.id, heir.id, "grudge", g.id);
        n++;
      } catch { /* per-row skip */ }
    }
  } catch { /* table optional */ }
  return n;
}

function inheritPreoccupations(db, deceased, heir) {
  if (!db || !deceased?.id || !heir?.id) return 0;
  let n = 0;
  try {
    const rows = db.prepare(`
      SELECT * FROM npc_preoccupations
      WHERE npc_id = ? AND fades_at IS NULL AND kind != 'faction_phase'
    `).all(deceased.id);
    for (const p of rows) {
      try {
        db.prepare(`
          INSERT INTO npc_preoccupations
            (id, npc_id, kind, source_id, narrative, established_at)
          VALUES (?, ?, ?, ?, ?, unixepoch())
        `).run(
          crypto.randomUUID(), heir.id, p.kind, p.source_id,
          `In their memory: ${p.narrative}`,
        );
        recordInheritanceLink(db, deceased.id, heir.id, "preoccupation", p.id);
        n++;
      } catch { /* per-row skip */ }
    }
  } catch { /* table optional */ }
  return n;
}

function inheritDesires(db, deceased, heir) {
  if (!db || !deceased?.id || !heir?.id) return 0;
  let n = 0;
  try {
    const rows = db.prepare(`
      SELECT * FROM npc_desires WHERE npc_id = ? AND status = 'open'
    `).all(deceased.id);
    for (const d of rows) {
      try {
        db.prepare(`
          INSERT INTO npc_desires
            (id, npc_id, target_archetype, narrative, completion_predicate_json, reward_kind, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'open', unixepoch())
        `).run(
          crypto.randomUUID(), heir.id, d.target_archetype,
          `Carrying the unfinished: ${d.narrative}`,
          d.completion_predicate_json, d.reward_kind || "opinion_shift",
        );
        recordInheritanceLink(db, deceased.id, heir.id, "desire", d.id);
        n++;
      } catch { /* per-row skip */ }
    }
  } catch { /* table optional */ }
  return n;
}

function inheritRecipes(db, deceased, heir) {
  // Recipes stay with the dead (DTU lineage invariant), but heirs receive
  // a citation so the royalty cascade pays the heir-line on derivative
  // works. We record the link only.
  if (!db || !deceased?.id || !heir?.id) return 0;
  let n = 0;
  try {
    const rows = db.prepare(`
      SELECT id FROM dtus
      WHERE creator_id = ? AND kind IN ('skill', 'spell_recipe', 'fighting_style_recipe', 'recipe')
    `).all(deceased.id);
    for (const r of rows) {
      recordInheritanceLink(db, deceased.id, heir.id, "recipe", r.id);
      n++;
    }
  } catch { /* dtus optional / not present in test */ }
  return n;
}

function inheritWealth(db, deceased, heirs) {
  if (!db || !deceased?.id || !Array.isArray(heirs) || heirs.length === 0) return 0;
  let total = 0;
  try {
    const row = db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id = ?`).get(deceased.id);
    total = Number(row?.wealth_sparks || 0);
  } catch { /* column optional */ }
  if (total <= 0) return 0;

  const share = Math.floor(total / heirs.length);
  if (share === 0) return 0;

  for (const heir of heirs) {
    try {
      db.prepare(`UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks, 0) + ? WHERE id = ?`).run(share, heir.id);
      recordInheritanceLink(db, deceased.id, heir.id, "wealth", null, JSON.stringify({ amount: share }));
    } catch { /* ignore */ }
  }
  // Zero the deceased's purse.
  try {
    db.prepare(`UPDATE world_npcs SET wealth_sparks = 0 WHERE id = ?`).run(deceased.id);
  } catch { /* ignore */ }
  return share * heirs.length;
}

function recordInheritanceLink(db, deceasedId, heirId, kind, sourceId, detailJson) {
  try {
    db.prepare(`
      INSERT INTO npc_inheritance_links
        (id, deceased_npc_id, heir_npc_id, inherited_kind, source_id, detail_json, inherited_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    `).run(
      `inh_${crypto.randomUUID()}`,
      deceasedId, heirId, kind,
      sourceId ?? null,
      detailJson ?? null,
    );
  } catch { /* table optional */ }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Main entry point — called by the death path (npc-consequences.js)
 * AFTER world_npcs.is_dead is set. Idempotent: a second call for the
 * same NPC is a no-op.
 *
 * Returns { ok, legacyId, heirs[], inherited: {grudge,preoc,desire,recipe,wealth} }.
 */
export function onNpcDeath(db, npc, opts = {}) {
  if (!db || !npc?.id) return { ok: false, reason: "no_npc" };

  // Idempotency: if a legacy row exists, return it.
  try {
    const existing = db.prepare(`SELECT id FROM npc_legacies WHERE npc_id = ?`).get(npc.id);
    if (existing) return { ok: true, action: "already_recorded", legacyId: existing.id };
  } catch { /* table optional */ }

  // Living Society Phase 1.5c — if the deceased held a settlement role, open a
  // vacancy (every role is load-bearing). Best-effort; never blocks the legacy.
  try {
    _openSettlementVacancyOnDeath(db, npc, opts);
  } catch { /* settlements optional */ }

  const cause = opts.cause || "unknown";
  const lastWords = composeLastWords(npc, cause);

  // Tomb position = NPC's last known location.
  let tombX = 0, tombZ = 0;
  try {
    const loc = typeof npc.current_location === "string"
      ? JSON.parse(npc.current_location || "{}")
      : (npc.current_location || {});
    tombX = Number(loc.x) || 0;
    tombZ = Number(loc.z) || 0;
  } catch { /* ignore */ }

  const legacyId = `lgcy_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO npc_legacies
        (id, npc_id, world_id, died_at, cause_of_death, last_words,
         tomb_x, tomb_z, faction, archetype)
      VALUES (?, ?, ?, unixepoch(), ?, ?, ?, ?, ?, ?)
    `).run(legacyId, npc.id, npc.world_id || "concordia-hub",
           cause, lastWords, tombX, tombZ,
           npc.faction || null, npc.archetype || null);
  } catch (err) {
    try { logger.warn?.("npc-legacy", "legacy_insert_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "legacy_insert_failed" };
  }

  const heirs = findHeirs(db, npc);
  const inherited = { grudge: 0, preoccupation: 0, desire: 0, recipe: 0, wealth: 0 };

  if (heirs.length > 0) {
    const primary = heirs[0];
    inherited.grudge        = inheritGrudges(db, npc, primary);
    inherited.preoccupation = inheritPreoccupations(db, npc, primary);
    inherited.desire        = inheritDesires(db, npc, primary);
    inherited.recipe        = inheritRecipes(db, npc, primary);
    inherited.wealth        = inheritWealth(db, npc, heirs);
    // D5 — hooks held over the deceased re-point to the heir; hooks the
    // deceased held pass to the heir. Synchronous + guarded (table-optional).
    try {
      const hres = inheritHooks(db, npc.id, primary.id);
      inherited.hooks = (hres?.transferredOver || 0) + (hres?.transferredHeld || 0);
    } catch { inherited.hooks = 0; }
  }

  return { ok: true, legacyId, heirs: heirs.map(h => h.id), inherited };
}

/**
 * Read the legacy for an NPC. Used by the dialogue endpoint to inject
 * "you stand at the tomb of {name}" + last words when the player
 * approaches a dead NPC's location.
 */
export function getLegacy(db, npcId) {
  if (!db || !npcId) return null;
  try {
    return db.prepare(`SELECT * FROM npc_legacies WHERE npc_id = ?`).get(npcId) || null;
  } catch { return null; }
}

/**
 * Tombs in a world for the rendering layer. Bounded.
 */
export function getTombsForWorld(db, worldId, limit = 200) {
  if (!db || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, npc_id, tomb_x, tomb_z, last_words, faction, archetype, died_at
      FROM npc_legacies
      WHERE world_id = ?
      ORDER BY died_at DESC LIMIT ?
    `).all(worldId, limit);
  } catch { return []; }
}

/**
 * Inheritance lineage for an heir (what did they inherit, from whom).
 */
export function getInheritanceForHeir(db, heirNpcId) {
  if (!db || !heirNpcId) return [];
  try {
    return db.prepare(`
      SELECT * FROM npc_inheritance_links
      WHERE heir_npc_id = ? ORDER BY inherited_at DESC LIMIT 50
    `).all(heirNpcId);
  } catch { return []; }
}

/**
 * T2.2 — outgoing inheritance from a deceased NPC: who inherited what when this
 * NPC died. Enriched with the heir's display name when world_npcs is present.
 * This is the other half of the cross-time thread the InheritanceLog renders
 * from a tomb's perspective ("their grudges/recipes passed to…").
 */
export function getInheritanceFromDeceased(db, deceasedNpcId) {
  if (!db || !deceasedNpcId) return [];
  try {
    return db.prepare(`
      SELECT l.*, n.name AS heir_name
      FROM npc_inheritance_links l
      LEFT JOIN world_npcs n ON n.id = l.heir_npc_id
      WHERE l.deceased_npc_id = ? ORDER BY l.inherited_at DESC LIMIT 50
    `).all(deceasedNpcId);
  } catch {
    // world_npcs may be absent on a minimal build — fall back without the join.
    try {
      return db.prepare(`
        SELECT * FROM npc_inheritance_links
        WHERE deceased_npc_id = ? ORDER BY inherited_at DESC LIMIT 50
      `).all(deceasedNpcId);
    } catch { return []; }
  }
}

export const _internal = {
  LAST_WORDS_BY_CAUSE,
  inheritGrudges,
  inheritPreoccupations,
  inheritDesires,
  inheritRecipes,
  inheritWealth,
  recordInheritanceLink,
};
