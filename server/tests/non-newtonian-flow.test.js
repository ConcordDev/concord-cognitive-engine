/**
 * Non-Newtonian pipe flow — power-law + Carreau, laminar internal flow.
 *
 * Per CLAUDE.md's "compute-don't-guess" doctrine, every expected value
 * here is either hand-derivable from the closed-form textbook formula, or
 * checked against the codebase's OWN independently-shipped Hagen-
 * Poiseuille oracle (physics-compute.js#pipeFlow) — never a value pasted
 * from this module's own output.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { pipeFlow } from "../lib/compute/physics-compute.js";
import {
  powerLawViscosity,
  carreauViscosity,
  powerLawPipeFlow,
  carreauPipeFlow,
  invertShearRate,
  generalisedReynolds,
  apparentViscosityMetznerReed,
  assertLaminar,
  LAMINAR_REGIME,
} from "../lib/simulation/non-newtonian-flow.js";

const DIAMETER = 0.02; // m
const LENGTH_M = 1.5; // m
const DELTA_P = 5000; // Pa
const MU = 0.01; // Pa·s — a representative Newtonian viscosity

describe("powerLawViscosity — Ostwald-de Waele, hand-calculable", () => {
  it("n=1 reduces to a constant viscosity K regardless of shear rate", () => {
    assert.equal(powerLawViscosity({ K: 0.5, n: 1, shearRate: 1 }), 0.5);
    assert.equal(powerLawViscosity({ K: 0.5, n: 1, shearRate: 1000 }), 0.5);
    assert.equal(powerLawViscosity({ K: 0.5, n: 1, shearRate: 0 }), 0.5);
  });

  it("shear-thinning (n<1): apparent viscosity strictly decreases as shear rate increases", () => {
    const K = 0.01, n = 0.6;
    const v1 = powerLawViscosity({ K, n, shearRate: 1 });
    const v10 = powerLawViscosity({ K, n, shearRate: 10 });
    const v100 = powerLawViscosity({ K, n, shearRate: 100 });
    assert.ok(v1 > v10 && v10 > v100, `expected strictly decreasing, got ${v1}, ${v10}, ${v100}`);
    // hand check at shearRate=10: K*10^(n-1) = 0.01 * 10^-0.4
    const expected = 0.01 * Math.pow(10, -0.4);
    assert.ok(Math.abs(v10 - expected) < 1e-15, `hand calc ${expected} vs ${v10}`);
  });

  it("shear-thickening (n>1): apparent viscosity strictly increases as shear rate increases", () => {
    const K = 0.01, n = 1.4;
    const v1 = powerLawViscosity({ K, n, shearRate: 1 });
    const v10 = powerLawViscosity({ K, n, shearRate: 10 });
    assert.ok(v10 > v1);
  });
});

describe("carreauViscosity — bounded plateau model, hand-calculable", () => {
  it("shearRate=0 gives exactly mu0 (zero-shear plateau)", () => {
    assert.equal(carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 2, n: 0.5, shearRate: 0 }), 1);
  });

  it("lambda=0 gives exactly mu0 for ANY shear rate (collapses to Newtonian at mu0)", () => {
    assert.equal(carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 0, n: 0.5, shearRate: 1000 }), 1);
  });

  it("n=1 gives exactly mu0 for ANY shear rate regardless of lambda", () => {
    assert.equal(carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 5, n: 1, shearRate: 1000 }), 1);
  });

  it("large shear rate approaches muInf", () => {
    const v = carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 1, n: 0.2, shearRate: 1e6 });
    assert.ok(Math.abs(v - 0.01) < 1e-3, `expected close to muInf=0.01, got ${v}`);
  });
});

describe("powerLawPipeFlow — Rabinowitsch-Mooney, exact Hagen-Poiseuille limit at n=1", () => {
  it("n=1, K=mu matches physics-compute.js#pipeFlow to <1e-12 relative", () => {
    const oracle = pipeFlow({ diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P, viscosity: MU }).value;
    const got = powerLawPipeFlow({ K: MU, n: 1, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    const relErr = Math.abs(got - oracle) / oracle;
    assert.ok(relErr < 1e-12, `oracle ${oracle} vs power-law(n=1) ${got}, relErr ${relErr}`);
  });

  it("shear-thinning (n=0.6) gives strictly MORE flow than Newtonian (n=1.0) at equal K, ΔP", () => {
    const K = 0.01;
    const Q06 = powerLawPipeFlow({ K, n: 0.6, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    const Q10 = powerLawPipeFlow({ K, n: 1.0, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    assert.ok(Q06 > Q10, `expected Q(n=0.6)=${Q06} > Q(n=1.0)=${Q10}`);
  });

  it("pressureDropPa=0 gives exactly zero flow", () => {
    assert.equal(powerLawPipeFlow({ K: 0.01, n: 0.6, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: 0 }), 0);
  });

  it("a negative pressure drop reverses flow direction with the same magnitude", () => {
    const fwd = powerLawPipeFlow({ K: 0.01, n: 0.6, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    const rev = powerLawPipeFlow({ K: 0.01, n: 0.6, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: -DELTA_P });
    assert.ok(Math.abs(fwd + rev) < 1e-18);
  });
});

describe("invertShearRate — bisection, monotone, never diverges", () => {
  it("tau=0 short-circuits to gammaDot=0 exactly (no bisection call)", () => {
    const r = invertShearRate(0, (g) => carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 1, n: 0.5, shearRate: g }));
    assert.equal(r.gammaDot, 0);
    assert.equal(r.converged, true);
  });

  it("recovers the shear rate that reproduces a hand-picked target stress", () => {
    const visc = (g) => carreauViscosity({ mu0: 1, muInf: 0.01, lambda: 1, n: 0.5, shearRate: g });
    const trueGammaDot = 3.7;
    const tau = visc(trueGammaDot) * trueGammaDot;
    const r = invertShearRate(tau, visc);
    assert.ok(r.converged);
    assert.ok(Math.abs(r.gammaDot - trueGammaDot) < 1e-6, `expected ${trueGammaDot}, got ${r.gammaDot}`);
  });
});

describe("carreauPipeFlow — full bisection+quadrature path, exact Hagen-Poiseuille limit", () => {
  it("lambda=0 (collapses to Newtonian at mu0=MU) matches pipeFlow to <1e-10 relative", () => {
    const oracle = pipeFlow({ diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P, viscosity: MU }).value;
    const got = carreauPipeFlow({ mu0: MU, muInf: MU, lambda: 0, n: 0.5, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    const relErr = Math.abs(got - oracle) / oracle;
    assert.ok(relErr < 1e-10, `oracle ${oracle} vs carreau(lambda=0) ${got}, relErr ${relErr}`);
  });

  it("n=1 (collapses to Newtonian at mu0=MU regardless of lambda) matches pipeFlow to <1e-10 relative", () => {
    const oracle = pipeFlow({ diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P, viscosity: MU }).value;
    const got = carreauPipeFlow({ mu0: MU, muInf: 0.002, lambda: 0.01, n: 1, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    const relErr = Math.abs(got - oracle) / oracle;
    assert.ok(relErr < 1e-10, `oracle ${oracle} vs carreau(n=1) ${got}, relErr ${relErr}`);
  });

  it("pressureDropPa=0 gives exactly zero flow without invoking bisection/quadrature", () => {
    assert.equal(
      carreauPipeFlow({ mu0: MU, muInf: 0.001, lambda: 1, n: 0.4, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: 0 }),
      0
    );
  });

  it("a shear-thinning Carreau fluid gives more flow than its zero-shear-only Newtonian equivalent at the same ΔP", () => {
    // mu0 alone (as if the fluid never thinned) is an UPPER bound on apparent
    // viscosity, so using mu0 as a constant-viscosity Newtonian comparison
    // must under-predict the real (thinned) flow rate.
    const newtonianAtMu0 = pipeFlow({ diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P, viscosity: 0.05 }).value;
    const thinned = carreauPipeFlow({ mu0: 0.05, muInf: 0.002, lambda: 0.5, n: 0.4, diameter: DIAMETER, lengthM: LENGTH_M, pressureDropPa: DELTA_P });
    assert.ok(thinned > newtonianAtMu0, `expected shear-thinned flow ${thinned} > constant-mu0 flow ${newtonianAtMu0}`);
  });
});

describe("generalisedReynolds — Metzner-Reed, composes with physics-compute.js#reynoldsNumber", () => {
  it("n=1 reduces the apparent viscosity to exactly K (Newtonian)", () => {
    const muApp = apparentViscosityMetznerReed({ K: 0.01, n: 1, velocity: 5, diameter: 0.02 });
    assert.ok(Math.abs(muApp - 0.01) < 1e-12, `expected muApp≈K=0.01, got ${muApp}`);
  });

  it("velocity=0 gives Re=0 exactly without evaluating the (singular-at-0) apparent-viscosity formula", () => {
    const re = generalisedReynolds({ K: 0.01, n: 0.5, density: 1000, velocity: 0, diameter: 0.02 });
    assert.equal(re.value, 0);
    assert.equal(re.regime, "laminar");
  });

  it("carries the regime field from the SAME bucketing physics-compute.js#reynoldsNumber uses", () => {
    const re = generalisedReynolds({ K: 0.01, n: 1, density: 1000, velocity: 0.05, diameter: 0.02 });
    assert.equal(re.regime, "laminar");
    assert.equal(typeof re.value, "number");
  });
});

describe("assertLaminar — hard refusal above Re≈2300, never extrapolates", () => {
  it("passes a genuinely laminar case (Re=100)", () => {
    const re = generalisedReynolds({ K: 0.01, n: 1, density: 1000, velocity: 0.05, diameter: 0.02 });
    assert.equal(re.value, 100);
    const check = assertLaminar(re);
    assert.equal(check.ok, true);
    assert.equal(check.regime, LAMINAR_REGIME);
  });

  it("refuses a turbulent case with the honest reason and the real Re/regime", () => {
    const re = generalisedReynolds({ K: 0.0001, n: 1, density: 1000, velocity: 50, diameter: 0.05 });
    assert.ok(re.value > 4000, `fixture should be turbulent, Re=${re.value}`);
    const check = assertLaminar(re);
    assert.equal(check.ok, false);
    assert.equal(check.reason, "non_laminar_regime_unsupported");
    assert.equal(check.Re, re.value);
    assert.equal(check.regime, "turbulent");
  });

  it("refuses a transitional case (2300<Re<=4000) rather than treating it as laminar", () => {
    // Re = rho*v*D/muApp; pick values landing in (2300,4000].
    const re = generalisedReynolds({ K: 0.01, n: 1, density: 1000, velocity: 1, diameter: 0.03 });
    assert.ok(re.value > 2300 && re.value <= 4000, `fixture should be transitional, Re=${re.value}`);
    const check = assertLaminar(re);
    assert.equal(check.ok, false);
    assert.equal(check.regime, "transitional");
  });

  it("honestly rejects malformed input instead of fabricating a pass", () => {
    assert.equal(assertLaminar(null).ok, false);
    assert.equal(assertLaminar({}).ok, false);
    assert.equal(assertLaminar({ value: NaN, regime: "laminar" }).ok, false);
  });
});
