// Parametric vehicle assembly: schema, J941 centroid, fit checks, and the
// packaging sheet projected from the same placements.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { assemblyFromIr, fitStatus } from "../lib/conkay/assembly/build.js";
import { validateAssembly } from "../lib/conkay/assembly/schema.js";
import { j941Centroid } from "../lib/conkay/assembly/j941.js";
import { buildPackagingSheet } from "../lib/conkay/drawings/ga-drawing.js";
import { toSvg } from "../lib/conkay/drawings/sheet.js";
import { frameTorsionSummary, carChatSummary } from "../lib/conkay/assembly/summary.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";

function car() {
  const b = buildCarFromLibrary(BRIEF);
  assert.equal(b.error, undefined);
  return assemblyFromIr(b.ir);
}

describe("J941 centroid", () => {
  it("matches the transcribed equations on a hand-calculated point", () => {
    // Xc = L1 - 12.5*t + 664 + 0.587*L6 - 0.176*H30
    //    = 1800 - 12.5 + 664 + 322.85 - 38.72 = 2735.63
    // Zc = H8 + H30 + 638 = 978
    const c = j941Centroid({ L1mm: 1800, L6mm: 550, H30mm: 220, H8mm: 120, W20mm: -370, clutch: true });
    assert.equal(Math.round(c.mid.xMm * 100) / 100, 2735.63);
    assert.equal(c.mid.zMm, 978);
    assert.equal(c.left.yMm, -402.5);
    assert.equal(c.right.yMm, -337.5);
    assert.equal(c.axesMm.x, 206.4);
    assert.equal(c.axesMm.y, 60.3);
    assert.equal(c.axesMm.z, 93.4);
    assert.equal(c.betaDeg, 12);
    assert.equal(c.provenance.transcription.length > 20, true);
  });
});

describe("assembly of the library car", () => {
  const doc = car();

  it("validates, and every relationship points at a real part", () => {
    const v = validateAssembly(doc);
    assert.deepEqual(v.errors, []);
    assert.equal(v.ok, true);
    const broken = { ...doc, schema: "nope", components: [] };
    assert.equal(validateAssembly(broken).ok, false);
  });

  it("places the wheels on the axles and instances one wheel mesh", () => {
    const fl = doc.components.find((c) => c.id === "TIRE_FL");
    const rl = doc.components.find((c) => c.id === "TIRE_RL");
    const front = doc.components.find((c) => c.id === "AXLE_FRONT");
    assert.equal(fl.placement.x, front.placement.x);
    assert.ok(rl.placement.x > fl.placement.x);
    assert.equal(fl.instanceOf, "WHEEL");
    assert.equal(doc.wheel.spec.rimDiameterM, Math.round(18 * 0.0254 * 1e6) / 1e6);
    assert.equal(doc.wheel.spec.spokes, 10);
    for (const part of [doc.wheel.tire, doc.wheel.rim, doc.wheel.disc, doc.wheel.caliper]) {
      const n = part.positions.length / 3;
      for (const i of part.indices) assert.ok(i >= 0 && i < n);
    }
  });

  it("caps the body tessellation and clears the driver head on the derived roof", () => {
    assert.ok(doc.surface.mesh.capped.stations <= 40);
    assert.ok(doc.surface.mesh.capped.section <= 48);
    const head = doc.checks.find((c) => c.id === "head-M95");
    assert.equal(head.status, "pass");
    const paintN = doc.surface.mesh.positions.length / 3;
    for (const i of doc.surface.mesh.paint.concat(doc.surface.mesh.glass)) assert.ok(i >= 0 && i < paintN);
    assert.ok(doc.surface.mesh.glass.length > 100, "greenhouse faces");
    const nose = doc.surface.mesh.stations.find((s) => s.role === "nose");
    const mid = doc.surface.mesh.stations.find((s) => s.role === "b-pillar");
    assert.ok(nose.halfWidth < mid.halfWidth * 0.55, `nose ${nose.halfWidth} vs cabin ${mid.halfWidth}`);
  });

  it("fails a roof that is below the 95th male head and names the minimum height", () => {
    const b = buildCarFromLibrary(BRIEF);
    const low = assemblyFromIr(b.ir, { bodyBBox: { min: [0.2, -0.9, 0.1], max: [4.6, 0.9, 0.7] } });
    const head = low.checks.find((c) => c.id === "head-M95");
    assert.equal(head.status, "fail");
    assert.ok(head.minimumOverallHeightM > 0.7, `${head.minimumOverallHeightM}`);
    assert.match(head.detail, /Minimum overall height|minimum|head top/i);
    assert.equal(fitStatus(low.checks), "fail");
  });

  it("projects the wheelbase onto sheet 3 as the same millimetres as the axle placements", () => {
    const front = doc.components.find((c) => c.id === "AXLE_FRONT");
    const rear = doc.components.find((c) => c.id === "AXLE_REAR");
    const sheet = buildPackagingSheet(doc, {
      scale: 25, number: "CK-GA-VEH", revision: "R-TEST", modelHash: "a".repeat(64),
      status: "SCREENING", generated: "test", model: "VEH", title: "Packaging and occupant layout",
    });
    assert.equal(sheet.projected.wheelbaseMm, Math.round((rear.placement.x - front.placement.x) * 1000));
    const svg = toSvg(sheet, { revision: "R-TEST" });
    assert.match(svg, new RegExp(String(sheet.projected.wheelbaseMm)));
    assert.match(svg, /PACKAGING DIMENSIONS AND FIT/);
    assert.match(svg, /Sheet 3 of 3/);
    assert.ok(sheet.items.some((it) => it.t === "line" && it.pts.length > 4), "side cutaway has a profile");
  });
});

describe("chat summary", () => {
  it("states the rigid-joint upper bound and the bond-line range", () => {
    const text = frameTorsionSummary({
      status: "WARN",
      outputs: {
        "stiffness.torsional": { perDegree: 12222 },
        "stiffness.torsional.jointRange": { value: { lowComputedPerDegree: 11000, lowEstimatedPerDegree: 8000, rigidPerDegree: 12222 } },
      },
    });
    assert.match(text, /rigid-joint 12222 N·m\/deg \(upper bound/);
    assert.match(text, /bond-line 11000/);
    assert.match(text, /EN 1993-1-8/);
    assert.match(text, /not a measured joint/);
  });

  it("includes packaging fit when the session has an assembly", () => {
    const session = {
      result(id) {
        if (id.startsWith("structure.frame")) return { status: "PASS", outputs: { "stiffness.torsional": { perDegree: 1000 } } };
        if (id.startsWith("assembly.vehicle")) return { outputs: { fit: { value: { text: "Packaging fit: fail. ingress fail." } } } };
        return null;
      },
    };
    const line = carChatSummary(session);
    assert.match(line, /Frame\/torsion/);
    assert.match(line, /Packaging fit: fail/);
  });
});
