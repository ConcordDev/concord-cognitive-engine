// server/lib/conkay/physics/solvers/vessel-h2.js
//
// Blend D brief item 6: vessel.h2-permeation on a Material node with
// props.formulation and optional props.h2Vessel:
//   { permeability: { P, T, source } (the compound's own, measured),
//     linerThicknessM, innerAreaM2, waterVolumeL, nwpPa, temperatureK,
//     activationEnergyJmol: { value, source }, platelet: { aspectRatio } }
// Material level: the matrix's measured P (HDPE: Dong 2023, 288 K) against the
// T/CATSI material limits. Vessel level: Q = P·A·Δp/L per litre against
// ISO 19881 (needs the chamber geometry). Another temperature needs Ep (not
// read for HDPE). The verdict always states the Type IV architecture.

import { registerSolver } from "../registry.js";
import { setup, formulated } from "./material-stiffness.js";
import { arrheniusPermeability, nielsenRatio, wallLeakRate, DONG_2023_TABLE4, H2_LIMITS, TYPE_IV_NOTE } from "../../knowledge/h2-permeation.js";

const TEST = "measure the compound: ASTM D1434 / ISO 15105-1 gas permeability, and the vessel per ISO 19881 / SAE J2579";

export const h2Permeation = registerSolver({
  id: "vessel.h2-permeation",
  version: "1.0.0",
  domain: "vessel.h2-permeation",
  fidelity: 1,
  method: "Steady permeation Q = P·A·Δp/L (P measured, Arrhenius in T with a stated Ep); platelet barrier by Nielsen tortuosity as an upper bound; limits as quoted by Li et al. 2023",
  reference: "server/lib/conkay/knowledge/h2-permeation.js",
  regime: "steady-state permeation through a polymer wall at the measured temperature (or shifted with a stated Ep); no rapid-decompression damage, no ageing",
  units: { inputs: "cm3·cm/(cm2·s·Pa), m, m2, L, Pa, K", outputs: "NmL/(h·L), cm3·cm/(cm2·s·Pa)" },
  tolerance: "the measured P's own spread; the compound's P is a test",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    const v = ctx.get(id, "props.h2Vessel") || {};
    const warnings = [TYPE_IV_NOTE];
    let P, Tm, source;
    if (v.permeability) {
      if (!v.permeability.source) return { notComputed: "props.h2Vessel.permeability needs its source (a permeation test of this compound)" };
      ({ P, T: Tm, source } = v.permeability);
    } else if (s.ir.constituents.some((c) => c.classId === "hdpe")) {
      P = DONG_2023_TABLE4.HDPE.P; Tm = DONG_2023_TABLE4.conditions.T;
      source = "HDPE matrix, measured: Dong et al., Polymers 2023, 15(18), 3715, Table 4 (288 K, 70 MPa) — NOT the compound's";
      const others = s.ir.constituents.filter((c) => c.classId !== "hdpe").map((c) => c.id);
      if (others.length) warnings.push(`the compound's own permeability is unknown: ${others.join(", ")} may lower it (tortuosity) or raise it (voids at the filler interfaces); the HDPE matrix value stands in, labelled. ${TEST}`);
    } else {
      return { notComputed: `no measured hydrogen permeability for this material and no HDPE matrix to stand in. ${TEST}` };
    }

    // platelet barrier (upper bound), when an aspect ratio and the platelet volume fraction are known
    let barrier = null;
    const plate = s.ir.constituents.findIndex((c) => c.classId === "graphene");
    if (plate >= 0) {
      if (!(v.platelet?.aspectRatio > 0)) barrier = { state: "not computed", reason: "no platelet aspect ratio (diameter/thickness of the compound's graphene, after compounding)" };
      else if (!s.phi) barrier = { state: "not computed", reason: s.blockers.join("; ") };
      else barrier = { state: "upper bound", ratio: nielsenRatio({ phi: s.phi[plate], aspect: v.platelet.aspectRatio }), note: "Nielsen: perfectly aligned, exfoliated, impermeable platelets; measured barrier is weaker (CO2 in aligned LDPE/xGnP: −34.7 % at 1 wt %, −65.5 % at 7.5 wt %, Gaska et al. 2017)" };
    }

    const Pat = (T) => {
      if (Math.abs(T - Tm) < 0.5) return { P, basis: `measured at ${Tm} K` };
      if (!v.activationEnergyJmol?.value) return null;
      return { P: arrheniusPermeability({ P, Tref: Tm, Ep: v.activationEnergyJmol.value }, T), basis: `Arrhenius from ${Tm} K with Ep ${v.activationEnergyJmol.value} J/mol (${v.activationEnergyJmol.source || "source not given"})` };
    };

    const material = H2_LIMITS.tcatsi.map((l) => {
      const at = Pat(l.T);
      return at ? { ...l, P: at.P, pass: at.P <= l.limitP, basis: at.basis } : { ...l, P: null, pass: null, basis: `not computed: no activation energy to move P from ${Tm} K to ${l.T} K (none read for HDPE)` };
    });

    const geom = [["linerThicknessM", v.linerThicknessM], ["innerAreaM2", v.innerAreaM2], ["waterVolumeL", v.waterVolumeL], ["nwpPa", v.nwpPa]].filter(([, x]) => !(x > 0)).map(([k]) => `props.h2Vessel.${k}`);
    const vessel = geom.length
      ? { state: "not computed", reason: `the chamber's geometry and working pressure are not given (${geom.join(", ")})` }
      : H2_LIMITS.iso19881.map((l) => {
        const at = Pat(l.T);
        if (!at) return { ...l, rate: null, pass: null, basis: `not computed: no activation energy to move P from ${Tm} K to ${l.T} K` };
        const rate = wallLeakRate({ P: at.P, areaCm2: v.innerAreaM2 * 1e4, deltaPPa: v.nwpPa * l.pressureFactor, thicknessCm: v.linerThicknessM * 100 }) / v.waterVolumeL;
        return { ...l, rate, pass: rate < l.limitNmLPerHPerL, basis: at.basis };
      });

    if (material.some((m) => m.pass === false)) warnings.push("the material-level permeability exceeds a liner-material limit");
    if (Array.isArray(vessel) && vessel.some((x) => x.pass === false)) warnings.push("the vessel permeation exceeds an ISO 19881 limit");
    return {
      inputs: { permeability: { value: P, unit: "cm3·cm/(cm2·s·Pa)", T: Tm, source }, limits: { value: H2_LIMITS.source } },
      outputs: {
        materialLevel: { value: material },
        vesselLevel: { value: vessel, unit: "NmL/(h·L)" },
        plateletBarrier: { value: barrier },
        verdict: { value: TYPE_IV_NOTE },
      },
      warnings,
    };
  },
});
