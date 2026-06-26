// server/lib/world-zones.js
//
// T3.3 — world zones: spatial combat/environment rules.
//
// A zone is a circle in a world with a `kind` that governs what's allowed
// inside it. zoneAt resolves the smallest containing zone (a sanctuary nested
// in a hazard field wins). combatRuleFor turns that into a decision the combat
// route consults — generalising the hardcoded hub safe-zone check to any
// region of any world.
//
// Pure where possible; DB reads are bounded + try/catch'd so a minimal build
// (no world_zones table) degrades to "no zone governs here", which yields the
// world's default rule (combat allowed, PvP off) — never a crash.

import crypto from "node:crypto";

export const ZONE_KINDS = Object.freeze(["safe", "sanctuary", "pvp", "lawless", "hazard"]);

// T3.4 balance dial — default per-tick damage for a hazard zone that doesn't
// set its own `hazard` in rules_json. Override CONCORD_HAZARD_DEFAULT_DPS.
const HAZARD_DEFAULT_DPS = (() => {
  const v = Number(process.env.CONCORD_HAZARD_DEFAULT_DPS);
  return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : 6;
})();

// Per-kind default rules. Overridden by a zone's rules_json.
export const ZONE_DEFAULTS = Object.freeze({
  safe:      { combat: false, pvp: false, hazard: 0 },
  sanctuary: { combat: false, pvp: false, hazard: 0, regenPerTick: 2, noAggro: true },
  pvp:       { combat: true,  pvp: true,  hazard: 0 },
  lawless:   { combat: true,  pvp: true,  hazard: 0, suppressWitness: true },
  hazard:    { combat: true,  pvp: false, hazard: HAZARD_DEFAULT_DPS, element: "fire" },
});

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

function parseRules(row) {
  let rules = {};
  try { rules = row.rules_json ? JSON.parse(row.rules_json) : {}; } catch { /* */ }
  return { ...(ZONE_DEFAULTS[row.kind] || {}), ...rules };
}

/** List all zones in a world (bounded). */
export function listZones(db, worldId) {
  if (!db || !worldId || !tableExists(db, "world_zones")) return [];
  try {
    return db.prepare(`
      SELECT * FROM world_zones WHERE world_id = ? ORDER BY radius_m ASC LIMIT 200
    `).all(worldId).map((z) => ({ ...z, rules: parseRules(z) }));
  } catch { return []; }
}

/**
 * The governing zone at a point: the smallest-radius zone whose circle contains
 * (x, z). Returns null if no zone contains the point.
 */
