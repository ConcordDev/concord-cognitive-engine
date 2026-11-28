// Design by the math: the organizer names what may change; the solvers size
// it. Expected values are closed-form hand calculations.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { sizeBuild } from "../lib/conkay/build/size.js";
import { buildFromBrief, saveBuild, sizeSavedBuild, loadBuild } from "../lib/conkay/build/index.js";
import { openBuildHint } from "../lib/conkay/build/chat.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { up as migrate518 } from "../migrations/518_conkay_builds.js";

const near = (a, b, rel, msg = "") => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);
const pine = { "white-pine": { label: "Eastern white pine", density: { value: "350 kg/m3", source: "OpenStax University Physics 1, Table 14.1" }, youngsModulus: { value: "8.5 GPa", source: "USDA Wood Handbook" }, poisson: { value: 0.33, source: "USDA Wood Handbook" }, yield: { value: "33 MPa", source: "USDA Wood Handbook (MOR)" } } };
const shelf = (h = "3/4 in") => ({ design: { id: "shelf", name: "wall shelf" }, materials: pine,
  nodes: [
    { id: "SHELF", kind: "Assembly", name: "wall shelf", props: { frameModel: { nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: "3 ft", y: 0, z: 0 }], members: [{ id: "M1", i: "A", j: "B", part: "BOARD" }],
      supports: [{ node: "A", fix: ["x", "y", "z", "rx"] }, { node: "B", fix: ["y", "z"] }], loadCases: [{ id: "books", udl: [{ member: "M1", w: [0, 0, "-24.3 lbf/ft"] }] }], factorOfSafety: { value: 2, basis: "the person" } } } },
    { id: "BOARD", kind: "Part", name: "board", material: "white-pine", position: { x: "1.5 ft", y: 0, z: 0 }, geometry: { shape: "box", length: "3 ft", width: "10 in", height: h } }],
  edges: [{ from: "SHELF", to: "BOARD", type: "CONTAINS" }] });
// σ = 6M/(b h²) = Fy/FS  →  h* = √(6 M FS / (b Fy)), M = w L² / 8
const w = (24.3 * 4.4482216152605) / 0.3048, M = (w * 0.9144 ** 2) / 8;
const hStar = Math.sqrt((6 * M * 2) / (0.254 * 33e6));

test("a shelf board is sized to exactly the thickness where bending meets Fy/FS, in the units it was written in", () => {
  const r = sizeBuild(shelf(), { variables: [{ id: "BOARD:geometry.height", min: "1 mm", max: "2 in" }] });
  assert.equal(r.feasible, true);
  const to = r.changes[0].to;
  assert.match(to, / in$/, "inches in, inches out");
  near(Number(to.split(" ")[0]) * 0.0254, hStar, 1e-5, "h*");
  assert.ok(r.after.mass < r.before.mass);
  assert.match(r.binding[0].check, /von Mises/);
});

test("too thin to start: it grows to the same answer", () => {
  const r = sizeBuild(shelf("2 mm"), { variables: [{ id: "BOARD:geometry.height", min: "1 mm", max: "2 in" }] });
  assert.equal(r.before.feasible, false);
  near(Number(r.changes[0].to.split(" ")[0]) / 1000, hStar, 1e-5, "h* from below");
});

test("stock sizes: the smallest one that passes", () => {
  const r = sizeBuild(shelf(), { variables: [{ id: "BOARD:geometry.height", stock: ["1/4 in", "3/8 in", "1/2 in", "3/4 in"] }] });
  assert.equal(r.changes[0].to, "3/8 in"); // 6.35 mm < h* = 7.28 mm < 9.53 mm
});

test("bounds that cannot work are said plainly, with the checks that still fail at the limits", () => {
  const r = sizeBuild(shelf(), { variables: [{ id: "BOARD:geometry.height", min: "1 mm", max: "5 mm" }] });
  assert.equal(r.ok, true);
  assert.equal(r.feasible, false);
  assert.match(r.failingAtLimits[0].check, /von Mises/);
  assert.match(r.message, /No design within these bounds/);
});

