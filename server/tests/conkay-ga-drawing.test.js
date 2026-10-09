// tests/conkay-ga-drawing.test.js
//
// Engineering drawings (step 5): the general-arrangement drawing generated from
// the CAD model (drawing.ga). Sheet writers and layout run everywhere; the
// projection kernel runs when a Python with OCP is found; the full library car
// (cad.body + drawing, about 1 min of kernel time, cached afterwards) only with
// CONKAY_CAD_BODY_FULL=1.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { toSvg, toPdf, ascii, fitText } from "../lib/conkay/drawings/sheet.js";
import { buildGaSheets, SHEET_A3 } from "../lib/conkay/drawings/ga-drawing.js";
import { drawingStatus, GA_VIEWS } from "../lib/conkay/physics/solvers/ga-drawing.js";
import { runDrawingKernel } from "../lib/conkay/cad/drawing-kernel.js";
import { runBodyKernel, bodyKernelPython } from "../lib/conkay/cad/body-kernel.js";
import { carAcceptance } from "../lib/conkay/compiler/car-from-library.js";
import { aabb } from "../lib/conkay/packaging/geometry.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const HAVE_KERNEL = !!bodyKernelPython();
const FULL = HAVE_KERNEL && process.env.CONKAY_CAD_BODY_FULL === "1";

// A synthetic GA input: rectangles for views, two axles, four tyres, every dimension.
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
const INPUT = {
  title: "GENERAL ARRANGEMENT - TEST", number: "CK-GA-TEST", scale: 25, revision: "R-0123ABCD",
  modelHash: "0123abcd".repeat(8), projection: "First-angle projection", status: "SCREENING - NOT FOR MANUFACTURE",
  generated: "test", model: "test model",
  views: {
    side: { visible: [rect(0.1, 0.1, 4.5, 1.25)], hidden: [] },
    plan: { visible: [rect(0.1, -0.95, 4.5, 0.95)], hidden: [[[1, -0.5], [1, 0.5]]] },
    front: { visible: [rect(-0.95, 0.1, 0.95, 1.25)], hidden: [] },
  },
  body: { min: [0.1, -0.95, 0.1], max: [4.5, 0.95, 1.25] },
  axles: { frontX: 1.0, rearX: 3.9 },
  tyres: [["TIRE_FL", 1.0, -0.8], ["TIRE_FR", 1.0, 0.8], ["TIRE_RL", 3.9, -0.8], ["TIRE_RR", 3.9, 0.8]].map(([id, x, y]) => ({ id, x, y, r: 0.33, halfWidth: 0.12 })),
  dims: {
    overallLength: { valueM: 4.4, basis: "C" }, overallWidth: { valueM: 1.9, basis: "C" }, overallHeight: { valueM: 1.25, basis: "C" },
    groundClearance: { valueM: 0.1, basis: "C" }, wheelbase: { valueM: 2.9, basis: "D" }, frontTrack: { valueM: 1.6, basis: "D" },
    rearTrack: { valueM: 1.6, basis: "D" }, frontOverhang: { valueM: 0.9, basis: "C" }, rearOverhang: { valueM: 0.6, basis: "C" }, tyreDiameter: { valueM: 0.66, basis: "S" },
  },
  dimRows: [{ id: "overallLength", label: "Overall length", from: "test" }, { id: "tyreDiameter", label: "Tyre", from: "test" }],
  bom: [{ item: 1, qty: 4, nodes: ["TIRE_FL", "TIRE_FR", "TIRE_RL", "TIRE_RR"], description: "Tyre", libraryId: "tyre.x", unitMassKg: 11.52, massState: "sourced", source: "example.com" }],
  toleranceText: "2 mm", bomNote: "note", notes: ["SCREENING DRAWING: test"],
};
const texts = (sheet) => sheet.items.filter((i) => i.t === "text").map((i) => i.s);

