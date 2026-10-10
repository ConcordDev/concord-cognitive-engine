// tests/conkay-sentinel-drawing.test.js
//
// Sentinel Milestone 1 in the drawing pipeline (drawing.ga-assembly): GA views
// from exact hidden-line projection of the part boxes, BOM from the part
// records with mass states, the known-mass CG and the support-polygon check.
// Unknown masses stay unknown and block a PASS (drawing check and acceptance
// gate); with every mass stated the check can pass, and a margin below the
// requirement fails it.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectBoxes } from "../lib/conkay/drawings/box-hlr.js";
import { pickScale } from "../lib/conkay/drawings/assembly-ga.js";
import { tolerableUnknownMass, edgeDistances } from "../lib/conkay/physics/solvers/geometry-stability.js";
import { drawingStatus, drawingContent } from "../lib/conkay/physics/solvers/ga-drawing.js";
import { runSentinelM1, buildSentinelM1IR } from "../lib/conkay/demos/sentinel-m1.js";
import { openDesign } from "../lib/conkay/index.js";

const len = (segs) => segs.reduce((s, [[a, b], [c, d]]) => s + Math.hypot(c - a, d - b), 0);
const box = (x0, y0, z0, x1, y1, z1, id) => ({ id, min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } });
const at = (list, id) => list.find((c) => c.runId === id);

describe("exact hidden lines for axis-aligned boxes", () => {
  const A = box(0, 0, 0, 1, 1, 1, "A"), B = box(2, -0.5, 0.25, 3, 0.5, 0.75, "B");
  it("hides exactly the part of the far box's outline behind the near box", () => {
    const front = projectBoxes([A, B], { u: ["y", 1], v: ["z", 1], depth: ["x", 1] }); // B nearer
    assert.ok(Math.abs(len(front.hidden) - 0.5) < 1e-12, "A's edge y = 0 hidden over z 0.25..0.75");
    assert.ok(Math.abs(len(front.visible) - (4 - 0.5 + 3)) < 1e-12); // A perimeter 4 less 0.5, B perimeter 3
    const back = projectBoxes([A, B], { u: ["y", 1], v: ["z", 1], depth: ["x", -1] }); // A nearer
    assert.ok(Math.abs(len(back.hidden) - 1.5) < 1e-12, "B's edge y = 0.5 and the halves of z = 0.25, 0.75 inside A");
  });
  it("draws coincident edges once and treats a shared boundary as visible", () => {
    const p = projectBoxes([box(0, 0, 0, 1, 1, 1, "a"), box(2, 0, 0, 3, 1, 1, "b")], { u: ["y", 1], v: ["z", 1], depth: ["x", 1] });
    assert.equal(p.hidden.length, 0);
    assert.ok(Math.abs(len(p.visible) - 4) < 1e-12);
  });
});

describe("unknown mass the stance tolerates", () => {
  it("matches the hand calculation on a square polygon", () => {
    // Polygon [-1,1]^2, known 10 kg at the origin, unknown mass anywhere in x <= 2, |y| <= 1:
    // edge x = 1: 10·1 + m·(1 − 2) ≥ 0 → m ≤ 10 kg; 10 kg at (2, 0) puts the CG at x = 1, on the edge.
    const sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
    const t = tolerableUnknownMass(sq, { x: 0, y: 0 }, 10, [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 1 }, { x: -1, y: 1 }]);
    assert.ok(Math.abs(t.massKg - 10) < 1e-12);
    const cg = { x: (10 * 0 + t.massKg * t.corner.x) / (10 + t.massKg), y: (t.massKg * t.corner.y) / (10 + t.massKg) };
    assert.ok(Math.abs(Math.min(...edgeDistances(sq, cg))) < 1e-12, "the bound puts the CG exactly on an edge");
    assert.equal(tolerableUnknownMass(sq, { x: 0, y: 0 }, 10, sq).massKg, Infinity, "a region inside the polygon tolerates any mass");
  });
});

