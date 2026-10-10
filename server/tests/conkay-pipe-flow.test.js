// tests/conkay-pipe-flow.test.js
//
// Pipe-flow solver (lib/conkay/fluids/pipe-flow.js): verification benchmarks,
// validity flags, then the coolant-loop screen on the library car with water
// properties from the NIST WebBook connector (replayed recordings).
//
// References:
//   [HP] Hagen-Poiseuille: dp = 128 mu L Q / (pi D^4), the exact laminar solution
//        (e.g. F. M. White, Fluid Mechanics, 7th ed., §6.4).
//   [C]  C. F. Colebrook, "Turbulent flow in pipes...", J. Inst. Civil Eng. 11 (1939) 133-156:
//        1/sqrt f = -2 log10(eps/3.7D + 2.51/(Re sqrt f)); the Moody (1944) chart is its plot.
//   [K]  G. Keady, "Colebrook-White formula for pipe flows", J. Hydraul. Eng. 124(1) (1998) 96-97:
//        the exact solution of [C] through the Lambert W function (re-derived in lambertColebrook below).
//   [H]  S. E. Haaland, J. Fluids Eng. 105 (1983) 89-90: 1/sqrt f = -1.8 log10[(eps/D/3.7)^1.11 + 6.9/Re].
//   [SJ] P. K. Swamee, A. K. Jain, J. Hydraul. Div. ASCE 102(5) (1976) 657-664: f = 0.25 / [log10(eps/3.7D + 5.74/Re^0.9)]^2.
//        [H] and [SJ] are explicit approximations of [C], used here only as an independent sanity
//        band; the exactness benchmark is [K]. Measured maximum deviation from [C] over the test
//        grid: Haaland 1.34 % (Re 1e5, eps/D 1e-4), Swamee-Jain 2.83 % (Re 5e3, eps/D 1e-2).
//   Network identities: series and parallel pipes, a quadratic pump against a quadratic
//   system curve (Q = sqrt(a/(b+c))), and the three-reservoir problem (junction head
//   found independently by bisection on continuity).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { frictionFactor, pipeHeadLoss, pumpCurve, solveNetwork, G } from "../lib/conkay/fluids/pipe-flow.js";

