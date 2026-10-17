// server/lib/conkay/physics/solvers/solid-stress.js
//
// fea.solid3d: 3-D linear-elastic static stress of a STEP solid on CalculiX
// (fea/calculix_kernel.py, wrapped by fea/calculix.js): gmsh second-order tet
// mesh -> CalculiX C3D10 deck -> ccx (subprocess, timeout) -> nodal
// displacement and von Mises stress. The kernel is a child process, so the
// (synchronous) solver queues it like the CAD / Cantera kernels
// (cad/kernel-queue.js): the first run reports NOT_COMPUTED "kernel run
// pending", DesignSession.settle() runs it off the request path and reruns the
// solver; the result is cached by the request hash.
//
// Node contract: props.fea = {
//   step: path to a STEP file with one solid,
//   material: { E, nu, source? }            (consistent units, e.g. MPa),
//   supports: [{ bbox: [x0,y0,z0,x1,y1,z1], dofs?: [1,2,3] }]  (surfaces inside the box),
//   loads:    [{ bbox, force: [Fx,Fy,Fz] }]  (total force, area-consistent over the surfaces),
//   mesh:     { size, refine?: { bbox, sizeMin, distMax } },
//   displacementProbes?, stressProbes?: [{ name, bbox }],
//   allowableStress?: { value, source }      (von Mises check),
//   displacementLimit?: { value, source }    (max |u| check),
//   timeoutMs?
// }
//
// Honesty: PASS/FAIL comes only from the margins the node states (von Mises
// vs allowable, |u| vs limit). With no criterion the solve is a WARN — a
// computed field, never a silent PASS. Missing Python/gmsh/ccx or a failed
// ccx run is NOT_COMPUTED with the reason. The peak stress is mesh-dependent
// at re-entrant corners/singularities and the assumptions say so.

import { registerSolver } from "../registry.js";
import { requestKernel } from "../../cad/kernel-queue.js";
import { runSolidStatic, feaKernelKey, feaNotComputedReason, DEFAULT_FEA_TIMEOUT_MS } from "../../fea/calculix.js";

const isBox = (b) => Array.isArray(b) && b.length === 6 && b.every(Number.isFinite);

/** The kernel request + inputs echo for a node, or { notComputed } with a precise reason. */
export function solidSpec(ctx, id) {
  const f = ctx.get(id, "props.fea");
  if (!f || typeof f !== "object") return { notComputed: `${id} has no props.fea (a solid stress node needs step, material, supports, loads, mesh)` };
  if (typeof f.step !== "string" || !f.step.trim()) return { notComputed: "props.fea.step must be the path of a STEP file with one solid" };
  const m = f.material || {};
  if (!(m.E > 0)) return { notComputed: "props.fea.material.E (Young's modulus) must be positive" };
  if (!(m.nu > -1 && m.nu < 0.5)) return { notComputed: "props.fea.material.nu (Poisson's ratio) must be in (-1, 0.5)" };
  if (!Array.isArray(f.supports) || !f.supports.length || !f.supports.every((s) => isBox(s.bbox))) return { notComputed: "props.fea.supports must be a non-empty list of { bbox: [x0,y0,z0,x1,y1,z1], dofs? }" };
  if (!Array.isArray(f.loads) || !f.loads.length || !f.loads.every((l) => isBox(l.bbox) && Array.isArray(l.force) && l.force.length === 3 && l.force.every(Number.isFinite))) return { notComputed: "props.fea.loads must be a non-empty list of { bbox, force: [Fx,Fy,Fz] }" };
  if (!(f.mesh?.size > 0)) return { notComputed: "props.fea.mesh.size (target element size) must be positive" };
  const request = {
    step: f.step,
    material: { E: m.E, nu: m.nu },
    supports: f.supports.map((s) => ({ bbox: s.bbox, dofs: s.dofs ?? [1, 2, 3] })),
    loads: f.loads.map((l) => ({ bbox: l.bbox, force: l.force })),
    mesh: f.mesh,
    displacementProbes: f.displacementProbes || [],
    stressProbes: f.stressProbes || [],
  };
  const source = typeof f.source === "string" && f.source.trim() ? f.source : `${id}.props.fea (design graph)`;
  const echo = {
    step: { value: f.step, source },
    youngsModulus: { value: m.E, source: m.source || source },
    poissonsRatio: { value: m.nu, source: m.source || source },
    supports: { value: request.supports, source },
    loads: { value: request.loads, source },
    meshSize: { value: f.mesh.size, source },
    ...(f.allowableStress ? { allowableStress: { value: f.allowableStress.value, source: f.allowableStress.source || source } } : {}),
    ...(f.displacementLimit ? { displacementLimit: { value: f.displacementLimit.value, source: f.displacementLimit.source || source } } : {}),
  };
  return { request, echo, criteria: { allowableStress: f.allowableStress, displacementLimit: f.displacementLimit }, timeoutMs: f.timeoutMs ?? DEFAULT_FEA_TIMEOUT_MS };
}

