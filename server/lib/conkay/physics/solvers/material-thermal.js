// server/lib/conkay/physics/solvers/material-thermal.js
//
// Blend D brief item 4: thermal screening on a Material node (props.formulation
// + optional props.micromechanics, as in material-stiffness.js).
//
//   material.k-maxwell-garnett — spheres, two phases, no interfacial resistance;
//   material.k-lewis-nielsen   — two phases; A and φ_max given, or the cited
//                                sphere values (A 1.5, φ_max 0.6, Bleija 2024);
//   material.cte-turner        — two phases, needs α and K (from E, ν) of both;
//   material.cte-schapery      — two phases, the Hashin–Shtrikman CTE bounds;
//   material.thermal-transitions — the polymer matrix's sourced Tm / Tc with the
//                                filler note: no prediction;
//   material.heat-dissipation-screen — graphene-filled polymers against the
//                                measured HDPE/GnP data (Evgin et al. 2020).
// The interfacial (Kapitza) thermal resistance is an explicit unknown: every
// conductivity here is an upper estimate for a perfectly bonded filler.

import { registerSolver } from "../registry.js";
import { setup, twoPhase, blocked, formulated, span, mid } from "./material-stiffness.js";
import { maxwellK, lewisNielsenK, cteTurner, cteSchapery } from "../../knowledge/thermal-models.js";
import { bulkShear } from "../../knowledge/micromechanics.js";
import { massToVolumeFractions, PE_FAMILY_SPAN } from "../../knowledge/material-ir.js";
import { constituentProperty } from "../../knowledge/constituent-properties.js";

const KAPITZA = "interfacial (Kapitza) thermal resistance: unknown and not in the model, so this is an upper estimate for a perfectly bonded filler";
/** Lewis–Nielsen sphere constants as used by Bleija et al., Sci. Rep. 2024, 14, 13629 §3 (body-centred cubic packing). */
export const LN_SPHERES = Object.freeze({ A: 1.5, phiMax: 0.6, source: "Bleija et al., Sci. Rep. 2024, 14, 13629, §3: 'for spherical particles, A = 1.5 and V fmax = 0.6 (body-centered cubic arrangement)'" });

const kOf = (c) => span(c.properties.conductivity);

const thermal = { units: { inputs: "W/(m·K), 1/K, Pa", outputs: "W/(m·K), 1/K" }, screening: true, targets: formulated };

function twoPhaseInputs(s, needs) {
  const tp = twoPhase(s.ir, s.micro);
  if (tp.notComputed) { s.blockers.push(tp.notComputed); return null; }
  for (const [key, label] of needs) {
    for (const c of [tp.matrix, tp.filler]) if (!c.properties[key]) s.blockers.push(`no cited ${label} for ${c.id}`);
  }
  return tp;
}

export const kMaxwell = registerSolver({
  id: "material.k-maxwell-garnett",
  version: "1.0.0",
  domain: "material.thermal-conductivity",
  fidelity: 1,
  method: "Maxwell (Maxwell–Garnett): k_c/k_m = (k_f + 2k_m + 2φ(k_f − k_m))/(k_f + 2k_m − φ(k_f − k_m))",
  reference: "server/lib/conkay/knowledge/thermal-models.js",
  regime: "spherical, well-dispersed filler, two phases, no interfacial resistance, dilute to moderate φ (against FEA within 2 % at 35 vol %: Yun et al. 2023)",
  tolerance: "−2 % against FEA at 35 vol % (Yun et al. 2023); −27 … +2 % against measured oxide/PBSA data (Bleija et al. 2024)",
  ...thermal,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    if (s.micro.shape !== "sphere") s.blockers.push("Maxwell is a sphere model (props.micromechanics.shape = sphere); platelets and fibres are not claimed");
    const tp = twoPhaseInputs(s, [["conductivity", "thermal conductivity"]]);
    if (s.blockers.length) return blocked(s.blockers);
    const phi = s.phi[s.ir.constituents.indexOf(tp.filler)];
    const km = kOf(tp.matrix), kf = kOf(tp.filler);
    return {
      inputs: { phi: { value: phi }, km: { value: km }, kf: { value: kf } },
      outputs: { conductivity: { value: { low: maxwellK({ km: km.lo, kf: kf.lo, phi }), nominal: maxwellK({ km: mid(km), kf: mid(kf), phi }), high: maxwellK({ km: km.hi, kf: kf.hi, phi }) }, unit: "W/(m·K)" } },
      warnings: [KAPITZA],
    };
  },
});

