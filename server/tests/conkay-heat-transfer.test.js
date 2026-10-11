// tests/conkay-heat-transfer.test.js
//
// Heat-transfer solver (lib/conkay/thermal/conduction.js): verification
// benchmarks against analytic solutions, then the car brake-stop screen.
//
// Reference [I]: F. P. Incropera, D. P. DeWitt, T. L. Bergman, A. S. Lavine,
// Fundamentals of Heat and Mass Transfer, 7th ed. (Wiley, 2011):
//   §3.1   plane wall with convection on both sides (thermal resistance network)
//   §3.5   plane wall with uniform generation, both surfaces at Ts (Eq. 3.42)
//   §3.6.2 / Table 3.4  straight fin of uniform cross-section: adiabatic tip (case B),
//          convection at the tip (case A)
//   §4.2   2D steady rectangle, three sides at T1 and one at T2 (Eq. 4.19)
//   §5.1   lumped capacitance (Eq. 5.6), valid for Bi < 0.1
//   §5.5.1 plane wall with convection, exact series (Eqs. 5.39, 5.39b/c: zeta tan zeta = Bi)
//   §5.7   semi-infinite solid: constant surface temperature (Eq. 5.57),
//          constant surface heat flux (Eq. 5.59)
//   §5.8   multidimensional transient: product solution (rectangular bar)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { erf, erfc, solve1D, solve2D, meshCheck } from "../lib/conkay/thermal/conduction.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (|Δ| ${Math.abs(a - b).toExponential(2)} > ${tol})`);

// Plane-wall series [I] Eq. 5.39: theta* = sum C_n exp(-zeta_n^2 Fo) cos(zeta_n x*)
function wallRoots(Bi, count = 60) {
  const roots = [];
  for (let n = 0; n < count; n++) {
    let lo = n * Math.PI + 1e-12, hi = n * Math.PI + Math.PI / 2 - 1e-12;
    const f = (z) => z * Math.sin(z) - Bi * Math.cos(z); // zeta tan zeta = Bi
    for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (f(lo) * f(m) <= 0) ? (hi = m) : (lo = m); }
    roots.push((lo + hi) / 2);
  }
  return roots;
}
function wallTheta(Bi, Fo, xs) {
  return wallRoots(Bi).reduce((s, z) => s + ((4 * Math.sin(z)) / (2 * z + Math.sin(2 * z))) * Math.exp(-z * z * Fo) * Math.cos(z * xs), 0);
}

describe("erf / erfc", () => {
  it("matches tabulated values ([I] Table B.2; Abramowitz & Stegun Table 7.1)", () => {
    near(erf(0.5), 0.5204998778, 1e-10, "erf 0.5");
    near(erf(1), 0.8427007929, 1e-10, "erf 1");
    near(erf(2), 0.9953222650, 1e-10, "erf 2");
    near(erfc(3) / 2.209049699858544e-5, 1, 1e-10, "erfc 3 (relative)");
    near(erf(2.4999) - erf(2.5001), -2 * 1e-4 * (2 / Math.sqrt(Math.PI)) * Math.exp(-6.25), 1e-12, "continuous across the series/fraction switch");
  });
});

