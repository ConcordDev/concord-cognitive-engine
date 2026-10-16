// server/lib/conkay/knowledge/process-window.js
//
// Blend D brief item 8: the processing window of an HDPE-matrix compound
// against sourced HDPE ranges. No viscosity or MFI number is predicted for a
// filled compound: the drop in melt flow with filler is a WARN, not a value.

import { constituentProperty } from "./constituent-properties.js";

const C = (k) => k - 273.15;

/** HDPE melt-processing windows (MOL TIPELIN catalogue 2023, p.9). */
export const HDPE_MELT_WINDOWS = Object.freeze([
  { process: "extrusion", lowC: 170, highC: 220 },
  { process: "blow moulding", lowC: 180, highC: 220 },
  { process: "film", lowC: 200, highC: 220 },
]);

/** Oxidation induction time at 200 °C across MOL blow-moulding grades (EN 728, p.7), minutes: 7 to over 120. */
export const HDPE_OIT_200C_MIN = Object.freeze({ low: 7, high: 120, note: "grade-dependent (antioxidant package); several grades print '>100' or '>120'" });

/** Onset of mass loss of neat HDPE in nitrogen (Evgin et al. 2020 Table 3, T5%): an inert-atmosphere ceiling, not oxidation. */
export const HDPE_T5_N2_C = 440.77;

const TERMS = [{ re: /\bcur(e|ed|ing)\b/i, note: "'cure' is a thermoset term: HDPE is a thermoplastic that is melted and cooled, not cured" }];

/**
 * @param {{ temperatureC: number, process?: string, residenceTimeMin?: number, statedAs?: string }} p
 * Returns { checks: [...], warnings: [...], notComputed: [...] }.
 */
export function processWindow(p) {
  if (!Number.isFinite(p.temperatureC)) throw new RangeError("a processing temperature (°C) is required");
  const T = p.temperatureC;
  const tm = constituentProperty("hdpe", "meltTemperature");
  const tmHi = C(tm.range.max);
  const windows = p.process ? HDPE_MELT_WINDOWS.filter((w) => w.process === p.process) : HDPE_MELT_WINDOWS;
  const inside = windows.filter((w) => T >= w.lowC && T <= w.highC).map((w) => w.process);
  const checks = [
    { id: "above-melting", pass: T > tmHi, detail: `${T} °C vs HDPE melting ${C(tm.range.min).toFixed(1)}–${tmHi.toFixed(2)} °C (cited)` },
    { id: "in-melt-window", pass: inside.length > 0, detail: inside.length ? `inside the ${inside.join(", ")} window (MOL 2023 p.9)` : `outside ${windows.map((w) => `${w.process} ${w.lowC}–${w.highC} °C`).join("; ")} (MOL 2023 p.9)` },
    { id: "below-inert-onset", pass: T < HDPE_T5_N2_C, detail: `below the ${HDPE_T5_N2_C} °C onset of mass loss in nitrogen (Evgin 2020) — an inert-atmosphere ceiling; in oxygen, HDPE grades oxidise within ${HDPE_OIT_200C_MIN.low}–${HDPE_OIT_200C_MIN.high}+ min at 200 °C (OIT, MOL 2023 p.7)` },
  ];
  const warnings = [];
  if (!inside.length) warnings.push(`out of the sourced HDPE melt window: ${checks[1].detail}`);
  if (!checks[0].pass) warnings.push(`not above the HDPE melting range: the matrix is not molten at ${T} °C`);
  for (const t of TERMS) if (p.statedAs && t.re.test(p.statedAs)) warnings.push(`terminology: ${t.note} (stated: "${p.statedAs}")`);
  warnings.push("filler loading raises melt viscosity and lowers MFI; the compound's MFI is a test (ASTM D1238), no number is predicted here");
  const notComputed = [
    "graphene dispersion state (method and degree of exfoliation): not stated, so its effect on the melt and on properties is not computed",
    "basalt fibre length after compounding (attrition in the extruder): not stated, so fibre reinforcement is not computed",
  ];
  if (Number.isFinite(p.residenceTimeMin)) {
    if (T >= 200) warnings.push(`residence ${p.residenceTimeMin} min at ${T} °C vs HDPE oxidation induction times of ${HDPE_OIT_200C_MIN.low}–${HDPE_OIT_200C_MIN.high}+ min at 200 °C (MOL 2023 p.7, grade-dependent): the compound's own OIT is unknown`);
  } else {
    notComputed.push("residence time at temperature: not stated, so oxidative degradation in the melt (HDPE OIT at 200 °C ranges 7 to over 120 min by grade) is not assessed");
  }
  return { checks, warnings, notComputed };
}
