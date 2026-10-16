// server/lib/conkay/physics/solvers/pressure-vessel.js
//
// Blend D brief item 9 on any node with props.pressureVessel
//   { innerRadiusM, wallThicknessM, lengthM, nwpPa,
//     wallStrengthPa: { lo, hi, source }, glassFibrePrimary,
//     crash: { energyJ }, modulusPa: { lo, hi, source } }
// The wall's strength and modulus come from props or the node's material; a
// material without them (USB Blend D) is NOT computed, with the reason.

import { registerSolver } from "../registry.js";
import { wallStress, burstPressure, requiredBurstRatio, thicknessForBurst, crashStrain, R134_BURST } from "../../knowledge/pressure-vessel.js";
import { HDPE_YIELD_STRAIN, HDPE_LINEAR_STRAIN_LIMIT } from "../../knowledge/viscoelastic.js";

const vessels = (g) => [...g.nodes.values()].filter((n) => n.props?.pressureVessel).map((n) => n.id);
const geomMissing = (v) => ["innerRadiusM", "wallThicknessM", "nwpPa"].filter((k) => !(v?.[k] > 0)).map((k) => `props.pressureVessel.${k}`);
const SEAL = "seal integrity after a crash is not computed: no material-level model shows a seal holds; it needs a vessel test (ISO 19881 / SAE J2579 / UN R134 sequences)";

function strengthOf(ctx, id, v) {
  if (v.wallStrengthPa?.lo > 0) return { lo: v.wallStrengthPa.lo, hi: v.wallStrengthPa.hi ?? v.wallStrengthPa.lo, source: v.wallStrengthPa.source || "props.pressureVessel.wallStrengthPa" };
  const m = ctx.material(id);
  const s = m?.ultimatePa ?? m?.yieldPa;
  if (s > 0) return { lo: s, hi: s, source: `${m.label} (${m.ultimatePa ? "ultimate" : "yield"})` };
  return { reason: m ? `${m.label}: ${m.unknown?.ultimatePa || m.unknown?.yieldPa || "no strength"}` : "no wall material and no props.pressureVessel.wallStrengthPa" };
}

function modulusOf(ctx, id, v) {
  if (v.modulusPa?.lo > 0) return { lo: v.modulusPa.lo, hi: v.modulusPa.hi ?? v.modulusPa.lo, source: v.modulusPa.source || "props" };
  const m = ctx.material(id);
  if (m?.youngsModulusPa > 0) return { lo: m.youngsModulusPa, hi: m.youngsModulusPa, source: m.label };
  return { reason: m ? `${m.label}: ${m.unknown?.youngsModulusPa || "no modulus"}` : "no wall material and no props.pressureVessel.modulusPa" };
}

const common = { domain: "vessel.structure", reference: "server/lib/conkay/knowledge/pressure-vessel.js", screening: true, targets: vessels };

export const hoopStress = registerSolver({
  ...common,
  id: "vessel.hoop-stress",
  version: "1.0.0",
  fidelity: 1,
  method: "Thin-wall σθ = p·r/t (t/r ≤ 0.1, mean radius), else Lamé thick-wall stresses at the bore",
  regime: "a closed cylinder under internal pressure, linear elastic, isotropic homogeneous wall; no end-closure, nozzle or overwrap stresses",
  units: { inputs: "m, Pa", outputs: "Pa" },
  tolerance: "exact for the model; Lamé identities checked in tests (Roark / ASME VIII not read)",
  run(ctx, id) {
    const v = ctx.get(id, "props.pressureVessel");
    const miss = geomMissing(v);
    if (miss.length) return { notComputed: `missing: ${miss.join(", ")}` };
    const s = wallStress({ p: v.nwpPa, innerRadius: v.innerRadiusM, thickness: v.wallThicknessM });
    const st = strengthOf(ctx, id, v);
    return {
      inputs: { nwp: { value: v.nwpPa, unit: "Pa" }, thicknessRatio: { value: s.ratio } },
      outputs: { stress: { value: s, unit: "Pa" } },
      margins: st.reason ? [] : [{ check: "hoop stress at NWP ≤ wall strength (low end)", demand: s.hoop, capacity: st.lo, unit: "Pa", basis: st.source }],
      warnings: st.reason ? [`no comparison with strength: ${st.reason}`] : [],
    };
  },
});