describe("steady 1D [I §3.1, §3.5, §3.6]", () => {
  it("plane wall with convection on both sides: q = ΔT / (1/h1 + L/k + 1/h2)", () => {
    const k = 0.8, L = 0.2, h1 = 30, h2 = 10, T1 = 120, T2 = 10;
    const r = solve1D({ L, n: 20, k, left: { type: "conv", h: h1, Tinf: T1 }, right: { type: "conv", h: h2, Tinf: T2 }, steady: true });
    const q = (T1 - T2) / (1 / h1 + L / k + 1 / h2);
    near(r.heatIn.left, q, 1e-9 * q, "heat flux");
    near(r.T[0], T1 - q / h1, 1e-9, "inner surface temperature");
  });
  it("uniform generation, both surfaces at Ts: T(x) = q̇L²/2k (1 − x²/L²) + Ts (half-width L)", () => {
    const k = 15, L = 0.01, g = 5e7, Ts = 50;
    // symmetric wall modelled from the centre (adiabatic) to the surface
    const r = solve1D({ L, n: 50, k, generation: g, left: { type: "adiabatic" }, right: { type: "T", T: Ts }, steady: true });
    for (const i of [0, 10, 25, 40]) near(r.T[i], ((g * L * L) / (2 * k)) * (1 - (r.x[i] / L) ** 2) + Ts, 1e-8, `T at x = ${r.x[i]}`);
  });
  const fin = { k: 200, D: 0.005, L: 0.05, h: 100, Tb: 100, Tinf: 25 };
  const A = (Math.PI * fin.D ** 2) / 4, P = Math.PI * fin.D;
  const m = Math.sqrt((fin.h * P) / (fin.k * A)), M = Math.sqrt(fin.h * P * fin.k * A) * (fin.Tb - fin.Tinf);
  it("pin fin, adiabatic tip: θ/θb = cosh m(L−x)/cosh mL, q = M tanh mL (Table 3.4 case B)", () => {
    const r = solve1D({ L: fin.L, n: 400, k: fin.k, area: A, perimeter: P, hLateral: fin.h, TinfLateral: fin.Tinf, left: { type: "T", T: fin.Tb }, right: { type: "adiabatic" }, steady: true });
    near(r.heatIn.left, M * Math.tanh(m * fin.L), 1e-5 * M, "fin heat rate");
    near(r.T[400], fin.Tinf + (fin.Tb - fin.Tinf) / Math.cosh(m * fin.L), 1e-3, "tip temperature");
  });
  it("pin fin, convection at the tip (Table 3.4 case A)", () => {
    const r = solve1D({ L: fin.L, n: 400, k: fin.k, area: A, perimeter: P, hLateral: fin.h, TinfLateral: fin.Tinf, left: { type: "T", T: fin.Tb }, right: { type: "conv", h: fin.h, Tinf: fin.Tinf }, steady: true });
    const hm = fin.h / (m * fin.k), mL = m * fin.L;
    near(r.heatIn.left, (M * (Math.sinh(mL) + hm * Math.cosh(mL))) / (Math.cosh(mL) + hm * Math.sinh(mL)), 1e-5 * M, "fin heat rate");
  });
});