export function zoneAt(db, worldId, x, z) {
  if (!db || !worldId || !Number.isFinite(x) || !Number.isFinite(z) || !tableExists(db, "world_zones")) {
    return null;
  }
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM world_zones WHERE world_id = ? ORDER BY radius_m ASC LIMIT 200
    `).all(worldId);
  } catch { return null; }
  // Smallest-radius-first, so a sanctuary nested inside a hazard field wins.
  for (const zone of rows) {
    const dx = x - zone.center_x;
    const dz = z - zone.center_z;
    if (dx * dx + dz * dz <= zone.radius_m * zone.radius_m) {
      return { ...zone, rules: parseRules(zone) };
    }
  }
  return null;
}

/**
 * The combat decision at a position. Consults the governing zone; falls back to
 * the world default when no zone governs. `hubHardcoded` lets the caller keep
 * the constitutional hub refusal as an unconditional override.
 */
export function combatRuleFor(db, worldId, x, z, { hubHardcoded = false } = {}) {
  if (hubHardcoded) {
    return { combatAllowed: false, pvpAllowed: false, reason: "concordant_law", zone: null };
  }
  const zone = zoneAt(db, worldId, x, z);
  if (!zone) {
    // World default: combat allowed, PvP off (existing behaviour off-hub).
    return { combatAllowed: true, pvpAllowed: false, reason: "default", zone: null };
  }
  const r = zone.rules;
  return {
    combatAllowed: r.combat !== false,
    pvpAllowed: !!r.pvp,
    suppressWitness: !!r.suppressWitness,
    hazardDps: Number(r.hazard) || 0,
    hazardElement: r.element || "physical",
    reason: zone.kind,
    zone: { id: zone.id, name: zone.name, kind: zone.kind },
  };
}

/** Insert/replace a zone (idempotent on (world_id, name)). */
export function upsertZone(db, { worldId, name, kind, centerX = 0, centerZ = 0, radiusM = 50, rules = {}, createdBy = null }) {
  if (!db || !worldId || !name || !ZONE_KINDS.includes(kind) || !tableExists(db, "world_zones")) {
    return { ok: false, reason: "invalid" };
  }
  const id = `zone_${crypto.createHash("sha1").update(`${worldId}|${name}`).digest("hex").slice(0, 16)}`;
  try {
    db.prepare(`
      INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m, rules_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(world_id, name) DO UPDATE SET
        kind = excluded.kind, center_x = excluded.center_x, center_z = excluded.center_z,
        radius_m = excluded.radius_m, rules_json = excluded.rules_json
    `).run(id, worldId, name, kind, centerX, centerZ, Math.max(1, radiusM), JSON.stringify(rules), createdBy);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Seed sensible default zones for authored worlds. The hub gets an explicit
 * sanctuary (so the zone system agrees with the hardcoded Concordant Law);
 * other worlds get a small sanctuary around spawn so newcomers have a safe
 * landing. Idempotent. Returns the count seeded.
 */
export function seedDefaultZones(db, worldIds = []) {
  if (!db || !tableExists(db, "world_zones")) return 0;
  let n = 0;
  for (const worldId of worldIds) {
    const isHub = worldId === "concordia-hub" || worldId === "concordia";
    const r = upsertZone(db, {
      worldId,
      name: isHub ? "The Three's Domain" : "Spawn Sanctuary",
      kind: "sanctuary",
      centerX: 0, centerZ: 0,
      radiusM: isHub ? 400 : 60,
      rules: { combat: false, pvp: false, regenPerTick: isHub ? 4 : 2, noAggro: true },
      createdBy: "content-seeder",
    });
    if (r.ok) n++;
  }
  return n;
}

/** Validate one authored zone object from a content `zones.json`. Shape:
 *  { name, kind, x, z, radius, rules? } — x/z/radius default to 0/0/50. */
export function validateZone(z) {
  if (!z || typeof z !== "object" || Array.isArray(z)) return { ok: false, reason: "not_object" };
  if (typeof z.name !== "string" || !z.name) return { ok: false, reason: "missing_name" };
  if (!ZONE_KINDS.includes(z.kind)) return { ok: false, reason: "invalid_kind" };
  for (const k of ["x", "z", "radius"]) {
    if (z[k] !== undefined && !Number.isFinite(Number(z[k]))) return { ok: false, reason: `invalid_${k}` };
  }
  if (z.rules !== undefined && (typeof z.rules !== "object" || Array.isArray(z.rules))) {
    return { ok: false, reason: "invalid_rules" };
  }
  return { ok: true };
}

/**
 * Seed authored lore zones for a world from a parsed `zones.json` array. Each
 * entry maps the lore's coordinate region onto the circular substrate via
 * upsertZone (idempotent on (world_id, name)). Invalid entries are skipped, not
 * fatal. Returns the count seeded. The lore's safe plaza / pvp arena / hazard
 * ruins become real combat/spawn rules `combatRuleFor` consults.
 */
export function seedZonesFromContent(db, worldId, zones) {
  if (!db || !worldId || !Array.isArray(zones) || !tableExists(db, "world_zones")) return 0;
  let n = 0;
  for (const z of zones) {
    if (!validateZone(z).ok) continue;
    const r = upsertZone(db, {
      worldId,
      name: z.name,
      kind: z.kind,
      centerX: Number(z.x) || 0,
      centerZ: Number(z.z) || 0,
      radiusM: Number(z.radius) || 50,
      rules: (z.rules && typeof z.rules === "object") ? z.rules : {},
      createdBy: "content-seeder",
    });
    if (r.ok) n++;
  }
  return n;
}