describe("Sentinel M1 GA drawing (drawing.ga-assembly)", () => {
  const r = runSentinelM1();
  const R = r.report;
  const d0 = at(R.initial, "drawing.ga-assembly@sentinel"), d = at(R.checks, "drawing.ga-assembly@sentinel");
  it("is generated inside the loop from the same model, and repairs give a new revision", () => {
    assert.equal(d.status, "WARN");
    assert.match(d.outputs.revision.value, /^R-[0-9A-F]{8}$/);
    assert.notEqual(d0.outputs.revision.value, d.outputs.revision.value, "battery and bracket repairs change the drawing");
    assert.equal(at(runSentinelM1().report.checks, "drawing.ga-assembly@sentinel").outputs.modelHash.value, d.outputs.modelHash.value, "deterministic");
    assert.equal(pickScale({ min: { x: -0.22, y: -0.29, z: 0 }, max: { x: 0.43, y: 0.29, z: 3.05 } }), 20);
  });
  it("lists every body in the BOM with its mass state; unknown masses are unknown, not zero", () => {
    const bom = d.outputs.bom.value;
    const nodes = bom.flatMap((b) => b.nodes).sort();
    const ir = buildSentinelM1IR();
    assert.deepEqual(nodes, ir.nodes.filter((n) => n.id !== "sentinel").map((n) => n.id).sort());
    const unknown = bom.filter((b) => b.massState === "unknown");
    assert.deepEqual(unknown.flatMap((b) => b.nodes).sort(), ["armor", "bms", "compute", "compute-carrier", "fans", "fasteners", "panel-mount", "sensors-misc", "wiring"]);
    for (const b of unknown) assert.equal(b.unitMassKg, null);
    const act = bom.find((b) => b.material === "CubeMars AK80-64 KV80");
    assert.deepEqual([act.qty, act.unitMassKg, act.massState], [6, 0.85, "sourced"]);
    assert.equal(bom.find((b) => b.nodes.includes("battery")).description.includes("13S5P"), true, "the repaired battery");
    assert.equal(bom.find((b) => b.nodes.includes("payload")).massState, "requirement");
    assert.equal(bom.reduce((s, b) => s + (b.unitMassKg ?? 0) * b.qty, 0).toFixed(9), at(R.checks, "mass.budget@sentinel").outputs.knownMass.value.toFixed(9));
  });
  it("blocks the CG / support-polygon PASS while masses are unknown, and says how much unknown mass the stance tolerates", () => {
    const c = d.outputs.cgCheck.value;
    assert.equal(c.closed, false);
    assert.match(c.verdict, /^NOT PASSED: mass budget open \(9 unknown/);
    assert.ok(c.margin >= c.requiredMargin, "the known-mass margin alone would meet the requirement: still not a pass");
    const st = at(R.checks, "stability.static@sentinel");
    assert.equal(c.tolerableUnknownMassKg, st.outputs.unknownMassTolerance.value.massKg);
    assert.ok(c.tolerableUnknownMassKg > 0 && c.tolerableUnknownMassKg < 50);
    assert.equal(r.gate.accepted, false);
    assert.ok(r.gate.blockers.some((b) => b.kind === "unknown" && b.runId === "mass.budget@sentinel"));
  });
  it("draws dimensions with their basis and lists what is not drawn", () => {
    const dims = d.outputs.dimensions.value;
    assert.deepEqual(dims.overallHeight, { mm: 3050, basis: "C" });
    assert.deepEqual(dims.stance, { mm: 400, basis: "D" });
    assert.equal(dims.overallHeight.mm, Math.round(at(R.checks, "geometry.clearance@sentinel").outputs.overallHeight.value * 1000));
    assert.equal(dims.cgHeight.mm, Math.round(at(R.checks, "mass.budget@sentinel").outputs.cgZ.value * 1000));
    assert.ok(d.outputs.notDrawn.value.includes("armor") && !d.outputs.notDrawn.value.includes("compute"));
    for (const v of Object.values(d.outputs.views.value)) assert.ok(v.visible > 0);
  });
  it("writes SVG and PDF sheets that carry the revision, and knows when a sheet is superseded", () => {
    const f = d.outputs.files.value;
    const svg = drawingContent(f.sheet1Svg.sha256);
    assert.match(svg, /^<\?xml/);
    assert.ok(svg.includes(d.outputs.revision.value) && svg.includes("MASS/CG OPEN"));
    assert.ok(drawingContent(f.sheet2Svg.sha256).includes("NOT PASSED: mass budget open"));
    assert.equal(drawingContent(f.pdf.sha256).slice(0, 8).toString(), "%PDF-1.4");
    const s = openDesign(buildSentinelM1IR({ batteryParallel: 5, bracket: "sq-1x0.065" })).session;
    const now = s.result("drawing.ga-assembly@sentinel");
    assert.equal(now.outputs.modelHash.value, d.outputs.modelHash.value, "the repaired design opened directly gives the same drawing");
    assert.equal(drawingStatus(svg, s, "sentinel", "drawing.ga-assembly").current, true);
    s.engine.applyEdits([{ node: "battery", path: "props.battery.parallel", value: 6 }], { source: "test" });
    const st = drawingStatus(svg, s, "sentinel", "drawing.ga-assembly");
    assert.equal(st.current, false);
    assert.match(st.reason, /superseded/);
  });
});

describe("with every mass stated", () => {
  // Give each unknown item an explicit estimate and a position (test values, labelled estimated).
  const closedIR = (reqMin) => {
    const ir = buildSentinelM1IR({ batteryParallel: 5, bracket: "sq-1x0.065" });
    for (const n of ir.nodes) {
      if (n.props?.massState?.state !== "placeholder") continue;
      n.props.mass = "1 kg";
      n.props.massState = { state: "estimated", method: "test estimate", uncertainty: { pct: 50 } };
      n.position ||= { x: "0 m", y: "0 m", z: "2.2 m" };
    }
    if (reqMin) ir.requirements.find((q) => q.id === "R-stability").min = reqMin;
    return ir;
  };
  it("passes the CG check and clears the gate's unknown blocker", () => {
    const r = runSentinelM1({ ir: closedIR() });
    const c = at(r.report.checks, "drawing.ga-assembly@sentinel").outputs.cgCheck.value;
    assert.equal(c.closed, true);
    assert.equal(c.verdict, "PASS");
    assert.equal(c.tolerableUnknownMassKg, null);
    assert.equal(r.gate.blockers.filter((b) => b.kind === "unknown").length, 0);
  });
  it("fails it when the margin is below the requirement", () => {
    const r = runSentinelM1({ ir: closedIR("0.5 m") });
    const c = at(r.report.checks, "drawing.ga-assembly@sentinel").outputs.cgCheck.value;
    assert.match(c.verdict, /^FAIL: margin below the requirement R-stability/);
  });
});

describe("north-star report and lens action", () => {
  it("adds the drawing to the report and serves the sheets", async () => {
    const { runNorthStar, renderNorthStarMarkdown } = await import("../lib/conkay/northstar/index.js");
    const md = renderNorthStarMarkdown(runNorthStar());
    assert.ok(md.includes("GA drawing, BOM and CG check") && md.includes("NOT PASSED: mass budget open"));
    const { default: register } = await import("../domains/conkay-northstar.js");
    const actions = {};
    register((dom, n, fn) => { actions[`${dom}.${n}`] = fn; });
    const r = actions["conkay_northstar.sentinel-drawing"]();
    assert.equal(r.ok, true);
    assert.match(r.result.files.sheet1Svg.svg, /CK-GA-SENTINEL-M1/);
    assert.equal(Buffer.from(r.result.files.pdf.base64, "base64").subarray(0, 5).toString(), "%PDF-");
    assert.equal(r.result.gate.accepted, false);
  });
});
