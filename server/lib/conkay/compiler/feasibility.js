// server/lib/conkay/compiler/feasibility.js
//
// Feasibility before geometry. Given the requirements parsed from a brief,
// run the physics bound that decides whether any design could meet them.
// Each bound uses deliberately generous inputs (best-case technology), so a
// FAIL holds for every real design; each input is labelled and can be
// overridden. When a brief fails, the screen computes what would make it
// feasible instead of just saying no.
//
// A kind of design with no screen yet is reported as "no screen", never as
// feasible.

const G = 9.80665;
const WH = 3600; // J per Wh

// Best-case bounds for a battery-electric aircraft. All optimistic on purpose.
export const ELECTRIC_AIRCRAFT_BOUNDS = {
  batterySpecificEnergyWhKg: { value: 300, basis: "best current Li-ion cells; real packs are lower (optimistic)" },
  propulsiveEfficiency: { value: 0.85, basis: "battery → motor → propeller, best case (optimistic)" },
  liftToDrag: { value: 30, basis: "high-performance sailplane class; light aircraft are 10–15 (optimistic)" },
  emptyMassFraction: { value: 0.35, basis: "structure, motor and systems as a share of total; light aircraft are about 0.55–0.65 (optimistic)" },
  occupantMassKg: { value: 77, basis: "per person, standard average adult (assumption)" },
};

function bound(over, key, defaults) {
  const v = over?.[key];
  return Number.isFinite(v) ? { value: v, basis: "given" } : defaults[key];
}

/**
 * Battery-electric aircraft range (constant mass):
 *   R = (e*·η/g)·(L/D)·(m_battery/m_total)
 */
function screenElectricAircraft(req, over) {
  const mass = req.mass?.max?.si;
  const range = req.range?.min?.si;
  const seats = req.seats?.min?.si;
  const missing = [!Number.isFinite(mass) && "total mass", !Number.isFinite(range) && "range", !Number.isFinite(seats) && "number of people"].filter(Boolean);
  if (missing.length) return { status: "NOT_COMPUTED", screen: "electric-aircraft-range", reason: `the brief needs ${missing.join(", ")}` };
  const b = Object.fromEntries(Object.keys(ELECTRIC_AIRCRAFT_BOUNDS).map((k) => [k, bound(over, k, ELECTRIC_AIRCRAFT_BOUNDS)]));
  const e = b.batterySpecificEnergyWhKg.value * WH;
  const K = (e * b.propulsiveEfficiency.value / G) * b.liftToDrag.value; // metres per unit battery fraction
  const payload = seats * b.occupantMassKg.value;
  const batteryFraction = 1 - b.emptyMassFraction.value - payload / mass;
  const maxRange = Math.max(0, K * batteryFraction);
  const pass = batteryFraction > 0 && maxRange >= range;

  const alternatives = [];
  if (!pass) {
    alternatives.push({ change: "accept a shorter range", value: maxRange, unit: "m", note: "best case at the stated mass and bounds" });
    if (batteryFraction > 0) {
      const eNeed = (range * G) / (b.propulsiveEfficiency.value * b.liftToDrag.value * batteryFraction) / WH;
      alternatives.push({ change: "raise battery specific energy", value: eNeed, unit: "Wh/kg", note: "with every other bound unchanged" });
    }
    const denom = 1 - b.emptyMassFraction.value - range / K;
    if (denom > 0) alternatives.push({ change: "raise total mass", value: payload / denom, unit: "kg", note: "with every other bound unchanged" });
    else alternatives.push({ change: "raise total mass", value: null, note: "no mass works: the range needs more than the battery share any airframe leaves at this energy density" });
    for (let n = seats - 1; n >= 1; n--) {
      const f = 1 - b.emptyMassFraction.value - (n * b.occupantMassKg.value) / mass;
      if (K * f >= range) { alternatives.push({ change: "carry fewer people", value: n, unit: "people" }); break; }
    }
  }
  return {
    status: pass ? "PASS" : "FAIL",
    screen: "electric-aircraft-range",
    method: "R = (e*·η/g)·(L/D)·(m_battery/m_total), constant-mass battery Breguet range",
    reason: pass
      ? `best-case range ${(maxRange / 1609.344).toFixed(0)} mi meets ${(range / 1609.344).toFixed(0)} mi; a real design still has to show it`
      : batteryFraction <= 0
        ? "the people and the airframe alone exceed the total mass; there is no mass left for a battery"
        : `even at best-case technology the range is ${(maxRange / 1609.344).toFixed(0)} mi, short of ${(range / 1609.344).toFixed(0)} mi`,
    inputs: {
      totalMass: { value: mass, unit: "kg" },
      payload: { value: payload, unit: "kg", basis: `${seats} × ${b.occupantMassKg.value} kg` },
      batteryFraction: { value: batteryFraction, unit: "1" },
      ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v])),
    },
    outputs: { maxRange: { value: maxRange, unit: "m" }, requiredRange: { value: range, unit: "m" } },
    alternatives,
  };
}

const SCREENS = [
  { id: "electric-aircraft-range", match: (intent) => /\b(aircraft|airplane|aeroplane|plane)\b/i.test(intent) && /\belectric|battery\b/i.test(intent), run: screenElectricAircraft },
];

export function checkFeasibility(parsed, overrides = {}) {
  const req = Object.fromEntries((parsed.requirements || []).map((r) => [r.metric, r]));
  const intent = parsed.intent || "";
  const screens = SCREENS.filter((s) => s.match(intent));
  if (!screens.length) {
    return { status: "NO_SCREEN", reason: "no feasibility screen for this kind of design yet; nothing is assumed to be feasible", results: [] };
  }
  const results = screens.map((s) => s.run(req, overrides));
  const status = results.some((r) => r.status === "FAIL") ? "FAIL" : results.every((r) => r.status === "PASS") ? "PASS" : "NOT_COMPUTED";
  return { status, results };
}
