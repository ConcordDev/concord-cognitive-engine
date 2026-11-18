// server/lib/conkay/physics/solvers/multiphysics-couple.js
//
// multiphysics.couple — SX-XC-09 (ConKay solver catalogue,
// Wave 0).
//
// Partitioned field coupling at the JS tier, per the
// CB-0820 engine-only interim ruling (XC-09 is one of the
// five engine-flag rows). The coupling machinery —
// Dirichlet-Neumann interface iteration with fixed
// relaxation or Aitken acceleration, per-step convergence
// measurement, and the partitioned-vs-monolithic deviation
// reported in-run — runs over built-in field problems:
// conjugate heat transfer between two conducting domains,
// and thermo-elastic expansion / stress from a temperature
// field. Full preCICE coupling between the heavy engines
// (OpenFOAM / CalculiX / FEniCSx / Elmer) is the engine
// tier and refuses by name: requires_engine_tier:sxe-11.
//
// Catalogue reference: the preCICE tutorials' coupling
// pattern (CHT flow over a plate); the CI reference case is
// the two-slab CHT problem whose steady interface
// temperature and flux are analytic.

import { registerSolver } from "../registry.js";

/* Tridiagonal solve (Thomas). a sub-, b diag, c super-, d rhs. */
function thomas(a, b, c, d) {
  const n = d.length;
  const cp = new Array(n);
  const dp = new Array(n);
  cp[0] = c[0] / b[0];
  dp[0] = d[0] / b[0];
  for (let i = 1; i < n; i += 1) {
    const m = b[i] - a[i] * cp[i - 1];
    cp[i] = i < n - 1 ? c[i] / m : 0;
    dp[i] = (d[i] - a[i] * dp[i - 1]) / m;
  }
  const x = new Array(n);
  x[n - 1] = dp[n - 1];
  for (let i = n - 2; i >= 0; i -= 1) x[i] = dp[i] - cp[i] * x[i + 1];
  return x;
}

/* One implicit FD step on a domain with n segments (n+1 nodes).
 * bcLeft/bcRight: {type: "dirichlet", value} or {type: "flux", q}
 * where q is the heat flux in +x direction LEAVING at the right
 * boundary (for the right end) — the left end takes dirichlet in
 * every use here. Boundary nodes carry half control volumes. */
function domainStep(T, dom, dt, bcLeft, bcRight) {
  const n = dom.nodes;
  const h = dom.length / n;
  const r = (dom.k * dt) / (dom.rho * dom.cp * h * h);
  const a = new Array(n + 1).fill(0);
  const b = new Array(n + 1).fill(0);
  const c = new Array(n + 1).fill(0);
  const d = new Array(n + 1).fill(0);
  for (let i = 1; i < n; i += 1) {
    a[i] = -r; b[i] = 1 + 2 * r; c[i] = -r; d[i] = T[i];
  }
  // left boundary
  if (bcLeft.type === "dirichlet") { b[0] = 1; d[0] = bcLeft.value; }
  // right boundary
  if (bcRight.type === "dirichlet") {
    b[n] = 1; d[n] = bcRight.value; a[n] = 0; c[n] = 0;
  } else {
    // flux q leaving at the right end, half control volume:
    // (h/2) rho cp (T_n^new - T_n)/dt = k (T_{n-1}^new - T_n^new)/h - q
    const rf = 2 * r;
    a[n] = -rf; b[n] = 1 + rf; c[n] = 0;
    d[n] = T[n] - (2 * dt * bcRight.q) / (dom.rho * dom.cp * h);
  }
  if (bcLeft.type === "dirichlet") { a[0] = 0; c[0] = 0; }
  return thomas(a, b, c, d);
}

