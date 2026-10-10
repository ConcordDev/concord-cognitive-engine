// tests/conkay-design-surface.test.js
//
// Roadmap 5 item 1. The design-surface layers sit on the package.
// The styling reference is not a source of dimensions. Headroom, egress
// and torsional stiffness are the solvers' own results. Drag and the
// zebra render run only when the CAD kernel is available, and they
// describe the skin that already exists.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildCarFromLibrary, carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import { openDesign } from "../lib/conkay/index.js";
import { getComponent } from "../lib/conkay/components/index.js";
import { designSurface, insetConvex, metres, LAMP_CHOICES, GLASS_REVEAL, STYLE_REFERENCE } from "../lib/conkay/cad/design-surface.js";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";
import { DRAG_BUILDUP_VERSION } from "../lib/conkay/aero/drag-buildup.js";
import { TORSION_TARGET } from "../lib/conkay/structural/car-tub.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HAVE_KERNEL = fs.existsSync(kernelPythonPath());

function specFromIr(ir) {
  const chassis = ir.nodes.find((n) => n.id === "CHASSIS");
  const shell = ir.nodes.find((n) => n.id === "BODY_SHELL");
  const veh = ir.nodes.find((n) => n.id === "VEH").props.vehicle;
  const g = shell.geometry;
  const body = g.shape === "cad-body" ? {
    shape: "cad-body",
    noseTipHeightM: metres(g.noseTipHeight),
    beltMinM: metres(g.beltMin),
    beltMaxM: metres(g.beltMax),
    archClearanceM: metres(g.archClearance),
    fenderCoverM: metres(g.fenderCover),
    noseExtensionM: metres(g.noseExtension),
    fastbackDeg: g.fastbackDeg,
  } : { shape: g.shape };
  const tyres = veh.packaging.tyres.map((t) => {
    const p = ir.nodes.find((n) => n.id === t.id).position;
    return { ...t, sectionWidthM: t.widthM, position: { x: metres(p.x), y: metres(p.y), z: metres(p.z) } };
  });
  return {
    openings: chassis.props.tubOpenings,
    nodes: chassis.props.frameModel.nodes,
    tyres,
    body,
    tyreRecord: getComponent(tyres[0].component),
  };
}

