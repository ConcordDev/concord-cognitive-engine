// server/lib/conkay/fluids/coolant-loop.js
//
// Engine coolant-loop screen for the library car: an electric pump (sourced
// curve points), the hoses (design choices), the engine block and the
// radiator, with water properties from the NIST WebBook connector at the
// loop's design temperature.
//
// What is and is not computed:
//   - required coolant flow = heat to coolant / (rho cp dT): heat to coolant is
//     an ESTIMATED fraction of the engine's sourced peak power; dT across the
//     radiator is a design choice;
//   - hose and fitting losses at that flow (Darcy-Weisbach / Colebrook);
//   - the pump's pressure rise at that flow, only inside its published points;
//   - the pressure left for the engine block and radiator together: neither
//     publishes a pressure drop, so the loop's operating point is NOT claimed;
//     the budget is what they may consume at the required flow;
//   - the operating point with the hoses only, labelled an UPPER BOUND on flow.

import { isobar } from "../knowledge/connectors/nist-webbook.js";

export const COOLANT_LOOP_VERSION = "1.0.0";
const LPM = 1 / 60000;

export const PUMP_CWA400 = Object.freeze({
  id: "pierburg-cwa400-7.03665.66.0",
  model: "Pierburg CWA400 electric coolant pump (7.03665.66.0)",
  points: [{ Q: 150 * LPM, dp: 0.85e5 }, { Q: 220 * LPM, dp: 0.55e5 }],
  state: "sourced",
  sourceQuality: "secondary: the CWA400_EN datasheet as quoted on the rusefi forum; the primary PDF could not be retrieved (HTTP 404)",
  excerpt: "approx. 150l/min @ 0.85bar / 220l/min @ 0.55bar",
  source: { title: "rusefi.com forum: Pierburg CWA400 (quoting the CWA400_EN.pdf datasheet, Pierburg 7.03665.66.0)", url: "https://www.rusefi.com/forum/viewtopic.php?p=41380", retrieved: "2026-10-09" },
  testConditions: { state: "unknown", note: "the test fluid and temperature of the curve were not in the source read; the curve is applied to water at the loop temperature without a density correction" },
});

export const LOOP_CHOICES = Object.freeze({
  designTempK: { value: 363.15, state: "design choice", basis: "coolant at 90 C (thermostat-open running)" },
  radiatorDeltaT: { value: 10, state: "design choice", basis: "coolant temperature drop across the radiator at full load" },
  heatToCoolantFraction: { value: 0.7, range: [0.5, 1.0], state: "estimated", basis: "heat to coolant at peak power as a fraction of brake power; no heat-rejection data published for this engine (order of magnitude from SI-engine energy balances)" },
  hoseId: { value: 0.038, state: "design choice", basis: "38 mm (1.5 in) hose bore; the radiator kit's hose sizes are not published" },
  hoseLength: { value: 3.0, state: "design choice", basis: "total hose run engine to radiator and back" },
  hoseRoughness: { value: 1.5e-6, range: [0, 1e-5], state: "estimated", basis: "smooth rubber hose; no roughness published" },
  bends: { value: 8, state: "design choice", basis: "smooth hose bends in the run" },
  bendK: { value: 0.3, range: [0.15, 0.6], state: "estimated", basis: "smooth 90-degree hose bend loss coefficient; no fitting data published for these hoses" },
  pumpsInParallel: { value: 1, state: "design choice", basis: "number of identical pumps in parallel" },
});

/** Water at the loop's design temperature from the NIST connector (getter: live or replay). */
export async function waterAt(tK, get) {
  const r = await isobar("7732-18-5", "water", { pMPa: 0.101325, tLowK: 343.15, tHighK: 363.15, tIncK: 5 }, get);
  if (!r.ok) throw new Error(`NIST water properties not available: ${r.reason}`);
  const pick = (prop) => r.claims.find((c) => c.property === prop && Math.abs(c.conditions.temperature - tK) < 1e-6);
  const rho = pick("liquid_density"), mu = pick("dynamic_viscosity"), cp = pick("specific_heat_capacity");
  if (!rho || !mu || !cp) throw new Error(`NIST data have no row at ${tK} K`);
  const strip = (c) => ({ id: c.id, value: c.value, unit: c.unit, uncertainty: c.uncertainty, evidence: c.evidence.map((e) => ({ url: e.url, locator: e.locator, retrieved: e.retrieved, sha256: e.sha256 })) });
  return { rho: strip(rho), mu: strip(mu), cp: strip(cp), reviews: r.reviews, validRangeK: [343.15, 363.15] };
}

/** Add the coolant-loop screen to a car IR (async: reads water properties through the getter). */
export async function withCoolantLoop(ir, { get, choices = {}, pump = PUMP_CWA400 } = {}) {
  const c = { ...LOOP_CHOICES, ...choices };
  const out = JSON.parse(JSON.stringify(ir));
  const rad = out.nodes.find((n) => n.id === "RADIATOR");
  if (!rad || !out.nodes.find((n) => n.id === "ENGINE")) throw new Error("car IR needs ENGINE and RADIATOR");
  const water = await waterAt(c.designTempK.value, get);
  rad.props.coolantLoop = { engine: "ENGINE", pump, water, choices: c };
  return out;
}
