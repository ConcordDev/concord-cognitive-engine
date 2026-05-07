// server/lib/embodied/skill-environment.js
//
// Layer 7.5: bidirectional coupling between skills and the environment.
//
// Three responsibilities:
//   1. elementalEnvBoost(element, signals) — environment-aware potency
//      multiplier. Frost magic is stronger in cold cells, weaker in hot;
//      fire is stronger when dry/sunny; lightning spikes during storms;
//      bio-magic prefers humid + clean air; energy follows sunlight.
//   2. elementalEnvFeedback(element, magnitude) — what a successful cast
//      WRITES BACK to the environment. Fire warms, water humidifies,
//      lightning thunders + creates ozone, etc. Returned as an array of
//      { channel, value, ttlSeconds } deltas; the caller calls recordSignal
//      for each. Magnitude is the post-multiplier final damage so big
//      casts leave bigger marks.
//   3. terrainResourceBoost(element, nodeType, signals) — yield multiplier
//      for harvesting. Earth-aligned (physical) extracts more from stone/ore
//      ("Toph effect"); water-aligned from springs; energy/light from
//      plants in sunlight; fire-aligned from dry wood.
//
// Plus two combat-environment side mechanics:
//   4. shouldStaggerOnTerrain(...) — DBZ-style: if a high-magnitude hit's
//      direction projects into a building within ~6m of the target, return
//      a stagger spec (durationMs + structuralStress + buildingId).
//   5. applyStructuralStress(...) — Geo-Mod-light: drains world_buildings
//      health_pct by stress fraction, transitions state through standing
//      → damaged → collapsed.
//
// Pure-ish: no I/O except the structural-stress UPDATE in #5. All other
// helpers are deterministic functions of inputs, easy to test.

const ELEMENTS = new Set([
  "fire", "ice", "water", "lightning", "bio", "poison",
  "energy", "physical", "none",
]);

/**
 * Environment-aware potency multiplier.
 * Returns 1.0 for unknown elements or `signals.hasData === false` so the
 * combat path collapses to neutral when Layer 7 hasn't seeded yet.
 *
 * Multiplier range: 0.5 .. 1.6.
 */
export function elementalEnvBoost(element, signals) {
  if (!signals || signals.hasData === false) return 1.0;
  if (!element || !ELEMENTS.has(element)) return 1.0;

  const t   = Number(signals.temperature);
  const hum = Number(signals.humidity);
  const aq  = Number(signals.airQuality);
  const lux = Number(signals.light);
  const wk  = signals.weatherKind;

  switch (element) {
    case "ice":
      if (t < 2)   return 1.5;
      if (t < 12)  return 1.2;
      if (t > 28)  return 0.5;
      if (t > 22)  return 0.75;
      return 1.0;

    case "fire":
      if (hum > 85)                   return 0.55;
      if (wk === "rain" || wk === "storm") return 0.6;
      if (lux > 80000 && hum < 50)    return 1.4;
      if (t > 28)                     return 1.25;
      if (hum < 35)                   return 1.15;
      return 1.0;

    case "water":
      if (wk === "rain" || wk === "storm") return 1.3;
      if (hum > 70)  return 1.2;
      if (hum < 30)  return 0.7;
      return 1.0;

    case "lightning":
      if (wk === "storm") return 1.6;
      if (hum > 75)       return 1.25;
      if (hum < 25)       return 0.7;
      return 1.0;

    case "bio":
      if (aq > 0.85 && hum > 50) return 1.3;
      if (aq < 0.5)              return 0.6;
      return 1.0;

    case "poison":
      if (hum > 60)      return 1.15;
      if (wk === "smog") return 1.25;
      return 1.0;

    case "energy":
      if (lux > 90000)  return 1.3;
      if (lux < 4000)   return 0.7;
      return 1.0;

    case "physical":
    case "none":
    default:
      return 1.0;
  }
}