const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b} (rel ${(Math.abs(a - b) / Math.abs(b)).toExponential(2)})`);
const WATER = { rho: 998.2, mu: 1.002e-3 };

/** Exact Colebrook via Lambert W: x = 1/sqrt f, x = -c ln(b + a x), c = 2/ln 10, a = 2.51/Re, b = eps/3.7D. */
function lambertW(z) {
  let w = Math.log1p(z); // start (z > 0)
  for (let i = 0; i < 100; i++) {
    const e = Math.exp(w), f = w * e - z;
    const wn = w - f / (e * (w + 1) - ((w + 2) * f) / (2 * w + 2)); // Halley
    if (Math.abs(wn - w) < 1e-15 * Math.max(1, Math.abs(w))) return wn;
    w = wn;
  }
  return w;
}
function lambertColebrook(Re, rr) {
  const c = 2 / Math.LN10, a = 2.51 / Re, b = rr / 3.7, ac = a * c;
  // u = b + a x satisfies u e^(u/ac) = e^(b/ac): u/ac = W(e^(b/ac)/ac); evaluated in logs to avoid overflow
  const lnz = b / ac - Math.log(ac);
  const W = lnz > 500 ? (() => { let w = lnz - Math.log(lnz); for (let i = 0; i < 50; i++) w = lnz - Math.log(w); return w; })() : lambertW(Math.exp(lnz));
  const x = (ac * W - b) / a;
  return 1 / (x * x);
}

describe("friction factor [C][K][H][SJ]", () => {
  const Res = [5e3, 1e4, 1e5, 1e6, 1e7, 1e8], rrs = [0, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.05];
  it("solves Colebrook exactly: agrees with the Lambert-W closed form to 1e-9 over the Moody chart", () => {
    for (const Re of Res) for (const rr of rrs) rel(frictionFactor(Re, rr).f, lambertColebrook(Re, rr), 1e-9, `Re ${Re}, eps/D ${rr}`);
  });
  it("sits within the measured band of the explicit approximations: Haaland ≤ 1.5 %, Swamee-Jain ≤ 3 % (sanity, not the exactness check)", () => {
    for (const Re of Res) {for (const rr of rrs) {
      const f = frictionFactor(Re, rr).f;
      rel(f, (-1.8 * Math.log10((rr / 3.7) ** 1.11 + 6.9 / Re)) ** -2, 0.015, `Haaland Re ${Re} eps/D ${rr}`);
      if (rr <= 1e-2) rel(f, 0.25 / Math.log10(rr / 3.7 + 5.74 / Re ** 0.9) ** 2, 0.03, `Swamee-Jain Re ${Re} eps/D ${rr}`);
    }}
  });
  it("is 64/Re in laminar flow and flags the transitional range and excessive roughness", () => {
    assert.equal(frictionFactor(1000, 0.01).f, 0.064);
    const t = frictionFactor(3000, 1e-4);
    assert.equal(t.regime, "transitional");
    assert.ok(t.f >= 64 / 3000 && Math.abs(t.f - Math.max(64 / 3000, lambertColebrook(3000, 1e-4))) < 1e-9, "the larger of laminar and Colebrook");
    assert.ok(t.flags.length === 1 && /not predictable/.test(t.flags[0]));
    assert.ok(frictionFactor(1e5, 0.08).flags.some((f) => /0.05/.test(f)));
  });
  it("laminar pipe loss is Hagen-Poiseuille exactly [HP]", () => {
    const D = 0.01, L = 2, Q = 1e-6; // Re ≈ 127
    const p = pipeHeadLoss({ D, L, eps: 0, K: [] }, Q, WATER);
    assert.equal(p.regime, "laminar");
    rel(p.h * WATER.rho * G, (128 * WATER.mu * L * Q) / (Math.PI * D ** 4), 1e-12, "dp");
  });
});

describe("networks", () => {
  const pipe = (id, from, to, o = {}) => ({ id, from, to, type: "pipe", D: 0.05, L: 50, eps: 4.5e-5, K: [], ...o });
  it("parallel identical pipes carry equal halves; two in series equal one of twice the length", () => {
    const par = solveNetwork({ fluid: WATER, nodes: [{ id: "A", head: 20 }, { id: "B", head: 0 }], links: [pipe("p1", "A", "B"), pipe("p2", "A", "B")] });
    const one = solveNetwork({ fluid: WATER, nodes: [{ id: "A", head: 20 }, { id: "B", head: 0 }], links: [pipe("p", "A", "B")] });
    rel(par.Q.p1, one.Q.p, 1e-10, "each parallel pipe = the single pipe");
    const ser = solveNetwork({ fluid: WATER, nodes: [{ id: "A", head: 20 }, { id: "M" }, { id: "B", head: 0 }], links: [pipe("s1", "A", "M"), pipe("s2", "M", "B")] });
    const long = solveNetwork({ fluid: WATER, nodes: [{ id: "A", head: 20 }, { id: "B", head: 0 }], links: [pipe("p", "A", "B", { L: 100 })] });
    rel(ser.Q.s1, long.Q.p, 1e-9, "series = one pipe of the summed length");
    rel(ser.H.M, 10, 1e-9, "midpoint head halves the drop");
  });
  it("a quadratic pump against a quadratic system: Q = sqrt(a / (b + c))", () => {
    const curve = pumpCurve([{ Q: 0.001, dp: 2e5 - 1e10 * 0.001 ** 2 }, { Q: 0.004, dp: 2e5 - 1e10 * 0.004 ** 2 }]);
    rel(curve.a, 2e5, 1e-12, "shut-off pressure recovered"); rel(curve.b, 1e10, 1e-12, "curvature recovered");
    const c = 3e10;
    const r = solveNetwork({ fluid: WATER, nodes: [{ id: "T", head: 0 }, { id: "P" }], links: [{ id: "pump", from: "T", to: "P", type: "pump", curve }, { id: "sys", from: "P", to: "T", type: "component", c }] });
    rel(r.Q.pump, Math.sqrt(2e5 / (1e10 + c)), 1e-10, "operating point");
    assert.deepEqual(r.flags, []);
  });
  it("three-reservoir problem: junction head and flows match an independent bisection on continuity", () => {
    const Hs = { R1: 100, R2: 60, R3: 20 }, cs = { R1: 2e5, R2: 5e5, R3: 3e5 }; // dp = c Q^2 (Pa per (m^3/s)^2) / rho g → head
    const r = solveNetwork({ fluid: WATER, nodes: [{ id: "R1", head: 100 }, { id: "R2", head: 60 }, { id: "R3", head: 20 }, { id: "J" }], links: Object.keys(Hs).map((k) => ({ id: k, from: k, to: "J", type: "component", c: cs[k] * WATER.rho * G })) });
    const flowIn = (HJ) => Object.keys(Hs).reduce((s, k) => s + Math.sign(Hs[k] - HJ) * Math.sqrt(Math.abs(Hs[k] - HJ) / cs[k]), 0);
    let lo = 20, hi = 100;
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; flowIn(m) > 0 ? (lo = m) : (hi = m); }
    rel(r.H.J, (lo + hi) / 2, 1e-9, "junction head");
    rel(r.Q.R1, Math.sqrt((100 - r.H.J) / cs.R1), 1e-9, "flow from the highest reservoir");
  });
  it("a two-loop pipe network satisfies continuity and the loop head balance to the solver tolerance", () => {
    const nodes = [{ id: "S", head: 50 }, { id: "a" }, { id: "b", demand: 0.004 }, { id: "c", demand: 0.003 }, { id: "d", demand: 0.002 }];
    const links = [pipe("Sa", "S", "a", { D: 0.1 }), pipe("ab", "a", "b"), pipe("ac", "a", "c"), pipe("bc", "b", "c", { D: 0.04 }), pipe("bd", "b", "d"), pipe("cd", "c", "d", { D: 0.04 })];
    const r = solveNetwork({ fluid: WATER, nodes, links });
    assert.equal(r.ok, true, r.error);
    rel(r.Q.Sa, 0.009, 1e-9, "supply = total demand");
    const hl = Object.fromEntries(r.links.map((l) => [l.id, l.headLoss]));
    assert.ok(Math.abs(hl.ab + hl.bc - hl.ac) < 1e-9, "loop a-b-c");
    assert.ok(Math.abs(hl.bd - hl.bc - hl.cd) < 1e-9, "loop b-d-c");
  });
  it("refuses an unknown component and flags pump-curve extrapolation", () => {
    const curve = pumpCurve([{ Q: 0.002, dp: 1e5 }, { Q: 0.003, dp: 0.6e5 }]);
    const unk = solveNetwork({ fluid: WATER, nodes: [{ id: "T", head: 0 }, { id: "P" }], links: [{ id: "pump", from: "T", to: "P", type: "pump", curve }, { id: "rad", from: "P", to: "T", type: "component" }] });
    assert.equal(unk.ok, false);
    assert.match(unk.error, /unknown component loss: rad/);
    const ext = solveNetwork({ fluid: WATER, nodes: [{ id: "T", head: 0 }, { id: "P" }], links: [{ id: "pump", from: "T", to: "P", type: "pump", curve }, { id: "sys", from: "P", to: "T", type: "component", c: 1e9 }] });
    assert.ok(ext.flags.some((f) => /extrapolated/.test(f)));
  });
});

describe("application: car coolant loop (NIST water, Pierburg CWA400 curve)", async () => {
  const { openDesign } = await import("../lib/conkay/index.js");
  const { buildCarFromLibrary } = await import("../lib/conkay/compiler/car-from-library.js");
  const { withCoolantLoop, LOOP_CHOICES, PUMP_CWA400 } = await import("../lib/conkay/fluids/coolant-loop.js");
  const { replayGetter } = await import("../lib/conkay/knowledge/connectors/fetcher.js");
  const rec = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../lib/conkay/knowledge/fixtures/connector-recordings.json", import.meta.url)), "utf8")).recordings;
  const ir = buildCarFromLibrary("Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.", { cadBody: false }).ir;
  const run = async (choices = {}) => openDesign(await withCoolantLoop(ir, { get: replayGetter(rec), choices })).session.result("fluid.coolant-loop@RADIATOR");
  const one = await run();
  it("reads water at 90 C from the NIST recording, with NIST's stated density uncertainty", () => {
    assert.equal(one.inputs.density.value, 965.31);
    assert.equal(one.inputs.density.uncertainty.type, "pct");
    assert.match(one.inputs.density.source, /webbook\.nist\.gov/);
    assert.ok(one.inputs.viscosity.value > 3e-4 && one.inputs.viscosity.value < 3.3e-4);
  });
  it("required flow = 0.7 x sourced peak power / (rho cp dT)", () => {
    const q = (0.7 * one.inputs.enginePeakPower.value) / (one.inputs.density.value * one.inputs.specificHeat.value * 10);
    rel(one.outputs.requiredFlow.value, q, 1e-12, "required flow");
  });
  it("one CWA400 fails: the required flow is beyond its published points, so its pressure rise is not claimed", () => {
    assert.equal(one.status, "FAIL");
    assert.equal(one.outputs.pumpRiseAtRequiredFlow.value, null);
    assert.ok(one.outputs.flowPerPump.value > PUMP_CWA400.points[1].Q);
    assert.ok(one.outputs.spread.value.every((s) => s.inRange === false), "fails across the whole estimated heat range");
  });
  it("two pumps with 45 mm hoses leave a positive budget for the block and radiator; never a PASS while those are unknown", async () => {
    const two = await run({ pumpsInParallel: { ...LOOP_CHOICES.pumpsInParallel, value: 2 }, hoseId: { ...LOOP_CHOICES.hoseId, value: 0.045 } });
    assert.ok(two.outputs.blockAndRadiatorBudget.value > 0, String(two.outputs.blockAndRadiatorBudget.value));
    rel(two.outputs.blockAndRadiatorBudget.value, two.outputs.pumpRiseAtRequiredFlow.value - two.outputs.hoseLoss.value, 1e-12, "budget");
    assert.notEqual(two.status, "PASS");
    assert.ok(two.warnings.some((w) => /not published/.test(w)));
    assert.ok(two.outputs.hosesOnlyFlowUpperBound.value > two.outputs.requiredFlow.value, "the zero-loss bound exceeds the requirement");
  });
});
