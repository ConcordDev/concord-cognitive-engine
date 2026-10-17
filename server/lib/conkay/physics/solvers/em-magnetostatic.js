// server/lib/conkay/physics/solvers/em-magnetostatic.js
//
// em.magnetostatic: low-frequency (magnetostatic) fields of conductors, coils
// and linear magnetic material in a 2-D planar cross-section, by finite
// elements on FEniCSx (em/fenicsx_magnetostatic_kernel.py, wrapped by
// em/fenicsx.js): magnetic vector potential A_z with
//     -div((1/mu) grad A_z) = J_z,   B = (dA/dy, -dA/dx).
// The kernel is a child process, so the (synchronous) solver queues it like
// the CAD / Meep / CalculiX kernels (cad/kernel-queue.js): the first run
// reports NOT_COMPUTED "kernel run pending", DesignSession.settle() runs it off
// the request path and reruns the solver; the result is cached by the request
// hash.
//
// Node contract: props.magnetics = {
//   domain: { type: "rect", x0, y0, x1, y1 } | { type: "disk", cx?, cy?, r },   (m)
//   boundary?: { left, right, bottom, top: "dirichlet" | "neumann" },  (rect; default dirichlet A = 0)
//   regions: [{ shape: "rect" | "disk" | "annulus", ..., muR?, J? (A/m^2) | I? (A), h? (m) }],
//   h: m (global mesh size), order?: 2, backgroundMuR?: 1,
//   probes: [{ name?, x, y }],                       (where |B| is reported)
//   maxFluxDensity?: { value (T), source },          (max |B| over the probes <= value)
//   minFluxDensity?: { value (T), source },          (min |B| over the probes >= value)
//   timeoutMs?
// }
//
// Honesty: PASS/FAIL only from the criteria the node states; with none the
// field is a WARN. Missing Python/FEniCSx or a failed run is NOT_COMPUTED with
// the reason.

import { registerSolver } from "../registry.js";
import { requestKernel } from "../../cad/kernel-queue.js";
import { runPlanar2d, magKernelKey, magNotComputedReason, DEFAULT_MAG_TIMEOUT_MS } from "../../em/fenicsx.js";

export const MU0 = 4e-7 * Math.PI;
const SHAPES = new Set(["rect", "disk", "annulus"]);