describe("design-surface geometry on the CAD package (no kernel)", () => {
  const surface = designSurface(specFromIr(buildCarFromLibrary(BRIEF).ir));
  const conflict = (id) => surface.conflicts.find((c) => c.id === id);

  it("keeps four doors and a B-pillar, and does not copy the reference", () => {
    assert.equal(surface.version, "1.0.0");
    assert.equal(surface.skinTrimmed, false);
    assert.equal(surface.tubRecut, false);
    assert.equal(surface.reference, STYLE_REFERENCE);
    assert.equal(surface.layers.panelCuts.length, 4);
    assert.ok(surface.layers.panelCuts.some((d) => d.id === "door-rear-L"));
    for (const c of surface.conflicts) {
      assert.equal(c.copied, false, c.id);
      assert.match(c.reference, /image/);
    }
    const pillar = surface.layers.bPillar.find((p) => p.side === "L");
    assert.ok(pillar.widthM > 0.05 && pillar.widthM < 0.2, `${pillar.widthM}`);
    assert.match(conflict("rear-doors-b-pillar").package, /4 door/);
    assert.match(conflict("glasshouse").package, /not joined/);
    assert.match(conflict("nose-length").package, /not lengthened/);
    assert.equal(surface.continuity.g2Claim, false);
  });

  it("places slim lamps inside the nose band and arches on the sourced tyre", () => {
    const lamps = surface.layers.lamps;
    assert.equal(lamps.state, "placed");
    assert.equal(lamps.slots.length, 2);
    for (const line of lamps.basis) assert.match(line, /design choice|fender-cover|midpoint/);
    const slot = lamps.slots.find((s) => s.side === "L");
    const zs = slot.outlineYZ.map((p) => p[1]);
    assert.ok(Math.min(...zs) >= slot.bounds.zLowM - 1e-9);
    assert.ok(Math.max(...zs) <= slot.bounds.zHighM + 1e-9);
    assert.ok(Math.max(...zs) - Math.min(...zs) - LAMP_CHOICES.slotHeightM.value < 1e-9);
    const tyre = surface.conflicts.find((c) => c.id === "wheel-size");
    assert.match(tyre.package, /0\.6528 m/);
    assert.match(tyre.package, /https:\/\//);
    const arch = surface.layers.wheelArches;
    assert.equal(arch.state, "drawn");
    assert.equal(arch.arches.length, 4);
    const front = arch.arches.find((a) => a.tyre === "TIRE_FL");
    const rear = arch.arches.find((a) => a.tyre === "TIRE_RL");
    const r = 0.6528 / 2, w = 0.2489;
    assert.ok(Math.abs(front.archRadiusM - (Math.hypot(r, w / 2) + 0.04)) < 1e-4);
    assert.ok(Math.abs(rear.archRadiusM - (r + 0.04)) < 1e-4);
    assert.ok(front.outline.every((p) => p[1] >= front.centre[1] - 1e-6));
  });

  it("insets side glass inside each door and keeps the windscreen on the tub nodes", () => {
    const glass = surface.layers.glazing.filter((g) => g.inDoor);
    assert.equal(glass.length, 4);
    for (const g of glass.filter((x) => /front/.test(x.inDoor))) {
      assert.equal(g.state, "inset", g.reason);
      assert.equal(g.revealM, GLASS_REVEAL.value);
    }
    for (const g of glass.filter((x) => /rear/.test(x.inDoor))) {
      assert.equal(g.state, "aperture");
      assert.match(g.reason, /wheel arch/);
      assert.equal(g.revealM, null);
      assert.ok(g.outline.length >= 4);
    }
    const screen = surface.layers.glazing.find((g) => g.id === "windscreen");
    const back = surface.layers.glazing.find((g) => g.id === "backlight");
    assert.equal(screen.state, "on the tub nodes");
    assert.equal(back.state, "on the tub nodes");
    assert.equal(screen.outlineXYZ.length, 4);
    assert.ok(screen.outlineXYZ.every((p) => p.length === 3 && p.every(Number.isFinite)));
  });

  it("a square insets by the same amount on every edge, and a reflex polygon does not", () => {
    const box = insetConvex([[0, 0], [1, 0], [1, 1], [0, 1]], 0.1);
    assert.deepEqual(box, [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]]);
    assert.equal(insetConvex([[0, 0], [1, 0], [0.2, 0.2], [0, 1]], 0.05), null);
  });
});

describe("headroom, egress and stiffness on the tub (ellipsoid shell, no kernel)", () => {
  it("reports the 95th-percentile man in every seat, the door egress, and the openings-tub stiffness", () => {
    const opened = openDesign(buildCarFromLibrary(BRIEF, { cadBody: false }).ir);
    const session = opened.session;
    const surface = session.result("cad.design-surface@VEH");
    assert.equal(opened.ok, true);
    assert.equal(surface.status, "WARN", surface.reason || surface.error);
    const re = surface.outputs.recheck.value;
    const fit = session.result("package.occupant-fit@VEH");
    const fromFit = fit.outputs.checks.value.filter((c) => /^headroom\.SEAT_[1-4]\.M95$/.test(c.id));
    assert.equal(fromFit.length, 4);
    assert.equal(re.headroom.rows.length, 4);
    for (const row of re.headroom.rows) {
      const src = fromFit.find((c) => c.id === row.id);
      assert.equal(row.value, src.value);
      assert.equal(row.pass, src.pass);
      assert.ok(Number.isFinite(row.value), row.id);
    }
    assert.equal(re.egress.state, "computed");
    assert.deepEqual(re.egress.failures, []);
    assert.equal(re.egress.tallMan.length, 4);
    assert.ok(re.egress.warnings.some((w) => /M95/.test(w) && /duck/.test(w)));
    const frame = session.result("structure.frame@CHASSIS");
    assert.equal(re.stiffness.state, "computed");
    assert.equal(re.stiffness.perDegree, frame.outputs["stiffness.torsional"].perDegree);
    assert.equal(re.stiffness.surfaceCut, false);
    assert.equal(re.stiffness.targetPerDegree, TORSION_TARGET.perDegree);
    assert.ok(Math.abs(re.stiffness.perDegree - 12222) / 12222 < 0.01, `${re.stiffness.perDegree}`);
    assert.equal(re.drag.state, "not computed");
    assert.equal(re.drag.labelledCd, 0.28);
    assert.match(re.drag.reason, /design target/);
    assert.equal(re.roofHeightM, null);
    assert.match(surface.outputs.conflicts.value.find((c) => c.id === "roof-height").package, /not computed on this run/);
  });
});