function runCht(inputs) {
  const A = inputs.domainA;
  const B = inputs.domainB;
  for (const [name, D] of [["domainA", A], ["domainB", B]]) {
    if (!D || ![D.length, D.k, D.rho, D.cp].every((v) => Number.isFinite(v) && v > 0)
      || !Number.isInteger(D.nodes) || D.nodes < 3 || D.nodes > 200) {
      return { notComputed: `invalid_input:${name} needs positive length/k/rho/cp and integer nodes in [3, 200]` };
    }
  }
  const { tempLeft, tempRight } = inputs;
  if (!Number.isFinite(tempLeft) || !Number.isFinite(tempRight)) {
    return { notComputed: "missing_input:tempLeft and tempRight (the outer boundary temperatures)" };
  }
  const initial = inputs.initialTemp ?? (tempLeft + tempRight) / 2;
  if (!Number.isFinite(initial)) return { notComputed: "invalid_input:initialTemp must be finite" };
  const dt = inputs.dt;
  const tEnd = inputs.tEnd;
  if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(tEnd) || tEnd <= 0 || tEnd / dt > 5000) {
    return { notComputed: "invalid_input:dt and tEnd must be positive with at most 5000 steps at the JS tier" };
  }
  const mode = inputs.relaxation ?? "aitken";
  if (mode !== "aitken" && !(Number.isFinite(mode) && mode > 0 && mode <= 2)) {
    return { notComputed: "invalid_input:relaxation must be 'aitken' or a fixed factor in (0, 2]" };
  }
  const tol = inputs.tolerance ?? 1e-8;
  const maxIter = inputs.maxIterations ?? 100;
  if (!(tol > 0) || !Number.isInteger(maxIter) || maxIter < 1 || maxIter > 500) {
    return { notComputed: "invalid_input:tolerance > 0 and integer maxIterations in [1, 500] are required" };
  }
  const steps = Math.round(tEnd / dt);
  let TA = new Array(A.nodes + 1).fill(initial);
  let TB = new Array(B.nodes + 1).fill(initial);
  TA[0] = tempLeft;
  TB[B.nodes] = tempRight;
  // monolithic state: nodes 0..A.nodes+B.nodes over the joined grid
  let TM = new Array(A.nodes + B.nodes + 1).fill(initial);
  TM[0] = tempLeft;
  TM[TM.length - 1] = tempRight;
  let q = 0;
  let totalIter = 0;
  let maxIterUsed = 0;
  let nonConverged = 0;
  let lastResiduals = [];
  const warnings = [];
  for (let s = 0; s < steps; s += 1) {
    // Every iteration re-solves from the STEP-START state; only the
    // interface quantities (TiB, q) move between iterations. (An
    // earlier draft re-solved from the previous iterate's field,
    // silently advancing time once per iteration — caught by the
    // partitioned-vs-monolithic deviation in this build's suite.)
    const TA0 = TA;
    const TB0 = TB;
    let TiB = TB0[0];
    let omega = mode === "aitken" ? 1 : mode;
    let prevResidual = null;
    let prevOmega = omega;
    let converged = false;
    const residuals = [];
    let TAnew = TA0;
    let TBnew = TB0;
    // flux stationarity scale: the flux a tol-sized temperature
    // change across A's first cell represents
    const fluxTol = (tol * A.k) / (A.length / A.nodes);
    let qPrev = null;
    for (let it = 1; it <= maxIter; it += 1) {
      TAnew = domainStep(TA0, A, dt, { type: "dirichlet", value: tempLeft }, { type: "flux", q });
      const TiA = TAnew[A.nodes];
      const residual = TiA - TiB;
      residuals.push(residual);
      TBnew = domainStep(TB0, B, dt, { type: "dirichlet", value: TiB }, { type: "dirichlet", value: tempRight });
      // interface flux from B's side: q = -k dT/dx at the interface
      q = (-B.k * (TBnew[1] - TBnew[0])) / (B.length / B.nodes);
      totalIter += 1;
      maxIterUsed = Math.max(maxIterUsed, it);
      // convergence needs BOTH sides stationary: temperature
      // residual within tol AND the exchanged flux no longer
      // moving (a temperature-only criterion once declared
      // convergence on a stale flux at steady state — caught
      // by this build's analytic reference case)
      if (Math.abs(residual) <= tol && qPrev !== null && Math.abs(q - qPrev) <= fluxTol) {
        converged = true;
        break;
      }
      qPrev = q;
      if (mode === "aitken" && prevResidual !== null && residual !== prevResidual) {
        omega = -prevOmega * (prevResidual / (residual - prevResidual));
        if (!Number.isFinite(omega) || omega === 0) omega = prevOmega;
        omega = Math.min(2, Math.max(0.05, omega));
      }
      prevResidual = residual;
      prevOmega = omega;
      TiB = TiB + omega * residual;
    }
    // closing sweep: re-solve both sides once with the final
    // exchanged values so the served fields are mutually
    // consistent (the loop's last A-solve otherwise carries
    // the previous iteration's flux)
    TA = domainStep(TA0, A, dt, { type: "dirichlet", value: tempLeft }, { type: "flux", q });
    TB = domainStep(TB0, B, dt, { type: "dirichlet", value: TA[A.nodes] }, { type: "dirichlet", value: tempRight });
    q = (-B.k * (TB[1] - TB[0])) / (B.length / B.nodes);
    if (!converged) nonConverged += 1;
    lastResiduals = residuals;
    // monolithic step over the joined grid (interface node shared,
    // half control volumes weighted by each side's properties)
    TM = monoStep(TM, A, B, dt, tempLeft, tempRight);
  }
  if (nonConverged > 0) warnings.push(`Dirichlet-Neumann iteration did not reach tolerance on ${nonConverged} step(s) — the last iterate is served and flagged`);
  const devA = Math.max(...TA.map((v, i) => Math.abs(v - TM[i])));
  const devB = Math.max(...TB.map((v, j) => Math.abs(v - TM[A.nodes + j])));
  const qSteady = (tempLeft - tempRight) / (A.length / A.k + B.length / B.k);
  const TiSteady = tempLeft - (qSteady * A.length) / A.k;
  return {
    outputs: {
      fieldA: TA,
      fieldB: TB,
      interface: {
        temperatureFromA: TA[A.nodes],
        temperatureFromB: TB[0],
        flux: q,
        steadyAnalytic: { flux: qSteady, interfaceTemperature: TiSteady },
      },
      maxDeviationVsMonolithic: Math.max(devA, devB),
      iterations: { total: totalIter, maxPerStep: maxIterUsed, nonConvergedSteps: nonConverged },
      lastStepResiduals: lastResiduals,
    },
    warnings,
  };
}

