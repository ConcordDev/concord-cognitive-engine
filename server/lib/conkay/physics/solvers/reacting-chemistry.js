// server/lib/conkay/physics/solvers/reacting-chemistry.js
//
// chem.equilibrium / chem.ignition / chem.flameSpeed: reacting-chemistry
// screening on the Cantera kernel (chem/cantera_kernel.py, wrapped by
// chem/cantera.js). The kernel is a child-process Python, so the (synchronous)
// solvers queue it exactly like the CAD kernels (cad/kernel-queue.js): the
// first run reports NOT_COMPUTED "kernel run pending", DesignSession.settle()
// runs it off the request path and reruns the solver; the result is then
// cached by the request hash.
//
// Node contract: props.chemistry = { op: "equilibrium" | "ignition" |
// "flameSpeed", mechanism: "gri30.yaml" | "h2o2.yaml", fuel: species name
// (e.g. "CH4"), oxidizer?: composition string (default "O2:1, N2:3.76"),
// phi: equivalence ratio, T0: K, P0: Pa, tEnd?: s (ignition), width?: m
// (flame), source?: where the mixture spec comes from }.
//
// Honesty: a fuel species absent from the mechanism is an error, never a
// guess; no Python with Cantera is NOT_COMPUTED with the reason; the flame
// solve is coarse-grid and says so (a WARN, never a silent PASS).

import { registerSolver } from "../registry.js";
import { requestKernel } from "../../cad/kernel-queue.js";
import { runChemistryKernel, runIgnition, chemKernelKey, chemNotComputedReason, CHEM_OPS } from "../../chem/cantera.js";

export const MECHANISMS = ["gri30.yaml", "h2o2.yaml"];
export const DEFAULT_OXIDIZER = "O2:1, N2:3.76";
const DEFAULT_IGNITION_TEND = 0.05; // s — a short window (the reference H2/air delays are 1e-4..1e-3 s)
const DEFAULT_FLAME_WIDTH = 0.03; // m

/** The kernel request + the inputs echo for a chemistry node, or { notComputed } with a precise reason. */
function chemistrySpec(ctx, id, op) {
  const c = ctx.get(id, "props.chemistry");
  if (!c || typeof c !== "object") return { notComputed: `${id} has no props.chemistry (a reacting-chemistry node needs op, mechanism, fuel, phi, T0 (K), P0 (Pa))` };
  if (c.op !== op) return { notComputed: `props.chemistry.op is ${JSON.stringify(c.op)}, not "${op}"` };
  if (!MECHANISMS.includes(c.mechanism)) return { notComputed: `mechanism ${JSON.stringify(c.mechanism)} is not one of ${MECHANISMS.join(", ")} (the two Cantera data files validated here: gri30.yaml for CH4 / natural gas, h2o2.yaml for H2)` };
  if (typeof c.fuel !== "string" || !c.fuel.trim()) return { notComputed: `props.chemistry.fuel must be a species name present in ${c.mechanism} (e.g. "CH4")` };
  if (!(c.phi > 0)) return { notComputed: "props.chemistry.phi (equivalence ratio) must be positive" };
  if (!(c.T0 > 0)) return { notComputed: "props.chemistry.T0 (initial temperature, K) must be positive" };
  if (!(c.P0 > 0)) return { notComputed: "props.chemistry.P0 (initial pressure, Pa) must be positive" };
  if (op === "ignition" && c.tEnd != null && !(c.tEnd > 0)) return { notComputed: "props.chemistry.tEnd (ignition window, s) must be positive" };
  if (op === "flameSpeed" && c.width != null && !(c.width > 0)) return { notComputed: "props.chemistry.width (flame domain width, m) must be positive" };
  const request = {
    mechanism: c.mechanism,
    fuel: c.fuel.trim(),
    oxidizer: typeof c.oxidizer === "string" && c.oxidizer.trim() ? c.oxidizer.trim() : DEFAULT_OXIDIZER,
    phi: c.phi,
    T0: c.T0,
    P0: c.P0,
    ...(op === "ignition" ? { tEnd: c.tEnd ?? DEFAULT_IGNITION_TEND } : {}),
    ...(op === "flameSpeed" ? { width: c.width ?? DEFAULT_FLAME_WIDTH } : {}),
  };
  const source = typeof c.source === "string" && c.source.trim() ? c.source : `${id}.props.chemistry (design graph)`;
  const echo = {
    mechanism: { value: c.mechanism, source: "Cantera data file (ships with Cantera)", basis: "gri30.yaml: natural-gas combustion mechanism; h2o2.yaml: H2/O2 mechanism" },
    fuel: { value: request.fuel, source },
    oxidizer: { value: request.oxidizer, source: request.oxidizer === DEFAULT_OXIDIZER ? "standard air by convention" : source },
    equivalenceRatio: { value: c.phi, unit: "dimensionless", source },
    initialTemperature: { value: c.T0, unit: "K", source },
    initialPressure: { value: c.P0, unit: "Pa", source },
    ...(op === "ignition" ? { ignitionWindow: { value: request.tEnd, unit: "s", source, note: "the integration window, not a property of the mixture" } } : {}),
    ...(op === "flameSpeed" ? { domainWidth: { value: request.width, unit: "m", source } } : {}),
  };
  return { request, echo };
}

