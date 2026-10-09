// tests/conkay-cad-body.test.js
//
// Step 4: the layout revision (rear package derived from the envelopes) and
// the parametric CAD body (cad.body, OpenCascade via OCP). Kernel tests run
// when a Python with OCP is found (CONKAY_OCC_PYTHON or the ConKay OCC venv)
// and are skipped otherwise; the full-car body (about 2-5 min of kernel time,
// cached afterwards) runs only with CONKAY_CAD_BODY_FULL=1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCarFromLibrary, carAcceptance } from "../lib/conkay/compiler/car-from-library.js";
import { LAYOUT_DESIGN_CHOICES, LAYOUT_REVISION_CHOICES, deriveGroundClearance } from "../lib/conkay/compiler/car-layout.js";
import { DesignGraph } from "../lib/conkay/graph/design-graph.js";
import { cadBodyRequest } from "../lib/conkay/physics/solvers/cad-body.js";
import { compileDesignIR } from "../lib/conkay/compiler/design-ir.js";
import { openDesign } from "../lib/conkay/index.js";
import { runBodyKernel, bodyKernelPython } from "../lib/conkay/cad/body-kernel.js";
import { CAD_BODY_DEFAULTS, CAD_BODY_BASIS, CAD_BODY_MATERIAL } from "../lib/conkay/cad/body-params.js";
import { getMaterial } from "../lib/conkay/materials/index.js";
import { obb, aabb } from "../lib/conkay/packaging/geometry.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const HAVE_KERNEL = !!bodyKernelPython();
const FULL = HAVE_KERNEL && process.env.CONKAY_CAD_BODY_FULL === "1";

describe("Layout revision: the rear package derived from the envelopes", () => {
  const b = buildCarFromLibrary(BRIEF, { cadBody: false });
  const veh = b.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
  const rev = veh.packaging.layoutRevision;
  const s = openDesign(b.ir).session;
  const fit = s.result("package.occupant-fit@VEH");
  const itf = s.result("package.interference@VEH");
  const ck = (id) => fit.outputs.checks.value.find((c) => c.id === id);

  it("records every changed parameter old -> new with its reason and basis", () => {
    assert.equal(rev.version, "2.1.0"); // 2.0 rear package + 2.1 ground clearance
    for (const c of rev.changes) {
      assert.ok(c.parameter && c.reason && c.basis, JSON.stringify(c));
      assert.ok("old" in c && "new" in c);
    }
    const row = (p) => rev.changes.find((c) => c.parameter === p);
    assert.equal(row("rearSgRPX").old, 3.38);
    assert.equal(row("rearAxleX").old, 3.7);
    assert.ok(row("rearAxleX").new > 3.7 && row("wheelbase").new > 2.7);
    assert.equal(parseFloat(veh.rearAxleX), row("rearAxleX").new);
    // The rear seats move inboard to clear the CAD body's rear wheel wells by the skin offset.
    assert.ok(row("rearSeatY").new < row("rearSeatY").old && row("rearSeatY").new > 0.25);
    assert.equal(veh.packaging.designChoices.rearSeatY.value, row("rearSeatY").new);
    for (const id of ["DIFFERENTIAL", "TIRE_RL", "TIRE_RR", "SUSPENSION_REAR", "BRAKES_REAR"]) assert.equal(parseFloat(b.ir.nodes.find((n) => n.id === id).position.x), row("rearAxleX").new, id);
    for (const [k, v] of Object.entries(LAYOUT_REVISION_CHOICES)) assert.match(v.basis, /design choice/, k);
    assert.match(veh.packaging.designChoices.rearSgRPX.basis, /^derived: /);
  });

  it("is deterministic and minimal: the derived values are the smallest that keep the margins", () => {
    const b2 = buildCarFromLibrary(BRIEF, { cadBody: false });
    assert.deepEqual(b2.ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging.layoutRevision, rev);
    const m = LAYOUT_REVISION_CHOICES;
    // L48 sits at the knee margin for the governing percentile (within the 1 mm rounding).
    const l48 = Math.min(...["F5", "F95", "M95"].map((k) => ck(`rearKnee.SEAT_3.${k}`).value));
    assert.ok(l48 >= m.rearKneeMarginM.value * 1000 - 0.05 && l48 <= m.rearKneeMarginM.value * 1000 + 1.05, `${l48}`);
    // The differential clears the rear occupants by the margin (within the 1 mm rounding), not more.
    const diffGap = Math.min(...itf.outputs.closest.value.concat(itf.outputs.interferences.value).filter((p) => /DIFFERENTIAL/.test(p.a + p.b) && /SEAT_[34]/.test(p.a + p.b)).map((p) => p.separationMm));
    assert.ok(diffGap >= m.diffClearanceM.value * 1000 - 0.05 && diffGap <= m.diffClearanceM.value * 1000 + 1.5, `${diffGap}`);
  });

  it("resolves the #1039 seat, knee and interference failures", () => {
    assert.equal(b.selection.seats_front.chosen, "seat.recaro.sportster-gt");
    const pole = b.selection.seats_front.candidates.find((c) => /pole-position/.test(c.id));
    assert.equal(pole.ok, false);
    assert.deepEqual(pole.mismatches.map((x) => x.field), ["seatHipBreadthM"]);
    for (const k of ["F5", "F95", "M95"]) {
      assert.equal(ck(`seatWidth.${k}`).pass, true, k);
      for (const seat of ["SEAT_3", "SEAT_4"]) assert.equal(ck(`rearKnee.${seat}.${k}`).pass, true, `${seat} ${k}`);
    }
    assert.notEqual(itf.status, "FAIL", (itf.failures || []).join("; "));
    assert.equal(itf.outputs.interferences.value.length, 0);
  });

  it("the v1 layout is still available (the #1039 regression)", () => {
    const v1 = buildCarFromLibrary(BRIEF, { layout: "v1", cadBody: false });
    const p = v1.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    assert.equal(p.packaging.layoutRevision, undefined);
    assert.equal(parseFloat(p.rearAxleX), 3.7);
    assert.equal(p.packaging.designChoices.rearSgRPX.value, LAYOUT_DESIGN_CHOICES.rearSgRPX.value);
  });
});

