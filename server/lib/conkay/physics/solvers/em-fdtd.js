// server/lib/conkay/physics/solvers/em-fdtd.js
//
// em.fdtd: normal-incidence reflectance / transmittance spectra of a 1-D
// dielectric layer stack (coatings, windows, slabs) by FDTD on MIT Meep
// (em/meep_kernel.py, wrapped by em/meep.js). The kernel is a child process,
// so the (synchronous) solver queues it like the CAD / Cantera / CalculiX
// kernels (cad/kernel-queue.js): the first run reports NOT_COMPUTED "kernel
// run pending", DesignSession.settle() runs it off the request path and
// reruns the solver; the result is cached by the request hash.
//
// Node contract: props.em = {
//   layers: [{ n, thickness }],   (Meep units: length a; frequency c/a)
//   nIncident?: 1, nSubstrate?: 1,
//   fcen, df,                     (band of interest: fcen +/- df/2)
//   nfreq?: 50, resolution?: 40,  (pixels per a)
//   maxReflectance?: { value, source },   (band max R <= value)
//   minTransmittance?: { value, source }, (band min T >= value)
//   timeoutMs?
// }
//
// Honesty: PASS/FAIL only from the criteria the node states; with none the
// spectrum is a WARN. Missing Python/Meep or a failed run is NOT_COMPUTED with
// the reason. The band is restricted to frequencies carrying >= 5 % of the
// pulse's peak incident flux (the normalisation is noise outside it).

import { registerSolver } from "../registry.js";
import { requestKernel } from "../../cad/kernel-queue.js";
import { runStack1d, emKernelKey, emNotComputedReason, DEFAULT_EM_TIMEOUT_MS } from "../../em/meep.js";

export const BAND_FLUX_FRACTION = 0.05;

/** Indices of frequencies inside the trusted band (incident flux >= 5 % of peak). */
export function bandIndices(r, fraction = BAND_FLUX_FRACTION) {
  const peak = Math.max(...r.incidentFlux);
  return r.incidentFlux.map((v, i) => (v >= fraction * peak ? i : -1)).filter((i) => i >= 0);
}

export function emSpec(ctx, id) {
  const e = ctx.get(id, "props.em");
  if (!e || typeof e !== "object") return { notComputed: `${id} has no props.em (an FDTD node needs layers, fcen, df)` };
  if (!Array.isArray(e.layers) || !e.layers.every((l) => l && l.n > 0 && l.thickness > 0)) return { notComputed: "props.em.layers must be a list of { n > 0, thickness > 0 }" };
  if (!(e.fcen > 0) || !(e.df > 0) || e.df >= 2 * e.fcen) return { notComputed: "props.em.fcen and props.em.df must be positive with df < 2 fcen" };
  const nInc = e.nIncident ?? 1, nSub = e.nSubstrate ?? 1;
  if (!(nInc > 0 && nSub > 0)) return { notComputed: "props.em.nIncident / nSubstrate must be positive" };
  const resolution = e.resolution ?? 40;
  if (!(Number.isInteger(resolution) && resolution >= 8)) return { notComputed: "props.em.resolution must be an integer >= 8 pixels per unit length" };
  const request = { layers: e.layers.map((l) => ({ n: l.n, thickness: l.thickness })), nIncident: nInc, nSubstrate: nSub, fcen: e.fcen, df: e.df, nfreq: e.nfreq ?? 50, resolution };
  const source = typeof e.source === "string" && e.source.trim() ? e.source : `${id}.props.em (design graph)`;
  const echo = {
    layers: { value: request.layers, source }, nIncident: { value: nInc, source }, nSubstrate: { value: nSub, source },
    band: { value: [e.fcen - e.df / 2, e.fcen + e.df / 2], unit: "c/a", source }, resolution: { value: resolution, unit: "pixels/a", source },
    ...(e.maxReflectance ? { maxReflectance: { value: e.maxReflectance.value, source: e.maxReflectance.source || source } } : {}),
    ...(e.minTransmittance ? { minTransmittance: { value: e.minTransmittance.value, source: e.minTransmittance.source || source } } : {}),
  };
  return { request, echo, criteria: { maxReflectance: e.maxReflectance, minTransmittance: e.minTransmittance }, timeoutMs: e.timeoutMs ?? DEFAULT_EM_TIMEOUT_MS };
}

const ASSUMPTIONS = [
  "1-D FDTD (Meep, Yee grid, second order): plane wave at normal incidence on infinite planar layers; no oblique incidence, polarisation dependence, roughness or finite aperture.",
  "Lossless, non-dispersive media (constant real index per layer).",
  "Spectra are only reported inside the band carrying >= 5 % of the pulse's peak incident flux; discretisation error scales ~1/resolution^2 — check convergence for thin layers or high index.",
];