/** The (synchronous) solver path: a computed result this process has, or the run queued for settle(). */
function requestChemKernel(op, request) {
  return requestKernel(chemKernelKey(op, request), () => runChemistryKernel(op, request), `Cantera ${op} ${chemKernelKey(op, request).split(":").at(-1)}`);
}

const notComputedOrComputed = (op, outputsOf, assumptions) => (ctx, id) => {
  const q = chemistrySpec(ctx, id, op);
  if (q.notComputed) return q;
  const r = requestChemKernel(op, q.request);
  if (!r.ok) return { notComputed: r.pending ? r.reason : chemNotComputedReason(r), inputs: q.echo };
  return { inputs: q.echo, outputs: outputsOf(r), warnings: r.warnings || [], assumptions, receipt: r };
};

const EQUILIBRIUM_ASSUMPTIONS = [
  "Adiabatic constant-pressure (HP) chemical equilibrium: the upper bound on the product temperature — equilibrium assumes an infinite residence time, so no kinetic (finite-rate) effects, no heat loss and no radiation.",
  "Ideal-gas mixture over the stated mechanism; a fuel species absent from the mechanism is an error, not a guess.",
];

const IGNITION_ASSUMPTIONS = [
  "Homogeneous adiabatic constant-pressure ideal-gas reactor: no mixing, no transport, no heat loss — the kinetic ignition delay of a uniform mixture, not of a device.",
  "Ignition delay is the time of maximum dT/dt; the T0 + 400 K criterion is reported beside it and can differ slightly.",
];

const FLAME_ASSUMPTIONS = [
  "Planar, unstretched, adiabatic 1-D premixed flame with mixture-averaged transport (no Soret diffusion, no radiation); ideal gas.",
  "Coarse grid (refine criteria ratio 3, slope 0.07, curve 0.14) on a 0.03 m domain: a screening solve — the converged-grid flame speed can differ by a few percent, so the run is a WARN, never a silent PASS.",
];

export const chemEquilibrium = registerSolver({
  id: "chem.equilibrium",
  version: "1.0.0",
  domain: "chem.combustion",
  domains: ["chem.combustion", "chem.equilibrium"],
  fidelity: 3,
  method: "Cantera 3.2 chemical equilibrium: element-potential Gibbs free-energy minimization at fixed enthalpy and pressure (HP) over the full mechanism (gri30.yaml for CH4 / natural gas, h2o2.yaml for H2)",
  reference: "server/lib/conkay/chem/cantera_kernel.py; validated in tests/conkay-reacting-chemistry.test.js against Turns, An Introduction to Combustion, 3rd ed. (stoichiometric CH4/air ~2226 K at 300 K; H2/air ~2380 K at 298 K)",
  regime: "ideal-gas mixture, one homogeneous adiabatic constant-pressure equilibrium state; no kinetics (infinite residence time), no heat loss, no radiation",
  units: { inputs: "K, Pa, dimensionless (phi), species name", outputs: "K, Pa, mole fraction" },
  tolerance: "equilibrium solver converges to machine precision; validated against Turns reference temperatures within +/-25 K (CH4/air) and +/-40 K (H2/air)",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.chemistry?.op === "equilibrium").map((n) => n.id),
  run: notComputedOrComputed("equilibrium", (r) => ({
    adiabaticFlameTemperature: { value: r.T_ad, unit: "K", basis: `Cantera ${r.cantera} HP equilibrium over ${r.mechanism}` },
    pressure: { value: r.P, unit: "Pa" },
    majorProducts: { value: r.products, unit: "mole fraction", note: "equilibrium mole fractions, the largest above 1e-4 (at most 8)" },
  }), EQUILIBRIUM_ASSUMPTIONS),
});

