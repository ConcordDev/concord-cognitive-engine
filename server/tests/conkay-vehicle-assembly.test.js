// Parametric vehicle assembly: schema, J941 centroid, fit checks, and the
// packaging sheet projected from the same placements.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { assemblyFromIr, fitStatus } from "../lib/conkay/assembly/build.js";
import { partInsideEnvelope } from "../lib/conkay/assembly/surface.js";
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
    const rimNote = fl.parameters.find((p) => p.id === "rim").provenance.note;
    assert.match(rimNote, /245\/40ZR18/);
    assert.match(rimNote, /18 in/);
    assert.equal(doc.wheel.spec.spokes, 10);
    for (const part of [doc.wheel.tire, doc.wheel.rim, doc.wheel.disc, doc.wheel.caliper]) {
      const n = part.positions.length / 3;
      for (const i of part.indices) assert.ok(i >= 0 && i < n);
    }
  });

  it("lofts a capped spline skin, its own glass, and arches the wheels sit in", () => {
    const mesh = doc.surface.mesh;
    assert.ok(mesh.capped.stations >= 16, `stations ${mesh.capped.stations}`);
    assert.ok(mesh.capped.triangles >= 60000 && mesh.capped.triangles <= 120000, `triangles ${mesh.capped.triangles}`);
    assert.ok(mesh.stations.length >= 16);
    const head = doc.checks.find((c) => c.id === "head-M95");
    assert.equal(head.status, "pass");
    const paintN = mesh.positions.length / 3;
    for (const i of mesh.paint) assert.ok(i >= 0 && i < paintN);
    const glass = mesh.glass;
    assert.ok(glass && !Array.isArray(glass) && glass.positions.length > 100, "glass is its own patch");
    const glassN = glass.positions.length / 3;
    for (const i of glass.indices) assert.ok(i >= 0 && i < glassN);
    // Offset is a few millimetres off the skin, not a coincident triangle.
    let nearest = Infinity;
    const gp = glass.positions;
    const sample = [gp[0], gp[1], gp[2]];
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(mesh.positions[i] - sample[0], mesh.positions[i + 1] - sample[1], mesh.positions[i + 2] - sample[2]);
      if (d < nearest) nearest = d;
    }
    assert.ok(nearest > 0.001 && nearest < 0.02, `glass offset ${nearest}`);
    assert.ok(Math.abs(mesh.windshield.rakeFromVerticalDeg - 60) < 1, mesh.windshield);
    const nose = mesh.stations.find((s) => s.role === "nose");
    const mid = mesh.stations.find((s) => s.role === "b-pillar");
    const plan = doc.surface.spec.planKeys;
    const nosePlan = plan.find((c) => c.id === "plan-nose");
    const cabin = Math.max(...plan.map((c) => c.v));
    const corner = plan.filter((c) => c.x > nosePlan.x && c.x <= nosePlan.x + 0.22).sort((a, b) => a.x - b.x)[0];
    assert.ok(nose.halfWidth > mid.halfWidth * 0.7, `bumper ${nose.halfWidth} vs cabin ${mid.halfWidth}`);
    assert.ok(nosePlan.v > cabin * 0.75, `plan nose ${nosePlan.v} vs ${cabin}`);
    assert.ok(corner && corner.v > cabin * 0.9, `plan corner ${corner && corner.v} within 0.22 m`);
    for (const arch of mesh.arches) {
      assert.ok(arch.gap >= 0.025 && arch.gap <= 0.04, arch.gap);
      let covered = 0;
      const used = new Set(mesh.paint);
      for (let i = 0; i < mesh.positions.length; i += 3) {
        if (!used.has(i / 3)) continue;
        const y = Math.abs(mesh.positions[i + 1]);
        const d = Math.hypot(mesh.positions[i] - arch.x, mesh.positions[i + 2] - arch.z);
        if (y > 0.9 && d < arch.radius - 0.02) covered++;
      }
      assert.equal(covered, 0, `arch at ${arch.x} still has outer skin inside the opening`);
    }
    // Left and right skins match.
    const pos = mesh.positions;
    const key = (x, z) => `${x.toFixed(3)},${z.toFixed(3)}`;
    const ys = new Map();
    for (let i = 0; i < pos.length; i += 3) {
      const k = key(pos[i], pos[i + 2]);
      if (!ys.has(k)) ys.set(k, []);
      ys.get(k).push(pos[i + 1]);
    }
    let bad = 0;
    for (const row of ys.values()) {
      const hi = Math.max(...row.map(Math.abs));
      const hasPos = row.some((y) => y > hi - 0.008);
      const hasNeg = row.some((y) => y < -hi + 0.008);
      if (hi > 0.2 && (!hasPos || !hasNeg)) bad++;
    }
    assert.ok(bad < 30, `asymmetric stations ${bad}`);
    const uses = new Map();
    const touch = (a, b) => {
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) || 0) + 1);
    };
    const paint = mesh.paint;
    for (let i = 0; i < paint.length; i += 3) {
      touch(paint[i], paint[i + 1]);
      touch(paint[i + 1], paint[i + 2]);
      touch(paint[i + 2], paint[i]);
    }
    let multi = 0;
    for (const n of uses.values()) if (n > 2) multi++;
    assert.equal(multi, 0, "body edges used by more than two triangles");
    let seam = 0;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (Math.abs(mesh.positions[i + 1]) < 1e-4 && Math.abs(mesh.normals[i + 1]) > 0.08) seam++;
    }
    assert.equal(seam, 0, "centreline vertices keep a normal off the symmetry plane");
  });

  it("keeps every non-exterior box inside the body or names it as a packaging failure", () => {
    const mesh = doc.surface.mesh;
    const containment = doc.checks.find((c) => c.id === "containment");
    assert.ok(containment);
    const outside = new Set(containment.outside || []);
    const exterior = new Set(["body", "glass", "wheel", "lamp", "intake", "opening", "axle", "mirror", "handle", "spare", "trim"]);
    for (const c of doc.components) {
      if (exterior.has(c.role) || c.id === "SPARE") continue;
      if (!c.half || c.half.every((h) => h === 0)) continue;
      const inside = partInsideEnvelope(doc.surface.spec, c, 0.05);
      if (inside) assert.equal(outside.has(c.id), false, `${c.id} is inside but listed`);
      else assert.ok(outside.has(c.id), `${c.id} is outside the envelope and was not flagged`);
    }
    assert.equal(containment.status, "pass", containment.detail);
    assert.equal(outside.size, 0);
    const grille = doc.components.find((c) => c.id === "GRILLE");
    assert.ok(grille.placement.x > mesh.bounds.min[0], "grille is aft of the nose");
    assert.ok(grille.placement.x < mesh.bounds.min[0] + 0.4);
    const spare = doc.components.find((c) => c.id === "SPARE");
    assert.ok(spare.placement.x > mesh.bounds.min[0] && spare.placement.x < mesh.bounds.max[0]);
    assert.ok(spare.half.every((h) => h === 0), "an unspecified spare is not given a body");
    const ingress = doc.checks.find((c) => c.id === "ingress");
    assert.equal(ingress.status, "pass");
    assert.match(ingress.detail, /Tub outline/);
    const fl = doc.components.find((c) => c.id === "TIRE_FL");
    const rl = doc.components.find((c) => c.id === "TIRE_RL");
    assert.equal(fl.placement.z, doc.wheel.spec.overallDiameterM / 2);
    assert.equal(fl.placement.x, doc.components.find((c) => c.id === "AXLE_FRONT").placement.x);
    assert.equal(rl.placement.x, doc.components.find((c) => c.id === "AXLE_REAR").placement.x);
    assert.ok(doc.wheel.caliper.positions.length / 3 > 8, "caliper is not a single box");
    assert.ok(doc.components.some((c) => c.id === "MIRROR_L" && c.mesh?.positions?.length));
    assert.ok(doc.components.some((c) => c.id === "HANDLE_FL" && c.mesh?.positions?.length));
    assert.ok(doc.components.some((c) => c.id === "LAMP_L" && c.mesh?.positions?.length));
    assert.ok(doc.components.some((c) => c.id === "TAIL_L" && c.mesh?.positions?.length));
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

  it("styles an EV skateboard first and keeps the hood low", () => {
    const layout = doc.checks.find((c) => c.id === "powertrain-layout");
    assert.equal(layout.status, "pass");
    assert.equal(doc.surface.spec.layout, "ev_skateboard");
    assert.match(layout.detail, /ev skateboard|floor battery/i);
    assert.match(layout.detail, /range was not specified|Range was not specified/);
    assert.match(layout.detail, /400 km/);
    assert.match(layout.detail, /gasoline/);
    for (const id of ["BATTERY", "MOTOR_FRONT", "MOTOR_REAR", "INVERTER", "COOLING"]) {
      assert.ok(doc.components.some((c) => c.id === id), id);
    }
    for (const id of ["ENGINE", "RADIATOR", "TRANSMISSION", "FUEL_CELL"]) {
      assert.equal(doc.components.some((c) => c.id === id), false, id);
    }
    const quality = doc.checks.find((c) => c.id === "design-quality");
    assert.ok(quality);
    assert.ok(quality.status === "info" || quality.status === "warn");
    assert.equal(quality.status, "info");
    assert.ok(quality.maxTurnDeg < 25, `turn ${quality.maxTurnDeg}`);
    assert.ok(quality.ratios.hoodAtAxleM < 0.78, `hood ${quality.ratios.hoodAtAxleM}`);
    assert.ok(quality.ratios.peakM > quality.ratios.hoodAtAxleM + 0.4, "the roof peaks above the hood");
    const controls = Number(quality.detail.match(/^(\d+) styling controls/)?.[1]);
    assert.ok(controls >= 20 && controls <= 40, quality.detail.slice(0, 40));
    assert.ok(doc.surface.spec.cagePoints >= 300 && doc.surface.spec.cagePoints <= 800, `cage ${doc.surface.spec.cagePoints}`);
    assert.equal(doc.surface.spec.cageLevels, 3);
    assert.ok(quality.panelHighlightMaxDeg <= 8, `panel highlight ${quality.panelHighlightMaxDeg}° ${quality.detail}`);
    assert.ok(quality.highlightMaxDeg <= 16, `fillet highlight ${quality.highlightMaxDeg}° ${quality.detail}`);
    assert.deepEqual(doc.surface.spec.pushes, []);
    assert.ok(doc.components.some((c) => c.id === "SEAT_1" && c.role === "seat"));
    assert.ok(doc.components.some((c) => c.id === "OCC_SEAT_1_M95" && c.role === "occupant"));
  });

  it("raises the hood when the caller asks for the library front engine", () => {
    const b = buildCarFromLibrary(BRIEF);
    const fe = assemblyFromIr(b.ir, { layout: "front_engine", brief: BRIEF });
    assert.equal(validateAssembly(fe).ok, true, (fe.validationErrors || []).join("; "));
    const contain = fe.checks.find((c) => c.id === "containment");
    assert.equal(contain.status, "pass", contain.detail);
    const layout = fe.checks.find((c) => c.id === "powertrain-layout");
    assert.match(layout.detail, /hood raised/);
    assert.match(layout.detail, /engine/);
    assert.match(layout.detail, /radiator/);
    const quality = fe.checks.find((c) => c.id === "design-quality");
    assert.equal(quality.status, "warn");
    assert.ok(quality.ratios.hoodAtAxleM > doc.checks.find((c) => c.id === "design-quality").ratios.hoodAtAxleM);
    assert.ok(fe.components.some((c) => c.id === "ENGINE"));
    assert.ok(fe.components.some((c) => c.id === "RADIATOR"));
    assert.equal(fe.components.some((c) => c.id === "BATTERY"), false);
    const low = fe.checks.find((c) => c.id === "head-M95");
    assert.equal(low.status, "pass");
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
