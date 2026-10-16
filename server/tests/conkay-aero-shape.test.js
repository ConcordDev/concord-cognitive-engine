// tests/conkay-aero-shape.test.js
//
// Roadmap 5 item 5. The tail face is 0.45 of the largest section so the
// v1 base term falls. The Ahmed slant term was taken to stay 0; measured from
// the top of the roof's final descent (2026-10-15) the backlight is in the slant
// band, so the cut is not counted as a reduction. The styling image
// is not copied. Drag v2 is not used. The kernel case is the new solid.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildCarFromLibrary, carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import { CAD_BODY_DEFAULTS, CAD_BODY_BASIS } from "../lib/conkay/cad/body-params.js";
import { dragBuildup, ISA_SEA_LEVEL, BUILDUP_COEFFICIENTS, DRAG_BUILDUP_VERSION } from "../lib/conkay/aero/drag-buildup.js";
import { hoernerBase, shapeVerdict, KAMM50_BASELINE, AHMED_ONSET_DEG } from "../lib/conkay/aero/shape.js";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const HAVE_KERNEL = fs.existsSync(kernelPythonPath());
const FLOW = { speedMs: 80.4672, rho: ISA_SEA_LEVEL.rho, mu: ISA_SEA_LEVEL.mu };

function fitRows(session) {
  const fit = session.result("package.occupant-fit@VEH");
  return (fit.outputs?.checks?.value || []).filter((c) => /^headroom\.SEAT_[1-4]\.M95$/.test(c.id)).map((c) => ({ id: c.id, value: c.value, pass: c.pass }));
}

function baselineGeom(baseArea) {
  return {
    lengthM: KAMM50_BASELINE.lengthM,
    wettedAreaM2: KAMM50_BASELINE.wettedAreaM2,
    frontalAreaM2: KAMM50_BASELINE.frontalAreaM2,
    baseAreaM2: baseArea,
    rearSlantDeg: KAMM50_BASELINE.rearSlantDeg,
  };
}

describe("the base-drag lever, without a new solid", () => {
  it("keeps the face ratio at 0.45 and does not move the roof, the nose or the fastback limit", () => {
    assert.equal(CAD_BODY_DEFAULTS.kammAreaRatio, 0.45);
    assert.equal(CAD_BODY_DEFAULTS.fastbackDeg, 18);
    assert.equal(CAD_BODY_DEFAULTS.beltMaxM, 0.85);
    assert.equal(CAD_BODY_DEFAULTS.noseExtensionM, 0.3);
    assert.equal(AHMED_ONSET_DEG, 12.5);
    assert.match(CAD_BODY_BASIS.kammAreaRatio, /0\.45/);
    assert.match(CAD_BODY_BASIS.kammAreaRatio, /12\.5/);
    assert.match(CAD_BODY_BASIS.kammAreaRatio, /not taken from the styling image/i);
    const g = buildCarFromLibrary(BRIEF).ir.nodes.find((n) => n.id === "BODY_SHELL").geometry;
    assert.equal(g.kammAreaRatio, 0.45);
    assert.equal(g.fastbackDeg, 18);
    assert.equal(g.noseExtension, "300 mm");
  });

  it("reproduces the kamm-0.5 centre, and a smaller base lowers the Hoerner term while the slant term stays 0", () => {
    const b = dragBuildup(baselineGeom(KAMM50_BASELINE.baseAreaM2), FLOW);
    assert.equal(DRAG_BUILDUP_VERSION, "1.0.0");
    assert.ok(Math.abs(b.low.cd - KAMM50_BASELINE.cd.low) < 1e-12);
    assert.ok(Math.abs(b.centre - KAMM50_BASELINE.cd.centre) < 1e-12);
    assert.ok(Math.abs(b.high.cd - KAMM50_BASELINE.cd.high) < 1e-12);
    assert.ok(Math.abs(hoernerBase(b.low.fore, KAMM50_BASELINE.frontalAreaM2, KAMM50_BASELINE.baseAreaM2, BUILDUP_COEFFICIENTS.baseK.low) - b.low.base) < 1e-12);
    assert.ok(Math.abs(hoernerBase(b.high.fore, KAMM50_BASELINE.frontalAreaM2, KAMM50_BASELINE.baseAreaM2, BUILDUP_COEFFICIENTS.baseK.high) - b.high.base) < 1e-12);
    const cut = dragBuildup(baselineGeom(KAMM50_BASELINE.baseAreaM2 * 0.9), FLOW);
    assert.ok(cut.low.base < b.low.base);
    assert.ok(cut.high.base < b.high.base);
    assert.ok(cut.low.cd < b.low.cd && cut.high.cd < b.high.cd);
    assert.equal(cut.high.slant, 0);
    const steep = dragBuildup({ ...baselineGeom(KAMM50_BASELINE.baseAreaM2 * 0.9), rearSlantDeg: 18 }, FLOW);
    assert.equal(steep.high.slant, 0.14);
    assert.ok(steep.high.cd > b.high.cd, "a slant inside 12.5..25 deg raises the high bound");
  });

  it("counts a reduction only when the base term fell and the slant term stayed 0", () => {
    const ok = shapeVerdict({
      rearSlantDeg: 11,
      baseAreaM2: KAMM50_BASELINE.baseAreaM2 * 0.9,
      cd: { low: KAMM50_BASELINE.cd.low - 0.01, centre: KAMM50_BASELINE.cd.centre - 0.01, high: KAMM50_BASELINE.cd.high - 0.01 },
      terms: { low: { base: KAMM50_BASELINE.baseTerm.low * 0.9, slant: 0 }, high: { base: KAMM50_BASELINE.baseTerm.high * 0.9, slant: 0 } },
      sectionLiftSign: "indeterminate",
    });
    assert.equal(ok.supported, true);
    assert.equal(ok.liftDetermined, false);
    const band = shapeVerdict({
      rearSlantDeg: 18,
      baseAreaM2: KAMM50_BASELINE.baseAreaM2 * 0.9,
      cd: { low: 0.01, centre: 0.01, high: 0.01 },
      terms: { low: { base: 0.01, slant: 0 }, high: { base: 0.01, slant: 0.14 } },
      sectionLiftSign: "downforce",
    });
    assert.equal(band.supported, false);
    assert.equal(band.slantOk, false);
    assert.equal(band.slantTermClear, false);
  });
});