describe("Layout revision 2.1: ground clearance toward >= 100 mm", () => {
  const b = buildCarFromLibrary(BRIEF);
  const veh = () => b.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
  const rev = veh().packaging.layoutRevision;
  const row = (p) => rev.changes.find((c) => c.parameter === p);
  const corners = (e) => [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => [0, 1, 2].map((i) => e.center[i] + sx * e.half[0] * e.axes[0][i] + sy * e.half[1] * e.axes[1][i] + sz * e.half[2] * e.axes[2][i]))));
  const envelopes = (ir) => {
    const g = DesignGraph.fromIR(ir).graph;
    return cadBodyRequest({ get: (id, path) => g.get(id, path) }, "BODY_SHELL").request.envelopes.filter((e) => e.enclose !== false);
  };

  it("derives the bottom height from the target, the skin offset and the floor-corner allowance", () => {
    const gc = rev.groundClearance;
    assert.equal(gc.targetM, 0.1);
    assert.ok(close(gc.requiredBottomZ, 0.1 + CAD_BODY_DEFAULTS.skinOffsetM + CAD_BODY_DEFAULTS.floorCornerAllowanceM, 1e-9));
    assert.equal(gc.hold, "hPoint");
    assert.deepEqual([row("floorZ").old, row("floorZ").new], [0.12, 0.155]);
    assert.deepEqual([row("engineBottomZ").old, row("engineBottomZ").new], [0.15, 0.155]);
    // differential: centre at the tyre radius, envelope = Ford's shipping box (0.4318 m high); bottom 0.1105 m -> 0.155
    assert.deepEqual([row("diffRiseM").old, row("diffRiseM").new], [0, 0.045]);
    for (const c of ["floorZ", "engineBottomZ", "diffRiseM", "h30", "rearH31", "steeringWheelH17"]) assert.equal(row(c).revision, "2.1.0", c);
  });

  it("every enclosed envelope's bottom is at or above the required bottom height", () => {
    const req = rev.groundClearance.requiredBottomZ;
    const env = envelopes(b.ir);
    assert.ok(env.length > 20);
    for (const e of env) {
      const z = Math.min(...corners(e).map((p) => p[2]));
      assert.ok(z >= req - 1e-6, `${e.id}: bottom ${z}`);
    }
    // without the change the differential (0.1105 m) and the cabin floor (0.12 m) were below it
    const old = envelopes(buildCarFromLibrary(BRIEF, { groundClearance: null }).ir);
    const low = old.filter((e) => Math.min(...corners(e).map((p) => p[2])) < req - 1e-6).map((e) => e.id.split(":")[0]);
    assert.ok(low.includes("DIFFERENTIAL") && low.includes("SEAT_1") && low.includes("ENGINE"), low.join(","));
  });

  it("hold = hPoint: the H-points and steering wheel stay put, H30 stays inside J1100 Class A", () => {
    const old = buildCarFromLibrary(BRIEF, { groundClearance: null, cadBody: false });
    const now = buildCarFromLibrary(BRIEF, { cadBody: false });
    const z = (ir, id) => parseFloat(ir.nodes.find((n) => n.id === id).position.z);
    for (const id of ["SEAT_1", "SEAT_2", "SEAT_3", "SEAT_4"]) assert.ok(close(z(now.ir, id), z(old.ir, id), 1e-9), id);
    assert.deepEqual([row("h30").old, row("h30").new], [0.22, 0.185]);
    const fit = openDesign(now.ir).session.result("package.occupant-fit@VEH");
    const h30 = fit.outputs.checks.value.find((c) => c.id === "classA.H30");
    assert.equal(h30.value, 185);
    assert.equal(h30.pass, true);
  });

  it("hold = posture: H30 unchanged, so the occupants rise with the floor", () => {
    const p = buildCarFromLibrary(BRIEF, { cadBody: false, groundClearance: { hold: "posture" } });
    const old = buildCarFromLibrary(BRIEF, { cadBody: false, groundClearance: null });
    const pv = p.ir.nodes.find((n) => n.id === "VEH").props.vehicle;
    assert.equal(pv.packaging.designChoices.h30.value, 0.22);
    const z = (ir) => parseFloat(ir.nodes.find((n) => n.id === "SEAT_1").position.z);
    assert.ok(close(z(p.ir) - z(old.ir), 0.035, 1e-9));
  });

  it("reports the halfshaft angle the differential rise costs (computed, not checked: no CV limits in the library)", () => {
    const t = rev.groundClearance.tradeoffs.find((x) => x.item === "rear halfshaft angle");
    const expected = Math.round((Math.atan2(0.045, 0.8 - 0.5334 / 2) * 180) / Math.PI * 100) / 100;
    assert.equal(t.value, expected);
    assert.equal(t.value, 4.82);
    assert.match(t.note, /not checked/);
  });

  it("is a pure derivation (no change when nothing is below the required bottom) and can be switched off", () => {
    const none = deriveGroundClearance({ choices: { ...LAYOUT_DESIGN_CHOICES, floorZ: { value: 0.2 }, engineBottomZ: { value: 0.2 } }, targetM: 0.1, skinOffsetM: 0.04, floorCornerAllowanceM: 0.015, tyreR: 0.3264, diffDims: { heightM: 0.2, widthM: 0.5 }, track: 1.6 });
    assert.deepEqual(none.rows, []);
    assert.deepEqual(none.overrides, {});
    const off = buildCarFromLibrary(BRIEF, { groundClearance: null }).ir.nodes.find((n) => n.id === "VEH").props.vehicle.packaging;
    assert.equal(off.layoutRevision.version, "2.0.0");
    assert.equal(off.designChoices.floorZ.value, 0.12);
  });
});

