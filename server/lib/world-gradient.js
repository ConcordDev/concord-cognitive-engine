// server/lib/world-gradient.js
//
// WS0 — Large radial worlds + danger-band geometry.
//
// One shared source of truth for "how dangerous is this point in this world".
// Each world is a large radial map: a small central hub sanctuary, then
// concentric danger bands that ramp super-linearly out to a lethal frontier.
// Distance-from-hub → band index → an absolute level window. This is what
// makes the place-based gradient possible:
//
//   - WS2 spawns each band at a band-appropriate level (dense weak near the hub,
//     sparse strong at the frontier).
//   - WS3's migration engine re-anchors a grown entity to the band that matches
//     its level (homeBandFor) and drifts it outward (outwardUnit).
//   - WS6 telegraphs danger by band.
//
// Pure where possible. The only DB read (hubAnchorFor) is bounded + try/catch'd
// so a minimal build with no `world_zones` table degrades to an origin-anchored
// hub — never a crash. All dials are env-overridable per the balance-dial
// invariant; per-world overrides live in `worlds.rule_modulators.gradient`.

// ── Default geometry (env-overridable) ──────────────────────────────────────
function envNum(name, dflt, { min = 0, max = Infinity } = {}) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

/**
 * Whether worlds use the large radial map (expanded spawn bounds out to the
 * frontier). ON by default — the renderer/terrain extent tracks the same
 * worldRadiusM. Set CONCORD_RADIAL_WORLDS=0 to fall back to the legacy ±400
 * footprint where everything stays band 0–1 near the hub.
 */
export function radialWorldsEnabled() {
  const v = String(process.env.CONCORD_RADIAL_WORLDS ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

export const GRADIENT_DEFAULTS = Object.freeze({
  // Radius of the central safe hub disc (band 0). Inside this, danger = 0.
  hubRadiusM: envNum("CONCORD_GRADIENT_HUB_RADIUS_M", 150, { min: 10 }),
  // Outer edge of the playable world — the lethal frontier rim. Defaults to the
  // frontend terrain half-extent (TerrainRenderer TERRAIN_SIZE=2000 → ±1000),
  // so the full hub→frontier ramp lands on rendered ground. Procedural worlds
  // with a larger terrain override this via rule_modulators.gradient.worldRadiusM.
  worldRadiusM: envNum("CONCORD_WORLD_RADIUS_M", 1000, { min: 200 }),
  // How many concentric danger bands between hub and frontier.
  bandCount: Math.round(envNum("CONCORD_GRADIENT_BANDS", 6, { min: 2, max: 32 })),
  // Super-linear ramp exponent: >1 keeps the inner bands gentle and makes the
  // frontier spike. 1.0 = linear.
  dangerCurve: envNum("CONCORD_GRADIENT_CURVE", 1.6, { min: 0.5, max: 4 }),
  // Commons level at the frontier rim. Levels are unbounded engine-wide; this
  // only caps *ambient/common* spawns — named threats deliberately exceed it.
  frontierLevel: envNum("CONCORD_GRADIENT_FRONTIER_LEVEL", 100, { min: 5 }),
  // Spawn-density multiplier floor at the frontier (band 0 is always 1.0).
  frontierDensity: envNum("CONCORD_GRADIENT_FRONTIER_DENSITY", 0.2, { min: 0.02, max: 1 }),
});

// Human-facing band names for telegraphing (WS6). Index-clamped.
const BAND_NAMES = Object.freeze([
  "Sanctuary", "Settled", "Borderlands", "Wilds", "Deep Wilds", "Frontier",
  "Deep Frontier", "The Edge",
]);

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/**
 * Resolve the per-world gradient geometry. Accepts a `worlds` row (parses
 * `rule_modulators` JSON), a already-parsed config object, or null. Per-world
 * overrides under `rule_modulators.gradient` win over the env/defaults.
 */
export function gradientConfigFor(world = null) {
  let overrides = {};
  if (world && typeof world === "object") {
    let rm = world.rule_modulators ?? world.ruleModulators ?? world.gradient ?? null;
    if (typeof rm === "string") { try { rm = JSON.parse(rm); } catch { rm = null; } }
    if (rm && typeof rm === "object") overrides = rm.gradient || rm.GRADIENT || {};
  }
  const cfg = { ...GRADIENT_DEFAULTS, ...pick(overrides, Object.keys(GRADIENT_DEFAULTS)) };
  // Guard rails: hub must sit inside the world, at least 2 bands.
  cfg.hubRadiusM = clamp(cfg.hubRadiusM, 10, cfg.worldRadiusM - 50);
  cfg.bandCount = Math.round(clamp(cfg.bandCount, 2, 32));
  return cfg;
}

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== "object") return out;
  for (const k of keys) if (Number.isFinite(Number(obj[k]))) out[k] = Number(obj[k]);
  return out;
}

/**
 * The hub anchor (center + radius) for a world. Prefers the largest authored
 * `sanctuary` zone (the constitutional hub); falls back to origin with the
 * config hub radius. Bounded + crash-safe.
 */
export function hubAnchorFor(db, worldId, config = null) {
  const cfg = config || GRADIENT_DEFAULTS;
  const fallback = { x: 0, z: 0, radiusM: cfg.hubRadiusM };
  if (!db || !worldId || !tableExists(db, "world_zones")) return fallback;
  try {
    const row = db.prepare(`
      SELECT center_x, center_z, radius_m FROM world_zones
      WHERE world_id = ? AND kind = 'sanctuary'
      ORDER BY radius_m DESC LIMIT 1
    `).get(worldId);
    if (!row) return fallback;
    return {
      x: Number(row.center_x) || 0,
      z: Number(row.center_z) || 0,
      // The hub disc is the smaller of (authored sanctuary, configured hub).
      radiusM: Math.min(Number(row.radius_m) || cfg.hubRadiusM, cfg.hubRadiusM),
    };
  } catch { return fallback; }
}