test("refuses what it cannot size", () => {
  for (const [v, re] of [
    [{ id: "BOARD:material", min: "1", max: "2" }, /only sizes/],
    [{ id: "nope", min: "1 mm", max: "2 mm" }, /not a value/],
    [{ id: "BOARD:geometry.height", min: "5 mm", max: "1 mm" }, /min ≤ max/],
    [{ id: "BOARD:geometry.height", stock: ["1 kg"] }, /stock size/],
  ]) { const r = sizeBuild(shelf(), { variables: [v] }); assert.equal(r.ok, false); assert.match(r.errors.join(" "), re); }
});

async function saved(userId = "u1") {
  const db = new Database(":memory:"); migrate518(db);
  const plan = { summary: "a pine wall shelf", ir: shelf(), lookups: [], questions: [], assumptions: [] };
  const r = await buildFromBrief({ brief: "a 3 ft pine shelf for 72 lb", chat: async () => ({ ok: true, text: JSON.stringify(plan) }), lookup: null, settle: false });
  return { db, id: saveBuild(db, { userId, brief: "a 3 ft pine shelf for 72 lb", answers: [], result: r }) };
}

test("sizing a saved build saves the sized design and its report", async () => {
  const { db, id } = await saved();
  const r = await sizeSavedBuild(db, { id, userId: "u1", variables: [{ id: "BOARD:geometry.height", min: "1 mm", max: "2 in" }], settle: false });
  assert.equal(r.feasible, true);
  assert.match(r.report.headline, /pass/);
  assert.equal(loadBuild(db, id, "u1").plan.ir.nodes.find((n) => n.id === "BOARD").geometry.height, r.sizing.changes[0].to);
  assert.equal((await sizeSavedBuild(db, { id, userId: "someone-else", variables: [] })).error, "not_found");
});

test("Kay as organizer: the open build's real values are in her hint; her tools edit and size that build", async () => {
  const { db, id } = await saved();
  const h = openBuildHint(db, id, "u1");
  assert.match(h.hint, /BOARD:geometry\.height — board height = 3\/4 in/);
  assert.equal(openBuildHint(db, id, "someone-else"), null, "not someone else's build");
  const ctx = { db, userId: "u1" };
  const ed = await executeToolCall(ctx, null, new Map(), { tool: "conkay_build_edit", params: { buildId: id, edits: [{ id: "BOARD:geometry.height", value: "1 in" }] } });
  assert.equal(ed.ok, true, ed.error);
  assert.equal(ed.artifact.buildId, id);
  assert.equal(loadBuild(db, id, "u1").plan.ir.nodes.find((n) => n.id === "BOARD").geometry.height, "1 in");
  const sz = await executeToolCall(ctx, null, new Map(), { tool: "conkay_build_size", params: { buildId: id, variables: [{ id: "BOARD:geometry.height", stock: ["1/4 in", "3/8 in", "1/2 in"] }] } });
  assert.equal(sz.ok, true, sz.error);
  assert.equal(sz.result.changes[0].to, "3/8 in");
  assert.ok(sz.result.massAfter < sz.result.massBefore);
  const other = await executeToolCall({ db, userId: "intruder" }, null, new Map(), { tool: "conkay_build_edit", params: { buildId: id, edits: [{ id: "BOARD:geometry.height", value: "9 in" }] } });
  assert.equal(other.ok, false);
});

