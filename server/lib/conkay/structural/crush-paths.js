// server/lib/conkay/structural/crush-paths.js
//
// Crush-path screening for the car's existing longitudinal members.
// No crash box is added. The front path is the front-rail metal ahead of
// the front-axle node. The rear quarter boxes carry the rear pickup, so
// they are not given a folding energy.
//
// Mean force, rectangular tube, rigid-plastic symmetric folding:
//   T. Wierzbicki and W. Abramowicz, J. Appl. Mech. 50(4a), 727–734 (1983),
//   doi:10.1115/1.3167137, eqs (7.1)–(7.4).
//   C = (c + d) / 2,  M0 = σ0 h² / 4,
//   Pm = 38.27 M0 (C / h)^(1/3).
// Eq (7.4), Pm = 9.56 σ0 h^(5/3) C^(1/3), is the square case c = d = C.
// It is not applied to a rectangle by substituting one side.
//
// The printed 38.27 is their rounding of
//   3 (A1 A2 A3)^(1/3),  A1 = 32 I1 = 18.56,  A2 = 4π,  A3 = 8 I3 = 8.91,
// from eqs (7.1) and (6.4). The screening uses the printed 38.27.

import { sectionProps } from "./frame-fe.js";

export const CRUSH_PATHS_VERSION = "1.0.0";

export const FOLDING = Object.freeze({
  citation: "T. Wierzbicki and W. Abramowicz, On the crushing mechanics of thin-walled structures, Journal of Applied Mechanics 50(4a), 727–734 (1983), doi:10.1115/1.3167137, eqs (7.1)–(7.4)",
  coefficient: 38.27,
  A1: 18.56,
  A3: 8.91,
});

/** 3 (A1 · 4π · A3)^(1/3). The paper prints this as 38.27. */
export function reconstructedCoefficient() {
  return 3 * Math.cbrt(FOLDING.A1 * 4 * Math.PI * FOLDING.A3);
}

/**
 * Mean crushing force (N) for one rectangular tube. σ0 is the caller's
 * flow stress (Pa). Returns null when the section is not a hollow tube.
 */
export function meanCrushForce({ c, d, h, sigma0 }) {
  if (!(c > 0 && d > 0 && h > 0 && sigma0 > 0)) return null;
  if (!(c > 2 * h && d > 2 * h)) return null;
  const C = (c + d) / 2;
  const M0 = (sigma0 * h * h) / 4;
  const Pm = FOLDING.coefficient * M0 * Math.cbrt(C / h);
  return { C, M0, Pm };
}

/** Elastic critical stress of the widest wall in uniform compression (Pa). */
export function wideWallCompressionCr({ c, d, h, E, nu }) {
  const sec = sectionProps({ shape: "rect-tube", width: c, height: d, wall: h });
  const b = sec.walls.widest;
  const k = 4.0;
  const sigmaCr = k * (Math.PI ** 2 * E) / (12 * (1 - nu * nu)) * (h / b) ** 2;
  return {
    sigmaCr,
    b,
    k,
    slenderness: sec.wallSlenderness,
    citation: "k = 4 uniform compression, long plate simply supported on both edges: Timoshenko and Gere, Theory of Elastic Stability, 2nd ed., sec. 9.2. Width is the section's mid-line widest wall (outer − wall), the same width frame-fe.js uses.",
  };
}

export function eulerLoad(E, I, L, K) {
  if (!(E > 0 && I > 0 && L > 0 && K > 0)) return null;
  return (Math.PI ** 2 * E * I) / (K * L) ** 2;
}

export const BARRIER_SPEEDS = Object.freeze([
  {
    id: "fmvss-208-s5.1.1-48",
    kmh: 48,
    mph: 30,
    source: "49 CFR 571.208 S5.1.1(a) and S5.1.1(b)(1): longitudinally forward at any speed up to and including 48 km/h (30 mph) into a fixed rigid barrier. https://www.ecfr.gov/current/title-49/subtitle-B/chapter-V/part-571/subpart-B/section-571.208",
  },
  {
    id: "fmvss-208-s5.1.1-56",
    kmh: 56,
    mph: 35,
    source: "49 CFR 571.208 S5.1.1(b)(2), vehicles certified to S14.3 or S14.4: up to and including 56 km/h (35 mph) into a fixed rigid barrier. S16.1(a)(2) is the same speed for the 5th percentile adult female dummy on vehicles certified to S14.6 or S14.7.",
  },
]);