const ASSUMPTIONS = [
  "Linear-elastic, isotropic, small-strain static analysis (CalculiX *STATIC): no plasticity, contact, buckling or large deformation.",
  "Loads are uniform tractions over the selected surfaces (total force, area-consistent nodal loads); supports fix the stated DOFs on every node of the selected surfaces.",
  "Peak von Mises is the maximum nodal (extrapolated) stress: mesh-dependent, and unbounded at sharp re-entrant corners or point supports — check convergence before trusting a peak.",
];

export const solid3d = registerSolver({
  id: "fea.solid3d",
  version: "1.0.0",
  domain: "structure.fea",
  domains: ["structure.fea", "structure.stress"],
  fidelity: 3,
  method: "gmsh second-order (10-node) tetrahedral mesh of a STEP solid; CalculiX ccx C3D10 linear static solve; nodal displacement and von Mises stress from the .frd",
  reference: "server/lib/conkay/fea/calculix_kernel.py; validated in tests/conkay-solid-stress.test.js against cantilever tip deflection PL^3/3EI, the Heywood plate-with-hole Kt (~3) and mesh convergence",
  regime: "linear-elastic isotropic, small strain, static; one solid; surface tractions and fixed DOFs selected by bounding box",
  units: { inputs: "consistent (e.g. mm, N, MPa)", outputs: "same consistent units as the STEP and material" },
  tolerance: "validated: cantilever tip deflection within 2 % of PL^3/3EI; plate-with-hole Kt 3.03 +/- 0.10; refinement change < 0.5 % (deflection) and < 1 % (peak stress)",
  screening: false,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.fea && typeof n.props.fea === "object").map((n) => n.id),
  run: (ctx, id) => {
    const q = solidSpec(ctx, id);
    if (q.notComputed) return q;
    const key = feaKernelKey(q.request);
    const r = requestKernel(key, () => runSolidStatic(q.request, { timeoutMs: q.timeoutMs }), `CalculiX solid ${key.split(":").at(-1)}`);
    if (!r.ok) return { notComputed: r.pending ? r.reason : feaNotComputedReason(r), inputs: q.echo };
    const margins = [];
    const warnings = [...(r.warnings || [])];
    if (q.criteria.allowableStress?.value > 0) {
      margins.push({ check: "peak von Mises <= allowable stress", demand: r.maxVonMises.value, capacity: q.criteria.allowableStress.value, unit: "stress", basis: q.criteria.allowableStress.source || "props.fea.allowableStress" });
    }
    if (q.criteria.displacementLimit?.value > 0) {
      margins.push({ check: "max |displacement| <= limit", demand: r.maxDisplacement.value, capacity: q.criteria.displacementLimit.value, unit: "length", basis: q.criteria.displacementLimit.source || "props.fea.displacementLimit" });
    }
    if (!margins.length) warnings.push("no allowableStress or displacementLimit on the node: the field is computed but nothing is checked (WARN, not PASS)");
    return {
      inputs: q.echo,
      outputs: {
        maxVonMises: { value: r.maxVonMises.value, at: r.maxVonMises.at, unit: "stress", basis: `CalculiX C3D10, ${r.elements} elements, ${r.nodes} nodes` },
        maxDisplacement: { value: r.maxDisplacement.value, at: r.maxDisplacement.at, unit: "length" },
        appliedForce: { value: r.appliedForce, unit: "force", note: "sum of the nodal loads written to the deck" },
        displacementProbes: { value: r.displacementProbes },
        stressProbes: { value: r.stressProbes },
        mesh: { value: { elements: r.elements, nodes: r.nodes, size: r.meshSize, elementType: r.elementType } },
      },
      margins,
      warnings,
      assumptions: ASSUMPTIONS,
      receipt: r,
    };
  },
});