/**
 * What a successful cast writes back to the environment.
 * Magnitude here is the post-multiplier damage (or work value for
 * non-combat skills); we normalise to a 0..2 envelope so very small
 * casts leave a faint trace and very large ones do meaningful drift.
 *
 * Returns an array of { channel, value, ttlSeconds } deltas. The caller
 * (combat / harvest route) calls recordSignal at the cast location for each.
 */
export function elementalEnvFeedback(element, magnitude) {
  if (!element || !ELEMENTS.has(element)) return [];
  const m = Math.max(0.1, Math.min(2.0, Number(magnitude) / 50));

  switch (element) {
    case "fire":
      return [
        { channel: "thermal_os.ambient_temp", value: +0.5 * m, ttlSeconds: 600 },
        { channel: "chemical_os.air_quality", value: -0.02 * m, ttlSeconds: 300 },
      ];
    case "ice":
      return [
        { channel: "thermal_os.ambient_temp", value: -0.5 * m, ttlSeconds: 600 },
      ];
    case "water":
      return [
        { channel: "chemical_os.humidity", value: +1.5 * m, ttlSeconds: 900 },
      ];
    case "lightning":
      return [
        { channel: "sonic_os.ambient_db",     value: +0.8 * m, ttlSeconds: 60 },
        { channel: "chemical_os.air_quality", value: -0.04 * m, ttlSeconds: 300 },
        { channel: "sight_os.illumination",   value: +500 * m, ttlSeconds: 15 },
      ];
    case "bio":
      return [
        { channel: "chemical_os.air_quality", value: -0.03 * m, ttlSeconds: 600 },
      ];
    case "poison":
      return [
        { channel: "chemical_os.air_quality", value: -0.08 * m, ttlSeconds: 900 },
      ];
    case "energy":
      return [
        { channel: "sight_os.illumination", value: +300 * m, ttlSeconds: 30 },
      ];
    case "physical":
      return [
        { channel: "tactile_force_os.ambient_pressure", value: +0.05 * m, ttlSeconds: 60 },
        { channel: "sonic_os.ambient_db",               value: +0.4 * m,  ttlSeconds: 60 },
      ];
    case "none":
    default:
      return [];
  }
}

/**
 * Yield multiplier for harvest actions, based on the gatherer's elemental
 * affinity, the node's substance, and (optionally) live signals.
 *
 * Affinities (the "bender" wedge):
 *   physical  + ore_vein/stone/crystal/fuel  → 1.5  (Toph: stonework)
 *   physical  + tree                         → 1.15 (deadlift, splitting)
 *   water     + spring                       → 1.4  (Katara: drawing)
 *   bio       + herb/soil                    → 1.45 (life-affinity)
 *   energy    + herb/tree (sunlight > 50k)   → 1.35 (photosynth boost)
 *   fire      + tree (humidity < 40)         → 1.2  (dry-wood split)
 *   ice       + spring (temperature < 5)     → 1.25 (frozen-edge cut)
 */
export function terrainResourceBoost(element, nodeType, signals = null) {
  if (!element || !nodeType) return 1.0;
  if (element === "none") return 1.0;

  const stoneNodes = new Set(["ore_vein", "stone", "crystal", "fuel"]);
  const plantNodes = new Set(["herb", "soil", "tree"]);
  const hum  = Number(signals?.humidity ?? 50);
  const lux  = Number(signals?.light    ?? 10000);
  const temp = Number(signals?.temperature ?? 15);

  if (element === "physical" && stoneNodes.has(nodeType))    return 1.5;
  if (element === "physical" && nodeType === "tree")         return 1.15;
  if (element === "water"    && nodeType === "spring")       return 1.4;
  if (element === "bio"      && (nodeType === "herb" || nodeType === "soil")) return 1.45;
  if (element === "energy"   && plantNodes.has(nodeType) && lux > 50000) return 1.35;
  if (element === "fire"     && nodeType === "tree" && hum < 40) return 1.2;
  if (element === "ice"      && nodeType === "spring" && temp < 5) return 1.25;
  return 1.0;
}