describe("the smaller tail face on the CAD solid", { skip: !HAVE_KERNEL && "no Python with OCP" }, () => {
  let session = null;
  before(async () => {
    const r = await carAcceptanceAsync(BRIEF);
    assert.equal(r.ok, true, r.error);
    session = r.session;
  });

  it("lowers the base term, but the backlight is in the slant band, so the cut is not counted; no lift coefficient is invented", () => {
    const shape = session.result("aero.shape@VEH");
    const aero = session.result("aero.drag-buildup@VEH");
    const cad = session.result("cad.body@BODY_SHELL");
    assert.equal(shape.status, "WARN", shape.reason || shape.error);
    assert.equal(shape.margins.length, 0);
    assert.equal(aero.solver.version, "1.1.0");
    assert.equal(shape.outputs.v2Stacked.value, true);
    assert.equal(shape.inputs.dragModel.value, "1.0.0");
    const m = shape.outputs.measured.value;
    // the v1 re-evaluation on the same areas is the drag solver's own previousEnvelope
    assert.ok(Math.abs(m.cd.low - aero.outputs.previousEnvelope.value.low) < 1e-12);
    assert.ok(Math.abs(m.cd.high - aero.outputs.previousEnvelope.value.high) < 1e-12);
    assert.ok(Math.abs(m.cd.centre - aero.outputs.previousEnvelope.value.centre) < 1e-12);
    assert.deepEqual(shape.outputs.reportedCd.value, aero.outputs.dragCoefficient.value);
    assert.equal(cad.inputs.parameters.value.kammAreaRatio, 0.45);
    assert.equal(cad.inputs.parameters.value.fastbackDeg, 18);
    assert.equal(cad.inputs.parameters.value.beltMax, 0.85);
    assert.equal(cad.inputs.parameters.value.noseExtension, 0.3);
    const v = shape.outputs.verdict.value;
    const report = {
      slant: aero.inputs.rearSlantDeg.value,
      base: aero.inputs.baseAreaM2.value,
      frontal: aero.inputs.frontalAreaM2.value,
      wetted: aero.inputs.wettedAreaM2.value,
      cd: m.cd,
      reportedCd: aero.outputs.dragCoefficient.value,
      terms: m.terms,
      lift: aero.outputs.sectionLift.value.sign,
      cl: [aero.outputs.sectionLift.value.kuttaUpperCorner.cl2d, aero.outputs.sectionLift.value.kuttaLowerCorner.cl2d],
      height: cad.outputs.dimensions.value.heightM,
      headroom: fitRows(session),
    };
    console.log(JSON.stringify(report));
    // The rear slant is measured from the top of the roof's final descent (drag-buildup.js rearSlantDeg). This
    // roof has two humps; the earlier highest-point chord ran from the front one through the rear one and read
    // 12.2 deg. The backlight is in Ahmed's 12.5..25 deg band: the slant term is not zero and the study's verdict
    // is not supported, though the smaller tail face still lowers the base term.
    assert.ok(aero.inputs.rearSlantDeg.value > 12.5 && aero.inputs.rearSlantDeg.value <= 25, `${aero.inputs.rearSlantDeg.value}`);
    assert.equal(v.slantOk, false);
    assert.equal(v.supported, false, JSON.stringify({ v, report }));
    assert.ok(shape.warnings.some((w) => /slant .* past 12\.5 deg/.test(w)), JSON.stringify(shape.warnings));
    assert.ok(aero.inputs.baseAreaM2.value < KAMM50_BASELINE.baseAreaM2);
    assert.ok(m.terms.high.base < KAMM50_BASELINE.baseTerm.high && m.terms.low.base < KAMM50_BASELINE.baseTerm.low);
    assert.ok(m.terms.high.slant > 0);
    assert.ok(aero.outputs.terms.value.high.slant > 0);
    assert.ok(["lift", "downforce", "indeterminate"].includes(aero.outputs.sectionLift.value.sign));
    assert.equal(shape.outputs.sectionLift.value.sign, aero.outputs.sectionLift.value.sign);
    assert.equal(v.liftDetermined, aero.outputs.sectionLift.value.sign !== "indeterminate");
    assert.ok(cad.outputs.dimensions.value.heightM > 1.2);
    const fit = session.result("package.occupant-fit@VEH");
    const rows = fit.outputs.checks.value.filter((c) => /^headroom\.SEAT_[1-4]\.M95$/.test(c.id));
    assert.equal(rows.length, 4);
    for (const row of rows) assert.equal(row.pass, true, `${row.id} ${row.value}`);
  });
});