describe("CAD body: design-graph parameters, material and the no-kernel path", () => {
  it("the body node carries editable parameters with units, and the material's density is cited", () => {
    const b = buildCarFromLibrary(BRIEF);
    const n = b.ir.nodes.find((x) => x.id === "BODY_SHELL");
    assert.equal(n.geometry.shape, "cad-body");
    assert.equal(n.material, CAD_BODY_MATERIAL);
    assert.equal(n.geometry.thickness, "2.925 mm");
    const m = getMaterial(CAD_BODY_MATERIAL);
    assert.equal(m.densityKgM3, 1570);
    assert.match(m.source, /hexcel\.com.*HexPly_8552/);
    for (const k of Object.keys(CAD_BODY_DEFAULTS)) assert.ok(CAD_BODY_BASIS[k.replace(/M$/, "")], k);
    const c = compileDesignIR(b.ir);
    assert.equal(c.ok, true, (c.errors || []).join("; "));
    const g = c.design.nodes.find((x) => x.id === "BODY_SHELL").geometry;
    assert.ok(close(g.thickness, 0.002925) && close(g.skinOffset, 0.04) && close(g.archClearance, 0.04));
    assert.equal(g.stationCount, CAD_BODY_DEFAULTS.stationCount);
    const bad = structuredClone(b.ir);
    bad.nodes.find((x) => x.id === "BODY_SHELL").geometry.skinOffset = "-5 mm";
    assert.equal(compileDesignIR(bad).ok, false);
  });

  it("without a kernel the body, its mass and the fit are NOT_COMPUTED and the car is not passed", () => {
    const saved = process.env.CONKAY_OCC_PYTHON;
    process.env.CONKAY_OCC_PYTHON = "/nonexistent/python";
    try {
      const r = carAcceptance(BRIEF);
      const s = r.session;
      assert.equal(s.result("cad.body@BODY_SHELL").status, "NOT_COMPUTED");
      const m = s.result("mass.part@BODY_SHELL");
      assert.equal(m.status, "NOT_COMPUTED", "no stand-in skin mass");
      assert.equal(s.result("package.occupant-fit@VEH").status, "NOT_COMPUTED");
      assert.equal(r.report.verdict, "not_physically_credible");
      assert.ok(r.report.failures.some((f) => /CAD body not computed/.test(f)));
    } finally {
      if (saved == null) delete process.env.CONKAY_OCC_PYTHON; else process.env.CONKAY_OCC_PYTHON = saved;
    }
  });
});