export function kineticEnergyJ(massKg, kmh) {
  const v = kmh / 3.6;
  return 0.5 * massKg * v * v;
}

function railRecord(rail, sigma0, E, nu) {
  const fold = meanCrushForce({ c: rail.c, d: rail.d, h: rail.h, sigma0 });
  if (!fold) return { id: rail.id, ok: false, reason: "section is not a hollow rectangular tube" };
  const sec = sectionProps({ shape: "rect-tube", width: rail.c, height: rail.d, wall: rail.h });
  const wall = wideWallCompressionCr({ c: rail.c, d: rail.d, h: rail.h, E, nu });
  const Iweak = Math.min(sec.Iy, sec.Iz);
  const L = rail.lengthM;
  const stroke = rail.xAxle - rail.x0;
  const euler = {
    lengthM: L,
    Iweak,
    pinnedN: eulerLoad(E, Iweak, L, 1),
    cantileverN: eulerLoad(E, Iweak, L, 2),
    endBasis: "K = 1 is pinned-pinned. K = 2 is a cantilever, a screening picture of a rail held at the firewall and free at the nose. Neither is a measured joint stiffness.",
  };
  const undercuts = euler.cantileverN != null && euler.cantileverN < fold.Pm;
  const strokeOk = stroke > 0 && stroke <= L + 1e-6;
  return {
    id: rail.id,
    ok: true,
    c: rail.c,
    d: rail.d,
    h: rail.h,
    lengthM: L,
    x0: rail.x0,
    xAxle: rail.xAxle,
    xBoxEnd: rail.xBoxEnd,
    C: fold.C,
    meanForceN: fold.Pm,
    areaM2: sec.A,
    meanStressPa: fold.Pm / sec.A,
    strokeM: strokeOk ? stroke : null,
    strokeBasis: "Rail metal ahead of the front-axle node. The pickup sits on the rail; metal aft of that node is not counted. This is a reading of the layout, not a cited crush stroke.",
    energyJ: strokeOk && !undercuts ? fold.Pm * stroke : null,
    euler,
    eulerUndercutsFolding: undercuts,
    wideWall: wall,
    squareFormulaApplied: false,
  };
}

/**
 * @param {object} spec
 * @param {Array} spec.frontRails {id,c,d,h,lengthM,x0,xAxle,xBoxEnd}
 * @param {Array} spec.rearQuarters {id,c,d,h,lengthM,x0,xAxle,xTip,xCrossRear}
 * @param {number} spec.sigma0Pa library yield used as the paper's flow stress
 * @param {number} spec.ultimatePa reported, not used as σ0
 * @param {number} spec.youngsPa
 * @param {number} spec.nu
 * @param {string} spec.materialId
 * @param {string} spec.materialNote
 * @param {Array<{id:string, kg:number, note:string}>} spec.masses
 */