describe("transient 1D [I §5.1, §5.5, §5.7]", () => {
  it("plane wall with convection: centre and surface match the exact series (Bi = 1, Fo = 0.2, 0.5, 1.5)", () => {
    const L = 0.05, k = 20, rho = 8000, cp = 500, h = (1 * k) / L, Ti = 300, Tinf = 20;
    const alpha = k / (rho * cp);
    const times = [0.2, 0.5, 1.5].map((Fo) => (Fo * L * L) / alpha);
    const r = solve1D({ L, n: 100, k, rho, cp, left: { type: "adiabatic" }, right: { type: "conv", h, Tinf }, transient: { tEnd: times[2], dt: times[2] / 3000, T0: Ti, record: times } });
    r.history.forEach((hh, i) => {
      const Fo = (alpha * hh.t) / (L * L);
      near((hh.T[0] - Tinf) / (Ti - Tinf), wallTheta(1, Fo, 0), 2e-4, `centre, Fo = ${Fo.toFixed(2)}`);
      near((hh.T[100] - Tinf) / (Ti - Tinf), wallTheta(1, Fo, 1), 2e-4, `surface, Fo = ${Fo.toFixed(2)}`);
      void i;
    });
  });
  it("lumped capacitance holds within the Bi-level error when Bi = 0.02 (Eq. 5.6)", () => {
    const L = 0.01, k = 50, rho = 7800, cp = 450, Bi = 0.02, h = (Bi * k) / L;
    const t = (3 * rho * cp * L) / h; // three time constants
    const r = solve1D({ L, n: 40, k, rho, cp, left: { type: "adiabatic" }, right: { type: "conv", h, Tinf: 0 }, transient: { tEnd: t, dt: t / 2000, T0: 1 } });
    near(r.T[20], Math.exp(-3), 0.02 * Math.exp(-3) + 1e-4, "mid-plane vs exp(-hAt/rhoVc)");
    near(r.T[0], wallTheta(Bi, (k / (rho * cp) * t) / (L * L), 0), 1e-4, "and the exact series exactly");
  });
  const semi = { k: 46, rho: 7500, cp: 490 }; // the brake rotor's iron (sourced below)
  const alpha = semi.k / (semi.rho * semi.cp);
  it("semi-infinite solid, sudden surface temperature: (T−Ts)/(Ti−Ts) = erf(x / 2√αt) (Eq. 5.57)", () => {
    const t = 5, depth = 20 * Math.sqrt(alpha * t);
    const r = solve1D({ L: depth, n: 800, ...semi, left: { type: "T", T: 500 }, right: { type: "adiabatic" }, transient: { tEnd: t, dt: t / 2000, T0: 20 } });
    for (const xm of [0.002, 0.005, 0.01]) {
      const i = Math.round(xm / (depth / 800));
      near((r.T[i] - 500) / (20 - 500), erf(r.x[i] / (2 * Math.sqrt(alpha * t))), 1.5e-3, `x = ${xm} m`);
    }
  });
  it("semi-infinite solid, constant surface flux (Eq. 5.59) — the brake-face case", () => {
    const t = 5, q0 = 2e6, depth = 20 * Math.sqrt(alpha * t);
    const r = solve1D({ L: depth, n: 800, ...semi, left: { type: "q", q: q0 }, right: { type: "adiabatic" }, transient: { tEnd: t, dt: t / 2000, T0: 20 } });
    const exact = (xx) => 20 + ((2 * q0 * Math.sqrt((alpha * t) / Math.PI)) / semi.k) * Math.exp((-xx * xx) / (4 * alpha * t)) - ((q0 * xx) / semi.k) * erfc(xx / (2 * Math.sqrt(alpha * t)));
    near(r.T[0], exact(0), 1e-3 * (exact(0) - 20), "surface");
    for (const xm of [0.003, 0.008]) { const i = Math.round(xm / (depth / 800)); near(r.T[i], exact(r.x[i]), 1e-3 * (exact(0) - 20), `x = ${xm}`); }
  });
  it("mesh halving changes the flux-case surface temperature by < 0.1 % (meshCheck)", () => {
    const t = 5, depth = 20 * Math.sqrt(alpha * t);
    const mc = meshCheck((n) => solve1D({ L: depth, n, ...semi, left: { type: "q", q: 2e6 }, right: { type: "adiabatic" }, transient: { tEnd: t, dt: t / 2000, T0: 20 } }).T[0], 200);
    assert.ok(mc.relChange < 1e-3, mc.relChange);
  });
});

describe("2D [I §4.2, §5.8]", () => {
  it("steady rectangle, T2 on one side and T1 on three (Eq. 4.19)", () => {
    const Lx = 2, Ly = 1, T1 = 0, T2 = 1;
    const r = solve2D({ Lx, Ly, nx: 80, ny: 40, k: 10, edges: { left: { type: "T", T: T1 }, right: { type: "T", T: T1 }, bottom: { type: "T", T: T1 }, top: { type: "T", T: T2 } } });
    const exact = (x, y) => (2 / Math.PI) * Array.from({ length: 199 }, (_, n) => n + 1).reduce((s, n) => s + (((-1) ** (n + 1) + 1) / n) * Math.sin((n * Math.PI * x) / Lx) * (Math.sinh((n * Math.PI * y) / Lx) / Math.sinh((n * Math.PI * Ly) / Lx)), 0);
    for (const [x, y] of [[1, 0.5], [0.5, 0.25], [1.5, 0.75]]) near(r.at(x, y), exact(x, y), 1e-3, `θ(${x}, ${y})`);
  });
  it("transient rectangular bar with convection: centre = product of two plane-wall solutions (§5.8)", () => {
    const L1 = 0.02, L2 = 0.04, k = 20, rho = 8000, cp = 500, h = 500, Ti = 1, alpha = k / (rho * cp);
    const t = 60;
    // quarter section: symmetry (adiabatic) at x = 0 and y = 0, convection at x = L1 and y = L2
    const r = solve2D({ Lx: L1, Ly: L2, nx: 40, ny: 80, k, rho, cp, edges: { left: { type: "adiabatic" }, bottom: { type: "adiabatic" }, right: { type: "conv", h, Tinf: 0 }, top: { type: "conv", h, Tinf: 0 } }, transient: { tEnd: t, dt: 0.05, T0: Ti } });
    const exact = wallTheta((h * L1) / k, (alpha * t) / L1 ** 2, 0) * wallTheta((h * L2) / k, (alpha * t) / L2 ** 2, 0);
    near(r.at(0, 0), exact, 5e-4, "centre");
    const corner = wallTheta((h * L1) / k, (alpha * t) / L1 ** 2, 1) * wallTheta((h * L2) / k, (alpha * t) / L2 ** 2, 1);
    near(r.at(L1, L2), corner, 2e-3, "corner");
  });
});