export function magSpec(ctx, id) {
  const m = ctx.get(id, "props.magnetics");
  if (!m || typeof m !== "object") return { notComputed: `${id} has no props.magnetics (a magnetostatic node needs domain, regions, h, probes)` };
  const d = m.domain;
  if (!d || !((d.type === "rect" && d.x1 > d.x0 && d.y1 > d.y0) || (d.type === "disk" && d.r > 0))) return { notComputed: "props.magnetics.domain must be { type: 'rect', x0 < x1, y0 < y1 } or { type: 'disk', r > 0 } (m)" };
  if (!Array.isArray(m.regions) || !m.regions.every((r) => r && SHAPES.has(r.shape))) return { notComputed: "props.magnetics.regions must be a list of { shape: 'rect' | 'disk' | 'annulus', ... }" };
  if (m.regions.some((r) => (r.muR !== undefined && !(r.muR > 0)) || (r.h !== undefined && !(r.h > 0)))) return { notComputed: "props.magnetics.regions: muR and h must be positive" };
  if (!(m.h > 0)) return { notComputed: "props.magnetics.h (global mesh size, m) must be positive" };
  if (!Array.isArray(m.probes) || !m.probes.length || !m.probes.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return { notComputed: "props.magnetics.probes must be a non-empty list of { x, y } (m)" };
  const order = m.order ?? 2;
  if (![1, 2, 3].includes(order)) return { notComputed: "props.magnetics.order must be 1, 2 or 3" };
  const request = { domain: d, ...(m.boundary ? { boundary: m.boundary } : {}), regions: m.regions, h: m.h, order, backgroundMuR: m.backgroundMuR ?? 1, probes: m.probes.map((p, i) => ({ name: p.name ?? String(i), x: p.x, y: p.y })) };
  const source = typeof m.source === "string" && m.source.trim() ? m.source : `${id}.props.magnetics (design graph)`;
  const echo = {
    domain: { value: d, unit: "m", source }, regions: { value: m.regions, source }, h: { value: m.h, unit: "m", source }, order: { value: order, source },
    ...(m.maxFluxDensity ? { maxFluxDensity: { value: m.maxFluxDensity.value, unit: "T", source: m.maxFluxDensity.source || source } } : {}),
    ...(m.minFluxDensity ? { minFluxDensity: { value: m.minFluxDensity.value, unit: "T", source: m.minFluxDensity.source || source } } : {}),
  };
  return { request, echo, criteria: { maxFluxDensity: m.maxFluxDensity, minFluxDensity: m.minFluxDensity }, timeoutMs: m.timeoutMs ?? DEFAULT_MAG_TIMEOUT_MS };
}

const ASSUMPTIONS = [
  "2-D planar magnetostatics: infinitely long in z (no end effects), current along z only, DC / low frequency (no eddy currents, no displacement current).",
  "Linear isotropic materials (constant mu_r per region): no saturation, hysteresis or permanent magnets.",
  "A_z = 0 on dirichlet sides (flux lines), zero normal field-derivative on neumann sides; the outer boundary must be far enough away (or a true symmetry line) for the result to mean anything.",
  "Lagrange P2 (default) on a gmsh mesh with straight-sided triangles; B is the (discontinuous) gradient, so probes sitting on a material interface take one side's value. Check mesh convergence for your geometry.",
];

export const emMagnetostatic = registerSolver({
  id: "em.magnetostatic",
  version: "1.0.0",
  domain: "electromagnetics",
  domains: ["electromagnetics", "magnetics"],
  fidelity: 3,
  method: "FEniCSx (dolfinx 0.11) finite elements + gmsh: 2-D planar magnetic vector potential A_z, -div((1/mu) grad A_z) = J_z, Lagrange P2, direct LU; B = curl A at probe points, magnetic energy per unit length",
  reference: "server/lib/conkay/em/fenicsx_magnetostatic_kernel.py; validated in tests/conkay-em-magnetostatic.test.js against the current-sheet pair (solenoid, B = mu0 n I), the long straight conductor (B = mu0 I r / (2 pi a^2) inside, mu0 I / (2 pi r) outside), an iron shell (B = mu_r mu0 I / (2 pi r)), a gapped iron core (magnetic-circuit B_gap) and mesh convergence of the conductor's field energy",
  regime: "2-D planar magnetostatics, linear isotropic media, SI units (m, A, A/m^2, T)",
  units: { inputs: "m, A, A/m^2, mu_r dimensionless", outputs: "B in T, A_z in Wb/m, energy in J/m" },
  tolerance: "validated: current-sheet pair |B/(mu0 n I) - 1| <= 1e-3, |B_outside| <= 1e-3 mu0 n I; straight conductor inside/outside |B/B_ref - 1| <= 1e-2; iron shell |B/B_ref - 1| <= 1e-2; gapped core |B_gap/B_circuit - 1| <= 5e-2 and B_gap/B_air >= 50; energy error decreasing over h, h/2, h/4 with observed order >= 1.5",
  screening: false,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.magnetics && typeof n.props.magnetics === "object").map((n) => n.id),
  run: (ctx, id) => {
    const q = magSpec(ctx, id);
    if (q.notComputed) return q;
    const key = magKernelKey(q.request);
    const r = requestKernel(key, () => runPlanar2d(q.request, { timeoutMs: q.timeoutMs }), `FEniCSx magnetostatic ${key.split(":").at(-1)}`);
    if (!r.ok) return { notComputed: r.pending ? r.reason : magNotComputedReason(r), inputs: q.echo };
    const Bs = r.probes.map((p) => p.B);
    const maxB = Math.max(...Bs), minB = Math.min(...Bs);
    const margins = [], warnings = [];
    if (q.criteria.maxFluxDensity?.value >= 0) margins.push({ check: "max |B| over probes <= limit", demand: maxB, capacity: q.criteria.maxFluxDensity.value, unit: "T", basis: q.criteria.maxFluxDensity.source || "props.magnetics.maxFluxDensity" });
    if (q.criteria.minFluxDensity?.value >= 0) margins.push({ check: "min |B| over probes >= required", demand: q.criteria.minFluxDensity.value, capacity: minB, unit: "T", basis: q.criteria.minFluxDensity.source || "props.magnetics.minFluxDensity" });
    if (!margins.length) warnings.push("no maxFluxDensity or minFluxDensity on the node: the field is computed but nothing is checked (WARN, not PASS)");
    const basis = `FEniCSx dolfinx ${r.dolfinxVersion} P${r.order}, ${r.cells} cells`;
    return {
      inputs: q.echo,
      outputs: {
        probes: { value: r.probes.map((p) => ({ name: p.name, x: p.x, y: p.y, B: p.B, Bx: p.Bx, By: p.By })), unit: "T", basis },
        maxFluxDensity: { value: maxB, unit: "T", basis },
        minFluxDensity: { value: minB, unit: "T", basis },
        energy: { value: r.energy, unit: "J/m", basis },
        regionCurrents: { value: r.regions.map((g) => g.current), unit: "A", basis },
      },
      margins, warnings, assumptions: ASSUMPTIONS, receipt: r,
    };
  },
});

