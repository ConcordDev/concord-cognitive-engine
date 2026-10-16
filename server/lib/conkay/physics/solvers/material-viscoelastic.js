// server/lib/conkay/physics/solvers/material-viscoelastic.js
//
// Blend D brief item 5: viscoelastic and impact SCREENING on a Material node.
//
//   material.viscoelastic-prony — E(t) from a Prony series: the material's own
//     (props.viscoelastic.prony, with its source) or, for an unfilled HDPE, the
//     cited HDPE series (Segura-Méndez 2025). A filled compound has no series
//     until a DMA / relaxation test of that compound: NOT computed, with the
//     HDPE matrix reference attached and labelled as not the compound. Another
//     temperature needs a shift (props.viscoelastic.shift: WLF or Arrhenius).
//   material.impact-recovery-screen — for a strain amplitude and frequency: E′,
//     E″, tan δ, energy dissipated per cycle vs peak stored. "Deforms and returns"
//     only within the strain the series was measured at; past it the response is
//     strain-dependent (WARN); past yield the set is permanent (WARN). Charpy /
//     Izod are never predicted.

import { registerSolver } from "../registry.js";
import { setup, formulated } from "./material-stiffness.js";
import {
  relaxationModulus, cycleEnergy, wlfShift, arrheniusShift,
  HDPE_PRONY_SEGURA_2025, HDPE_LINEAR_STRAIN_LIMIT, HDPE_YIELD_STRAIN,
} from "../../knowledge/viscoelastic.js";

const IMPACT_TESTS = "Charpy (ISO 179) / Izod (ASTM D256) impact strength is not predicted by any model here: a lab test only";

/** The series for this material, or { reason } (with the matrix reference for a filled compound). */
function seriesFor(ir, given) {
  if (given?.prony) {
    if (!given.source) return { reason: "props.viscoelastic.prony needs its source (a DMA / relaxation test of this material)" };
    return { prony: given.prony, source: given.source, strain: given.strain ?? null };
  }
  const classes = ir.constituents.map((c) => c.classId);
  if (classes.length === 1 && classes[0] === "hdpe") {
    const set = HDPE_PRONY_SEGURA_2025.sets[0];
    return { prony: set, source: HDPE_PRONY_SEGURA_2025.source, strain: set.strain, cited: true };
  }
  return {
    reason: `no relaxation data for this compound (${ir.constituents.map((c) => c.id).join(", ")}): its Prony series is unknown until a DMA / stress-relaxation test of the compound; the unfilled-HDPE series is not the compound's`,
    matrixReference: classes.includes("hdpe") ? HDPE_PRONY_SEGURA_2025 : null,
  };
}

function shiftFor(given, T) {
  if (T == null) return { aT: 1, basis: "at the test temperature of the series" };
  const sh = given?.shift;
  if (!sh) return { reason: `no time–temperature shift for ${T} K: no HDPE α-relaxation activation energy (Arrhenius) or WLF constants were read; give props.viscoelastic.shift` };
  if (sh.kind === "arrhenius") return { aT: arrheniusShift(sh, T), basis: `Arrhenius, Ea ${sh.Ea} J/mol, Tref ${sh.Tref} K (${sh.source || "source not given"})` };
  if (sh.kind === "wlf") return { aT: wlfShift(sh, T), basis: `WLF (${sh.source || "source not given"}); HDPE is semicrystalline and its α-relaxation is not a glass transition: WLF is out of its usual regime here`, warn: true };
  return { reason: "props.viscoelastic.shift.kind must be arrhenius or wlf" };
}