// ---------------------------------------------------------------------------
// Reference-case validation. Tolerances fixed with their citations; the pass is
// computed from the numbers, never forced. Units: mm, N, MPa.
// ---------------------------------------------------------------------------

const STEEL = { E: 210000, nu: 0.3 };
export const CANTILEVER = { L: 100, b: 10, h: 10, P: 100 };
const I = (CANTILEVER.b * CANTILEVER.h ** 3) / 12;
export const CANTILEVER_DEFLECTION = (CANTILEVER.P * CANTILEVER.L ** 3) / (3 * STEEL.E * I); // 0.190476 mm

export const cantileverRequest = (size) => ({
  geometry: { kind: "box", L: CANTILEVER.L, b: CANTILEVER.b, h: CANTILEVER.h },
  material: STEEL,
  mesh: { size },
  supports: [{ bbox: [0, 0, 0, 0, CANTILEVER.b, CANTILEVER.h], dofs: [1, 2, 3] }],
  loads: [{ bbox: [CANTILEVER.L, 0, 0, CANTILEVER.L, CANTILEVER.b, CANTILEVER.h], force: [0, -CANTILEVER.P, 0] }],
  displacementProbes: [{ name: "tip", bbox: [CANTILEVER.L, 0, 0, CANTILEVER.L, CANTILEVER.b, CANTILEVER.h] }],
});

// Quarter model (symmetry on x=0, y=0 and the mid-plane z=0) of a 400 x 200 x 5 plate, 20 mm hole, 1 MPa remote tension.
export const PLATE = { L: 400, W: 200, t: 5, d: 20, sigma: 1 };
export const PLATE_KT_HEYWOOD = (2 + (1 - PLATE.d / PLATE.W) ** 3) / (1 - PLATE.d / PLATE.W); // gross-section Kt = 3.0323
export const plateRequest = (sizeMin) => {
  const hx = PLATE.L / 2, hy = PLATE.W / 2, hz = PLATE.t / 2, r = PLATE.d / 2;
  return {
    geometry: { kind: "plate_hole", L: PLATE.L, W: PLATE.W, t: PLATE.t, d: PLATE.d },
    material: STEEL,
    mesh: { size: 10, refine: { bbox: [0, 0, 0, r, r, hz], sizeMin, distMax: 20 } },
    supports: [
      { bbox: [0, 0, 0, 0, hy, hz], dofs: [1] },
      { bbox: [0, 0, 0, hx, 0, hz], dofs: [2] },
      { bbox: [0, 0, 0, hx, hy, 0], dofs: [3] },
    ],
    loads: [{ bbox: [hx, 0, 0, hx, hy, hz], force: [PLATE.sigma * hy * hz, 0, 0] }],
    stressProbes: [{ name: "hole", bbox: [0, 0, 0, r, r, hz] }],
  };
};