// ---------------------------------------------------------------------------
// Reference-case validation. Tolerances fixed here, before any run, with
// their citations; the pass is computed from the numbers, never forced.
// ---------------------------------------------------------------------------

const relErr = (v, ref) => Math.abs(v / ref - 1);
const probe = (r, name) => r.probes.find((p) => p.name === name);

// (1) Solenoid as a pair of opposite current sheets (planar cross-section of a
// long solenoid): n = 1000 turns/m, I = 2 A -> K = n I = 2000 A/m carried by
// 10 mm thick slabs; field between = mu0 n I, outside = 0.
export const SOLENOID = { n: 1000, I: 2, t: 0.01, a: 0.05, L: 0.2, H: 0.05 };
export const SOLENOID_B = MU0 * SOLENOID.n * SOLENOID.I;
export const solenoidRequest = () => {
  const { n, I, t, a, L, H } = SOLENOID;
  const J = (n * I) / t;
  return {
    domain: { type: "rect", x0: -L, y0: 0, x1: L, y1: H },
    boundary: { left: "dirichlet", right: "neumann", bottom: "neumann", top: "neumann" },
    regions: [{ shape: "rect", x0: -a - t, y0: 0, x1: -a, y1: H, J }, { shape: "rect", x0: a, y0: 0, x1: a + t, y1: H, J: -J }],
    h: 0.005, order: 2,
    probes: [{ name: "centre", x: 0, y: H / 2 }, { name: "inside", x: 0.03, y: 0.01 }, { name: "outsideL", x: -0.12, y: H / 2 }, { name: "outsideR", x: 0.12, y: 0.04 }],
  };
};

// (2) Long straight round conductor: a = 10 mm, I = 100 A, in a disk of R = 0.5 m (A = 0 on r = R; by symmetry B does not depend on R).
export const WIRE = { a: 0.01, I: 100, R: 0.5 };
export const wireB = (r) => (r < WIRE.a ? (MU0 * WIRE.I * r) / (2 * Math.PI * WIRE.a ** 2) : (MU0 * WIRE.I) / (2 * Math.PI * r));
/** Magnetic energy per unit length inside r <= R: mu0 I^2 / (4 pi) * (1/4 + ln(R/a)). */
export const WIRE_ENERGY = ((MU0 * WIRE.I ** 2) / (4 * Math.PI)) * (0.25 + Math.log(WIRE.R / WIRE.a));
export const wireRequest = (s = 1, order = 2, extra = []) => ({
  domain: { type: "disk", r: WIRE.R },
  regions: [{ shape: "disk", r: 0.15, h: 0.004 * s }, ...extra, { shape: "disk", r: WIRE.a, I: WIRE.I, h: 0.001 * s }],
  h: 0.02 * s, order,
  probes: [{ name: "r=a/2", x: 0.005, y: 0 }, { name: "r=2a", x: 0, y: 0.02 }, { name: "r=4a", x: -0.04 * Math.SQRT1_2, y: 0.04 * Math.SQRT1_2 }, { name: "r=10a", x: 0.1, y: 0 }],
});
const WIRE_PROBE_R = { "r=a/2": 0.005, "r=2a": 0.02, "r=4a": 0.04, "r=10a": 0.1 };