export const kLewisNielsen = registerSolver({
  id: "material.k-lewis-nielsen",
  version: "1.0.0",
  domain: "material.thermal-conductivity",
  fidelity: 1,
  method: "Lewis–Nielsen: k_c/k_m = (1 + A·B·φ)/(1 − B·Ψ·φ), B = (k_f/k_m − 1)/(k_f/k_m + A), Ψ = 1 + φ(1 − φ_max)/φ_max²",
  reference: "server/lib/conkay/knowledge/thermal-models.js",
  regime: "two phases; A and φ_max stated for the filler's shape and packing (spheres: A 1.5, φ_max 0.6 as cited); φ < φ_max; no interfacial resistance",
  tolerance: "−17 … +14 % against measured oxide/PBSA data (Bleija et al. 2024)",
  ...thermal,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const ln = s.micro.lewisNielsen || (s.micro.shape === "sphere" ? LN_SPHERES : null);
    if (!ln) s.blockers.push("Lewis–Nielsen needs A and φ_max for the filler's shape (props.micromechanics.lewisNielsen); only the sphere values are cited here");
    const tp = twoPhaseInputs(s, [["conductivity", "thermal conductivity"]]);
    if (s.blockers.length) return blocked(s.blockers);
    const phi = s.phi[s.ir.constituents.indexOf(tp.filler)];
    if (!(phi < ln.phiMax)) return { notComputed: `φ = ${phi.toFixed(3)} is at or above φ_max = ${ln.phiMax}: outside the model` };
    const km = kOf(tp.matrix), kf = kOf(tp.filler);
    const f = (a, b) => lewisNielsenK({ km: a, kf: b, phi, A: ln.A, phiMax: ln.phiMax });
    return {
      inputs: { phi: { value: phi }, A: { value: ln.A }, phiMax: { value: ln.phiMax, source: ln.source || "props.micromechanics.lewisNielsen" } },
      outputs: { conductivity: { value: { low: f(km.lo, kf.lo), nominal: f(mid(km), mid(kf)), high: f(km.hi, kf.hi) }, unit: "W/(m·K)" } },
      warnings: [KAPITZA],
    };
  },
});

function cteInputs(s) {
  const tp = twoPhaseInputs(s, [["cte", "CTE"], ["youngsModulus", "Young's modulus"], ["poisson", "Poisson's ratio"]]);
  if (!tp || s.blockers.length) return null;
  const kg = (c) => bulkShear(mid(span(c.properties.youngsModulus)), mid(span(c.properties.poisson)));
  return { tp, m: kg(tp.matrix), f: kg(tp.filler), phi: s.phi[s.ir.constituents.indexOf(tp.filler)] };
}

export const cteTurnerSolver = registerSolver({
  id: "material.cte-turner",
  version: "1.0.0",
  domain: "material.cte",
  fidelity: 1,
  method: "Turner: α = Σ φ_i α_i K_i / Σ φ_i K_i (bulk moduli from E, ν)",
  reference: "server/lib/conkay/knowledge/thermal-models.js",
  regime: "two isotropic phases, perfect bond; it weights the stiff phase heavily and under-predicts a soft-matrix composite (4× below FEA for 35 vol % basalt in PP: Yun et al. 2023)",
  tolerance: "not a bound; use material.cte-schapery for bounds",
  ...thermal,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const q = cteInputs(s);
    if (s.blockers.length) return blocked(s.blockers);
    const am = mid(span(q.tp.matrix.properties.cte)), af = mid(span(q.tp.filler.properties.cte));
    return {
      outputs: { cte: { value: cteTurner([{ phi: 1 - q.phi, alpha: am, K: q.m.K }, { phi: q.phi, alpha: af, K: q.f.K }]), unit: "1/K", basis: "at the midpoints of the cited intervals" } },
      warnings: ["Turner under-predicts soft-matrix composites; see the Schapery bounds"],
    };
  },
});

