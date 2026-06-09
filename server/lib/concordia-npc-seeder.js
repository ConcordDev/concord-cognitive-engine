// server/lib/concordia-npc-seeder.js
//
// Concordia bootstrap pass — for every authored NPC, populate the
// Phase 2 / 3 / 12 / 13 substrate tables (npc_ancestry, actor_physique,
// actor_culture, npc_ages) so the calculation paths in combat / dialogue
// / dynasty get real values instead of defaults.
//
// Deterministic per-npc_id mapping (sha1) so re-seeding doesn't flap.
// Idempotent — uses ON CONFLICT DO UPDATE on the underlying tables.

import crypto from "node:crypto";

// Map authored faction_id → primary bloodline. Falls back to a sha1-
// derived bucket so unknown factions don't break.
const FACTION_TO_BLOODLINE = {
  // Tunyan core
  dinye: "dinye", aekon: "aekon", asbir: "asbir",
  fluxom: "fluxom", akeia: "akeia", nil: "tunyan_pure",
  sangree: "sangree", kree: "kree", medici: "medici", sahm: "sahm",
  // Cross-world fall-through — every faction without a Tunyan match
  // gets sah/sahm as the default (precision-bloodline) so combat path
  // resolves.
  scholars_guild: "sahm", wardens: "iron_warden", merchant_collective: "sahm",
  bahiij: "tunyan_pure",
  // Concordia Web (cyber/crime/fantasy/superhero/sovereign-ruins/
  // lattice-crucible / concord-link-frontier — any with no mapping
  // falls through to defaultBloodline()
};

const KNOWN_BLOODLINES = ["sanguire", "medici", "sahm", "iron_warden", "akeia", "kree", "asbir", "dinye", "aekon", "fluxom"];

function deterministicHash(id, salt = "") {
  return crypto.createHash("sha1").update(`${id}::${salt}`).digest();
}

function defaultBloodline(npcId) {
  const h = deterministicHash(npcId, "bloodline");
  return KNOWN_BLOODLINES[h[0] % KNOWN_BLOODLINES.length];
}

function bloodlineFor(npc) {
  const f = npc?.faction || npc?.faction_id;
  if (f && FACTION_TO_BLOODLINE[f]) return FACTION_TO_BLOODLINE[f];
  return defaultBloodline(npc.id);
}

function dilutionFor(npcId) {
  // Conscious / authored majors get pure ancestry; minor NPCs get
  // varying dilution based on sha1.
  const h = deterministicHash(npcId, "dilution");
  return Math.max(0.05, Math.min(0.85, h[1] / 256 * 0.8 + 0.05));
}

// Map archetype → body-type / mass band. Defaults to average (75 kg).
const ARCHETYPE_TO_BODY = {
  warrior:  { body_type: "stocky",  mass_kg: 92, height_m: 1.82 },
  guard:    { body_type: "stocky",  mass_kg: 88, height_m: 1.80 },
  hunter:   { body_type: "slim",    mass_kg: 68, height_m: 1.75 },
  scholar:  { body_type: "slim",    mass_kg: 65, height_m: 1.72 },
  mystic:   { body_type: "tall",    mass_kg: 70, height_m: 1.84 },
  healer:   { body_type: "average", mass_kg: 70, height_m: 1.74 },
  trader:   { body_type: "average", mass_kg: 78, height_m: 1.76 },
  noble:    { body_type: "tall",    mass_kg: 76, height_m: 1.83 },
  default:  { body_type: "average", mass_kg: 75, height_m: 1.75 },
};

function physiqueFor(npc) {
  const arch = npc?.archetype || "default";
  const base = ARCHETYPE_TO_BODY[arch] || ARCHETYPE_TO_BODY.default;
  // Add a deterministic ±10% variance per npc_id.
  const h = deterministicHash(npc.id, "physique");
  const variance = (h[2] / 256 - 0.5) * 0.2;
  return {
    body_type: base.body_type,
    mass_kg: Math.round(base.mass_kg * (1 + variance) * 10) / 10,
    height_m: Math.round(base.height_m * (1 + variance * 0.5) * 100) / 100,
  };
}

