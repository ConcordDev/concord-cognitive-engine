// tests/conkay-aero.test.js
//
// First aerodynamics solver (screening): benchmarks, validity flags, then the
// library car with Cd from its CAD body instead of the 0.28 design target.
//
// References:
//   [HS] J. L. Hess, A. M. O. Smith, Prog. Aerospace Sci. 8 (1967) 1-138 (the panel method);
//   [C]  circular cylinder, potential flow: Cp = 1 - 4 sin^2(theta), no lift, zero drag (d'Alembert);
//   [J]  Joukowski airfoil: exact surface speed through the conformal map z = zeta + c^2/zeta and the
//        Kutta circulation Gamma = 4 pi V R sin(alpha + beta), Cl = 2 Gamma / (V chord)
//        (e.g. Katz & Plotkin, Low-Speed Aerodynamics, 2nd ed., sec. 6.6), re-derived below;
//   [PS] Prandtl-Schlichting turbulent flat plate cf = 0.455 / (log10 Re)^2.58 and
//   [Sch] Schoenherr 0.242 / sqrt(cf) = log10(Re cf): two independent correlations (agree within 2.8 %
//        over Re 1e6..1e9, measured below);
//   [A]  Ahmed, Ramm & Faltin, SAE 840300 (1984), 25 deg body (1.044 x 0.389 x 0.288 m, frontal 0.112 m2,
//        Re 4.29e6): nose 0.020, slant 0.140, base 0.070, friction 0.055, total 0.285
//        (Gant, PhD thesis ch. 7, Table 7.4);
//   [S]  Saltzman, Wang & Iliff, AIAA 99-0383: Hoerner -Cpb = K / sqrt(Cd_fore,b), K = 0.029 (models)
//        .. 0.09-0.10 (full-scale flight); base and forebody drag "combine to form an optimum minimum
//        drag (a drag 'bucket')".
// Passing these is not physical validation of a car's drag: see the solver header.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { solvePanels, velocityAt, signedArea } from "../lib/conkay/aero/panel2d.js";
import { cfTurbulent, cfSchoenherr, cfLaminar, dragBuildup, rearSlantDeg, BUILDUP_COEFFICIENTS, ISA_SEA_LEVEL } from "../lib/conkay/aero/drag-buildup.js";
import { ahmedBenchmark, ahmedBaseCp25, ahmedFrictionCheck, hoernerAhmedBase, calibratedDrag, AHMED_GANT_25, AHMED_LIENHART_25 } from "../lib/conkay/aero/calibrated-drag.js";
import { sectionAreas, meshChecks } from "../lib/conkay/aero/stl-sections.js";
import { profilePolygon } from "../lib/conkay/physics/solvers/aero-drag.js";
import { buildCarFromLibrary, carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";

const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${msg}: ${a} vs ${b} (rel ${(Math.abs(a - b) / Math.abs(b)).toExponential(2)})`);

function cylinder(N, r = 1, cx = 0, cy = 0) {
  const nodes = [];
  for (let k = 0; k < N; k++) { const th = (-2 * Math.PI * k) / N; nodes.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]); }
  nodes.push(nodes[0]);
  return nodes;
}

/** Joukowski airfoil: clockwise nodes from the trailing edge, chord, exact Cl and exact surface speed per node. */
function joukowski({ eps, mu, alphaDeg, n }) {
  const c = 1, z0 = [-eps, mu], R = Math.hypot(c - z0[0], z0[1]), beta = Math.asin(z0[1] / R), a = (alphaDeg * Math.PI) / 180;
  const Gamma = 4 * Math.PI * R * Math.sin(a + beta); // clockwise, V = 1
  const cmul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
  const cdiv = (p, q) => { const d = q[0] ** 2 + q[1] ** 2; return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
  const pts = [], speed = [];
  for (let k = 0; k < n; k++) {
    const t = (-2 * Math.PI * k) / n - beta;
    const zeta = [z0[0] + R * Math.cos(t), z0[1] + R * Math.sin(t)];
    pts.push([zeta[0] + cdiv([1, 0], zeta)[0], zeta[1] + cdiv([1, 0], zeta)[1]]);
    const d = [zeta[0] - z0[0], zeta[1] - z0[1]];
    // w(zeta) = e^{-ia} - R^2 e^{ia} / d^2 + i Gamma / (2 pi d)
    const t2 = cdiv(cmul([R * R * Math.cos(a), R * R * Math.sin(a)], [1, 0]), cmul(d, d));
    const t3 = cdiv([0, Gamma / (2 * Math.PI)], d);
    const w = [Math.cos(a) - t2[0] + t3[0], -Math.sin(a) - t2[1] + t3[1]];
    const dz = [1 - cdiv([1, 0], cmul(zeta, zeta))[0], -cdiv([1, 0], cmul(zeta, zeta))[1]];
    const wz = cdiv(w, dz);
    speed.push({ t, v: Math.hypot(...wz) });
  }
  pts.push(pts[0]);
  const xs = pts.map((p) => p[0]), chord = Math.max(...xs) - Math.min(...xs);
  return { pts, chord, clExact: (2 * Gamma) / chord, speed, beta };
}

describe("panel method: exact benchmarks [HS][C][J]", () => {
  it("circular cylinder: Cp = 1 - 4 sin^2 theta to 1e-10, no lift, zero pressure drag (d'Alembert)", () => {
    const r = solvePanels(cylinder(128), { kutta: false });
    for (const p of r.panels) {
      const th = Math.atan2(p.mid[1], p.mid[0]);
      assert.ok(Math.abs(p.cp - (1 - 4 * Math.sin(th) ** 2)) < 1e-10);
    }
    assert.ok(Math.abs(r.clPressure) < 1e-10 && Math.abs(r.cdPressure) < 1e-10);
  });
  it("Joukowski airfoil (t/c ~ 12 %, camber, alpha 5 deg): Cl converges to the exact value (error falls with N; < 1.5 % at 512 panels)", () => {
    const errs = [64, 128, 256, 512].map((n) => {
      const j = joukowski({ eps: 0.1, mu: 0.05, alphaDeg: 5, n });
      return Math.abs(solvePanels(j.pts, { alphaDeg: 5 }).cl / j.clExact - 1);
    });
    for (let i = 1; i < errs.length; i++) assert.ok(errs[i] < errs[i - 1], `error decreases: ${errs}`);
    assert.ok(errs.at(-1) < 0.015, `512 panels: ${errs.at(-1)}`);
  });
  it("Joukowski airfoil: surface speed converges to the exact map away from the cusp (max |error| 0.073 V at 128 panels -> < 0.01 V at 1024)", () => {
    const errs = [128, 256, 512, 1024].map((n) => {
      const j = joukowski({ eps: 0.1, mu: 0.05, alphaDeg: 5, n });
      const r = solvePanels(j.pts, { alphaDeg: 5 });
      let worst = 0;
      r.panels.forEach((p, i) => {
        if (i < n * 0.1 || i > n * 0.9) return; // the cusp: constant-strength panels converge slowly there
        const exact = (j.speed[i].v + j.speed[(i + 1) % n].v) / 2;
        worst = Math.max(worst, Math.abs(Math.abs(p.vt) - exact)); // absolute, in units of V (stagnation speed is 0)
      });
      return worst;
    });
    for (let i = 1; i < errs.length; i++) assert.ok(errs[i] < errs[i - 1], `error decreases: ${errs}`);
    assert.ok(errs.at(-1) < 0.01, `1024 panels: ${errs.at(-1)}`);
  });
  it("ground plane by images: zero normal velocity on the plane, and far from the plane the free-air lift", () => {
    const j = joukowski({ eps: 0.1, mu: 0.05, alphaDeg: 5, n: 128 });
    const lifted = j.pts.map(([x, y]) => [x, y + 0.6]);
    const r = solvePanels(lifted, { alphaDeg: 0, ground: { y: 0 } });
    for (const x of [-3, -1, 0, 0.5, 1, 2, 4]) assert.ok(Math.abs(velocityAt(r, [x, 0])[1]) < 1e-12, `v at (${x}, 0)`);
    const far = solvePanels(j.pts.map(([x, y]) => [x, y + 200]), { ground: { y: 0 } });
    rel(far.cl, solvePanels(j.pts).cl, 2e-3, "h = 200 chords");
    assert.ok(Math.abs(r.cl - solvePanels(j.pts).cl) > 1e-3, "near the ground the lift differs");
  });
  it("refuses counter-clockwise or open input and a body below the ground", () => {
    const cw = cylinder(16);
    assert.ok(signedArea(cw) < 0);
    assert.throws(() => solvePanels([...cw].reverse(), { kutta: false }), /clockwise/);
    assert.throws(() => solvePanels(cw.slice(0, -1), { kutta: false }), /closed/);
    assert.throws(() => solvePanels(cylinder(16, 1, 0, 0.5), { kutta: false, ground: { y: 0 } }), /above the ground/);
  });
});

describe("drag build-up: correlations and sources [PS][Sch][A][S]", () => {
  it("turbulent skin friction: Prandtl-Schlichting within 2.8 % of Schoenherr over Re 1e6..1e9; laminar Blasius exact", () => {
    for (let e = 6; e <= 9; e += 0.25) rel(cfTurbulent(10 ** e), cfSchoenherr(10 ** e), 0.028, `Re 1e${e}`);
    rel(cfLaminar(1e6), 1.328e-3, 1e-12, "Blasius");
  });
  it("the forebody factor's high end is the Ahmed 25 deg (nose + friction) over flat-plate friction on the Ahmed box", () => {
    const fric = (cfTurbulent(4.29e6) * 2 * 1.044 * (0.389 + 0.288)) / 0.112;
    rel(BUILDUP_COEFFICIENTS.kFore.high * fric, 0.020 + 0.055, 0.002, "k_high reproduces Ahmed's forebody drag");
    // the flat-plate friction alone is 21 % below Ahmed's friction value (theirs is a residual of the total)
    const d = fric / 0.055 - 1;
    assert.ok(d > -0.25 && d < -0.15, `flat-plate vs Ahmed friction ${d}`);
  });
  it("Hoerner's base relation gives the drag bucket [S]: forebody + base is minimum at Cd_fore,b = (K/2)^(2/3)", () => {
    for (const K of [BUILDUP_COEFFICIENTS.baseK.low, BUILDUP_COEFFICIENTS.baseK.high]) {
      const total = (x) => x + K / Math.sqrt(x); // on the base area, A = A_base
      let best = Infinity, at = null;
      for (let x = 1e-3; x < 1; x += 1e-5) { const t = total(x); if (t < best) { best = t; at = x; } }
      rel(at, (K / 2) ** (2 / 3), 2e-3, `K ${K}`);
    }
  });
  it("the range is ordered, each bound is the sum of its terms, and every coefficient states its source", () => {
    const b = dragBuildup({ lengthM: 4.5, wettedAreaM2: 26, frontalAreaM2: 2.05, baseAreaM2: 0.9, rearSlantDeg: 5 }, { speedMs: 80, ...ISA_SEA_LEVEL });
    assert.ok(b.low.cd < b.centre && b.centre < b.high.cd);
    for (const s of [b.low, b.high]) rel(s.cd, (s.fore + s.base + s.slant + s.cooling) / (1 - s.wheelsShare), 1e-12, "sum");
    for (const c of Object.values(BUILDUP_COEFFICIENTS)) assert.ok(c.basis && c.status);
    assert.match(BUILDUP_COEFFICIENTS.cooling.status, /estimated/);
  });
  it("validity: a rear slant over 25 deg, Mach > 0.3 and Re outside 1e6..1e9 are flagged; 12.5..25 deg adds the slant bound", () => {
    const g = { lengthM: 4.5, wettedAreaM2: 26, frontalAreaM2: 2.05, baseAreaM2: 0.9 };
    const f = { speedMs: 80, ...ISA_SEA_LEVEL };
    assert.equal(dragBuildup({ ...g, rearSlantDeg: 28 }, f).inRange, false);
    const mid = dragBuildup({ ...g, rearSlantDeg: 20 }, f);
    assert.equal(mid.high.slant, 0.14);
    assert.equal(mid.low.slant, 0);
    assert.ok(dragBuildup({ ...g, rearSlantDeg: 5 }, { ...f, speedMs: 120 }).flags.some((x) => /Mach/.test(x)));
    assert.ok(dragBuildup({ ...g, rearSlantDeg: 5 }, { ...f, speedMs: 0.5 }).flags.some((x) => /Re_L/.test(x)));
  });
  it("rear slant: from the roof's highest point to the tail", () => {
    const roof = [{ x: 0, z: 1 }, { x: 1, z: 1.2 }, { x: 2, z: 1.2 - Math.tan((10 * Math.PI) / 180) }];
    rel(rearSlantDeg(roof), 10, 1e-9, "10 deg");
  });
});

/** Closed outward-oriented triangle mesh of a box and of a UV sphere. */
function boxMesh([x0, y0, z0], [x1, y1, z1]) {
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return quads.flatMap(([a, b, c, d]) => [[v(a), v(b), v(c)], [v(a), v(c), v(d)]]);
}
function sphereMesh(R, nu = 96, nv = 48) {
  const p = (i, j) => { const th = (Math.PI * j) / nv, ph = (2 * Math.PI * i) / nu; return [R * Math.cos(th), R * Math.sin(th) * Math.cos(ph), R * Math.sin(th) * Math.sin(ph)]; };
  const t = [];
  for (let j = 0; j < nv; j++) {for (let i = 0; i < nu; i++) {
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    if (j > 0) t.push([a, c, b]);
    if (j < nv - 1) t.push([a, d, c]);
  }}
  return t;
}

describe("STL cross-sections (divergence theorem)", () => {
  it("box: A(x) = W H exactly at every cut; closed and outward (volume > 0, zero net flux)", () => {
    const m = boxMesh([0, -1, 0], [4, 1, 1.5]);
    const c = meshChecks(m);
    rel(c.volume, 12, 1e-12, "volume");
    assert.ok(Math.hypot(...c.netFlux) < 1e-12);
    for (const s of sectionAreas(m, [0.01, 1, 2.5, 3.99])) rel(s.area, 3, 1e-12, `x ${s.x}`);
  });
  it("sphere: A(x) = pi (R^2 - x^2) within the mesh's polygon error (< 0.3 %)", () => {
    const m = sphereMesh(1);
    for (const s of sectionAreas(m, [-0.6, -0.2, 0, 0.3, 0.7])) rel(s.area, Math.PI * (1 - s.x ** 2), 3e-3, `x ${s.x}`);
  });
});

describe("the library car: Cd from its CAD body", () => {
  const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
  it("without the CAD body (ellipsoid screening) the 0.28 design target stays a labelled input", () => {
    const b = buildCarFromLibrary(BRIEF, { cadBody: false });
    const v = b.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    assert.equal(v.dragCoefficient, 0.28);
    assert.equal(v.dragCoefficientFrom, undefined);
    const ts = openDesign(b.ir).session.result("vehicle.top-speed@VEH");
    assert.match(ts.inputs.dragCoefficient.source, /design target/);
  });

  let s = null, skip = null;
  before(async () => {
    if (!(await kernelPythonPath())) { skip = "no OCC kernel Python"; return; }
    s = (await carAcceptanceAsync(BRIEF)).session;
  });

  it("computes a Cd range from the solid and re-runs top speed on it (needs the OCC kernel)", (t) => {
    if (skip) return t.skip(skip);
    const a = s.result("aero.drag-buildup@VEH");
    assert.equal(a.status, "WARN", a.reason);
    assert.ok(a.warnings[0].includes("not CFD"));
    const cd = a.outputs.dragCoefficient.value;
    assert.ok(cd.low > 0.05 && cd.low < cd.centre && cd.centre < cd.high && cd.high < 0.6, JSON.stringify(cd));
    rel(cd.centre, Math.sqrt(cd.low * cd.high), 1e-12, "centre");
    const prev = a.outputs.previousEnvelope.value;
    assert.ok(cd.high - cd.low < prev.high - prev.low, `1.1 width ${cd.high - cd.low} vs 1.0 width ${prev.high - prev.low}`);
    assert.equal(a.outputs.ahmedBenchmark.value.containsTarget, true);
    // the geometry it used is the kernel's
    const cad = s.result("cad.body@BODY_SHELL");
    assert.equal(a.inputs.frontalAreaM2.value, cad.outputs.frontalArea.value);
    assert.equal(a.inputs.wettedAreaM2.value, cad.outputs.surfaceArea.value);
    assert.ok(a.inputs.baseAreaM2.value > 0 && a.inputs.baseAreaM2.value < cad.outputs.frontalArea.value);
    assert.ok(a.inputs.rearSlantDeg.value >= 0 && a.inputs.rearSlantDeg.value < 25);
    // top speed: Cd is the computed centre, with the drag-limited speed at both ends of the range
    const ts = s.result("vehicle.top-speed@VEH");
    assert.equal(ts.inputs.dragCoefficient.value, cd.centre);
    assert.match(ts.inputs.dragCoefficient.source, /computed \(screening range\)/);
    const r = ts.outputs.dragLimitedTopSpeedRange.value;
    assert.ok(r.low < ts.outputs.dragLimitedTopSpeed.value && ts.outputs.dragLimitedTopSpeed.value < r.high);
    assert.equal(ts.outputs.topSpeed.status, "model_output_unvalidated");
  });

  it("the 2D section lift sign is reported only when both Kutta placements agree", (t) => {
    if (skip) return t.skip(skip);
    const L = s.result("aero.drag-buildup@VEH").outputs.sectionLift.value;
    const signs = [L.kuttaUpperCorner.cl2d, L.kuttaLowerCorner.cl2d].map(Math.sign);
    assert.equal(L.sign, signs[0] === signs[1] ? (signs[0] > 0 ? "lift" : "downforce") : "indeterminate");
  });

  it("profile polygon runs clockwise from the chosen tail corner", () => {
    const prof = [{ x: 0, top: 0.6, bot: 0.4 }, { x: 1, top: 1.2, bot: 0.15 }, { x: 4, top: 1.1, bot: 0.15 }];
    for (const k of ["upper", "lower"]) {
      const p = profilePolygon(prof, k);
      assert.ok(signedArea(p) < 0, k);
      assert.deepEqual(p[0], k === "upper" ? [4, 1.1] : [4, 0.15]);
    }
  });
});

describe("calibrated drag build-up 1.1, benchmarked on the Ahmed body", () => {
  it("25 deg Ahmed: Gant's 0.285 sits inside the band, and the band is narrower than the 1.0 envelope", () => {
    const b = ahmedBenchmark();
    assert.ok(b.low.cd <= AHMED_GANT_25.total && AHMED_GANT_25.total <= b.high.cd, JSON.stringify(b));
    rel(b.low.base, AHMED_GANT_25.base, 1e-9, "base low is Gant's 0.070");
    rel(b.high.base, AHMED_LIENHART_25.base, 1e-9, "base high is Lienhart's 0.116");
    rel(b.low.slant, AHMED_GANT_25.slant, 1e-12, "slant low");
    rel(b.high.slant, AHMED_LIENHART_25.slant, 1e-12, "slant high");
    rel(b.high.friction, AHMED_GANT_25.friction, 1e-12, "friction high is the residual");
    const fr = ahmedFrictionCheck();
    const cp = ahmedBaseCp25();
    const v1a = dragBuildup(
      { lengthM: 1.044, wettedAreaM2: fr.wettedBoxM2, frontalAreaM2: fr.frontalAreaM2, baseAreaM2: cp.Ab, rearSlantDeg: 25 },
      { speedMs: b.speedMs, ...ISA_SEA_LEVEL },
    );
    assert.ok(b.high.cd - b.low.cd < (v1a.high.cd - v1a.low.cd) / 2, `v2 ${b.high.cd - b.low.cd} vs v1 ${v1a.high.cd - v1a.low.cd}`);
  });
  it("Guilmineau's 25 deg base pressure sits between Gant and Lienhart; Hoerner K=0.10 does not", () => {
    const cp = ahmedBaseCp25();
    assert.ok(cp.guilmineau > cp.gant && cp.guilmineau < cp.lienhart, JSON.stringify(cp));
    const h029 = hoernerAhmedBase(0.029);
    const h10 = hoernerAhmedBase(0.10);
    assert.ok(h029.cd > AHMED_GANT_25.base && h029.cd < AHMED_LIENHART_25.base, `K=0.029 base Cd ${h029.cd}`);
    assert.ok(h10.cd > AHMED_LIENHART_25.base * 2, `K=0.10 base Cd ${h10.cd} is not an Ahmed base`);
  });
  it("a slant past 25 deg is out of range; at 12.5 deg no slant increment is added", () => {
    const flow = { speedMs: 30, ...ISA_SEA_LEVEL };
    const geom = { lengthM: 4, wettedAreaM2: 20, frontalAreaM2: 2, baseAreaM2: 0.4, rearSlantDeg: 30 };
    assert.equal(calibratedDrag(geom, flow).inRange, false);
    const low = calibratedDrag({ ...geom, rearSlantDeg: 12.5 }, flow);
    assert.equal(low.low.slant, 0);
    assert.equal(low.high.slant, 0);
    assert.ok(low.flags.some((f) => /12\.5/.test(f) || /12.5/.test(f)));
  });
  it("flat-plate friction on the Ahmed box is 15 to 25 % below Ahmed's residual friction", () => {
    const fr = ahmedFrictionCheck();
    const d = (fr.flatCd - fr.residualCd) / fr.residualCd;
    assert.ok(d > -0.25 && d < -0.15, `${d}`);
  });
});
