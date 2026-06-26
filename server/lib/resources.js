// server/lib/resources.js
//
// Living Society — Phase 0: the canonical resource property catalog.
//
// Every resource KIND carries properties (potency/affinity/stability/volume/
// weight/rarity_tier/source_type [+ magical_sub]). This module is the source of
// truth (works without a DB); migration 278's `resource_properties` table is the
// persistence/override layer. `propsFor` resolves DB row → catalog → safe default
// so crafting works on a minimal build, in tests, and pre-seed.
//
// The catalog is DATA — adding a tier/material never needs new code. It spans
// the 5 rarity tiers + the magical sub-tier (soul gems / mana / aether /
// essence) so the craft-resolve potency gradient (Fireball I → V) has fuel.

const AFFINITIES = Object.freeze(["magic", "tech", "bio", "physical", "chaos"]);

// item_id → { potency, affinity, stability, volume, weight, rarity_tier, source_type, magical_sub? }
export const RESOURCE_CATALOG = Object.freeze({
  // ── Tier 1 — Basic (common, farmable, low potency) ──────────────────────
  wood:        { potency: 8,  affinity: "physical", stability: 95, volume: 1.5, weight: 1.0, rarity_tier: 1, source_type: "logging" },
  stone:       { potency: 10, affinity: "physical", stability: 98, volume: 1.0, weight: 2.0, rarity_tier: 1, source_type: "mining" },
  fiber:       { potency: 6,  affinity: "bio",      stability: 90, volume: 0.5, weight: 0.2, rarity_tier: 1, source_type: "gather" },
  hide:        { potency: 9,  affinity: "bio",      stability: 88, volume: 1.0, weight: 0.6, rarity_tier: 1, source_type: "butcher" },
  iron_ore:    { potency: 14, affinity: "physical", stability: 92, volume: 1.0, weight: 2.4, rarity_tier: 1, source_type: "mining" },
  herb:        { potency: 12, affinity: "bio",      stability: 70, volume: 0.3, weight: 0.1, rarity_tier: 1, source_type: "forage" },
  // ── Tier 2 — Refined (uncommon, durability) ─────────────────────────────
  iron_ingot:  { potency: 24, affinity: "physical", stability: 95, volume: 0.8, weight: 2.2, rarity_tier: 2, source_type: "smelting" },
  steel_ingot: { potency: 34, affinity: "physical", stability: 96, volume: 0.8, weight: 2.0, rarity_tier: 2, source_type: "smelting" },
  leather:     { potency: 22, affinity: "bio",      stability: 92, volume: 0.9, weight: 0.5, rarity_tier: 2, source_type: "tanning" },
  cloth:       { potency: 18, affinity: "bio",      stability: 90, volume: 0.7, weight: 0.3, rarity_tier: 2, source_type: "weaving" },
  // ── Tier 3 — Rare (enchant-grade) ───────────────────────────────────────
  gold:        { potency: 40, affinity: "tech",     stability: 85, volume: 0.4, weight: 3.0, rarity_tier: 3, source_type: "mining" },
  gemstone:    { potency: 48, affinity: "magic",    stability: 80, volume: 0.2, weight: 0.4, rarity_tier: 3, source_type: "mining" },
  crystal:     { potency: 52, affinity: "magic",    stability: 72, volume: 0.3, weight: 0.3, rarity_tier: 3, source_type: "mining" },
  chitin:      { potency: 44, affinity: "bio",      stability: 86, volume: 0.6, weight: 0.7, rarity_tier: 3, source_type: "butcher" },
  // ── Tier 4 — Exotic (high magical/tech) ─────────────────────────────────
  adamantite:  { potency: 66, affinity: "physical", stability: 90, volume: 0.5, weight: 3.2, rarity_tier: 4, source_type: "deep_mining" },
  orichalcum:  { potency: 70, affinity: "tech",     stability: 78, volume: 0.5, weight: 2.6, rarity_tier: 4, source_type: "deep_mining" },
  element_shard:{ potency: 74, affinity: "chaos",   stability: 55, volume: 0.2, weight: 0.3, rarity_tier: 4, source_type: "boss_drop" },
  soul_essence:{ potency: 72, affinity: "magic",    stability: 60, volume: 0.1, weight: 0.1, rarity_tier: 4, source_type: "boss_drop" },
  // ── Tier 5 — Legendary / Mythic (game-changing) ─────────────────────────
  dragonbone:    { potency: 90, affinity: "physical", stability: 82, volume: 0.6, weight: 3.5, rarity_tier: 5, source_type: "boss_drop" },
  ancient_tech_core:{ potency: 92, affinity: "tech", stability: 50, volume: 0.4, weight: 1.2, rarity_tier: 5, source_type: "ruins" },
  divine_essence:{ potency: 96, affinity: "magic",  stability: 65, volume: 0.1, weight: 0.1, rarity_tier: 5, source_type: "divine" },

  // ── Magical sub-tier (overlays any tier; the potency FUEL) ──────────────
  // Soul gems store/power enchantments; black is high-risk high-reward.
  petty_soul_gem: { potency: 30, affinity: "magic", stability: 75, volume: 0.1, weight: 0.2, rarity_tier: 2, source_type: "enchant", magical_sub: "soul_gem" },
  grand_soul_gem: { potency: 70, affinity: "magic", stability: 60, volume: 0.1, weight: 0.2, rarity_tier: 4, source_type: "enchant", magical_sub: "soul_gem" },
  black_soul_gem: { potency: 88, affinity: "chaos", stability: 30, volume: 0.1, weight: 0.2, rarity_tier: 5, source_type: "forbidden", magical_sub: "soul_gem" },
  mana_crystal:   { potency: 40, affinity: "magic", stability: 70, volume: 0.2, weight: 0.2, rarity_tier: 3, source_type: "mining", magical_sub: "mana" },
  aether_dust:    { potency: 58, affinity: "magic", stability: 50, volume: 0.05, weight: 0.05, rarity_tier: 4, source_type: "distill", magical_sub: "aether" },
  essence_life:   { potency: 64, affinity: "bio",   stability: 68, volume: 0.1, weight: 0.1, rarity_tier: 4, source_type: "essence", magical_sub: "essence" },
  essence_death:  { potency: 64, affinity: "chaos", stability: 45, volume: 0.1, weight: 0.1, rarity_tier: 4, source_type: "essence", magical_sub: "essence" },
  essence_order:  { potency: 64, affinity: "tech",  stability: 80, volume: 0.1, weight: 0.1, rarity_tier: 4, source_type: "essence", magical_sub: "essence" },
  essence_chaos:  { potency: 64, affinity: "chaos", stability: 35, volume: 0.1, weight: 0.1, rarity_tier: 4, source_type: "essence", magical_sub: "essence" },
});