test("trades: a tube under bending goes to its widest diameter with the thinnest wall that passes (the true minimum)", () => {
  const ir = { design: { id: "p", name: "post" }, edges: [{ from: "A1", to: "P", type: "CONTAINS" }], nodes: [
    { id: "A1", kind: "Assembly", name: "post", props: { frameModel: { nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0, y: 0, z: 0.4 }], members: [{ id: "M1", i: "A", j: "B", part: "P" }], supports: [{ node: "A", fix: "fixed" }], loadCases: [{ id: "tip", nodal: [{ node: "B", F: [500, 0, 0] }] }], factorOfSafety: { value: 3, basis: "t" } } } },
    { id: "P", kind: "Part", name: "post", material: "aluminum-6061-t6", position: { x: 0, y: 0, z: 0.2 }, props: { axis: "z" }, geometry: { shape: "round-tube", length: "400 mm", outerDiameter: "16 mm", wall: "1.5 mm" } }] };
  const r = sizeBuild(ir, { variables: [{ id: "P:geometry.outerDiameter", min: "10 mm", max: "50 mm" }, { id: "P:geometry.wall", min: "0.5 mm", max: "5 mm" }] });
  assert.equal(r.feasible, true);
  assert.equal(r.changes[0].atBound, "max");
  // σ = M c / I = Fy / 3 at OD 50 mm  →  the wall that gives I = 3 M c / Fy
  const M = 500 * 0.4, c = 0.025, Ineed = (3 * M * c) / 276e6;
  let lo = 1e-5, hi = 0.0249; for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if ((Math.PI * (0.05 ** 4 - (0.05 - 2 * m) ** 4)) / 64 >= Ineed) hi = m; else lo = m; }
  near(Number(r.changes[1].to.split(" ")[0]) / 1000, hi, 2e-4, "wall");
});

test("thin round tubes are checked for local buckling (NASA SP-8007), and it governs when the wall is very thin", async () => {
  const { openDesign } = await import("../lib/conkay/index.js");
  const tube = (od, wall) => ({ design: { id: "t", name: "t" }, loadCases: [], requirements: [], edges: [{ from: "A1", to: "P", type: "CONTAINS" }], nodes: [
    { id: "A1", kind: "Assembly", name: "beam", props: { frameModel: { nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 1, y: 0, z: 0 }], members: [{ id: "M1", i: "A", j: "B", part: "P" }], supports: [{ node: "A", fix: "fixed" }], loadCases: [{ id: "tip", nodal: [{ node: "B", F: [0, 0, -80] }] }], factorOfSafety: { value: 1, basis: "t" } } } },
    { id: "P", kind: "Part", name: "tube", material: "aluminum-6061-t6", position: { x: 0.5, y: 0, z: 0 }, props: { axis: "x" }, geometry: { shape: "round-tube", length: "1 m", outerDiameter: od, wall } }] });
  const margins = (od, wall) => openDesign(tube(od, wall)).session.results().find((e) => e.solver.id === "structure.frame").margins;
  // σcr = γ E t / (R √(3(1−ν²))), γ = 1 − 0.731 (1 − e^(−√(R/t)/16)), R the mid-wall radius
  const E = 68.9e9, nu = 0.33, t = 0.0002, R = (0.1 - t) / 2;
  const gamma = 1 - 0.731 * (1 - Math.exp(-Math.sqrt(R / t) / 16));
  const sigmaCr = (gamma * E * t) / (R * Math.sqrt(3 * (1 - nu * nu)));
  const thin = margins("100 mm", "0.2 mm");
  const lb = thin.find((m) => /local buckling/.test(m.check));
  const { getMaterial } = await import("../lib/conkay/materials/index.js");
  const al = getMaterial("aluminum-6061-t6");
  const crExact = (gamma * al.youngsModulusPa * t) / (R * Math.sqrt(3 * (1 - al.poisson ** 2)));
  near(lb.capacity, crExact, 1e-12, "σcr");
  near(crExact, sigmaCr, 0.01, "σcr with handbook E and ν");
  assert.ok(lb.capacity < al.yieldPa, "for a wall this thin, local buckling governs before yield");
  // a stocky tube: buckling far above yield, so yield governs
  const stocky = margins("50 mm", "3 mm").find((m) => /local buckling/.test(m.check));
  assert.ok(stocky.capacity > al.yieldPa);
});