export const burstMargin = registerSolver({
  ...common,
  id: "vessel.burst-margin",
  version: "1.0.0",
  fidelity: 1,
  method: "Lamé burst p_b = S(b² − a²)/(b² + a²) against UN R134 §5.1.1 BPmin (200 % NWP; 350 % for glass-fibre-primary containers)",
  regime: "monolithic isotropic wall reaching its strength at the bore; a Type IV liner carries no pressure and an overwrap is not modelled here",
  units: { inputs: "m, Pa", outputs: "Pa, ratio" },
  tolerance: "screening: strength spread and the single-wall model; burst is a test (UN R134 / ISO 19881 / SAE J2579)",
  run(ctx, id) {
    const v = ctx.get(id, "props.pressureVessel");
    const miss = geomMissing(v);
    const st = strengthOf(ctx, id, v);
    if (miss.length || st.reason) return { notComputed: [miss.length ? `missing: ${miss.join(", ")}` : null, st.reason ? `no wall strength — ${st.reason}` : null].filter(Boolean).join("; ") };
    const ratio = requiredBurstRatio({ glassFibrePrimary: v.glassFibrePrimary === true });
    const pb = burstPressure({ strength: st.lo, innerRadius: v.innerRadiusM, thickness: v.wallThicknessM });
    const tNeed = thicknessForBurst({ strength: st.lo, innerRadius: v.innerRadiusM, nwp: v.nwpPa, ratio });
    return {
      inputs: { strength: { value: st, unit: "Pa" }, requirement: { value: ratio, source: R134_BURST.source } },
      outputs: {
        burstPressure: { value: pb, unit: "Pa", basis: "at the low end of the strength" },
        burstRatio: { value: pb / v.nwpPa },
        wallForRequirement: { value: Number.isFinite(tNeed) ? tNeed : null, unit: "m", note: Number.isFinite(tNeed) ? "monolithic wall that would reach BPmin" : `no wall thickness reaches ${ratio}× NWP: the strength is at or below ${ratio}× NWP` },
      },
      margins: [{ check: `burst ≥ ${ratio * 100} % NWP (UN R134 §5.1.1)`, demand: ratio * v.nwpPa, capacity: pb, unit: "Pa" }],
      warnings: ["burst is qualified by test, not by this screen", "a polymer chamber at these pressures is a Type IV liner inside a carbon-fibre overwrap; the overwrap carries the pressure"],
    };
  },
});

export const crashSealScreen = registerSolver({
  ...common,
  id: "vessel.crash-seal-screen",
  version: "1.0.0",
  fidelity: 0,
  method: "Uniform strain-energy screen: mean wall strain √(2U/(E·V)) against the wall's tested linear strain and yield strain; seal integrity always NOT computed",
  regime: "crude: the crash energy taken by the chamber spread uniformly through its wall; real crush is local",
  units: { inputs: "J, Pa, m", outputs: "strain" },
  tolerance: "order of magnitude only",
  run(ctx, id) {
    const v = ctx.get(id, "props.pressureVessel");
    const need = [];
    if (!(v?.crash?.energyJ > 0)) need.push("props.pressureVessel.crash.energyJ (the energy the chamber takes in the crash case)");
    const miss = ["innerRadiusM", "wallThicknessM", "lengthM"].filter((k) => !(v?.[k] > 0)).map((k) => `props.pressureVessel.${k}`);
    if (miss.length) need.push(`missing: ${miss.join(", ")}`);
    const mod = modulusOf(ctx, id, v);
    if (mod.reason) need.push(`no wall modulus — ${mod.reason}`);
    if (need.length) return { notComputed: `${need.join("; ")}. ${SEAL}`, outputs: { seal: { value: "not computed — needs a vessel test" } } };
    const a = v.innerRadiusM, b = a + v.wallThicknessM;
    const volume = Math.PI * (b * b - a * a) * v.lengthM + 2 * Math.PI * b * b * v.wallThicknessM;
    const strain = crashStrain({ energyJ: v.crash.energyJ, modulusPa: mod.lo, wallVolumeM3: volume });
    const yieldStrain = v.yieldStrain ?? HDPE_YIELD_STRAIN, linear = v.linearStrain ?? HDPE_LINEAR_STRAIN_LIMIT;
    const verdict = strain > yieldStrain ? "past yield on average: permanent deformation of the wall" : strain > linear ? "above the tested linear strain: recovery not shown" : "within the tested linear strain on average (a local crush can still exceed it)";
    return {
      inputs: { energyJ: { value: v.crash.energyJ }, modulus: { value: mod }, wallVolumeM3: { value: volume } },
      outputs: { meanStrain: { value: strain, basis: "uniform strain energy" }, verdict: { value: verdict }, seal: { value: "not computed — needs a vessel test" } },
      warnings: [SEAL, verdict],
    };
  },
});
