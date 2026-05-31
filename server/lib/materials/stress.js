// server/lib/materials/stress.js
//
// Engine N7 — materials science = PHYSICAL viability under stress. A structure
// is viable while stress < ultimate; failure = exiting the viability set (the
// same R≥D shape — repair/strength vs load/decay). Real stress-response (elastic
// → yielding → fracture), fatigue (Basquin S-N + Miner's-rule cumulative
// damage), and the robust/brittle distinction (#4). Pure, zero-dep — the math
// crafting quality, building/destruction (applyStructuralStress), and weapon
// durability read. Stress in arbitrary game units; ratios are what matter.

// Building materials match the toughness wedges already in skill-environment.js
// (thatch 1.5× ... steel 0.6× damage-take). brittleness: 0 = ductile (yields a
// lot before fracture), 1 = brittle (snaps at ultimate with no warning).
export const MATERIALS = Object.freeze({
  thatch: { yield: 8,  ultimate: 12,  brittleness: 0.3, density: 0.2, fatigueExp: 6 },
  wood:   { yield: 30, ultimate: 45,  brittleness: 0.4, density: 0.5, fatigueExp: 7 },
  stone:  { yield: 90, ultimate: 100, brittleness: 0.85, density: 2.4, fatigueExp: 10 }, // yield≈ultimate → little warning
  steel:  { yield: 120, ultimate: 200, brittleness: 0.15, density: 7.8, fatigueExp: 9 }, // big plastic region
  glass:  { yield: 49, ultimate: 50,  brittleness: 0.97, density: 2.5, fatigueExp: 12 }, // shatters
});

function _mat(material) {
  return typeof material === "string" ? MATERIALS[material] : material;
}

/**
 * Single-load stress response.
 *   stress < yield      → elastic   (springs back)
 *   yield ≤ stress < ult → yielding (permanent deformation; ductile warning)
 *   stress ≥ ultimate    → fracture (failed)
 * Returns { state, ratio (stress/ultimate), failed, plasticReserve }.
 */
export function stressResponse(material, stress) {
  const m = _mat(material);
  if (!m) return { state: "unknown", ratio: 0, failed: false };
  const s = Math.max(0, Number(stress) || 0);
  const ratio = s / m.ultimate;
  let state = "elastic";
  if (s >= m.ultimate) state = "fracture";
  else if (s >= m.yield) state = "yielding";
  // plasticReserve = how much warning between yield and fracture (ductility).
  const plasticReserve = (m.ultimate - m.yield) / m.ultimate;
  return { state, ratio, failed: state === "fracture", plasticReserve };
}

/** Brittle = fails suddenly at ultimate with little plastic warning. */
export function isBrittle(material) {
  const m = _mat(material);
  return !!m && m.brittleness >= 0.5;
}

/**
 * Fatigue life — cycles to failure under a repeated stress amplitude, via a
 * Basquin S-N law: N_f = (ultimate / amplitude)^fatigueExp. Higher amplitude →
 * dramatically fewer cycles. Returns Infinity below a tiny endurance floor.
 */
export function fatigueLife(material, stressAmplitude) {
  const m = _mat(material);
  if (!m) return Infinity;
  const Sa = Math.max(0, Number(stressAmplitude) || 0);
  if (Sa <= 0) return Infinity;
  if (Sa >= m.ultimate) return 1; // overload fails on the first cycle
  return Math.pow(m.ultimate / Sa, m.fatigueExp);
}

/**
 * Accumulate fatigue damage via Miner's rule: each block of `cycles` at a given
 * amplitude adds cycles / N_f(amplitude). Failure when cumulative damage ≥ 1.
 * Returns { damage, failed } — feed prior damage back in for a running total.
 */
export function accumulateFatigue(priorDamage, material, stressAmplitude, cycles) {
  const Nf = fatigueLife(material, stressAmplitude);
  const add = Nf === Infinity ? 0 : (Math.max(0, Number(cycles) || 0) / Nf);
  const damage = Math.max(0, Number(priorDamage) || 0) + add;
  return { damage, failed: damage >= 1 };
}

/**
 * Toughness — energy absorbed to fracture (≈ area under the stress-strain
 * curve). Ductile materials (big plastic region) are tougher per unit strength;
 * brittle ones store little energy. A relative score for "how much abuse it
 * takes." Reuses the catalog only.
 */
export function toughness(material) {
  const m = _mat(material);
  if (!m) return 0;
  // ultimate × plastic reserve × (1 − brittleness): brittle high-strength glass
  // is NOT tough; ductile steel is.
  const plastic = (m.ultimate - m.yield) / m.ultimate;
  return m.ultimate * (0.2 + plastic) * (1 - m.brittleness * 0.7);
}