export function crushPaths(spec) {
  const warnings = [];
  const nu = spec.nu;
  const fronts = (spec.frontRails || []).map((r) => railRecord(r, spec.sigma0Pa, spec.youngsPa, nu));
  const usable = fronts.filter((r) => r.ok && r.energyJ != null);
  const frontEnergy = fronts.length && usable.length === fronts.length
    ? usable.reduce((s, r) => s + r.energyJ, 0)
    : null;
  if (fronts.some((r) => r.eulerUndercutsFolding)) {
    warnings.push("A front rail's cantilever Euler load is below the 1983 mean crush force, so the folding energy is not used.");
  }
  if (fronts.some((r) => r.ok && r.strokeM == null)) {
    warnings.push("A front rail has no positive length ahead of the axle node inside the member, so its folding energy is not used.");
  }

  const rears = (spec.rearQuarters || []).map((q) => {
    const fold = meanCrushForce({ c: q.c, d: q.d, h: q.h, sigma0: spec.sigma0Pa });
    const aftOfAxle = q.xTip - q.xAxle;
    const aftOfCross = q.xCrossRear == null ? null : q.xTip - q.xCrossRear;
    return {
      id: q.id,
      c: q.c,
      d: q.d,
      h: q.h,
      lengthM: q.lengthM,
      x0: q.x0,
      xAxle: q.xAxle,
      xTip: q.xTip,
      aftOfAxleM: aftOfAxle,
      aftOfCrossM: aftOfCross,
      meanForceIfItFoldedN: fold ? fold.Pm : null,
      energyJ: null,
      energyStatus: "not determined",
      reason: "The quarter box carries the rear-axle pickup. Counting it as a crush can would fold the pickup. The metal past the rear cross is not a separate crash box, and the cross sits in that aft segment, so the free-tube energy is not applied.",
    };
  });

  const comparisons = [];
  for (const mass of spec.masses || []) {
    if (!(mass.kg > 0)) continue;
    for (const speed of BARRIER_SPEEDS) {
      const ke = kineticEnergyJ(mass.kg, speed.kmh);
      const ratio = frontEnergy == null ? null : frontEnergy / ke;
      let reading = "not determined";
      if (ratio != null) reading = ratio < 1 ? "short of this kinetic energy" : "above this kinetic energy";
      comparisons.push({
        massId: mass.id,
        massKg: mass.kg,
        massNote: mass.note,
        speedId: speed.id,
        kmh: speed.kmh,
        kineticEnergyJ: ke,
        frontEnergyJ: frontEnergy,
        frontOverKinetic: ratio,
        reading,
        compliance: "not an FMVSS result",
      });
      if (reading === "short of this kinetic energy") {
        warnings.push(`${speed.id}: kinetic energy of ${mass.id} (${mass.kg} kg) at ${speed.kmh} km/h is ${ke.toFixed(0)} J. Both front rails at the 1983 mean force over the pre-axle length sum to ${frontEnergy.toFixed(0)} J, short of that kinetic energy.`);
      } else if (reading === "above this kinetic energy") {
        warnings.push(`${speed.id}: the same rail product is above the kinetic energy of ${mass.id} at ${speed.kmh} km/h. That is not a crash-test pass. The stroke is an upper reading and Standard 208 limits occupant injury; it does not assign this energy to the rails.`);
      }
    }
  }

  warnings.push("No crash box was added. The front path is the existing front-rail section ahead of the axle node.");
  warnings.push("σ0 is the library yield of the tub's material, not a measured flow stress. The 1983 Fig. 8 reduced experiments with ultimate stress. Ultimate is reported and not used.");
  warnings.push("The 1983 model is rigid-plastic and quasi-static. Strain rate and fracture are not in it. 6061-T6 may crack instead of folding; that is not checked.");
  warnings.push("Abramowicz, Int. J. Impact Eng. 1(3), 309–317 (1983), the effective crushing distance, is not applied. The pre-axle length is longer than a stacked fold, so the energy is an upper reading of the 1983 model.");
  warnings.push("Standard 208's kinetic energy is the energy of the stated mass at the stated speed. The standard's test mass (vehicle plus test devices, S8.1.1 / S16.2.1) is not encoded. Occupant dummies are not added.");

  return {
    version: CRUSH_PATHS_VERSION,
    citation: FOLDING.citation,
    coefficient: FOLDING.coefficient,
    reconstructedCoefficient: reconstructedCoefficient(),
    squareFormulaApplied: false,
    dedicatedCrashBox: false,
    material: {
      id: spec.materialId,
      sigma0Pa: spec.sigma0Pa,
      sigma0Basis: "library yield, used as the paper's flow stress and labelled as that substitution",
      ultimatePa: spec.ultimatePa,
      ultimateUsedAsFlowStress: false,
      note: spec.materialNote,
    },
    front: {
      energyJ: frontEnergy,
      energyStatus: frontEnergy == null ? "not determined" : "screening upper bound",
      members: fronts,
    },
    rear: {
      energyJ: null,
      energyStatus: "not determined",
      members: rears,
    },
    speeds: BARRIER_SPEEDS,
    comparisons,
    warnings,
    assumptions: [
      "Wierzbicki and Abramowicz 1983, rigid-plastic symmetric progressive folding, rectangular tube, C = (c+d)/2. Quasi-static. No strain rate, no fracture.",
      "Eq (7.4) is the square-tube reduction. These rails and quarter boxes are rectangular, so that reduction is not used.",
      "σ0 is the tub material's library yield. The paper's experiments in Fig. 8 were reduced with ultimate stress.",
      "Front stroke is the rail length ahead of the front-axle node. No metal was added.",
      "Rear quarter boxes are not crush cans: they carry the rear pickup.",
      "Kinetic energy is ½mv² at the stated mass and at 48 km/h or 56 km/h from 49 CFR 571.208. It is not a rail-energy requirement.",
    ],
  };
}
