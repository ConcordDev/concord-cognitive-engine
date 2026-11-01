// Parametric vehicle assembly: schema, J941 centroid, fit checks, and the
// packaging sheet projected from the same placements.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { assemblyFromIr, fitStatus, partAnalyses, withPartAnalyses } from "../lib/conkay/assembly/build.js";
import { partInsideEnvelope, loftBody } from "../lib/conkay/assembly/surface.js";
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
    assert.ok(nose.halfWidth < mid.halfWidth * 0.55, `nose ${nose.halfWidth} vs cabin ${mid.halfWidth}`);
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
    const exterior = new Set(["body", "glass", "wheel", "lamp", "intake", "opening", "axle", "mirror", "handle", "spare"]);
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

  it("draws the design's own powertrain: the gasoline car's front engine, never an invented one", () => {
    const layout = doc.checks.find((c) => c.id === "powertrain-layout");
    assert.equal(layout.status, "pass");
    assert.equal(doc.surface.spec.layout, "front_engine");
    assert.match(layout.detail, /design's own package/);
    for (const id of ["ENGINE", "RADIATOR", "TRANSMISSION", "FUEL_CELL"]) assert.ok(doc.components.some((c) => c.id === id), id);
    for (const id of ["BATTERY", "MOTOR_FRONT", "MOTOR_REAR", "INVERTER", "COOLING"]) assert.equal(doc.components.some((c) => c.id === id), false, id);
    assert.ok(doc.components.some((c) => c.id === "PEDAL_CLUTCH") && doc.components.some((c) => c.id === "GEAR_SELECTOR"), "the manual gearbox's controls");
    const contain = doc.checks.find((c) => c.id === "containment");
    assert.equal(contain.status, "pass", contain.detail);
    assert.ok(doc.components.some((c) => c.id === "SEAT_1" && c.role === "seat"));
    assert.ok(doc.components.some((c) => c.id === "OCC_SEAT_1_M95" && c.role === "occupant"));
  });

  it("draws the electric design as a skateboard with its drive unit and traction battery; its radiator still raises the hood", () => {
    const ev = assemblyFromIr(buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" } }).ir);
    assert.equal(validateAssembly(ev).ok, true, (ev.validationErrors || []).join("; "));
    assert.equal(ev.surface.spec.layout, "ev_skateboard");
    const layout = ev.checks.find((c) => c.id === "powertrain-layout");
    assert.match(layout.detail, /The design is electric/);
    for (const id of ["ENGINE", "DIFFERENTIAL", "BATTERY_CELLS", "BATTERY_CELLS:TUNNEL_REAR", "RADIATOR"]) assert.ok(ev.components.some((c) => c.id === id), id);
    for (const id of ["TRANSMISSION", "FUEL_CELL", "MOTOR_FRONT", "MOTOR_REAR", "INVERTER", "PEDAL_CLUTCH", "GEAR_SELECTOR"]) assert.equal(ev.components.some((c) => c.id === id), false, id);
    // the second battery block sits at its node plus its package offset, not on top of the first
    const b0 = ev.components.find((c) => c.id === "BATTERY_CELLS"), b1 = ev.components.find((c) => c.id === "BATTERY_CELLS:TUNNEL_REAR");
    assert.ok(b1.placement.x > b0.placement.x + b0.half[0], `${b1.placement.x} vs ${b0.placement.x}`);
    const cabin = ev.checks.find((c) => c.id === "powertrain-cabin");
    assert.equal(cabin.status, "pass", cabin.detail);
    assert.match(cabin.detail, /drive unit to the nearest rear occupant box/);
    // The electric design still carries the library gasoline radiator as its cooling core, at the nose: it raises the
    // hood, and the styling bands report the turn that makes (a design finding, not hidden by an invented low hood;
    // sizing the electric car's cooling is separate work)
    const quality = ev.checks.find((c) => c.id === "design-quality");
    assert.ok(ev.surface.spec.pushes.some((p) => /hood raised \d+ mm for the library radiator/.test(p)), JSON.stringify(ev.surface.spec.pushes));
    assert.equal(quality.status, "warn");
    assert.match(quality.detail, /Outside the styling bands: silhouette turn/);
    assert.ok(quality.ratios.peakM > quality.ratios.hoodAtAxleM + 0.3, "the roof peaks above the hood");
    assert.ok(ev.surface.spec.cagePoints >= 300 && ev.surface.spec.cagePoints <= 800, `cage ${ev.surface.spec.cagePoints}`);
    assert.equal(ev.surface.spec.cageLevels, 3);
    assert.ok(quality.panelHighlightMaxDeg <= 8, `panel highlight ${quality.panelHighlightMaxDeg}°`);
    assert.ok(quality.highlightMaxDeg <= 16, `fillet highlight ${quality.highlightMaxDeg}°`);
  });

  it("a layout the design does not have is a styling study, labelled, with its sized parts", () => {
    const study = assemblyFromIr(buildCarFromLibrary(BRIEF).ir, { layout: "ev_skateboard", brief: BRIEF });
    assert.equal(validateAssembly(study).ok, true, (study.validationErrors || []).join("; "));
    const layout = study.checks.find((c) => c.id === "powertrain-layout");
    assert.match(layout.detail, /Styling study: this layout is not the design's/);
    for (const id of ["BATTERY", "MOTOR_FRONT", "MOTOR_REAR"]) assert.ok(study.components.some((c) => c.id === id), id);
    assert.equal(study.components.some((c) => c.id === "ENGINE"), false);
    // the front engine raises the hood over the skateboard study
    const q = (d) => d.checks.find((c) => c.id === "design-quality").ratios.hoodAtAxleM;
    assert.ok(q(doc) > q(study), `${q(doc)} vs ${q(study)}`);
  });

  it("containment: a part outside Studio's styled surface but verified inside the CAD body is a drawn preview gap", () => {
    const b = buildCarFromLibrary(BRIEF);
    const tight = { min: [0.2, -0.9, 0.1], max: [4.6, 0.9, 1.3] };
    const plain = assemblyFromIr(b.ir, { bodyBBox: tight });
    const out = plain.checks.find((c) => c.id === "containment");
    if (out.status !== "fail") return; // nothing outside at this box: nothing to verify
    const ids = out.outside;
    const verified = assemblyFromIr(b.ir, { bodyBBox: tight, verifiedInside: new Set(ids) });
    const c = verified.checks.find((x) => x.id === "containment");
    assert.equal(c.status, "warn");
    assert.deepEqual(c.outside, []);
    assert.deepEqual(c.previewOnly, ids);
    // only the verified ones move: one left unverified still fails
    const partial = assemblyFromIr(b.ir, { bodyBBox: tight, verifiedInside: new Set(ids.slice(1)) });
    const p = partial.checks.find((x) => x.id === "containment");
    assert.equal(p.status, "fail");
    assert.deepEqual(p.outside, [ids[0]]);
  });
});

describe("check parts attribution (HANDOFF-3 A3)", () => {
  const doc = car();
  const ids = new Set(doc.components.map((c) => c.id));
  const byId = (list, id) => list.find((c) => c.id === id);

  it("every part a check names is a component in the same document", () => {
    for (const c of doc.checks) for (const p of c.parts || []) {
      assert.ok(ids.has(p), `${c.id} names ${p}, which is not a component`);
    }
    const ev = assemblyFromIr(buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" } }).ir);
    const evIds = new Set(ev.components.map((c) => c.id));
    for (const c of ev.checks) for (const p of c.parts || []) {
      assert.ok(evIds.has(p), `electric ${c.id} names ${p}, which is not a component`);
    }
  });

  it("head clearance names the manikin it measured and the body it measured against", () => {
    assert.deepEqual(byId(doc.checks, "head-M95").parts, ["OCC_SEAT_1_M95", "BODY_SHELL"]);
    assert.deepEqual(byId(doc.checks, "head-F5").parts, ["OCC_SEAT_1_F5", "BODY_SHELL"]);
    assert.deepEqual(byId(doc.checks, "head-M95-rear").parts, ["OCC_SEAT_3_M95", "BODY_SHELL"]);
    // the stored clearance is the gap the check computed, in metres — the viewer displays it verbatim
    assert.equal(byId(doc.checks, "head-M95").clearanceM, byId(doc.checks, "head-M95").valueM);
  });

  it("four-seats names exactly the seat components it counted", () => {
    const four = byId(doc.checks, "four-seats");
    assert.deepEqual(four.parts, four.seats);
    assert.deepEqual(four.parts, ["SEAT_1", "SEAT_2", "SEAT_3", "SEAT_4"]);
  });

  it("wheel-footwell names both front tyres and the manikin whose foot it swept against", () => {
    const wf = byId(doc.checks, "wheel-footwell");
    assert.deepEqual(wf.parts, ["TIRE_FL", "TIRE_FR", "OCC_SEAT_1_F5"]);
    assert.equal(typeof wf.clearanceM, "number");
  });

  it("containment names exactly the parts it found outside — the parts its own loop collected", () => {
    const ev = assemblyFromIr(buildCarFromLibrary(BRIEF, { config: { fuelType: "electric" } }).ir);
    const cont = byId(ev.checks, "containment");
    assert.equal(cont.status, "fail");
    assert.ok(cont.outside.length > 0);
    assert.deepEqual(cont.parts, cont.outside);
  });

  it("cooling-power names the radiator component when the document carries one", () => {
    assert.ok(ids.has("RADIATOR"));
    assert.deepEqual(byId(doc.checks, "cooling-power").parts, ["RADIATOR"]);
  });

  it("geometricOnlyParts names real components, and the styled-loft body is among them", () => {
    const geo = doc.verification.geometricOnlyParts;
    assert.ok(Array.isArray(geo) && geo.length > 0);
    for (const p of geo) assert.ok(ids.has(p), `geometricOnlyParts names ${p}, which is not a component`);
    assert.equal(doc.surface.source, "styling"); // no cad.body solid in this build
    assert.ok(geo.includes("BODY_SHELL"), "the viewer body loft is geometric only");
    assert.ok(geo.includes("TRUNK") && geo.includes("FRUNK"), "the volume boxes the statement names");
    assert.ok(!geo.includes("ENGINE"), "a library envelope the checks evaluate is not geometric only");
  });
});

describe("part analyses join (HANDOFF-3 A4)", () => {
  const doc = car();
  const env = (id, target, status, outputs = {}, extra = {}) => ({
    runId: `${id}@${target}`,
    solver: { id, version: "9.9.9" },
    target,
    status,
    outputs,
    covers: extra.covers ?? [target],
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.inputs ? { inputs: extra.inputs } : {}),
    provenance: { computedAt: "2026-10-28T00:00:00.000Z", ...(extra.noHash ? {} : { inputHash: `hash-${id}` }) },
  });

  it("with no envelopes, every mapped solver is an honest not_run and unmapped parts get an empty list", () => {
    const map = partAnalyses(doc, []);
    assert.equal(map["RADIATOR"][0].solver, "fluid.cooling-opening");
    assert.equal(map["RADIATOR"][0].status, "not_run");
    assert.equal(map["RADIATOR"][0].receipt, null);
    assert.deepEqual(map["ENGINE"].map((a) => a.solver), ["electrical.motor-thermal", "vehicle.required-power"]);
    assert.ok(map["ENGINE"].every((a) => a.status === "not_run"));
    assert.deepEqual(map["BODY_SHELL"].map((a) => a.solver), ["aero.shape", "aero.cfd"]);
    assert.match(map["BODY_SHELL"][1].reason, /OpenFOAM runs on the GPU pod/);
    assert.deepEqual(map["SEAT_1"], []);
    const tub = doc.components.find((c) => c.role === "frame");
    assert.deepEqual(map[tub.id].map((a) => a.solver), ["structure.frame"]);
    assert.equal(map[tub.id][0].status, "not_run");
  });

  it("a frame run links to exactly the members its covers list, with its receipt and key outputs", () => {
    const frameEnv = env("structure.frame", "CHASSIS", "WARN", {
      "bending.maxVonMises": { value: 3.02e7, unit: "Pa" },
      "bending.maxTranslation": { value: 0.0015, unit: "m" },
      "stiffness.torsional": { value: 770804.5, unit: "N·m/rad" },
      "stiffness.torsional.specific": { value: { tubMassKg: 90 } },
    }, { covers: ["CHASSIS", "TUB_FLOOR_L", "TUB_FLOOR_R"] });
    frameEnv.margins = [{ check: "yield", demand: 10, capacity: 20, utilization: 0.5 }, { check: "buckling", demand: 9, capacity: 10, utilization: 0.9 }];
    const map = partAnalyses(doc, [frameEnv]);
    const rec = map["TUB_FLOOR_L"][0];
    assert.equal(rec.status, "warn");
    assert.equal(rec.version, "9.9.9");
    assert.equal(rec.receipt.runId, "structure.frame@CHASSIS");
    assert.equal(rec.receipt.inputHash, "hash-structure.frame");
    assert.equal(rec.ranAt, "2026-10-28T00:00:00.000Z");
    assert.equal(rec.utilization, 0.9);
    assert.deepEqual(rec.keyOutputs.map((o) => o.id), ["bending.maxVonMises", "bending.maxTranslation", "stiffness.torsional"]);
    assert.equal(rec.keyOutputs[0].value, 3.02e7);
    // a frame member the run did not cover was not solved by it
    const uncovered = doc.components.find((c) => c.role === "frame" && c.id !== "TUB_FLOOR_L" && c.id !== "TUB_FLOOR_R");
    assert.equal(map[uncovered.id][0].status, "not_run");
    assert.match(map[uncovered.id][0].reason, /did not cover this member/);
  });

  it("cooling, required-power and aero records carry the envelope's own numbers and statuses", () => {
    const map = partAnalyses(doc, [
      env("fluid.cooling-opening", "RADIATOR", "PASS", { openingAreaM2: { value: 0.21, unit: "m^2" }, riseK: { value: 11.5, unit: "K" } }),
      env("vehicle.required-power", "VEH", "PASS", { requiredPower: { value: 187000, unit: "W" } }),
      env("electrical.motor-thermal", "ENGINE", "NOT_COMPUTED", {}, { reason: "no winding resistance on the motor node", noHash: true }),
      env("aero.shape", "VEH", "PASS", { verdict: { value: "lower drag, slant clear" }, reportedCd: { value: 0.31 } }),
      env("aero.cfd", "VEH", "PASS", { dragCoefficient: { value: 0.29 } }, { inputs: { run: { value: { importedAt: "2026-09-01T00:00:00.000Z" } } } }),
    ]);
    assert.equal(map["RADIATOR"][0].status, "pass");
    assert.deepEqual(map["RADIATOR"][0].keyOutputs.map((o) => o.id), ["openingAreaM2", "riseK"]); // absent picks are dropped, never invented
    const [motor, power] = map["ENGINE"];
    assert.equal(motor.status, "not_computed");
    assert.equal(motor.reason, "no winding resistance on the motor node");
    assert.equal(motor.receipt.inputHash, null); // a NOT_COMPUTED envelope has no inputs hash; the record says so
    assert.equal(power.status, "pass");
    assert.deepEqual(power.keyOutputs, [{ id: "requiredPower", value: 187000, unit: "W" }]);
    const [shape, cfd] = map["BODY_SHELL"];
    assert.deepEqual(shape.keyOutputs, [{ id: "verdict", value: "lower drag, slant clear" }, { id: "reportedCd", value: 0.31 }]);
    assert.equal(cfd.recordedAt, "2026-09-01T00:00:00.000Z");
    assert.deepEqual(cfd.keyOutputs, [{ id: "dragCoefficient", value: 0.29 }]);
  });

  it("withPartAnalyses attaches without mutating the source document", () => {
    const joined = withPartAnalyses(doc, []);
    assert.equal(doc.components.find((c) => c.id === "ENGINE").analyses, undefined);
    assert.equal(joined.components.find((c) => c.id === "ENGINE").analyses.length, 2);
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

describe("styling never moves the analysed solid (HANDOFF-3 A6)", () => {
  it("the document is byte-stable in everything analysed — checks, components, parameters, spec", () => {
    const doc = car();
    const again = car();
    assert.deepEqual(again.checks, doc.checks);
    assert.deepEqual(
      again.components.map((c) => [c.id, c.placement, c.half, c.parameters]),
      doc.components.map((c) => [c.id, c.placement, c.half, c.parameters]),
    );
    assert.deepEqual(again.surface.spec, doc.surface.spec);
    assert.deepEqual(again.wheel.spec, doc.wheel.spec);
  });

  it("a presentation resample leaves the design-defining spec fields and the skin's extents untouched", () => {
    const doc = car();
    const full = loftBody(doc.surface.spec);
    const mobile = loftBody(doc.surface.spec, { quality: "mobile" });
    // The resample really happened — a different tessellation of the same solid.
    assert.notEqual(full.capped.triangles, mobile.capped.triangles);
    // Every design-defining spec field is identical. Excluded are the sampling
    // markers (quality, cageLevels) and the three values DERIVED from the sampled
    // mesh — the limit-surface samples (limitCrown, limitWidth) and the
    // highlightContinuity report. Analysis reads them only from the document's
    // own full-quality loft: envelope verdicts and fit checks are computed once,
    // in the document path, and a presentation resample is never fed back in.
    const strip = (s) => { const { quality, cageLevels, highlightContinuity, limitCrown, limitWidth, ...rest } = s; return rest; };
    assert.deepEqual(strip(mobile.spec), strip(full.spec));
    // The limit samples still describe the same curve: across the stations both
    // samplings share, the coarse one tracks the full one (measured on this car:
    // mean |Δ| ≈ 0.002, worst ≈ 0.026 at the high-curvature tail).
    const mobileCrown = new Map(mobile.spec.limitCrown.map((p) => [p.x, p.v]));
    let shared = 0, maxD = 0, sumD = 0;
    for (const p of full.spec.limitCrown) {
      const mv = mobileCrown.get(p.x);
      if (mv === undefined) continue;
      shared++;
      const d = Math.abs(mv - p.v);
      if (d > maxD) maxD = d;
      sumD += d;
    }
    assert.ok(shared >= 30, `only ${shared} shared crown stations`);
    assert.ok(maxD < 0.03, `limit crown worst deviation ${maxD}`);
    assert.ok(sumD / shared < 0.005, `limit crown mean deviation ${sumD / shared}`);
    // Mesh bounds agree to sampling tolerance — the skin did not move.
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(full.bounds.min[k] - mobile.bounds.min[k]) < 0.002, `bounds.min[${k}]`);
      assert.ok(Math.abs(full.bounds.max[k] - mobile.bounds.max[k]) < 0.002, `bounds.max[${k}]`);
    }
  });
});