export const chemIgnition = registerSolver({
  id: "chem.ignition",
  version: "1.0.0",
  domain: "chem.combustion",
  domains: ["chem.combustion", "chem.ignition"],
  fidelity: 3,
  method: "Cantera 3.2 zero-dimensional homogeneous ignition: IdealGasConstPressureReactor integrated by ReactorNet (adaptive stiff ODE solver); ignition delay at maximum dT/dt, the T0 + 400 K criterion reported beside it",
  reference: "server/lib/conkay/chem/cantera_kernel.py; no single-value ignition-delay citation is claimed — validated qualitatively (monotonic decrease with T0 for H2/air) in tests/conkay-reacting-chemistry.test.js",
  regime: "ideal gas, homogeneous (no transport, no mixing, no heat loss), constant pressure, adiabatic; gri30.yaml / h2o2.yaml kinetics",
  units: { inputs: "K, Pa, dimensionless (phi), s", outputs: "s, K, K/s" },
  tolerance: "adaptive stiff ODE integration to the ReactorNet tolerance; ignition delay validated qualitatively only (a monotonic decrease with initial temperature): no number is pass/failed",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.chemistry?.op === "ignition").map((n) => n.id),
  run: notComputedOrComputed("ignition", (r) => ({
    ignitionDelay: { value: r.ignitionDelay, unit: "s", note: "time of maximum dT/dt" },
    ignitionDelayT400: { value: r.ignitionDelayT400, unit: "s", note: "first time the gas exceeds T0 + 400 K" },
    maxTemperatureRiseRate: { value: r.maxdTdt, unit: "K/s" },
    finalTemperature: { value: r.TFinal, unit: "K", note: `gas temperature at the end of the integration window (${r.reachedTEnd ? "tEnd reached" : "step cap"})` },
  }), IGNITION_ASSUMPTIONS),
});

export const chemFlameSpeed = registerSolver({
  id: "chem.flameSpeed",
  version: "1.0.0",
  domain: "chem.combustion",
  domains: ["chem.combustion", "chem.flame"],
  fidelity: 3,
  method: "Cantera 3.2 FreeFlame one-dimensional unstretched premixed laminar flame, mixture-averaged transport, coarse refinement (ratio 3, slope 0.07, curve 0.14), domain width 0.03 m",
  reference: "server/lib/conkay/chem/cantera_kernel.py; validated in tests/conkay-reacting-chemistry.test.js against measured H2/air flame speeds (Kwon & Faeth, Combust. Flame 124 (2001); Burke et al., Combust. Flame 159 (2012): 2.1-2.3 m/s at 298 K, 1 atm)",
  regime: "ideal gas, planar unstretched adiabatic 1-D flame, mixture-averaged transport (no Soret, no radiation), coarse grid",
  units: { inputs: "K, Pa, dimensionless (phi), m", outputs: "m/s, K" },
  tolerance: "coarse refine criteria: S_L within a few percent of the converged grid; validated against the measured 2.1-2.3 m/s band (no widening); h2o2.yaml mixture-averaged lands ~2.31 m/s, just above it",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.chemistry?.op === "flameSpeed").map((n) => n.id),
  run: notComputedOrComputed("flameSpeed", (r) => ({
    laminarFlameSpeed: { value: r.S_L, unit: "m/s", basis: `Cantera ${r.cantera} FreeFlame, mixture-averaged transport, ${r.mechanism}, ${r.gridPoints} grid points` },
    burnedGasTemperature: { value: r.T_max, unit: "K", note: "the flame's downstream plateau temperature (grid-dependent)" },
    gridPoints: { value: r.gridPoints, unit: "points", note: "coarse-grid screening solve" },
  }), FLAME_ASSUMPTIONS),
});

// ---------------------------------------------------------------------------
// Reference-case validation. Each case: value, tolerance, citation. The pass
// is computed from the numbers, never forced.
// ---------------------------------------------------------------------------