export const SOLID_REFERENCE_CASES = [
  {
    id: "cantilever-tip-deflection",
    request: cantileverRequest(2.5),
    quantity: "tip deflection",
    reference: CANTILEVER_DEFLECTION,
    relTolerance: 0.02,
    unit: "mm",
    value: (r) => -r.displacementProbes[0].mean[1],
    source: "Euler-Bernoulli cantilever, tip load: delta = PL^3/3EI (any strength-of-materials text, e.g. Gere & Goodno, Mechanics of Materials, App. G). 100 x 10 x 10 mm steel, P = 100 N: 0.19048 mm. Tolerance 2 %: shear deformation (Timoshenko, ~+0.8 % at L/h = 10) and the fully clamped root (Poisson restraint) are inside it.",
  },
  {
    id: "plate-hole-Kt",
    request: plateRequest(0.5),
    quantity: "Kt (peak sigma_xx / remote sigma)",
    reference: PLATE_KT_HEYWOOD,
    absTolerance: 0.1,
    unit: "dimensionless",
    value: (r) => r.stressProbes[0].components.sxx.max / PLATE.sigma,
    source: "Kirsch: Kt = 3 for a hole in an infinite plate; finite width by Heywood (Peterson's Stress Concentration Factors, 3rd ed., ch. 4): Kt_net = 2 + (1 - d/W)^3, gross Kt = Kt_net / (1 - d/W) = 3.032 at d/W = 0.1. Tolerance +/-0.10 (the Heywood fit is good to a few percent).",
  },
];

export const CONVERGENCE_CASES = [
  { id: "cantilever-deflection-convergence", sizes: [10, 5, 2.5], request: cantileverRequest, value: SOLID_REFERENCE_CASES[0].value, maxFinalRelChange: 0.005, unit: "mm" },
  { id: "plate-hole-peak-stress-convergence", sizes: [4, 2, 1, 0.5], request: plateRequest, value: SOLID_REFERENCE_CASES[1].value, maxFinalRelChange: 0.01, unit: "dimensionless" },
];

/** Converged when the last refinement changes the value by <= maxFinalRelChange and the changes do not grow. */
export function convergenceVerdict(values, maxFinalRelChange) {
  const changes = values.slice(1).map((v, i) => Math.abs(v - values[i]) / Math.abs(v));
  const finalRelChange = changes.at(-1);
  const pass = values.every(Number.isFinite) && finalRelChange <= maxFinalRelChange && changes.every((c, i) => i === 0 || c <= changes[i - 1]);
  return { changes, finalRelChange, pass };
}

/** Run the reference + convergence cases (real gmsh + ccx). Results are reused across cases with the same request. */
export async function validateSolid3d({ run = runSolidStatic } = {}) {
  const memo = new Map();
  const solve = (req) => {
    const k = JSON.stringify(req);
    if (!memo.has(k)) memo.set(k, run(req));
    return memo.get(k);
  };
  const cases = [];
  for (const c of SOLID_REFERENCE_CASES) {
    const result = await solve(c.request);
    const tol = c.absTolerance ?? c.relTolerance * c.reference;
    if (!result.ok) { cases.push({ id: c.id, computed: null, reference: c.reference, tolerance: tol, unit: c.unit, pass: false, source: c.source, reason: feaNotComputedReason(result) }); continue; }
    const computed = c.value(result);
    cases.push({ id: c.id, quantity: c.quantity, computed, reference: c.reference, tolerance: tol, relError: (computed - c.reference) / c.reference, unit: c.unit, pass: Number.isFinite(computed) && Math.abs(computed - c.reference) <= tol, source: c.source, result });
  }
  const convergence = [];
  for (const c of CONVERGENCE_CASES) {
    const runs = [];
    for (const s of c.sizes) runs.push(await solve(c.request(s)));
    const bad = runs.find((r) => !r.ok);
    if (bad) { convergence.push({ id: c.id, sizes: c.sizes, pass: false, reason: feaNotComputedReason(bad) }); continue; }
    const values = runs.map(c.value);
    convergence.push({ id: c.id, sizes: c.sizes, values, elements: runs.map((r) => r.elements), unit: c.unit, maxFinalRelChange: c.maxFinalRelChange, ...convergenceVerdict(values, c.maxFinalRelChange) });
  }
  return { cases, convergence };
}