export const emFdtd = registerSolver({
  id: "em.fdtd",
  version: "1.0.0",
  domain: "electromagnetics",
  domains: ["electromagnetics", "optics"],
  fidelity: 3,
  method: "MIT Meep 1.35 FDTD: 1-D layer stack, Gaussian pulse, PML, flux monitors with incident-field subtraction (normalisation run); R(f), T(f)",
  reference: "server/lib/conkay/em/meep_kernel.py; validated in tests/conkay-em-fdtd.test.js against the Fresnel normal-incidence reflectance (n=2: 1/9), the Airy (Fabry-Perot) transmission of a dielectric slab and resolution convergence",
  regime: "normal incidence, lossless non-dispersive planar layers between two half-spaces; Meep units (a, c/a)",
  units: { inputs: "length a, frequency c/a (dimensionless Meep units)", outputs: "R, T dimensionless" },
  tolerance: "validated: Fresnel |R - 1/9| <= 5e-3 at resolution 40; slab |T - T_Airy| <= 1e-2 and |R + T - 1| <= 1e-3 at resolution 40; slab error decreasing over 20/40/80 with observed order >= 1.5",
  screening: false,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.em && typeof n.props.em === "object").map((n) => n.id),
  run: (ctx, id) => {
    const q = emSpec(ctx, id);
    if (q.notComputed) return q;
    const key = emKernelKey(q.request);
    const r = requestKernel(key, () => runStack1d(q.request, { timeoutMs: q.timeoutMs }), `Meep FDTD ${key.split(":").at(-1)}`);
    if (!r.ok) return { notComputed: r.pending ? r.reason : emNotComputedReason(r), inputs: q.echo };
    const idx = bandIndices(r);
    const band = { freqs: idx.map((i) => r.freqs[i]), R: idx.map((i) => r.R[i]), T: idx.map((i) => r.T[i]) };
    const maxR = Math.max(...band.R), minT = Math.min(...band.T);
    const margins = [], warnings = [];
    if (q.criteria.maxReflectance?.value >= 0) margins.push({ check: "band max reflectance <= limit", demand: maxR, capacity: q.criteria.maxReflectance.value, unit: "dimensionless", basis: q.criteria.maxReflectance.source || "props.em.maxReflectance" });
    if (q.criteria.minTransmittance?.value >= 0) margins.push({ check: "band min transmittance >= required", demand: q.criteria.minTransmittance.value, capacity: minT, unit: "dimensionless", basis: q.criteria.minTransmittance.source || "props.em.minTransmittance" });
    if (!margins.length) warnings.push("no maxReflectance or minTransmittance on the node: the spectrum is computed but nothing is checked (WARN, not PASS)");
    return {
      inputs: q.echo,
      outputs: {
        spectrum: { value: band, unit: "dimensionless", basis: `Meep ${r.meepVersion} FDTD, resolution ${r.resolution}` },
        maxReflectance: { value: maxR, unit: "dimensionless" },
        minTransmittance: { value: minT, unit: "dimensionless" },
      },
      margins, warnings, assumptions: ASSUMPTIONS, receipt: r,
    };
  },
});

// ---------------------------------------------------------------------------
// Reference-case validation. Tolerances fixed here with their citations; the
// pass is computed from the numbers, never forced.
// ---------------------------------------------------------------------------

export const FRESNEL_N = 2;
export const FRESNEL_R = ((1 - FRESNEL_N) / (1 + FRESNEL_N)) ** 2; // 1/9
export const SLAB = { n: 1.5, d: 1 };

/** Airy transmission of a lossless slab (index n, thickness d) in vacuum at normal incidence, frequency f in c/a. */
export function airyTransmission(f, n = SLAB.n, d = SLAB.d) {
  const r2 = ((n - 1) / (n + 1)) ** 2;
  const F = (4 * r2) / (1 - r2) ** 2;
  return 1 / (1 + F * Math.sin(2 * Math.PI * n * d * f) ** 2);
}

export const fresnelRequest = (resolution) => ({ layers: [], nIncident: 1, nSubstrate: FRESNEL_N, fcen: 1, df: 0.5, nfreq: 50, resolution });
export const slabRequest = (resolution) => ({ layers: [{ n: SLAB.n, thickness: SLAB.d }], nIncident: 1, nSubstrate: 1, fcen: 1, df: 1, nfreq: 101, resolution });