function cultureFor(npc) {
  const f = npc?.faction || npc?.faction_id;
  // Map faction to culture_id (same naming for Tunyan factions).
  if (f && FACTION_TO_BLOODLINE[f]) {
    const bl = FACTION_TO_BLOODLINE[f];
    return { culture_id: bl, faith_id: null };
  }
  return { culture_id: "tunyan_pure", faith_id: null };
}

function birthDayFor(npc, archetype, currentDay) {
  // Conscious majors should already exist at game start — age them.
  const h = deterministicHash(npc.id, "age");
  // Sample 20..60 years old at start.
  const ageYears = 20 + (h[3] / 256) * 40;
  return Math.floor(currentDay - ageYears * 42);
}

/**
 * Seed all Phase 2/3/12/13 tables for the authored NPC roster.
 * Returns { ok, seeded: { ancestry, physique, culture, age }, errors }.
 */
export async function seedConcordiaNpcSubstrate(db, { currentConcordiaDay = 0 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };

  let getAllAuthoredNPCs;
  try {
    const cs = await import("./content-seeder.js");
    getAllAuthoredNPCs = cs.getAllAuthoredNPCs;
  } catch { return { ok: false, reason: "content_seeder_unavailable" }; }
  if (typeof getAllAuthoredNPCs !== "function") return { ok: false, reason: "no_authored_registry" };

  const npcs = getAllAuthoredNPCs();
  let ancestryN = 0, physiqueN = 0, cultureN = 0, ageN = 0, errors = 0;

  // Hoisted constant-SQL statements reused across the bounded NPC seed loop.
  const upsertAncestry = db.prepare(`
        INSERT INTO npc_ancestry (npc_id, primary_bloodline, dilution)
        VALUES (?, ?, ?)
        ON CONFLICT(npc_id) DO UPDATE SET primary_bloodline = excluded.primary_bloodline, dilution = excluded.dilution
      `);
  const upsertPhysique = db.prepare(`
        INSERT INTO actor_physique (actor_kind, actor_id, mass_kg, height_m, body_type)
        VALUES ('npc', ?, ?, ?, ?)
        ON CONFLICT(actor_kind, actor_id) DO UPDATE SET mass_kg = excluded.mass_kg, height_m = excluded.height_m, body_type = excluded.body_type
      `);
  const upsertCulture = db.prepare(`
        INSERT INTO actor_culture (actor_kind, actor_id, culture_id, faith_id)
        VALUES ('npc', ?, ?, ?)
        ON CONFLICT(actor_kind, actor_id) DO UPDATE SET culture_id = excluded.culture_id, faith_id = excluded.faith_id
      `);
  const selAge = db.prepare(`SELECT 1 FROM npc_ages WHERE npc_id = ?`);

  for (const npc of npcs) {
    if (!npc?.id) continue;
    // Ancestry
    try {
      const bl = bloodlineFor(npc);
      const dil = dilutionFor(npc.id);
      upsertAncestry.run(npc.id, bl, dil);
      ancestryN++;
    } catch { errors++; }

    // Physique
    try {
      const p = physiqueFor(npc);
      upsertPhysique.run(npc.id, p.mass_kg, p.height_m, p.body_type);
      physiqueN++;
    } catch { errors++; }

    // Culture
    try {
      const c = cultureFor(npc);
      upsertCulture.run(npc.id, c.culture_id, c.faith_id || null);
      cultureN++;
    } catch { errors++; }

    // Age (only if not already aged).
    try {
      const exists = selAge.get(npc.id);
      if (!exists) {
        const birth = birthDayFor(npc, npc.archetype, currentConcordiaDay);
        const { setBirth } = await import("./aging-engine.js");
        setBirth(db, npc.id, npc.archetype || null, birth);
        ageN++;
      }
    } catch { errors++; }
  }

  return { ok: true, seeded: { ancestry: ancestryN, physique: physiqueN, culture: cultureN, age: ageN }, errors, total: npcs.length };
}