/** Euclidean distance from a point to the hub anchor. Pure. */
export function distanceFromHub(anchor, x, z) {
  const ax = anchor?.x || 0, az = anchor?.z || 0;
  return Math.hypot((Number(x) || 0) - ax, (Number(z) || 0) - az);
}

/** Unit vector pointing away from the hub (for WS3 outward drift). Pure. */
export function outwardUnit(anchor, x, z) {
  const ax = anchor?.x || 0, az = anchor?.z || 0;
  const dx = (Number(x) || 0) - ax, dz = (Number(z) || 0) - az;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: 1, z: 0 }; // at the exact center: arbitrary but stable
  return { x: dx / d, z: dz / d };
}

/**
 * Normalised danger fraction 0..1 for a distance: 0 inside the hub disc, 1 at
 * (or beyond) the frontier rim. Pure.
 */
export function dangerFraction(config, distance) {
  const cfg = config || GRADIENT_DEFAULTS;
  const span = Math.max(1, cfg.worldRadiusM - cfg.hubRadiusM);
  return clamp((distance - cfg.hubRadiusM) / span, 0, 1);
}

/** Band index 0..bandCount-1 for a point (needs the resolved hub anchor). Pure. */
export function dangerBandAt(config, anchor, x, z) {
  const cfg = config || GRADIENT_DEFAULTS;
  const frac = dangerFraction(cfg, distanceFromHub(anchor, x, z));
  return clamp(Math.floor(frac * cfg.bandCount), 0, cfg.bandCount - 1);
}

/** Commons level at a 0..1 fraction along the ramp. Pure. */
function levelAtFraction(cfg, frac) {
  const f = clamp(frac, 0, 1);
  return Math.max(1, Math.round(cfg.frontierLevel * Math.pow(f, cfg.dangerCurve)));
}

/**
 * The [minLevel, maxLevel] commons window for a band. Band 0 starts at level 1;
 * the outermost band tops out at frontierLevel. Pure.
 */
export function bandLevelRange(config, band) {
  const cfg = config || GRADIENT_DEFAULTS;
  const b = clamp(Math.floor(band), 0, cfg.bandCount - 1);
  const loFrac = b / cfg.bandCount;
  const hiFrac = (b + 1) / cfg.bandCount;
  const minLevel = b === 0 ? 1 : levelAtFraction(cfg, loFrac) + 1;
  const maxLevel = Math.max(minLevel, levelAtFraction(cfg, hiFrac));
  return [minLevel, maxLevel];
}

/**
 * Inverse of bandLevelRange: which band should host an entity of this level.
 * Veterans (level above the frontier window) pile into the outermost band —
 * the migration engine pushes them to the rim and named threats live beyond it.
 * Pure.
 */
export function homeBandFor(config, level) {
  const cfg = config || GRADIENT_DEFAULTS;
  const lvl = Math.max(1, Number(level) || 1);
  for (let b = 0; b < cfg.bandCount; b++) {
    const [, hi] = bandLevelRange(cfg, b);
    if (lvl <= hi) return b;
  }
  return cfg.bandCount - 1;
}

/** Spawn-density multiplier for a band: 1.0 at the hub → frontierDensity at the rim. Pure. */
export function spawnDensityFor(config, band) {
  const cfg = config || GRADIENT_DEFAULTS;
  if (cfg.bandCount <= 1) return 1;
  const t = clamp(band, 0, cfg.bandCount - 1) / (cfg.bandCount - 1);
  return 1 - t * (1 - cfg.frontierDensity);
}

/** Human-facing band name for telegraphing. Pure. */
export function bandName(config, band) {
  const cfg = config || GRADIENT_DEFAULTS;
  const b = clamp(Math.floor(band), 0, cfg.bandCount - 1);
  // Map the band onto the name list proportionally so small/large bandCounts
  // both read sensibly.
  const idx = clamp(Math.round((b / Math.max(1, cfg.bandCount - 1)) * (BAND_NAMES.length - 1)), 0, BAND_NAMES.length - 1);
  return BAND_NAMES[idx];
}

/** Square world bounds enclosing the radial map (replaces the ±400 placeholder). Pure. */
export function worldBoundsFor(config, anchor = { x: 0, z: 0 }) {
  const cfg = config || GRADIENT_DEFAULTS;
  const r = cfg.worldRadiusM;
  return { x0: anchor.x - r, x1: anchor.x + r, z0: anchor.z - r, z1: anchor.z + r };
}

/**
 * One-shot convenience: everything about a point. Does the single DB read for
 * the hub anchor, then composes the pure helpers. Crash-safe.
 */
export function gradientAt(db, world, x, z) {
  const worldId = typeof world === "string" ? world : world?.id;
  const cfg = gradientConfigFor(typeof world === "object" ? world : null);
  const anchor = hubAnchorFor(db, worldId, cfg);
  const distance = distanceFromHub(anchor, x, z);
  const band = dangerBandAt(cfg, anchor, x, z);
  const [minLevel, maxLevel] = bandLevelRange(cfg, band);
  return {
    config: cfg,
    anchor,
    distance,
    band,
    bandName: bandName(cfg, band),
    minLevel,
    maxLevel,
    density: spawnDensityFor(cfg, band),
    inHub: distance <= anchor.radiusM,
    outward: outwardUnit(anchor, x, z),
  };
}