// A small synthetic scene: a cabin box, an engine box, a pitched (occupant-like) box and four wheels.
const SCENE = {
  command: "body",
  params: { skinOffset: 0.035, stationCount: 36, sectionPoints: 24, frontalSlices: 160, maxIterations: 3, upperExponent: 2.4, lowerExponent: 8, noseExtension: 0.15, tailExtension: 0.1 },
  envelopes: [
    aabb({ id: "CABIN", min: [1.5, -0.6, 0.2], max: [3.0, 0.6, 1.0] }),
    aabb({ id: "ENGINE", min: [0.7, -0.3, 0.2], max: [1.4, 0.3, 0.75] }),
    aabb({ id: "BOOT", min: [3.0, -0.5, 0.2], max: [3.9, 0.5, 0.7] }),
    obb({ id: "TORSO", center: [2.6, 0.3, 0.75], half: [0.12, 0.25, 0.3], pitchDeg: 25 }),
  ].map((b) => ({ id: b.id, kind: "test", center: b.center, half: b.half, axes: b.axes, enclose: true })),
  points: [],
  wheels: [[1.0, -0.8, 35], [1.0, 0.8, 35], [3.45, -0.8, 0], [3.45, 0.8, 0]].map(([x, y, st], i) => ({ id: `W${i}`, center: [x, y, 0.33], radius: 0.33, halfWidth: 0.12, steerDeg: st })),
  rays: [
    { id: "up", origin: [2.2, 0, 0.5], dir: [0, 0, 1] },
    // straight up from each tyre's tread centre line: the fender over it must be hit
    ...[[1.0, 0.8], [3.45, 0.8]].map(([x, y], i) => ({ id: `tread${i}`, origin: [x, y, 0.33], dir: [0, 0, 1] })),
  ],
  exports: ["stl", "glb"],
};