describe("Drawing sheets: layout and writers (no kernel)", () => {
  const sheets = buildGaSheets(INPUT);

  it("two A3 sheets; every dimension shown with its value in mm and its basis", () => {
    assert.equal(sheets.length, 2);
    for (const s of sheets) assert.deepEqual(s.size, SHEET_A3);
    const t1 = texts(sheets[0]);
    for (const [id, want] of [["overallLength", "4400 C"], ["wheelbase", "2900 D"], ["frontOverhang", "900 C"], ["rearOverhang", "600 C"], ["overallWidth", "1900 C"], ["overallHeight", "1250 C"], ["frontTrack", "1600 D"]]) {
      assert.ok(t1.includes(want), `${id}: ${want}`);
    }
    assert.ok(t1.some((s) => s.startsWith("100 C")), "ground clearance");
  });

  it("the title block on both sheets carries the revision and the model hash", () => {
    for (const s of sheets) {
      const t = texts(s);
      assert.ok(t.includes("R-0123ABCD"));
      assert.ok(t.some((x) => x.includes(INPUT.modelHash.slice(0, 32))));
      assert.ok(t.some((x) => /SCREENING - NOT FOR MANUFACTURE/.test(x)));
      assert.ok(t.some((x) => /Scale 1:25 \(A3\)/.test(x) && /First-angle/.test(x)));
    }
    assert.ok(texts(sheets[0]).some((x) => /Sheet 1 of 2/.test(x)));
    assert.ok(texts(sheets[1]).some((x) => /Sheet 2 of 2/.test(x)));
  });

  it("sheet 2 lists the BOM and the dimension table", () => {
    const t = texts(sheets[1]);
    assert.ok(t.includes("BILL OF MATERIALS (component library + designed parts)"));
    assert.ok(t.includes("tyre.x") && t.includes("11.52") && t.includes("sourced"));
    assert.ok(t.includes("Overall length") && t.includes("4400"));
  });

  it("everything is drawn inside the sheet border", () => {
    for (const s of sheets) {
      for (const it of s.items) {
        const pts = it.t === "line" ? it.pts : it.t === "text" || it.t === "arrow" ? [[it.x, it.y]] : it.t === "circle" ? [[it.cx, it.cy]] : [[it.x, it.y]];
        for (const [x, y] of pts) assert.ok(x >= 10 - 1e-9 && x <= 410 + 1e-9 && y >= 10 - 1e-9 && y <= 287 + 1e-9, `${JSON.stringify(it).slice(0, 80)}`);
      }
    }
  });

  it("SVG: deterministic, ASCII, metadata embedded and readable back", () => {
    const a = toSvg(sheets[0], { revision: "R-0123ABCD", modelHash: INPUT.modelHash });
    assert.equal(a, toSvg(buildGaSheets(INPUT)[0], { revision: "R-0123ABCD", modelHash: INPUT.modelHash }));
    assert.ok([...a].every((ch) => ch.charCodeAt(0) < 128), "ASCII only");
    assert.match(a, /<metadata id="conkay-drawing">/);
    const fake = { result: () => ({ status: "PASS", outputs: { modelHash: { value: INPUT.modelHash }, revision: { value: "R-0123ABCD" } } }) };
    assert.deepEqual(drawingStatus(a, fake), { current: true, revision: "R-0123ABCD" });
    const moved = { result: () => ({ status: "PASS", outputs: { modelHash: { value: "f".repeat(64) }, revision: { value: "R-FFFFFFFF" } } }) };
    const st = drawingStatus(a, moved);
    assert.equal(st.current, false);
    assert.match(st.reason, /superseded: the model changed since R-0123ABCD \(now R-FFFFFFFF\)/);
    assert.equal(drawingStatus("<svg/>", fake).current, false);
  });

  it("PDF: deterministic bytes, one page per sheet, a valid cross-reference table", () => {
    const a = toPdf(sheets, { title: "t" });
    assert.ok(a.equals(toPdf(buildGaSheets(INPUT), { title: "t" })));
    const s = a.toString("latin1");
    assert.ok(s.startsWith("%PDF-1.4"));
    assert.ok(s.trimEnd().endsWith("%%EOF"));
    assert.equal((s.match(/\/Type \/Page /g) || []).length, 2);
    const xref = Number(s.match(/startxref\n(\d+)/)[1]);
    assert.ok(s.slice(xref).startsWith("xref"));
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} at ${o}`));
    assert.ok(!/CreationDate|ModDate/.test(s), "no dates: same model, same bytes");
  });

  it("text helpers keep sheets ASCII and fit columns", () => {
    assert.equal(ascii("–30 °C ± 2 × 3"), "-30  degC +/- 2 x 3");
    assert.ok(fitText("x".repeat(200), 2.5, 20).endsWith("..."));
  });

  it("without a kernel the drawing is NOT_COMPUTED, never drawn from a stand-in body", () => {
    const saved = process.env.CONKAY_OCC_PYTHON;
    process.env.CONKAY_OCC_PYTHON = "/nonexistent/python";
    try {
      const s = carAcceptance(BRIEF).session;
      const d = s.result("drawing.ga@VEH");
      assert.equal(d.status, "NOT_COMPUTED");
      assert.match(d.reason, /no drawing without the CAD body/);
      assert.match(s.realizationPackage().files["README.md"], /drawing not computed/);
    } finally {
      if (saved == null) delete process.env.CONKAY_OCC_PYTHON; else process.env.CONKAY_OCC_PYTHON = saved;
    }
  });
});

describe("Drawing projection kernel (OpenCascade HLR)", { skip: !HAVE_KERNEL && "no Python with OCP" }, () => {
  const body = HAVE_KERNEL ? runBodyKernel({
    command: "body",
    params: { skinOffset: 0.035, stationCount: 24, sectionPoints: 16, frontalSlices: 60, maxIterations: 2, noseExtension: 0.15, tailExtension: 0.1 },
    envelopes: [aabb({ id: "CABIN", min: [1.0, -0.6, 0.25], max: [3.0, 0.6, 1.0] })].map((b) => ({ id: b.id, kind: "test", center: b.center, half: b.half, axes: b.axes, enclose: true })),
    points: [], rays: [],
    wheels: [[1.2, -0.8], [1.2, 0.8], [2.9, -0.8], [2.9, 0.8]].map(([x, y], i) => ({ id: `W${i}`, center: [x, y, 0.3], radius: 0.3, halfWidth: 0.1, steerDeg: 0 })),
    exports: ["step", "stl"],
  }) : null;
  const req = HAVE_KERNEL ? { command: "project", step: body.files.step.path, geometryHash: body.files.stl.sha256, views: GA_VIEWS } : null;
  const p = HAVE_KERNEL ? runDrawingKernel(req) : null;

  it("projects the solid into side, plan and front views; the outline spans the body's bounding box", () => {
    assert.equal(body.ok, true, body.error);
    assert.equal(p.ok, true, p.error);
    // against the exact extents (BRepExtrema), not the body's AddOptimal box, which can sit outside the surface
    const bb = p.extents;
    const tol = 0.004; // tessellation deflection 2 mm + 0.1 mm grid
    for (let i = 0; i < 3; i++) {
      // bracketed: attained value within [bound, attained] / [attained, bound], inside the outer (AddOptimal) box
      const [lo, hi] = p.extents.maxBracket[i], [mlo, mhi] = p.extents.minBracket[i];
      assert.ok(lo === p.extents.max[i] && hi >= lo && hi <= p.extents.addOptimalBox.max[i] + 1e-9, `max ${i}`);
      assert.ok(mhi === p.extents.min[i] && mlo <= mhi && mlo >= p.extents.addOptimalBox.min[i] - 1e-9, `min ${i}`);
      // the body kernel measures its solid the same way: the exported STEP gives the same extents
      assert.ok(Math.abs(p.extents.max[i] - body.metrics.bbox.max[i]) < 1e-4 && Math.abs(p.extents.min[i] - body.metrics.bbox.min[i]) < 1e-4, `axis ${i}`);
    }
    const near = (a, b) => Math.abs(a - b) <= tol;
    const side = p.views.side.bbox, plan = p.views.plan.bbox, front = p.views.front.bbox;
    assert.ok(near(side[0], bb.min[0]) && near(side[2], bb.max[0]) && near(side[1], bb.min[2]) && near(side[3], bb.max[2]), JSON.stringify({ side, bb }));
    assert.ok(near(plan[1], bb.min[1]) && near(plan[3], bb.max[1]), JSON.stringify(plan));
    assert.ok(near(front[0], -bb.max[1]) && near(front[2], -bb.min[1]), JSON.stringify(front));
    for (const v of Object.values(p.views)) assert.ok(v.visible.length > 0 && v.visibleLengthM > 1);
    // the outer outline (slices) reaches the exact lowest point, which hidden-line removal misses on a flat floor
    const outlineMinZ = Math.min(...p.views.side.outline.map((q) => q[1]));
    assert.ok(near(outlineMinZ, bb.min[2]), `${outlineMinZ} vs ${bb.min[2]}`);
    assert.match(p.method.algorithm, /HLRBRep_PolyAlgo/);
  });

  it("is deterministic (a fresh run of the script gives the same views)", () => {
    const again = runDrawingKernel({ ...req, nonce: "rerun" }); // a different request hash: not served from the cache
    assert.equal(again.ok, true);
    assert.deepEqual(again.views, p.views);
  });
});

describe("GA drawing of the library car (full kernel run)", { skip: !FULL && "set CONKAY_CAD_BODY_FULL=1 with a kernel available" }, () => {
  const r = FULL ? carAcceptance(BRIEF) : null;
  const s = r?.session;

  it("drawing.ga runs from the CAD body; its dimensions are the body's and the layout's", () => {
    const d = s.result("drawing.ga@VEH");
    assert.ok(["PASS", "WARN"].includes(d.status), d.reason || d.error);
    assert.equal(d.status, "PASS", (d.warnings || []).join("; "));
    const dim = d.outputs.dimensions.value;
    const b = s.result("cad.body@BODY_SHELL").outputs.dimensions.value;
    const ext = d.outputs.extents.value;
    assert.equal(dim.overallLength.mm, Math.round((ext.max[0] - ext.min[0]) * 1000));
    assert.equal(dim.groundClearance.mm, Math.round(ext.min[2] * 1000));
    // cad.body and the drawing kernel measure the same solid the same way (bracketed extents)
    for (const c of d.outputs.bboxCheck.value) assert.ok(Math.abs(c.outsideMm) <= 0.1, JSON.stringify(c));
    assert.ok(Math.abs(dim.overallWidth.mm - b.widthM * 1000) < 10);
    assert.equal(dim.wheelbase.basis, "D");
    assert.equal(dim.tyreDiameter.basis, "S");
    assert.match(d.outputs.revision.value, /^R-[0-9A-F]{8}$/);
    for (const k of ["sheet1Svg", "sheet2Svg", "pdf", "json"]) assert.ok(fs.existsSync(d.outputs.files.value[k].path), k);
  });

  it("the BOM covers every library component node, with mass.part masses and states", () => {
    const bom = s.result("drawing.ga@VEH").outputs.bom.value;
    const listed = new Set(bom.flatMap((x) => x.nodes));
    for (const n of s.graph.nodes.values()) if (n.props?.component) assert.ok(listed.has(n.id), n.id);
    const tyres = bom.find((x) => x.nodes.includes("TIRE_FL"));
    assert.equal(tyres.qty, 4);
    assert.ok(Math.abs(tyres.unitMassKg - s.result("mass.part@TIRE_FL").outputs.mass.value) < 1e-9);
    assert.equal(tyres.massState, "sourced");
    assert.ok(!bom.some((x) => x.nodes.some((id) => id.startsWith("OCCUPANT"))), "payload is not a part");
  });

  it("the sheets carry the revision; the realization package includes them", () => {
    const d = s.result("drawing.ga@VEH").outputs;
    const svg = fs.readFileSync(d.files.value.sheet1Svg.path, "utf8");
    assert.ok(svg.includes(d.revision.value));
    assert.deepEqual(drawingStatus(svg, s), { current: true, revision: d.revision.value });
    const pkg = s.realizationPackage().files;
    assert.ok(Object.keys(pkg).some((k) => k.startsWith("manufacturing/drawings/") && k.endsWith("sheet1.svg")));
    assert.match(pkg["README.md"], /## Drawings \(drawing\.ga\)/);
  });

  it("a model change re-runs the drawing and supersedes the old revision (BOM edit, then a body edit)", () => {
    const before = s.result("drawing.ga@VEH").outputs;
    const oldSvg = fs.readFileSync(before.files.value.sheet1Svg.path, "utf8");
    const e1 = s.edit([{ node: "SEAT_1", path: "props.mass", value: 16 }]);
    assert.ok(e1.ok !== false, JSON.stringify(e1).slice(0, 200));
    const mid = s.result("drawing.ga@VEH").outputs;
    assert.notEqual(mid.revision.value, before.revision.value, "a BOM mass change is a new revision");
    const st = drawingStatus(oldSvg, s);
    assert.equal(st.current, false);
    assert.match(st.reason, /superseded/);
    s.edit([{ node: "BODY_SHELL", path: "geometry.skinOffset", value: 0.045 }]);
    const after = s.result("drawing.ga@VEH").outputs;
    assert.notEqual(after.revision.value, mid.revision.value, "a body change is a new revision");
    assert.notEqual(after.files.value.sheet1Svg.sha256, mid.files.value.sheet1Svg.sha256);
  });
});