export const cteSchaperySolver = registerSolver({
  id: "material.cte-schapery",
  version: "1.0.0",
  domain: "material.cte",
  fidelity: 1,
  method: "Schapery: α = α_m + (α_f − α_m)(1/K − 1/K_m)/(1/K_f − 1/K_m) at the Hashin–Shtrikman bulk-modulus bounds",
  reference: "server/lib/conkay/knowledge/thermal-models.js",
  regime: "two isotropic phases, perfect bond; FEA of 35 vol % basalt in PP/PA6/PA66 sits within 1 % of the upper bound (Yun et al. 2023)",
  tolerance: "bounds; FEA within 1 % of the upper bound (Yun et al. 2023)",
  ...thermal,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const q = cteInputs(s);
    if (s.blockers.length) return blocked(s.blockers);
    const r = cteSchapery({ alphaM: mid(span(q.tp.matrix.properties.cte)), alphaF: mid(span(q.tp.filler.properties.cte)), Km: q.m.K, Gm: q.m.G, Kf: q.f.K, Gf: q.f.G, phi: q.phi });
    return { outputs: { cte: { value: r, unit: "1/K", basis: "bounds at the midpoints of the cited intervals" } }, warnings: ["bounds, not a prediction"] };
  },
});

export const thermalTransitions = registerSolver({
  id: "material.thermal-transitions",
  version: "1.0.0",
  domain: "material.thermal-transitions",
  fidelity: 0,
  method: "Reports the polymer matrix's sourced melting and crystallization temperatures with the filler note; predicts nothing",
  reference: "server/lib/conkay/knowledge/constituent-properties.js",
  regime: "the matrix's own transitions; fillers shift crystallization (nucleation) and are not modelled",
  tolerance: "the span of the cited values",
  ...thermal,
  units: { inputs: "—", outputs: "K" },
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const hdpe = s.ir.constituents.filter((c) => c.classId === "hdpe");
    if (!hdpe.length) return { notComputed: "no HDPE matrix constituent: no sourced transitions for this matrix" };
    const tm = constituentProperty("hdpe", "meltTemperature"), tc = constituentProperty("hdpe", "crystallizationTemperature");
    const others = s.ir.constituents.filter((c) => c.classId !== "hdpe").map((c) => c.id);
    return {
      outputs: {
        meltTemperature: { value: { low: tm.range.min, high: tm.range.max }, unit: "K", source: tm.id },
        crystallizationTemperature: { value: { low: tc.range.min, high: tc.range.max }, unit: "K", source: tc.id },
      },
      warnings: [
        `the HDPE matrix's own values, not the compound's: ${others.join(", ")} can shift crystallization (graphene nanoplatelets raised T_c by 1–5 °C in HDPE, Evgin et al. 2020 Table 2); measure the compound by DSC (ASTM D3418)`,
        ...(others.some((id) => /co-polymer/.test(id)) ? ["the HDPE/HC co-polymer is unidentified: its own transitions are unknown"] : []),
      ],
    };
  },
});

/** Measured HDPE/GnP data the screen compares against (Evgin et al., Beilstein J. Nanotechnol. 2020, 11, 167). */
export const EVGIN_2020 = Object.freeze({
  kHdpe: 0.386,
  atPhi: 0.1392,
  gains: Object.freeze({ G1: 0.521 / 0.386 - 1, G3: 0.625 / 0.386 - 1, G2: 0.729 / 0.386 - 1 }),
  electricalPercolationPhi: Object.freeze({ G2: 0.0552, G3: 0.0738 }),
  linear: "the thermal conductivity of the nanocomposites increased linearly with the addition of GnPs",
  noThermalPercolation: "No thermal percolation threshold was observed for all types of nanocomposites",
});