describe("CAD body kernel (OpenCascade)", { skip: !HAVE_KERNEL && "no Python with OCP (CONKAY_OCC_PYTHON / ~/.zuko/venvs/cad-occ)" }, () => {
  const a = HAVE_KERNEL ? runBodyKernel(SCENE, { noCache: true }) : null;

  it("builds one closed, valid solid with wheel wells", () => {
    assert.equal(a.ok, true, a.error);
    assert.equal(a.solid.valid, true);
    assert.equal(a.solid.closed, true);
    assert.equal(a.solid.solids, 1);
    assert.equal(a.solid.freeEdges, 0);
    assert.ok(a.solid.faces > 3, "the wheel wells add faces to the lofted side and two caps");
    assert.ok(a.metrics.volumeM3 > 0 && a.metrics.surfaceAreaM2 > 0 && a.metrics.frontalAreaM2 > 0);
  });

  it("encloses every envelope with at least the skin offset, and no tyre touches the body", () => {
    for (const c of a.clearances) {
      assert.equal(c.inside, true, c.id);
      assert.ok(c.clearanceM >= SCENE.params.skinOffset - 5e-4, `${c.id}: ${c.clearanceM}`);
    }
    for (const w of a.wheels) assert.ok(w.minClearanceM >= 0, `${w.id}: ${w.minClearanceM}`);
    assert.ok(a.rays[0].distanceM > 0.5 - 0.035);
  });

  it("fender pods enclose the tyre sweep: a crown over every tyre and the body side beyond its outer face", () => {
    const P = { archClearance: 0.04, fenderSkin: 0.03, fenderCover: 0.02, ...SCENE.params };
    for (const w of SCENE.wheels) {
      const atWheel = a.sections.filter((s) => s.pods && Math.abs(s.x - w.center[0]) <= w.radius);
      assert.ok(atWheel.length > 0, w.id);
      for (const s of atWheel) {
        const pod = s.pods.find((p) => p.wheel === w.id);
        assert.ok(pod && pod.t === 1, `${w.id} @ ${s.x}`);
        assert.ok(pod.crown >= w.center[2] + w.radius + P.archClearance + P.fenderSkin - 1e-9, `${w.id} crown ${pod.crown}`);
        assert.ok(pod.uOut >= Math.abs(w.center[1]) + w.halfWidth + P.fenderCover - 1e-9, `${w.id} side ${pod.uOut}`);
      }
    }
    for (const r of a.rays.filter((q) => q.id.startsWith("tread"))) {
      assert.ok(Number.isFinite(r.distanceM) && r.distanceM >= 0.33 + P.archClearance - 1e-3, `${r.id}: ${r.distanceM}`);
      assert.ok(r.distanceM < 0.33 + 0.2, `${r.id}: the fender sits right over the tyre (${r.distanceM})`);
    }
  });

  it("the width is set by the fender pods, not by the fender tops: within the tyre's outer face + cover + blend", () => {
    const blend = SCENE.params.blendRadius ?? 0.08, cover = SCENE.params.fenderCover ?? 0.02;
    const podOut = 0.8 + 0.12 + cover;
    // the section model: no feature reaches beyond the tyre's outer face + cover
    for (const s of a.sections.filter((q) => q.pods)) {
      for (const p of s.pods) assert.ok(p.uOut <= podOut + 1e-9, `${s.x} ${p.wheel} ${p.uOut}`);
      assert.ok(s.W <= podOut && s.Wg <= podOut, `${s.x}`);
    }
    // the solid: + the smooth-max blend + 25 mm a side for the B-spline loft between stations (it overshoots
    // slightly where the pods fade in and out; measured 20 mm a side at 36 stations)
    const bound = 2 * (podOut + blend / 4 + 0.025);
    assert.ok(a.metrics.widthM <= bound, `${a.metrics.widthM} > ${bound}`);
    assert.ok(a.metrics.widthM >= 2 * (0.8 + 0.12), "the body covers the tyres' outer faces");
  });

  it("is deterministic: the same parameters give the same sections, measurements and mesh bytes", () => {
    // A second run in parallel clearance workers (forked processes): identical results.
    const prev = process.env.CONKAY_BODY_WORKERS;
    process.env.CONKAY_BODY_WORKERS = "2";
    let b;
    try { b = runBodyKernel(SCENE, { noCache: true }); } finally { if (prev == null) delete process.env.CONKAY_BODY_WORKERS; else process.env.CONKAY_BODY_WORKERS = prev; }
    assert.deepEqual(b.sections, a.sections);
    assert.deepEqual(b.metrics, a.metrics);
    assert.deepEqual(b.clearances, a.clearances);
    assert.equal(b.files.stl.sha256, a.files.stl.sha256);
    assert.equal(b.files.glb.sha256, a.files.glb.sha256);
  });

  it("a parameter edit changes the body (the skin offset grows the sections)", () => {
    const c = runBodyKernel({ ...SCENE, params: { ...SCENE.params, skinOffset: 0.05 } }, { noCache: true });
    assert.ok(c.metrics.volumeM3 > a.metrics.volumeM3);
    for (const x of c.clearances) assert.ok(x.clearanceM >= 0.05 - 5e-4, x.id);
  });

  it("fairing: fairer than the v2.0 loft, with the floor, envelopes and tyres all still held", () => {
    const v20 = runBodyKernel({ ...SCENE, params: { ...SCENE.params, fairSigmaX: 0, fairEnds: false, fairPoleSpacing: 0 } }, { noCache: true });
    assert.equal(v20.ok, true, v20.error);
    assert.equal(v20.fairing, null);
    const fa = a.fairness.regions, fb = v20.fairness.regions;
    assert.ok(fa.body.alongCar.rmsDkDs < 0.8 * fb.body.alongCar.rmsDkDs, `body ${fa.body.alongCar.rmsDkDs} vs ${fb.body.alongCar.rmsDkDs}`);
    assert.ok(fa.body.alongCar.inflections < fb.body.alongCar.inflections);
    assert.ok(fa.tail.alongCar.rmsDkDs < fb.tail.alongCar.rmsDkDs);
    assert.equal(fa.nose.alongCar.inflections, 0);
    // the fairing converged: the faired field is inside the solved sections by at most 0.01 mm
    assert.ok(a.fairing.residualM <= 1e-5, `${a.fairing.residualM}`);
    assert.equal(a.fairing.controlPointsX, Math.round((a.sections.at(-1).x - a.sections[0].x) / 0.24) + 3);
    // the floor: the v2.0 loft dipped below its own solved floor; the faired one does not
    const floor = Math.min(...a.sections.filter((s) => s.zb != null).map((s) => s.zb));
    assert.ok(a.metrics.groundClearanceM >= floor - 1e-6, `${a.metrics.groundClearanceM} < ${floor}`);
    // regression evidence: a point ON the v2.0 loft's surface lies 4.66 mm below its solved floor (bracketed
    // extents; the 16.5 mm once reported here was BRepBndLib's loose box, not the surface)
    assert.ok(v20.metrics.groundClearanceM < floor - 0.004, `v2.0 lowest surface point ${v20.metrics.groundClearanceM} vs floor ${floor}`);
    assert.ok(v20.metrics.extentBrackets.addOptimalBox.min[2] < v20.metrics.groundClearanceM - 0.01, "the box alone is >10 mm outside this surface");
  });

  it("maxWidth: the fairing never cuts into the solved sections; a bound they exceed is reported, not met by cheating", () => {
    const w = runBodyKernel({ ...SCENE, params: { ...SCENE.params, maxWidth: 1.93 } }, { noCache: true });
    assert.equal(w.ok, true, w.error);
    assert.ok(w.metrics.widthM > 1.93, "the pods (tyre outer face + cover + blend) need more than 1.93 m");
    assert.ok(w.fairing.adjustments.length > 0);
    for (const c of w.clearances) assert.ok(c.clearanceM >= SCENE.params.skinOffset - 5e-4, c.id);
    for (const x of w.wheels) assert.ok(x.minClearanceM >= 0, x.id);
  });

  it("bracketed extents: an analytic ellipsoid's semi-axes, attained on the surface and inside the outer box", () => {
    const sem = [2.2, 0.95, 0.6];
    const e = runBodyKernel({ command: "ellipsoid", semi: sem, slices: 60 }, { noCache: true });
    assert.equal(e.ok, true, e.error);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(e.extents.max[i] - sem[i]) < 1e-6 && Math.abs(e.extents.min[i] + sem[i]) < 1e-6, `axis ${i}: ${e.extents.min[i]} .. ${e.extents.max[i]}`);
      const [lo, hi] = e.extents.brackets.max[i];
      assert.ok(lo <= sem[i] + 1e-9 && sem[i] <= hi + 1e-9, `bracket ${i}`);
    }
  });

  it("frontal area and volume match an analytic ellipsoid", () => {
    const e = runBodyKernel({ command: "ellipsoid", semi: [2.2, 0.95, 0.6], slices: 400 }, { noCache: true });
    assert.equal(e.ok, true, e.error);
    assert.ok(Math.abs(e.frontalAreaM2 / (Math.PI * 0.95 * 0.6) - 1) < 0.003, `${e.frontalAreaM2}`);
    assert.ok(Math.abs(e.volumeM3 / ((4 / 3) * Math.PI * 2.2 * 0.95 * 0.6) - 1) < 0.002, `${e.volumeM3}`);
  });
});

