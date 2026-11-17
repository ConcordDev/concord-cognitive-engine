// server/lib/conkay/physics/solvers/mesh-convergence.js
//
// verify.mesh-convergence — SX-XC-04 (ConKay solver catalogue, W0).
//
// Mesh/time-step convergence by Richardson extrapolation and the
// Grid Convergence Index, following Roache's method as proceduralized
// by Celik et al. (2008) and the NASA NPARC GCI tutorial:
//
//   given solutions f1 (fine), f2, f3 (coarse) on three systematically
//   refined meshes with uniform refinement ratio r:
//     e21 = (f2 - f1)/f1,  e32 = (f3 - f2)/f2     (relative differences)
//     R   = e21/e32                                (convergence ratio)
//     p   = ln(e32/e21) / ln(r)                    (observed order)
//     f_ext = f1 + (f1 - f2)/(r^p - 1)             (extrapolated value)
//     GCI_fine   = Fs * |e21| / (r^p - 1),  Fs = 1.25 (three meshes)
//     GCI_coarse = Fs * |e32| / (r^p - 1)
//
// Validity envelope (the catalogue's): >= 3 systematically refined
// meshes, uniform ratio. Outside it the answer is NOT_COMPUTED:
//   - oscillatory convergence (R < 0): the observed order does not
//     exist; the refusal carries the sequence spread beside it.
//   - divergent convergence (R > 1): same, with the negative order.
//   - non-uniform refinement (r21 != r32): the iterative-p form is
//     outside this solver's declared envelope, named as such.
//   - f1 = 0: relative measures are undefined, named.
// A supplied tolerance turns GCI_fine into an envelope margin, so a
// study that misses its tolerance FAILs instead of merely reporting.

import { registerSolver } from "../registry.js";

export const GCI_SAFETY_FACTOR_3GRID = 1.25;

export function gciStudy({ f1, f2, f3, r }) {
  const e21 = (f2 - f1) / f1;
  const e32 = (f3 - f2) / f2;
  if (e21 === 0) {
    // The two finest meshes agree exactly: the fine-pair GCI is zero
    // and no finite observed order exists. That is a result, not a gap.
    return {
      convergenceType: "monotonic",
      observedOrder: null,
      extrapolatedValue: f1,
      gciFine: 0,
      gciCoarse: null,
      approximateRelativeErrorFine: 0,
      extrapolatedRelativeError: 0,
      convergenceRatio: 0,
      asymptoticRatio: null,
      note: "fine pair identical (e21 = 0): GCI_fine = 0; observed order undefined",
    };
  }
  const R = e21 / e32;
  if (R < 0) {
    const spread = Math.max(f1, f2, f3) - Math.min(f1, f2, f3);
    return { notComputed: "oscillatory_convergence", convergenceType: "oscillatory", spread, relativeSpread: spread / Math.abs(f1) };
  }
  if (R > 1) {
    const p = Math.log(e32 / e21) / Math.log(r);
    return { notComputed: "divergent_convergence", convergenceType: "divergent", observedOrder: p, convergenceRatio: R };
  }
  const p = Math.log(e32 / e21) / Math.log(r);
  const rp = Math.pow(r, p);
  const fExt = f1 + (f1 - f2) / (rp - 1);
  const gciFine = (GCI_SAFETY_FACTOR_3GRID * Math.abs(e21)) / (rp - 1);
  const gciCoarse = (GCI_SAFETY_FACTOR_3GRID * Math.abs(e32)) / (rp - 1);
  return {
    convergenceType: "monotonic",
    observedOrder: p,
    extrapolatedValue: fExt,
    gciFine,
    gciCoarse,
    approximateRelativeErrorFine: Math.abs(e21),
    extrapolatedRelativeError: Math.abs((fExt - f1) / fExt),
    convergenceRatio: R,
    asymptoticRatio: gciCoarse / (rp * gciFine),
  };
}

function runGci(ctx, target) {
  const inputs = ctx?.inputs || {};
  const sols = Array.isArray(inputs.solutions) ? inputs.solutions : null;
  if (!sols) return { notComputed: "missing_input:solutions (three solutions, fine to coarse)" };
  if (sols.length < 3) {
    return { notComputed: `insufficient_meshes:${sols.length} solution(s); GCI requires >= 3 systematically refined meshes (validity envelope)` };
  }
  if (sols.length > 3) {
    return { notComputed: "invalid_input:solutions must be exactly three (fine, medium, coarse); submit one study per call" };
  }
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(sols[i])) return { notComputed: `invalid_input:solutions[${i}] is not finite` };
  }
  const [f1, f2, f3] = sols;
  if (f1 === 0) return { notComputed: "invalid_input:solutions[0] (f1) is zero; relative GCI measures are undefined" };
  const r = inputs.refinementRatio;
  if (!Number.isFinite(r) || r <= 1) {
    return { notComputed: `invalid_input:refinementRatio ${r}; a refinement ratio must be > 1` };
  }
  if (inputs.r21 != null || inputs.r32 != null) {
    if (inputs.r21 !== inputs.r32) {
      return { notComputed: "nonuniform_refinement: r21 != r32 is outside this solver's declared envelope (uniform ratio; the iterative-p form is not served)" };
    }
  }
  const study = gciStudy({ f1, f2, f3, r });
  const echo = { solutions: sols, refinementRatio: r };
  if (study.notComputed) {
    const { notComputed, ...rest } = study;
    return { notComputed, inputs: echo, outputs: rest };
  }
  const outputs = { ...study };
  delete outputs.note;
  const margins = [];
  if (Number.isFinite(inputs.tolerance) && inputs.tolerance > 0) {
    margins.push({
      name: "gci_fine_within_tolerance",
      demand: study.gciFine,
      capacity: inputs.tolerance,
      ratio: study.gciFine / inputs.tolerance,
      unit: "1",
    });
  }
  return {
    inputs: echo,
    outputs,
    margins,
    assumptions: study.note ? [study.note] : [],
    covers: [target],
  };
}

export const meshConvergence = registerSolver({
  id: "verify.mesh-convergence",
  version: "1.0.0",
  domain: "verification",
  domains: ["verification", "physics"],
  fidelity: 3,
  method: "Richardson extrapolation + Grid Convergence Index on 3 systematically refined meshes; observed order; safety factor 1.25 (Celik et al. procedure)",
  reference: "Roache, Verification and Validation in Computational Science and Engineering; Celik et al., J. Fluids Eng. 130(7) 2008; NASA NPARC GCI tutorial (grc.nasa.gov)",
  regime: ">= 3 systematically refined meshes, uniform refinement ratio; monotonic convergence",
  units: { inputs: "three solutions (fine, medium, coarse) in the quantity's own unit; refinement ratio dimensionless", outputs: "observed order, extrapolated value (input unit), GCI as relative (dimensionless) values" },
  tolerance: "GCI reported exactly per the procedure; a caller tolerance may be supplied to turn GCI_fine into a pass/fail margin",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runGci,
});
