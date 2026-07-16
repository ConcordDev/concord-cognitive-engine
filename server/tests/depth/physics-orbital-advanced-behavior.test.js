// tests/depth/physics-orbital-advanced-behavior.test.js
//
// Behavioral tests for the NEW, additive `physics.orbitalMechanicsAdvanced`
// macro (server/domains/physics.js). This macro un-shadows the domain file's
// richer Keplerian-element / Hohmann-transfer orbital-mechanics engine —
// previously dead code because server.js's "Engineering Compute" block
// re-registers the SAME macro name ("orbitalMechanics") with a flatter
// two-body-gravity handler AFTER domains/index.js loads, winning the
// last-write-wins LENS_ACTIONS Map (see docs/WAVE4_INVENTORY.md's `physics`
// row + docs/lens-specs/physics-capability-map.md).
//
// Rather than deleting the server.js duplicate (which PhysicsAdvancedLab.tsx
// and server/tests/depth/physics-behavior.test.js depend on byte-for-byte),
// this exposes the SAME already-written domains/physics.js engine under a
// new, additive macro name that nothing else registers, so it is reachable.
//
// See server/domains/physics.js:135 (orbitalMechanicsHandler, registered
// under both "orbitalMechanics" and "orbitalMechanicsAdvanced" at line 264-265).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