describe("CAD body on the library car (full kernel run)", { skip: !FULL && "set CONKAY_CAD_BODY_FULL=1 with a kernel available" }, () => {
  const r = FULL ? carAcceptance(BRIEF) : null;
  const s = r?.session;

  it("cad.body runs with receipts; its parameters are the design graph's", () => {
    const e = s.result("cad.body@BODY_SHELL");
    assert.ok(["PASS", "WARN", "FAIL"].includes(e.status), e.reason);
    assert.equal(e.outputs.solid.value.valid, true);
    assert.equal(e.outputs.solid.value.closed, true);
    assert.ok(e.provenance && e.solver.version);
    assert.ok(close(e.inputs.parameters.value.skinOffset, CAD_BODY_DEFAULTS.skinOffsetM));
  });

  it("the skin mass flows into the mass breakdown as computed (area x thickness x cited density)", () => {
    const body = s.result("cad.body@BODY_SHELL").outputs;
    const m = s.result("mass.part@BODY_SHELL");
    assert.equal(m.outputs.massState.value, "computed");
    assert.match(m.outputs.massState.detail.materialRef, /hexcel\.com/);
    assert.ok(close(m.outputs.mass.value, body.surfaceArea.value * 0.002925 * 1570, 1e-6));
    const bd = s.result("mass.breakdown@VEH");
    assert.ok(bd.outputs.byState.value.computed.kg >= m.outputs.mass.value - 1e-9);
  });

  it("the top speed uses the body's computed frontal area; packaging is measured on the CAD surface", () => {
    const fa = s.result("cad.body@BODY_SHELL").outputs.frontalArea.value;
    const ts = s.result("vehicle.top-speed@VEH");
    assert.ok(close(ts.inputs.frontalArea.value, fa, 1e-12));
    assert.match(ts.inputs.frontalArea.source, /cad\.body/);
    const fit = s.result("package.occupant-fit@VEH");
    assert.ok(fit.outputs.vehicleDimensions.value.overallLength.source.includes("CAD body"));
    assert.ok(fit.outputs.checks.value.some((c) => /CAD body/.test(c.note || "")));
  });

  it("overall width is within the sports 2+2 band (<= 1.95 m) with the track unchanged", () => {
    const m = s.result("cad.body@BODY_SHELL").outputs;
    const w = m.width?.value ?? m.dimensions?.value?.widthM;
    assert.ok(Number.isFinite(w) && w <= 1.95, `width ${w}`);
  });

  it("ground clearance >= 100 mm (layout revision 2.1) on the faired body", () => {
    const m = s.result("cad.body@BODY_SHELL").outputs;
    assert.ok(m.dimensions.value.groundClearanceM >= 0.1 - 1e-4, `${m.dimensions.value.groundClearanceM}`);
    const f = m.fairness.value.regions;
    assert.ok(f.body.alongCar.rmsDkDs < 10, `${f.body.alongCar.rmsDkDs}`);
    assert.ok(m.fairing.value.residualM <= 1e-5);
  });

  it("the README reports the body", () => {
    const readme = s.realizationPackage().files["README.md"];
    assert.match(readme, /## CAD body \(cad\.body\)/);
    assert.match(readme, /frontal area [\d.]+ m2 \(computed, projected\)/);
  });
});