function monoStep(TM, A, B, dt, tempLeft, tempRight) {
  // joined grid: segment sizes hA in A, hB in B; the interface node
  // (index A.nodes) has a control volume spanning hA/2 + hB/2.
  const nA = A.nodes;
  const nB = B.nodes;
  const N = nA + nB;
  const hA = A.length / nA;
  const hB = B.length / nB;
  const a = new Array(N + 1).fill(0);
  const b = new Array(N + 1).fill(0);
  const c = new Array(N + 1).fill(0);
  const d = new Array(N + 1).fill(0);
  const seg = (i) => (i < nA ? { h: hA, D: A } : { h: hB, D: B }); // segment i joins node i and i+1
  for (let i = 1; i < N; i += 1) {
    const left = seg(i - 1);
    const right = seg(i);
    // control volume width: half of each neighbouring segment
    const wL = (i - 1 < nA ? hA : hB) / 2;
    const wR = (i < nA ? hA : hB) / 2;
    const width = wL + wR;
    const rhoCp = (left.D.rho * left.D.cp * wL + right.D.rho * right.D.cp * wR) / width;
    const gL = left.D.k / left.h;
    const gR = right.D.k / right.h;
    a[i] = (-dt * gL) / (rhoCp * width);
    c[i] = (-dt * gR) / (rhoCp * width);
    b[i] = 1 - a[i] - c[i];
    d[i] = TM[i];
  }
  b[0] = 1; d[0] = tempLeft;
  b[N] = 1; d[N] = tempRight;
  return thomas(a, b, c, d);
}