// Safe default for an unknown resource id — a basic tier-1 physical material, so
// crafting with an uncatalogued mat degrades gracefully instead of throwing.
const DEFAULT_PROPS = Object.freeze({
  potency: 10, affinity: "physical", stability: 80, volume: 1.0, weight: 1.0, rarity_tier: 1, source_type: "gather", magical_sub: null,
});

/**
 * Resolve a resource's properties. Order: a per-slot override (parsed
 * properties_json) → the DB `resource_properties` row → the catalog → default.
 * `db` and `overrideJson` are optional so this is pure-callable in tests.
 */
export function propsFor(itemId, { db = null, overrideJson = null } = {}) {
  if (overrideJson) {
    try {
      const o = typeof overrideJson === "string" ? JSON.parse(overrideJson) : overrideJson;
      if (o && typeof o === "object" && (o.potency != null || o.affinity != null)) {
        return { ...DEFAULT_PROPS, ...(RESOURCE_CATALOG[itemId] || {}), ...o };
      }
    } catch { /* fall through */ }
  }
  if (db) {
    try {
      const row = db.prepare(`SELECT potency, affinity, stability, volume, weight, rarity_tier, source_type, magical_sub FROM resource_properties WHERE item_id = ?`).get(itemId);
      if (row) return { ...DEFAULT_PROPS, ...row };
    } catch { /* table absent → catalog */ }
  }
  return { ...DEFAULT_PROPS, ...(RESOURCE_CATALOG[itemId] || {}) };
}