describe("drag, roof height and zebra on the CAD skin", { skip: !HAVE_KERNEL && "no Python with OCP" }, () => {
  let session = null;
  before(async () => {
    const r = await carAcceptanceAsync(BRIEF);
    assert.equal(r.ok, true, r.error);
    session = r.session;
  });

  it("re-reads drag and the solid height from the unaltered skin", () => {
    const surface = session.result("cad.design-surface@VEH");
    assert.equal(surface.status, "WARN", surface.reason);
    const re = surface.outputs.recheck.value;
    const aero = session.result("aero.drag-buildup@VEH");
    const cad = session.result("cad.body@BODY_SHELL");
    assert.equal(aero.solver.version, DRAG_BUILDUP_VERSION);
    assert.equal(DRAG_BUILDUP_VERSION, "1.0.0");
    assert.equal(re.drag.state, "computed", re.drag.reason);
    assert.equal(re.drag.solverVersion, "1.0.0");
    assert.equal(re.drag.low, aero.outputs.dragCoefficient.value.low);
    assert.equal(re.drag.centre, aero.outputs.dragCoefficient.value.centre);
    assert.equal(re.drag.high, aero.outputs.dragCoefficient.value.high);
    assert.ok(re.drag.low < re.drag.centre && re.drag.centre < re.drag.high);
    assert.equal(re.roofHeightM, cad.outputs.dimensions.value.heightM);
    assert.ok(re.roofHeightM > 1 && re.roofHeightM < 1.6, `${re.roofHeightM}`);
    assert.equal(surface.outputs.continuity.value.g2Claim, false);
    const fair = re.fairness;
    assert.ok(fair && fair.regions && fair.regions.body);
    assert.ok(fair.regions.body.alongCar.inflections + fair.regions.body.aroundSection.inflections > 0);
    const fit = session.result("package.occupant-fit@VEH");
    assert.equal(re.headroom.state, "computed", re.headroom.reason);
    assert.equal(re.headroom.rows.length, 4);
    for (const row of re.headroom.rows) {
      assert.equal(row.value, fit.outputs.checks.value.find((c) => c.id === row.id).value);
    }
    assert.equal(cad.inputs.parameters.value.beltMax, 0.85);
    assert.equal(cad.inputs.parameters.value.noseExtension, 0.3);
    assert.equal(surface.outputs.layers.value.lamps.state, "placed");
  });

  it("renders zebra stripes of the existing STEP", () => {
    const cad = session.result("cad.body@BODY_SHELL");
    const step = cad.outputs.files.value.step.path;
    assert.ok(fs.existsSync(step), step);
    const out = path.join(process.env.HOME, ".cache", "conkay-cad-body", "zebra-design-surface");
    fs.mkdirSync(out, { recursive: true, mode: 0o700 });
    const script = path.join(HERE, "../lib/conkay/cad/render_zebra.py");
    const run = spawnSync(kernelPythonPath(), [script, step, out, "pkg", "--width", "480", "--views", "side", "--mesh", "0.004"], { encoding: "utf8", timeout: 180000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const png = path.join(out, "pkg-side.png");
    const bytes = fs.readFileSync(png);
    assert.ok(bytes.length > 1000, bytes.length);
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  });
});