export const heatDissipationScreen = registerSolver({
  id: "material.heat-dissipation-screen",
  version: "1.0.0",
  domain: "material.thermal-conductivity",
  fidelity: 0,
  method: "Graphene volume fraction (cited densities; the PE-family assumption A1 for an unidentified polymer, labelled) against measured HDPE/GnP conductivity and percolation (Evgin et al. 2020): the conductivity gain scaled linearly from 13.92 vol %, as the paper reports it rising",
  reference: "server/lib/conkay/physics/solvers/material-thermal.js",
  regime: "HDPE-type matrix, graphene nanoplatelets, φ ≤ 13.92 vol % (the data's range)",
  tolerance: "the spread of the three GnP grades measured; the compound's own k is a test (ASTM E1530)",
  ...thermal,
  targets: (g) => formulated(g).filter((id) => (g.node ? g.node(id) : g.nodes.get(id))?.props?.formulation?.constituents?.some((c) => c.classId === "graphene")),
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const ir = s.ir;
    const gi = ir.constituents.findIndex((c) => c.classId === "graphene");
    let phi = s.phi ? { lo: s.phi[gi], hi: s.phi[gi] } : null;
    let assumption = null;
    if (!phi) {
      const w = ir.constituents.map((c) => ir.nominal.fractions.find((f) => f.id === c.id).pct);
      const dens = ir.constituents.map((c) => c.properties.density || { lo: PE_FAMILY_SPAN.lo, hi: PE_FAMILY_SPAN.hi });
      const r = massToVolumeFractions(w, dens);
      phi = { lo: r.phi[gi].min / 100, hi: r.phi[gi].max / 100 };
      assumption = `A1: ${ir.constituents.filter((c) => !c.properties.density).map((c) => c.id).join(", ")} assumed polyethylene-family (${PE_FAMILY_SPAN.lo}–${PE_FAMILY_SPAN.hi} kg/m3) to place the graphene volume fraction; not established`;
    }
    const e = EVGIN_2020;
    const gainLo = (Math.min(...Object.values(e.gains)) * phi.lo) / e.atPhi;
    const gainHi = (Math.max(...Object.values(e.gains)) * phi.hi) / e.atPhi;
    const perc = Math.min(...Object.values(e.electricalPercolationPhi));
    const below = phi.hi < perc;
    return {
      inputs: { grapheneVolumeFraction: { value: phi, basis: assumption ? "conditional (assumption A1)" : "computed from cited densities" } },
      outputs: {
        conductivityGain: { value: { low: gainLo, high: gainHi }, unit: "1 (fraction over the matrix)", basis: `linear scaling of the measured gains at ${e.atPhi * 100} vol % (Evgin 2020: ${e.linear})` },
        percolation: { value: { electricalThresholdPhi: e.electricalPercolationPhi, thermal: e.noThermalPercolation, belowElectrical: below } },
        verdict: {
          value: below
            ? `graphene at ${(phi.lo * 100).toFixed(2)}–${(phi.hi * 100).toFixed(2)} vol % is below the electrical percolation thresholds measured in HDPE (5.52–7.38 vol %), and HDPE/GnP showed no thermal percolation up to 13.92 vol %: the expected conductivity gain is about ${(gainLo * 100).toFixed(1)}–${(gainHi * 100).toFixed(1)} % over the matrix. A "heat dissipation" claim is not supported by this evidence; measure k (ASTM E1530).`
            : `graphene at ${(phi.lo * 100).toFixed(2)}–${(phi.hi * 100).toFixed(2)} vol % reaches the electrical percolation range measured in HDPE; thermal conductivity still showed no percolation there, so measure k (ASTM E1530) before claiming heat dissipation.`,
        },
      },
      warnings: [...(assumption ? [assumption] : []), "the grade, dispersion and interfacial resistance of the compound's graphene are unknown; the measured data are for named xGnP-type grades in HDPE"],
      assumptions: assumption ? [assumption] : [],
    };
  },
});