export const CHEM_REFERENCE_CASES = [
  {
    id: "CH4-air-stoichiometric-Tad",
    op: "equilibrium",
    request: { mechanism: "gri30.yaml", fuel: "CH4", oxidizer: DEFAULT_OXIDIZER, phi: 1.0, T0: 300, P0: 101325 },
    quantity: "T_ad",
    reference: 2226,
    tolerance: 25,
    unit: "K",
    source: "Turns, An Introduction to Combustion, 3rd ed., ch. 2: stoichiometric CH4/air adiabatic flame temperature ~2226 K (at 298 K, 1 atm); the same state is computed by the Cantera 'adiabatic flame temperature' example (gri30.yaml, HP). Tolerance +/-25 K.",
  },
  {
    id: "H2-air-stoichiometric-Tad",
    op: "equilibrium",
    request: { mechanism: "gri30.yaml", fuel: "H2", oxidizer: DEFAULT_OXIDIZER, phi: 1.0, T0: 298, P0: 101325 },
    quantity: "T_ad",
    reference: 2380,
    tolerance: 40,
    unit: "K",
    source: "Turns, An Introduction to Combustion, 3rd ed.: stoichiometric H2/air adiabatic flame temperature ~2380-2400 K. Tolerance +/-40 K covers that band.",
  },
  {
    id: "H2-air-stoichiometric-SL",
    op: "flameSpeed",
    request: { mechanism: "h2o2.yaml", fuel: "H2", oxidizer: DEFAULT_OXIDIZER, phi: 1.0, T0: 298, P0: 101325, width: 0.03 },
    quantity: "S_L",
    reference: 2.2,
    tolerance: 0.1,
    unit: "m/s",
    source: "Kwon & Faeth, Combust. Flame 124 (2001) 230: measured H2/air laminar flame speed ~2.1-2.3 m/s at 298 K, 1 atm; Burke et al., Combust. Flame 159 (2012) 3282: mechanism comparisons. Window 2.2 +/- 0.1 m/s is the measured 2.1-2.3 m/s band itself, not widened for mechanism spread. h2o2.yaml with mixture-averaged transport gives ~2.31 m/s (grid-converged: 2.319 at 127 pts, 2.314 at 198 pts), just above the band, so this case honestly reports FAIL.",
  },
];

export const CHEM_IGNITION_CASE = {
  id: "H2-air-ignition-monotonic-T0",
  request: { mechanism: "h2o2.yaml", fuel: "H2", oxidizer: DEFAULT_OXIDIZER, phi: 1.0, P0: 101325, tEnd: 0.05 },
  temperaturesK: [1000, 1200],
  unit: "s",
  qualitative: true,
  source: "No single-value ignition-delay citation is claimed for these states: H2/air ignition is validated only qualitatively — the delay must decrease monotonically with initial temperature (the Arrhenius expectation). The computed values are reported, never pass/failed against a number.",
};

/**
 * Run every reference case against the kernel. Returns per-case
 * { computed, reference, tolerance, unit, pass, source, result (the kernel receipt) }
 * and the qualitative ignition check; pass/fail comes from the numbers.
 */
export async function validateChemistry() {
  const cases = [];
  let cantera = null;
  for (const c of CHEM_REFERENCE_CASES) {
    const result = await runChemistryKernel(c.op, c.request);
    if (!result.ok) {
      cases.push({ id: c.id, quantity: c.quantity, computed: null, reference: c.reference, tolerance: c.tolerance, unit: c.unit, pass: false, source: c.source, reason: chemNotComputedReason(result) });
      continue;
    }
    cantera = result.cantera;
    const computed = result[c.quantity];
    cases.push({
      id: c.id, quantity: c.quantity, computed, reference: c.reference, tolerance: c.tolerance, unit: c.unit,
      pass: Number.isFinite(computed) && Math.abs(computed - c.reference) <= c.tolerance,
      source: c.source, request: c.request, result,
    });
  }
  const ignition = { ...CHEM_IGNITION_CASE, results: [], pass: false };
  const delays = [];
  for (const T0 of CHEM_IGNITION_CASE.temperaturesK) {
    const result = await runIgnition({ ...CHEM_IGNITION_CASE.request, T0 });
    if (!result.ok) {
      ignition.results.push({ T0, ignitionDelay: null, reason: chemNotComputedReason(result) });
      continue;
    }
    cantera = result.cantera;
    ignition.results.push({ T0, ignitionDelay: result.ignitionDelay, ignitionDelayT400: result.ignitionDelayT400, TFinal: result.TFinal, result });
    delays.push(result.ignitionDelay);
  }
  ignition.pass = delays.length === CHEM_IGNITION_CASE.temperaturesK.length && delays.every((d, i) => i === 0 || d < delays[i - 1]);
  return { cantera, ops: Object.keys(CHEM_OPS), cases, ignition };
}