export function tierOf(itemId) { return propsFor(itemId).rarity_tier; }
export function isValidAffinity(a) { return AFFINITIES.includes(a); }

/**
 * Persist the canonical catalog into resource_properties (idempotent upsert).
 * Called at boot/seed so DB-backed lookups + admin edits have a baseline. Safe
 * to call when the table is absent (guarded).
 */
export function seedResourceProperties(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const stmt = db.prepare(`
      INSERT INTO resource_properties (item_id, potency, affinity, stability, volume, weight, rarity_tier, source_type, magical_sub)
      VALUES (@item_id, @potency, @affinity, @stability, @volume, @weight, @rarity_tier, @source_type, @magical_sub)
      ON CONFLICT(item_id) DO UPDATE SET
        potency=excluded.potency, affinity=excluded.affinity, stability=excluded.stability,
        volume=excluded.volume, weight=excluded.weight, rarity_tier=excluded.rarity_tier,
        source_type=excluded.source_type, magical_sub=excluded.magical_sub, updated_at=unixepoch()
    `);
    let n = 0;
    const tx = db.transaction(() => {
      for (const [item_id, p] of Object.entries(RESOURCE_CATALOG)) {
        stmt.run({ item_id, magical_sub: null, ...p });
        n++;
      }
    });
    tx();
    return { ok: true, seeded: n };
  } catch (e) {
    return { ok: false, reason: "schema_unavailable", error: e?.message };
  }
}

/** Validate one authored material blueprint from `content/items.json`. Required:
 *  item_id. Numeric props, if present, must be finite. */
export function validateItemBlueprint(it) {
  if (!it || typeof it !== "object" || Array.isArray(it)) return { ok: false, reason: "not_object" };
  if (typeof it.item_id !== "string" || !it.item_id) return { ok: false, reason: "missing_item_id" };
  for (const k of ["potency", "stability", "volume", "weight", "rarity_tier"]) {
    if (it[k] !== undefined && !Number.isFinite(Number(it[k]))) return { ok: false, reason: `invalid_${k}` };
  }
  return { ok: true };
}

/**
 * Content pillar 2 (materials) — seed authored lore materials from a parsed
 * `content/items.json` array into `resource_properties`, the same table
 * `seedResourceProperties` populates and `propsFor` reads (override→DB→catalog→
 * default). So an authored mythical ore becomes a real craftable material the
 * craft-resolve system reads. Each entry merges over DEFAULT_PROPS; idempotent
 * upsert on item_id. Returns the count seeded.
 */
export function seedItemBlueprints(db, items) {
  if (!db || !Array.isArray(items)) return 0;
  let stmt;
  try {
    stmt = db.prepare(`
      INSERT INTO resource_properties (item_id, potency, affinity, stability, volume, weight, rarity_tier, source_type, magical_sub)
      VALUES (@item_id, @potency, @affinity, @stability, @volume, @weight, @rarity_tier, @source_type, @magical_sub)
      ON CONFLICT(item_id) DO UPDATE SET
        potency=excluded.potency, affinity=excluded.affinity, stability=excluded.stability,
        volume=excluded.volume, weight=excluded.weight, rarity_tier=excluded.rarity_tier,
        source_type=excluded.source_type, magical_sub=excluded.magical_sub, updated_at=unixepoch()
    `);
  } catch {
    return 0; // resource_properties absent on a minimal build — degrade to no-op
  }
  let n = 0;
  const tx = db.transaction(() => {
    for (const it of items) {
      if (!validateItemBlueprint(it).ok) continue;
      const m = { ...DEFAULT_PROPS, ...it };
      stmt.run({
        item_id: it.item_id,
        potency: Number(m.potency), affinity: String(m.affinity),
        stability: Number(m.stability), volume: Number(m.volume), weight: Number(m.weight),
        rarity_tier: Number(m.rarity_tier), source_type: String(m.source_type),
        magical_sub: m.magical_sub != null ? String(m.magical_sub) : null,
      });
      n++;
    }
  });
  tx();
  return n;
}

export const RESOURCE_CONSTANTS = Object.freeze({ AFFINITIES, DEFAULT_PROPS });