describe("application: car front brake, one stop from the top-speed requirement", async () => {
  const { openDesign } = await import("../lib/conkay/index.js");
  const { buildCarFromLibrary } = await import("../lib/conkay/compiler/car-from-library.js");
  const { withBrakeThermal, rotorFromKit, ROTOR_IRON_PROXY, BRAKE_ESTIMATES } = await import("../lib/conkay/thermal/brake-stop.js");
  const { brakeStop } = await import("../lib/conkay/physics/solvers/brake-thermal.js");
  const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
  const s = openDesign(withBrakeThermal(buildCarFromLibrary(BRIEF, { cadBody: false }).ir)).session;
  const env = s.result("thermal.brake-stop@BRAKES_FRONT");
  const m = s.result("mass.assembly@VEH").outputs.grossMass.value;
  it("uses the sourced rotor (Wilwood 160-8398-GTB, 17.50 lb, 14.00 x 1.25 in) and the requirement speed", () => {
    const rot = rotorFromKit("brakes.wilwood.aero6.140-13886");
    near(rot.massKg, 17.5 * 0.45359237, 1e-12, "rotor mass");
    near(rot.outerRadiusM, 7 * 0.0254, 1e-12, "outer radius");
    near(env.inputs.stopFrom.value, 80.4672, 1e-9, "180 mph");
  });
  it("conserves energy: bulk rise = share·½mv²/2 / (m_rotor cp), and the slab's mean temperature at the stop equals it", () => {
    const rot = rotorFromKit("brakes.wilwood.aero6.140-13886");
    const bulk = (0.5 * m * 80.4672 ** 2 * BRAKE_ESTIMATES.frontShare.value) / 2 / (rot.massKg * ROTOR_IRON_PROXY.specificHeatJkgK);
    near(env.outputs.bulkRise.value, bulk, 1e-9 * bulk, "bulk rise");
    const r = brakeStop({ massKg: m, v0: 80.4672, decel: 9.80665, frontShare: 0.7, rotorsOnAxle: 2, heatShare: 1, rotor: rot, padHeight: 0.05, mat: ROTOR_IRON_PROXY, T0: 25 });
    near(r.meanEndC, 25 + bulk, 1e-3 * bulk, "stored energy in the slab = energy in");
  });
  it("reports the peak face temperature with its spread, mesh-converged, and is not a PASS outside the property range", () => {
    const p = env.outputs.peakFaceTemp;
    assert.ok(p.range[0] < p.value && p.value < p.range[1]);
    assert.ok(p.value > 25 + env.outputs.bulkRise.value, "the face runs hotter than the bulk");
    assert.ok(env.outputs.meshChange.value < 1e-3);
    assert.equal(env.status, "WARN");
    assert.equal(env.outputs.validity.value.inRange, false);
    assert.ok(env.warnings.some((w) => /no service temperature limit/.test(w)));
    assert.equal(env.margins[0].capacity, 1180, "solidus bound only");
  });
});