// (3a) Iron shell (mu_r = 1000, 30..50 mm) round the conductor: H is unchanged by symmetry, so B = mu_r mu0 I / (2 pi r) in the iron and mu0 I / (2 pi r) outside it.
export const SHELL = { r0: 0.03, r1: 0.05, muR: 1000 };
export const shellRequest = () => ({
  ...wireRequest(1, 2, [{ shape: "annulus", r0: SHELL.r0, r1: SHELL.r1, muR: SHELL.muR, h: 0.002 }]),
  probes: [{ name: "air r=2a", x: 0.02, y: 0 }, { name: "iron r=4a", x: 0, y: 0.04 }, { name: "air r=10a", x: -0.1, y: 0 }],
});
const SHELL_REF = { "air r=2a": wireB(0.02), "iron r=4a": SHELL.muR * wireB(0.04), "air r=10a": wireB(0.1) };

// (3b) Gapped iron core: annulus 50..70 mm, mu_r = 1000, cut by a radial wedge gap of 0.05 rad (3 mm at the mean radius), excited by the central conductor.
// Magnetic circuit (Ampere's law round r = 60 mm, flux continuous): B_gap = mu0 I / (r (theta_g + (2 pi - theta_g) / mu_r)).
export const CORE = { r0: 0.05, r1: 0.07, rm: 0.06, gap: 0.05, muR: 1000 };
export const CORE_B_GAP = (MU0 * WIRE.I) / (CORE.rm * (CORE.gap + (2 * Math.PI - CORE.gap) / CORE.muR));
export const coreRequest = () => ({
  domain: { type: "disk", r: WIRE.R },
  regions: [{ shape: "disk", r: 0.15, h: 0.004 }, { shape: "annulus", r0: CORE.r0, r1: CORE.r1, muR: CORE.muR, gapAngle: CORE.gap, h: 0.0015 }, { shape: "disk", r: WIRE.a, I: WIRE.I, h: 0.001 }],
  h: 0.02, order: 2,
  probes: [{ name: "gap centre", x: CORE.rm, y: 0 }],
});

export const MAG_REFERENCE_CASES = [
  {
    id: "solenoid-current-sheet-pair",
    request: solenoidRequest(),
    quantity: "|B| between and outside two opposite current sheets",
    reference: SOLENOID_B,
    checks: (r) => [
      { name: "max |B/(mu0 n I) - 1| inside", value: Math.max(...["centre", "inside"].map((k) => relErr(probe(r, k).B, SOLENOID_B))), limit: 1e-3 },
      { name: "max |B_outside| / (mu0 n I)", value: Math.max(...["outsideL", "outsideR"].map((k) => probe(r, k).B / SOLENOID_B)), limit: 1e-3 },
    ],
    source: "Ampere's law for a long solenoid / an infinite current sheet pair: B = mu0 n I inside, 0 outside (Griffiths, Introduction to Electrodynamics, ex. 5.9 / sec. 5.3.3; Jackson sec. 5.3). n = 1000 /m, I = 2 A -> 2.513 mT. Limits fixed before running: 1e-3 relative inside, outside |B| <= 1e-3 mu0 n I (the field is y-invariant, P2 represents the exact piecewise-quadratic A).",
  },
  {
    id: "straight-conductor-inside-outside",
    request: wireRequest(),
    quantity: "|B| at r = a/2 (inside), 2a, 4a, 10a (outside)",
    reference: "B = mu0 I r / (2 pi a^2) for r < a, mu0 I / (2 pi r) for r > a; a = 10 mm, I = 100 A",
    checks: (r) => Object.entries(WIRE_PROBE_R).map(([k, rr]) => ({ name: `|B/B_ref - 1| at ${k}`, value: relErr(probe(r, k).B, wireB(rr)), limit: 1e-2 })),
    source: "Ampere's law for a long straight round conductor with uniform current density (Griffiths ex. 5.10 / prob. 5.13; Jackson sec. 5.3). Limit fixed before running: 1e-2 relative at every probe (straight-sided mesh of the round conductor, pointwise DG1 B).",
  },
  {
    id: "iron-shell-permeability",
    request: shellRequest(),
    quantity: "|B| in air inside, in an iron shell mu_r = 1000, and in air outside",
    reference: SHELL_REF,
    checks: (r) => Object.entries(SHELL_REF).map(([k, ref]) => ({ name: `|B/B_ref - 1| at ${k}`, value: relErr(probe(r, k).B, ref), limit: 1e-2 })),
    source: "Ampere's law for H with linear media: a concentric shell leaves H = I / (2 pi r) unchanged, B = mu_r mu0 H in the shell (Griffiths sec. 6.3, ex. 6.2 / prob. 6.17). Limit fixed before running: 1e-2 relative at every probe.",
  },
  {
    id: "gapped-core-magnetic-circuit",
    request: coreRequest(),
    quantity: "|B| at the centre of the air gap of a gapped iron ring",
    reference: CORE_B_GAP,
    checks: (r) => [
      { name: "|B_gap/B_circuit - 1|", value: relErr(probe(r, "gap centre").B, CORE_B_GAP), limit: 5e-2 },
      { name: "B_air(r=60mm) / B_gap (permeability effect, must be <= 1/50)", value: wireB(CORE.rm) / probe(r, "gap centre").B, limit: 1 / 50 },
    ],
    source: "Magnetic-circuit (reluctance) model of a gapped core, Ampere's law with flux continuity: B_gap = mu0 N I / (l_gap + l_iron / mu_r) (Griffiths sec. 6.3; Hughes, Electrical and Electronic Technology, magnetic circuits chapter). 37.2 mT vs 0.333 mT without the core. Limit fixed before running: 5e-2 relative (the circuit model neglects fringing and leakage; the gap is 3 mm against a 20 mm core width), and the core must raise B by >= 50x.",
  },
];