/**
 * DBZ-style: if a high-magnitude hit projects the target into a building
 * within ~6m of the target's position (along the attack vector), return
 * a stagger spec. Caller emits realtime + applies structural stress.
 *
 * Threshold: magnitude >= 30 (anything below feels like a slap).
 *
 * @param {object} args
 * @param {string} args.element
 * @param {number} args.magnitude — final post-multiplier damage
 * @param {{ x: number, z: number } | null} args.attackerPos
 * @param {{ x: number, z: number } | null} args.targetPos
 * @param {import('better-sqlite3').Database} args.db
 * @param {string} args.worldId
 */
export function shouldStaggerOnTerrain({ element, magnitude, attackerPos, targetPos, db, worldId }) {
  if (!Number.isFinite(magnitude) || magnitude < 30) return null;
  if (!db || !worldId) return null;
  if (!attackerPos || !targetPos) return null;
  if (!Number.isFinite(attackerPos.x) || !Number.isFinite(attackerPos.z)) return null;
  if (!Number.isFinite(targetPos.x)   || !Number.isFinite(targetPos.z))   return null;

  const dx = targetPos.x - attackerPos.x;
  const dz = targetPos.z - attackerPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.001) return null;
  const ux = dx / dist;
  const uz = dz / dist;
  const projX = targetPos.x + ux * 6;
  const projZ = targetPos.z + uz * 6;

  const STAGGER_RADIUS = 8;
  let nearby;
  try {
    nearby = db.prepare(`
      SELECT id, x, z, building_type, material, health_pct, state
        FROM world_buildings
       WHERE world_id = ?
         AND state IN ('standing', 'damaged')
         AND x BETWEEN ? AND ?
         AND z BETWEEN ? AND ?
    `).all(
      worldId,
      projX - STAGGER_RADIUS, projX + STAGGER_RADIUS,
      projZ - STAGGER_RADIUS, projZ + STAGGER_RADIUS,
    );
  } catch {
    return null;
  }
  if (!nearby || nearby.length === 0) return null;

  let closest = null;
  let minD2 = Infinity;
  for (const b of nearby) {
    const d2 = (b.x - projX) * (b.x - projX) + (b.z - projZ) * (b.z - projZ);
    if (d2 < minD2) { minD2 = d2; closest = b; }
  }
  if (!closest) return null;

  // Material toughness mod: stone/steel resist; thatch/wood crumple.
  const matMod = closest.material === "thatch" ? 1.5
               : closest.material === "wood"   ? 1.2
               : closest.material === "stone"  ? 0.8
               : closest.material === "steel"  ? 0.6
               : 1.0;

  return {
    buildingId: closest.id,
    buildingType: closest.building_type,
    durationMs: Math.min(4000, Math.floor(magnitude * 50)),
    structuralStress: Math.min(0.2, (magnitude / 1000) * matMod),
    elementContrib: element,
  };
}

/**
 * Apply structural stress to a building, transitioning its state if health
 * crosses a threshold. Idempotent on `collapsed` buildings.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} _worldId — accepted for contract symmetry; the building
 *                            id is globally unique so the lookup doesn't
 *                            need to scope by world.
 * @param {string} buildingId
 * @param {number} stress 0..1
 */
export function applyStructuralStress(db, _worldId, buildingId, stress) {
  if (!db || !buildingId || !Number.isFinite(stress) || stress <= 0) return null;
  let row;
  try {
    row = db.prepare(`
      SELECT health_pct, state FROM world_buildings WHERE id = ?
    `).get(buildingId);
  } catch {
    return null;
  }
  if (!row || row.state === "collapsed") return null;

  const oldHealth = Number(row.health_pct ?? 1.0);
  const newHealth = Math.max(0, oldHealth - Number(stress));
  let newState = row.state;
  if (newHealth <= 0)        newState = "collapsed";
  else if (newHealth < 0.4)  newState = "damaged";
  else                       newState = "standing";

  try {
    db.prepare(`
      UPDATE world_buildings SET health_pct = ?, state = ? WHERE id = ?
    `).run(newHealth, newState, buildingId);
  } catch {
    return null;
  }
  return {
    buildingId,
    healthPct: newHealth,
    state: newState,
    transitioned: newState !== row.state,
  };
}