const near = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be within ${eps} of ${expected} (diff ${Math.abs(actual - expected)})`);

// ─── Hohmann-transfer verification ─────────────────────────────────────────
//
// Independent derivation (written from the standard formulas, NOT copy-pasted
// from the handler) of the classic two-impulse Hohmann-transfer maneuver:
//
//   v_circ(r)      = sqrt(mu / r)                     — circular-orbit speed at radius r
//   a_transfer     = (r1 + r2) / 2                     — transfer-ellipse semi-major axis
//   v_transfer(r)  = sqrt(mu * (2/r - 1/a_transfer))   — vis-viva equation at radius r on the transfer ellipse
//   dv1            = |v_transfer(r1) - v_circ(r1)|     — departure burn (at the transfer ellipse's periapsis)
//   dv2            = |v_circ(r2) - v_transfer(r2)|     — arrival/circularization burn (at apoapsis)
//   transferTime   = pi * sqrt(a_transfer^3 / mu)      — half the transfer ellipse's orbital period
//
// These are the standard equations from Curtis, "Orbital Mechanics for
// Engineering Students" §6.3, and Vallado, "Fundamentals of Astrodynamics and
// Applications" — the same equations server/domains/physics.js's
// orbitalMechanicsHandler implements for its Keplerian-elements branch.
//
// The classic worked scenario — a 300 km altitude LEO (r1 ≈ 6678 km) to GEO
// (r2 ≈ 42164 km) — is reproduced here. A web search (2026-07-16, this
// session) against the "Hohmann Transfer Example" pages at
// orbital-mechanics.space and openmdao.org's Hohmann-transfer tutorial
// (search snippet, since direct fetch of both pages 403'd) independently
// reports for exactly this scenario: dv1 = 2.426 km/s, dv2 = 1.467 km/s,
// total ≈ 3.89 km/s, transfer time ≈ 5.28 h. Those published figures use a
// slightly different standard gravitational parameter (Earth mu is commonly
// tabulated as 398,600.4418 km^3/s^2) than G*M with this codebase's own
// constants (G=6.674e-11, M=5.972e24 kg → mu ≈ 398,571.28 km^3/s^2), so
// agreement to within ~0.01 km/s / ~0.01 h (not bit-exact) is the right bar
// for that cross-check — it confirms the FORMULA is textbook-correct. The
// tight, load-bearing assertions below compare the live macro's output
// against this test's OWN independent implementation of the same formula
// using the codebase's exact constants, which should match near bit-for-bit.
function handDerivedHohmann(mu, r1, r2) {
  const aTransfer = (r1 + r2) / 2;
  const vCirc1 = Math.sqrt(mu / r1);
  const vCirc2 = Math.sqrt(mu / r2);
  const vTransfer1 = Math.sqrt(mu * (2 / r1 - 1 / aTransfer));
  const vTransfer2 = Math.sqrt(mu * (2 / r2 - 1 / aTransfer));
  const deltaV1 = Math.abs(vTransfer1 - vCirc1);
  const deltaV2 = Math.abs(vCirc2 - vTransfer2);
  const transferTime = Math.PI * Math.sqrt((aTransfer ** 3) / mu);
  return { aTransfer, deltaV1, deltaV2, totalDeltaV: deltaV1 + deltaV2, transferTime };
}

describe("physics — orbitalMechanicsAdvanced (un-shadowed Keplerian/Hohmann engine)", () => {
  it("LEO(300km alt)→GEO Hohmann transfer matches an independent hand-derivation (Curtis §6.3 / Vallado formulas) and published reference figures to ~0.01 km/s, ~0.01 h", async () => {
    const G = 6.674e-11, M = 5.972e24, mu = G * M;
    const r1 = 6678000;   // 300 km altitude LEO circular orbit, e=0
    const r2 = 42164000;  // GEO radius

    const expected = handDerivedHohmann(mu, r1, r2);

    // Cross-check against published reference figures for exactly this
    // scenario (orbital-mechanics.space / openmdao.org Hohmann-transfer
    // examples, per the 2026-07-16 web search cited above). Loose tolerance
    // because the published mu differs slightly from G*M here.
    near(expected.deltaV1 / 1000, 2.426, 1e-2);      // km/s
    near(expected.deltaV2 / 1000, 1.467, 1e-2);      // km/s
    near(expected.totalDeltaV / 1000, 3.89, 1e-2);   // km/s
    near(expected.transferTime / 3600, 5.28, 1e-2);  // hours

    // Load-bearing: the live macro must match THIS test's independent
    // implementation of the same standard formula, using the SAME constants
    // the handler uses (G=6.674e-11, M=5.972e24) — this should agree to
    // near floating-point precision, not just "close".
    const r = await lensRun("physics", "orbitalMechanicsAdvanced", {
      data: { orbit: { semiMajorAxis: r1, eccentricity: 0, centralBodyMass: M } },
      params: { targetAltitude: r2, points: 12 },
    });
    assert.equal(r.ok, true);
    const ht = r.result.hohmannTransfer;
    near(ht.deltaV1, expected.deltaV1, 1e-3);
    near(ht.deltaV2, expected.deltaV2, 1e-3);
    near(ht.totalDeltaV, expected.totalDeltaV, 1e-3);
    near(ht.transferTime, expected.transferTime, 1e-3);
    assert.equal(ht.targetAltitude, r2);
  });

  it("Keplerian elements propagate a real orbit-point ellipse (periapsis/apoapsis distances match a·(1∓e) exactly, and theta=0 is periapsis)", async () => {
    const a = 10000000, e = 0.3;
    const r = await lensRun("physics", "orbitalMechanicsAdvanced", {
      data: { orbit: { semiMajorAxis: a, eccentricity: e, inclination: 0 } },
      params: { points: 36 },
    });
    assert.equal(r.ok, true);
    const res = r.result;
    near(res.dynamics.periapsis, a * (1 - e), 1e-6);
    near(res.dynamics.apoapsis, a * (1 + e), 1e-6);
    assert.ok(Array.isArray(res.orbitPoints) && res.orbitPoints.length > 0);
    // At true anomaly theta=0, the polar orbit equation r = a(1-e^2)/(1+e*cos(theta))
    // reduces to a(1-e) — periapsis, the closest point to the central body.
    const p0 = res.orbitPoints[0];
    near(p0.radius, a * (1 - e), 1e-3);
    near(p0.theta, 0, 1e-9);
  });

  it("state-vector mode still resolves orbital elements under the new name (same branch orbitalMechanics uses, just additionally reachable here)", async () => {
    const r = await lensRun("physics", "orbitalMechanicsAdvanced", {
      data: {
        stateVector: {
          position: { x: 7000000, y: 0, z: 0 },
          velocity: { x: 0, y: 7546, z: 0 },
          centralBodyMass: 5.972e24,
        },
      },
      params: {},
    });
    assert.equal(r.ok, true);
    assert.ok(["circular", "elliptical"].includes(r.result.orbitType));
    assert.ok(r.result.escapeVelocity > 0);
  });
});

describe("physics — orbitalMechanicsAdvanced does not disturb the shadowed orbitalMechanics name (regression guard)", () => {
  it("physics.orbitalMechanics is UNCHANGED — still the flat server.js Newtonian two-body handler (independently re-derived here, not copied from physics-behavior.test.js, which is NOT modified)", async () => {
    const G = 6.674e-11, m1 = 5.972e24, m2 = 1000, rr = 7000000;
    const r = await lensRun("physics", "orbitalMechanics", { params: { mass1: m1, mass2: m2, distance: rr } });
    assert.equal(r.ok, true);
    const res = r.result;
    near(res.gravitationalForce, (G * m1 * m2) / (rr * rr), 1e-6);
    near(res.orbitalVelocity, Math.sqrt((G * m1) / rr), 1e-6);
    near(res.orbitalPeriod, 2 * Math.PI * Math.sqrt((rr * rr * rr) / (G * m1)), 1e-3);
    assert.ok(res.formula.includes("F = G"));
    // The flat handler's result shape has NO hohmannTransfer/orbitPoints keys —
    // proof the richer engine isn't leaking through under the old, shadowed name.
    assert.equal(res.hohmannTransfer, undefined);
    assert.equal(res.orbitPoints, undefined);
  });

  it("non-positive distance is still rejected on physics.orbitalMechanics (unchanged validation)", async () => {
    const r = await lensRun("physics", "orbitalMechanics", { params: { mass1: 1e24, mass2: 100, distance: 0 } });
    assert.equal(r.result.ok, false);
    assert.ok(r.result.error.includes("numeric mass1, mass2, distance"));
  });
});