export const MAG_CONVERGENCE = {
  id: "conductor-energy-mesh-convergence",
  scales: [1, 0.5, 0.25],
  request: (s) => wireRequest(2 * s, 1),
  error: (r) => Math.abs(r.energy / WIRE_ENERGY - 1),
  minObservedOrder: 1.5,
  source: "P1 finite elements: energy error O(h^2) for this smooth problem (Brenner & Scott, The Mathematical Theory of Finite Element Methods, ch. 5); the round boundaries are approximated by straight segments, also O(h^2). Reference W = mu0 I^2/(4 pi) (1/4 + ln(R/a)). Mesh sizes halved twice: the error must fall at every refinement and the observed order log2(e(h/2)/e(h/4)) must be >= 1.5.",
};

/** Converged when the error decreases at every refinement and the last observed order >= minOrder (h halved each step). */
export function magConvergenceVerdict(errors, minOrder) {
  const orders = errors.slice(1).map((e, i) => Math.log2(errors[i] / e));
  const decreasing = errors.every(Number.isFinite) && errors.slice(1).every((e, i) => e < errors[i]);
  const finalOrder = orders.at(-1);
  return { orders, finalOrder, decreasing, pass: decreasing && finalOrder >= minOrder };
}

/** Run the reference + convergence cases (real FEniCSx runs). */
export async function validateEmMagnetostatic({ run = runPlanar2d } = {}) {
  const cases = [];
  for (const c of MAG_REFERENCE_CASES) {
    const result = await run(c.request);
    if (!result.ok) { cases.push({ id: c.id, status: "NOT_COMPUTED", pass: false, reason: magNotComputedReason(result), source: c.source }); continue; }
    const checks = c.checks(result).map((k) => ({ ...k, pass: Number.isFinite(k.value) && k.value <= k.limit }));
    const pass = checks.every((k) => k.pass);
    cases.push({ id: c.id, quantity: c.quantity, reference: c.reference, probes: result.probes, checks, status: pass ? "PASS" : "FAIL", pass, source: c.source, result });
  }
  const C = MAG_CONVERGENCE;
  const runs = [];
  for (const s of C.scales) runs.push(await run(C.request(s)));
  const bad = runs.find((r) => !r.ok);
  const convergence = bad
    ? { id: C.id, scales: C.scales, status: "NOT_COMPUTED", pass: false, reason: magNotComputedReason(bad) }
    : (() => { const errors = runs.map(C.error); const v = magConvergenceVerdict(errors, C.minObservedOrder); return { id: C.id, scales: C.scales, energies: runs.map((r) => r.energy), reference: WIRE_ENERGY, cells: runs.map((r) => r.cells), errors, minObservedOrder: C.minObservedOrder, ...v, status: v.pass ? "PASS" : "FAIL", source: C.source }; })();
  return { cases, convergence };
}