const maxAbs = (a) => Math.max(...a.map(Math.abs));
const fresnelError = (r) => maxAbs(bandIndices(r).map((i) => r.R[i] - FRESNEL_R));
export const slabError = (r) => maxAbs(bandIndices(r).map((i) => r.T[i] - airyTransmission(r.freqs[i])));
const energyError = (r) => maxAbs(bandIndices(r).map((i) => r.R[i] + r.T[i] - 1));

export const EM_REFERENCE_CASES = [
  {
    id: "fresnel-normal-incidence-n2",
    request: fresnelRequest(40),
    quantity: "max |R(f) - 1/9| over the band",
    reference: FRESNEL_R,
    checks: (r) => [{ name: "max |R - 1/9|", value: fresnelError(r), limit: 5e-3 }],
    source: "Fresnel equations at normal incidence, R = ((n1 - n2)/(n1 + n2))^2 = 1/9 for vacuum -> n = 2 (Born & Wolf, Principles of Optics, sec. 1.5.3; Hecht, Optics, sec. 4.6). Limit 5e-3 absolute at resolution 40, the criterion of the standing Meep install test (~/.zuko/tmp/meep-test/fresnel1d.py).",
  },
  {
    id: "slab-fabry-perot-transmission",
    request: slabRequest(40),
    quantity: "max |T(f) - T_Airy(f)| over the band, and energy balance",
    reference: "T_Airy(f) = 1 / (1 + F sin^2(2 pi n d f)), F = 4 r^2 / (1 - r^2)^2, r = (n-1)/(n+1); n = 1.5, d = 1",
    checks: (r) => [{ name: "max |T - T_Airy|", value: slabError(r), limit: 1e-2 }, { name: "max |R + T - 1|", value: energyError(r), limit: 1e-3 }],
    source: "Airy formula for a lossless Fabry-Perot etalon at normal incidence (Born & Wolf sec. 7.6.1; Hecht sec. 9.6). n = 1.5, d = 1 a, band f = 0.5..1.5 c/a (three fringes, T between 0.852 and 1). Limits fixed before running: 1e-2 absolute on T at resolution 40; 1e-3 on R + T - 1 (lossless medium).",
  },
];

export const EM_CONVERGENCE = {
  id: "slab-transmission-resolution-convergence",
  resolutions: [20, 40, 80],
  request: slabRequest,
  error: slabError,
  minObservedOrder: 1.5,
  source: "Yee FDTD is second-order in the grid spacing (Taflove & Hagness, Computational Electrodynamics, ch. 4): the error vs T_Airy must fall at every refinement and the observed order log2(e40/e80) must be >= 1.5.",
};

/** Converged when the error decreases at every refinement and the last observed order >= minOrder (resolution doubled each step). */
export function emConvergenceVerdict(errors, minOrder) {
  const orders = errors.slice(1).map((e, i) => Math.log2(errors[i] / e));
  const decreasing = errors.every(Number.isFinite) && errors.slice(1).every((e, i) => e < errors[i]);
  const finalOrder = orders.at(-1);
  return { orders, finalOrder, decreasing, pass: decreasing && finalOrder >= minOrder };
}

/** Run the reference + convergence cases (real Meep runs). */
export async function validateEmFdtd({ run = runStack1d } = {}) {
  const memo = new Map();
  const solve = (req) => { const k = JSON.stringify(req); if (!memo.has(k)) memo.set(k, run(req)); return memo.get(k); };
  const cases = [];
  for (const c of EM_REFERENCE_CASES) {
    const result = await solve(c.request);
    if (!result.ok) { cases.push({ id: c.id, status: "NOT_COMPUTED", pass: false, reason: emNotComputedReason(result), source: c.source }); continue; }
    const checks = c.checks(result).map((k) => ({ ...k, pass: Number.isFinite(k.value) && k.value <= k.limit }));
    const pass = checks.every((k) => k.pass);
    cases.push({ id: c.id, quantity: c.quantity, reference: c.reference, checks, status: pass ? "PASS" : "FAIL", pass, source: c.source, result });
  }
  const C = EM_CONVERGENCE;
  const runs = [];
  for (const res of C.resolutions) runs.push(await solve(C.request(res)));
  const bad = runs.find((r) => !r.ok);
  const convergence = bad
    ? { id: C.id, resolutions: C.resolutions, status: "NOT_COMPUTED", pass: false, reason: emNotComputedReason(bad) }
    : (() => { const errors = runs.map(C.error); const v = emConvergenceVerdict(errors, C.minObservedOrder); return { id: C.id, resolutions: C.resolutions, errors, minObservedOrder: C.minObservedOrder, ...v, status: v.pass ? "PASS" : "FAIL", source: C.source }; })();
  return { cases, convergence };
}