export const viscoelasticProny = registerSolver({
  id: "material.viscoelastic-prony",
  version: "1.0.0",
  domain: "material.viscoelastic",
  fidelity: 1,
  method: "Generalized Maxwell (Prony) relaxation modulus E(t) = E∞ + Σ E_q exp(−t/(a_T τ_q))",
  reference: "server/lib/conkay/knowledge/viscoelastic.js",
  regime: "linear viscoelastic, at the strain and temperature the series was measured at; t within the measured window",
  units: { inputs: "Pa, s, K", outputs: "Pa" },
  tolerance: "the series' own fit (HDPE: R² 0.98–0.99 over 1000 s steps, Segura-Méndez 2025 Table 6)",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const given = ctx.get(id, "props.viscoelastic") || {};
    const ser = seriesFor(s.ir, given);
    if (ser.reason) {
      return {
        notComputed: ser.reason,
        outputs: ser.matrixReference ? { hdpeMatrixReference: { value: ser.matrixReference, note: "the unfilled HDPE matrix's measured series — NOT the compound's" } } : {},
      };
    }
    const sh = shiftFor(given, given.temperatureK);
    if (sh.reason) return { notComputed: sh.reason };
    const times = Array.isArray(given.timesS) && given.timesS.length ? given.timesS : [0, 1, 10, 100, 1000];
    const window = ser.cited ? HDPE_PRONY_SEGURA_2025.stepDurationS : given.windowS ?? null;
    const warnings = [];
    if (window != null && times.some((t) => t > window)) warnings.push(`times past ${window} s are beyond the measured relaxation steps: extrapolated`);
    if (sh.warn) warnings.push(sh.basis);
    if (ser.cited) warnings.push(`the cited series was measured at ${ser.strain * 100} % strain, temperature not stated; the modulus falls with strain (Segura-Méndez 2025 Table 6), so linearity is not demonstrated`);
    return {
      inputs: { series: { value: ser.prony, source: ser.source }, shift: { value: sh.aT, basis: sh.basis } },
      outputs: { relaxationModulus: { value: times.map((t) => ({ t, E: relaxationModulus(ser.prony, t, sh.aT) })), unit: "Pa" } },
      warnings,
    };
  },
});

export const impactRecoveryScreen = registerSolver({
  id: "material.impact-recovery-screen",
  version: "1.0.0",
  domain: "material.viscoelastic",
  fidelity: 0,
  method: "Prony dynamic moduli at the load frequency: E′, E″, tan δ; energy dissipated per cycle π ε0² E″ vs peak stored ½ ε0² E′; strain checked against the series' measured strain and the yield strain",
  reference: "server/lib/conkay/knowledge/viscoelastic.js",
  regime: "small-amplitude cyclic load within the series' measured strain; impact (fracture) energy is a test, never predicted",
  units: { inputs: "1 (strain), Hz", outputs: "Pa, J/m3" },
  tolerance: "screening; a 'returns' verdict only inside the measured strain",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const given = ctx.get(id, "props.viscoelastic") || {};
    const load = ctx.get(id, "props.impact") || {};
    const need = [];
    if (!(load.strainAmplitude > 0)) need.push("props.impact.strainAmplitude");
    if (!(load.frequencyHz > 0)) need.push("props.impact.frequencyHz");
    const ser = seriesFor(s.ir, given);
    if (ser.reason) need.push(ser.reason);
    if (need.length) return { notComputed: `${need.join("; ")}. ${IMPACT_TESTS}`, outputs: { charpyIzod: { value: "not predicted (lab test)" } } };
    const e = cycleEnergy(ser.prony, { strainAmplitude: load.strainAmplitude, omega: 2 * Math.PI * load.frequencyHz });
    const linearLimit = ser.strain ?? HDPE_LINEAR_STRAIN_LIMIT;
    const yieldStrain = ser.cited ? HDPE_YIELD_STRAIN : given.yieldStrain ?? null;
    const warnings = [IMPACT_TESTS];
    let verdict;
    if (yieldStrain != null && load.strainAmplitude > yieldStrain) {
      verdict = `beyond the yield strain (${yieldStrain * 100} %): permanent set — it does not return`;
      warnings.push(verdict);
    } else if (load.strainAmplitude > linearLimit) {
      verdict = `above the ${linearLimit * 100} % strain the series was measured at: the response is strain-dependent and recovery is not shown`;
      warnings.push(verdict);
    } else {
      verdict = `within the ${linearLimit * 100} % strain the series was measured at: deforms and returns (linear viscoelastic); each cycle dissipates ΔW/W = 2π·tan δ = ${(2 * Math.PI * e.tanDelta * 100).toFixed(0)} % of the peak stored energy (tan δ ${e.tanDelta.toFixed(3)})`;
    }
    return {
      inputs: { strainAmplitude: { value: load.strainAmplitude }, frequencyHz: { value: load.frequencyHz }, series: { value: ser.source } },
      outputs: {
        dynamic: { value: { storage: e.storage, loss: e.loss, tanDelta: e.tanDelta }, unit: "Pa" },
        energy: { value: { dissipatedPerCycle: e.dissipatedPerCycle, peakStored: e.peakStored }, unit: "J/m3" },
        verdict: { value: verdict },
        charpyIzod: { value: "not predicted (lab test)" },
      },
      warnings,
    };
  },
});