function runThermoElastic(inputs) {
  const bar = inputs.bar;
  if (!bar || ![bar.length, bar.E, bar.alpha].every((v) => Number.isFinite(v) && v > 0)
    || !Number.isInteger(bar.nodes) || bar.nodes < 2 || bar.nodes > 1000 || !Number.isFinite(bar.Tref)) {
    return { notComputed: "invalid_input:bar needs positive length/E/alpha, finite Tref, integer nodes in [2, 1000]" };
  }
  let temps;
  if (Array.isArray(inputs.temperatureValues)) {
    if (inputs.temperatureValues.length !== bar.nodes + 1 || !inputs.temperatureValues.every(Number.isFinite)) {
      return { notComputed: `invalid_input:temperatureValues must be ${bar.nodes + 1} finite nodal temperatures` };
    }
    temps = inputs.temperatureValues;
  } else if (inputs.temperatureProfile && Number.isFinite(inputs.temperatureProfile.T0) && Number.isFinite(inputs.temperatureProfile.T1)) {
    const { T0, T1 } = inputs.temperatureProfile;
    temps = Array.from({ length: bar.nodes + 1 }, (_, i) => T0 + ((T1 - T0) * i) / bar.nodes);
  } else {
    return { notComputed: "missing_input:temperatureValues or temperatureProfile {T0, T1}" };
  }
  const constraint = inputs.constraint ?? "free";
  if (!["free", "fixed"].includes(constraint)) {
    return { notComputed: `invalid_input:constraint '${constraint}' (one of: free, fixed)` };
  }
  const h = bar.length / bar.nodes;
  const dT = temps.map((t) => t - bar.Tref);
  const meanDT = dT.reduce((s, v, i) => s + (i === 0 || i === bar.nodes ? v / 2 : v), 0) / bar.nodes;
  // cumulative expansion from the fixed end (trapezoid)
  const displacement = [0];
  for (let i = 1; i <= bar.nodes; i += 1) {
    displacement.push(displacement[i - 1] + bar.alpha * ((dT[i - 1] + dT[i]) / 2) * h);
  }
  const outputs = {
    constraint,
    meanTemperatureRise: meanDT,
    freeExpansion: displacement[bar.nodes],
  };
  if (constraint === "free") {
    outputs.displacement = displacement;
    outputs.stress = 0;
  } else {
    outputs.displacement = new Array(bar.nodes + 1).fill(0);
    outputs.stress = -bar.E * bar.alpha * meanDT;
    outputs.stressBasis = "fully constrained prismatic bar: sigma = -E * alpha * (mean(T) - Tref)";
  }
  return { outputs, warnings: [] };
}

function runCouple(ctx, target) {
  const inputs = ctx?.inputs || {};
  if (target === "precice" || target === "engine") return { notComputed: "requires_engine_tier:sxe-11" };
  let r;
  if (target === "cht") r = runCht(inputs);
  else if (target === "thermo-elastic") r = runThermoElastic(inputs);
  else return { notComputed: `unknown_target:${target} (known: cht, thermo-elastic, precice)` };
  if (r.notComputed) return r;
  return {
    inputs,
    outputs: r.outputs,
    ...(r.warnings && r.warnings.length ? { warnings: r.warnings } : {}),
    margins: [],
    covers: [target],
  };
}

export const multiphysicsCouple = registerSolver({
  id: "multiphysics.couple",
  version: "1.0.0",
  domain: "multiphysics",
  domains: ["multiphysics", "thermal", "mechanics"],
  fidelity: 2,
  method: "partitioned Dirichlet-Neumann field coupling with fixed or Aitken relaxation and in-run partitioned-vs-monolithic deviation (preCICE tutorial pattern), plus thermo-elastic expansion/stress integration",
  reference: "preCICE tutorials (CHT flow over a plate; perpendicular flap) for the coupling pattern — CI reference case: two-slab CHT with analytic steady flux q = (T_L - T_R)/(L1/k1 + L2/k2) and interface temperature T_L - q L1/k1",
  regime: "JS tier per CB-0820 (engine-flag row): two-domain 1D CHT (nodes <= 200 per domain, steps <= 5000) and 1D thermo-elasticity; full preCICE coupling between OpenFOAM/CalculiX/FEniCSx/Elmer is requires_engine_tier:sxe-11",
  units: { inputs: "lengths (m), conductivities (W/m/K), densities (kg/m^3), specific heats (J/kg/K), temperatures (K or C, consistent), E (Pa), alpha (1/K)", outputs: "temperature fields, interface flux (W/m^2), displacements (m), stress (Pa)" },
  tolerance: "interface iteration to the caller's tolerance (default 1e-8 K); the reference case pins the steady interface temperature to the analytic value within 1e-5",
  screening: false,
  targets: () => [], // direct-call solver (solve.direct shape)
  run: runCouple,
});
