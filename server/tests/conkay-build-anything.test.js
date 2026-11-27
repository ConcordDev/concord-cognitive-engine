// "Build anything": Kay plans the design graph, every applicable solver checks
// it, the report says what was checked and what wasn't, in the person's units.
// The model is a stub here (its replies are the test's inputs); every number
// asserted comes from the solvers or a hand calculation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAMILIES, selectFamilies } from "../lib/conkay/build/catalogue.js";
import { checkPlan, planBuild } from "../lib/conkay/build/planner.js";
import { buildFromBrief, buildToolSummary } from "../lib/conkay/build/index.js";
import { unitPreferences } from "../lib/conkay/build/report.js";
import { openDesign } from "../lib/conkay/index.js";

test("every catalogue example compiles and its own solver runs on it", () => {
  const expect = { parts: "mass.part", vessel: "geometry.capacity", stability: "stability.tipping", wing: "aero.lifting-line", frame: "structure.frame", pressure: "vessel.hoop-stress", flow: "fluid.pipe-network", heat: "thermal.conduction-1d", electrical: "electrical.dc-budget", mixture: "chem.solution", combustion: "chem.equilibrium" };
  for (const f of FAMILIES) {
    const c = checkPlan({ design: { id: f.id, name: f.id }, ...f.example });
    assert.equal(c.ok, true, `${f.id}: ${JSON.stringify(c.errors)}`);
    const r = openDesign(c.ir);
    const env = r.session.results().filter((e) => e.solver.id === expect[f.id]);
    assert.ok(env.length, `${f.id}: ${expect[f.id]} did not target the example`);
    if (f.id !== "combustion") assert.notEqual(env[0].status, "NOT_COMPUTED", `${f.id}: ${env[0].reason}`);
  }
});

test("families follow the brief, not a fixed beam", () => {
  const ids = (t) => selectFamilies(t).map((f) => f.id);
  assert.deepEqual(ids("a pickling brine with 2 oz salt per quart"), ["parts", "mixture"]);
  assert.ok(ids("a 12 V LED lamp on a battery for 3 hours").includes("electrical"));
  assert.ok(ids("an insulated cooler box").includes("heat"));
  assert.ok(ids("garden hose from a rain barrel").includes("flow"));
  assert.ok(ids("a wall shelf that holds 50 lb").includes("frame"));
});

test("unit preferences: the person's units come back", () => {
  const p = unitPreferences("a 3 ft shelf holding 50 lb, at 70 °F");
  assert.equal(p.length, "ft");
  assert.equal(p.pressure, "psi");
  assert.equal(p.temperature, "°F");
});

const SHELF_BAD = { summary: "wall shelf", ir: { design: { id: "shelf", name: "wall shelf" },
  nodes: [{ id: "BOARD", kind: "Part", name: "board", material: "pine", geometry: { shape: "box", x: "3 ft", y: "10 in", z: "3/4 in" } }], edges: [] },
  lookups: [{ query: "density of pine wood", for: "pine density" }], questions: [], assumptions: [] };
const shelfIr = (fix) => ({ design: { id: "shelf", name: "wall shelf" },
  materials: { "white-pine": { label: "Eastern white pine", density: { value: "350 kg/m3", source: "OpenStax University Physics 1, Table 14.1" },
    youngsModulus: { value: "8.5 GPa", source: "USDA Wood Handbook, Table 5-3a" }, poisson: { value: 0.33, source: "USDA Wood Handbook, Table 5-2 (ν_LR)" }, yield: { value: "33 MPa", source: "USDA Wood Handbook, Table 5-3a (MOR)" } } },
  nodes: [
    { id: "SHELF", kind: "Assembly", name: "wall shelf", props: { frameModel: {
      nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: "3 ft", y: 0, z: 0 }],
      members: [{ id: "M1", i: "A", j: "B", part: "BOARD" }],
      supports: [{ node: "A", fix: fix }, { node: "B", fix: ["y", "z"] }],
      loadCases: [{ id: "books", udl: [{ member: "M1", w: [0, 0, "-24.3 lbf/ft"] }] }],
      factorOfSafety: { value: 2, basis: "the person" } } } },
    { id: "BOARD", kind: "Part", name: "board", material: "white-pine", position: { x: "1.5 ft", y: 0, z: 0 }, geometry: { shape: "box", length: "3 ft", width: "10 in", height: "3/4 in" } },
  ],
  edges: [{ from: "SHELF", to: "BOARD", type: "CONTAINS" }] });

test("planner: lookups go to the textbook, compile errors go back to the model, the repaired plan is checked", async () => {
  const seen = [];
  const replies = [
    JSON.stringify(SHELF_BAD),                                           // asks for a lookup
    JSON.stringify({ ...SHELF_BAD, lookups: [] }),                       // still the bad box keys
    "```json\n" + JSON.stringify({ summary: "wall shelf", ir: shelfIr(["x", "y", "z", "rx"]), lookups: [], questions: [{ ask: "What wall is it going on?", blocking: false, default: "wood studs" }], assumptions: ["books spread evenly"] }) + "\n```",
  ];
  const chat = async (messages) => { seen.push(messages.at(-1).content); return { ok: true, text: replies.shift() }; };
  const lookup = async (q) => ({ ok: true, results: [{ book: "University Physics Volume 1", section: "14.1 Fluids, Density, and Pressure", url: "https://openstax.org/x", passage: `densities: pine ~ 350 kg/m3 (${q})` }] });
  const brief = "a wall shelf 3 ft long that holds 72 lb of books, pine, safety factor 2";
  const r = await buildFromBrief({ brief, chat, lookup, settle: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(seen[1], /Textbook passages[\s\S]*University Physics Volume 1/);
  assert.match(seen[2], /compiler rejected/);
  assert.equal(r.plan.sources[0].book, "University Physics Volume 1");
  const frame = r.report.checked.find((c) => c.solver === "structure.frame");
  assert.ok(frame, "the frame solver checked the board");
  // hand check: w = 24.3 lbf/ft = 354.6 N/m, L = 0.9144 m, M = wL²/8, σ = 6M/(b h²)
  const w = 24.3 * 4.4482216152605 / 0.3048, L = 0.9144, b = 0.254, h = 0.01905;
  const sigma = (6 * (w * L * L / 8)) / (b * h * h);
  assert.match(frame.demand, /psi/, "stress comes back in psi for a brief in feet and pounds");
  const psi = Number(/^([\d.]+) psi/.exec(frame.demand)[1]);
  assert.ok(Math.abs(psi * 6894.757 - sigma) / sigma < 0.02, `${psi} psi vs ${sigma} Pa`);
  assert.equal(frame.pass, sigma <= 33e6 / 2);
  assert.ok(r.report.masses.some((m) => /lb/.test(m.mass)), "mass in lb");
  assert.deepEqual(r.report.questions, [{ ask: "What wall is it going on?", blocking: false, default: "wood studs" }]);
  assert.ok(r.artifact?.positions.length > 0, "the board is drawn");
  const s = buildToolSummary(r);
  assert.ok(s.checked.length && s.parts.length);
});

test("planner: an unsourced material is refused at compile and the model is told why", async () => {
  const noSource = shelfIr(["x", "y", "z", "rx"]);
  noSource.materials["white-pine"].density = "350 kg/m3";
  const c = checkPlan(noSource);
  assert.equal(c.ok, false);
  assert.match(c.errors.join(" "), /source/);
});

test("planner: no model is an honest failure, not a beam", async () => {
  const r = await planBuild({ brief: "a dog house", chat: async () => ({ ok: false, error: "down" }) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "no_model");
  assert.match(r.message, /can't reach my language model/);
});

test("planner gives up after its repairs with the compiler's errors", async () => {
  const bad = JSON.stringify({ ir: { nodes: [{ id: "X", kind: "Nope" }] } });
  let n = 0;
  const r = await planBuild({ brief: "a thing", chat: async () => { n++; return { ok: true, text: bad }; }, lookup: null });
  assert.equal(r.ok, false);
  assert.equal(r.error, "plan_invalid");
  assert.ok(r.errors.length);
  assert.ok(n <= 5);
});

test("a mechanism is a failure the report shows, not a pass", async () => {
  // rx free at both ends: the board can spin about its own axis
  const plan = { summary: "s", ir: shelfIr(["x", "y", "z"]), lookups: [], questions: [], assumptions: [] };
  const r = await buildFromBrief({ brief: "a 3 ft shelf", chat: async () => ({ ok: true, text: JSON.stringify(plan) }), lookup: null, settle: false });
  assert.equal(r.ok, true);
  assert.notEqual(r.report.verdict, "passes_checked");
});

// ── Step 1: a build you can work on ──────────────────────────────────────────
import Database from "better-sqlite3";
import { up as migrate518 } from "../migrations/518_conkay_builds.js";
import { saveBuild, editBuild, loadBuild } from "../lib/conkay/build/index.js";
import { listParameters, applyEdits } from "../lib/conkay/build/edit.js";

async function savedShelf() {
  const db = new Database(":memory:");
  migrate518(db);
  const plan = { summary: "s", ir: shelfIr(["x", "y", "z", "rx"]), lookups: [], questions: [], assumptions: [] };
  const r = await buildFromBrief({ brief: "a 3 ft pine shelf for 72 lb", chat: async () => ({ ok: true, text: JSON.stringify(plan) }), lookup: null, settle: false });
  const id = saveBuild(db, { userId: "u1", brief: "a 3 ft pine shelf for 72 lb", answers: [], result: r });
  return { db, id, r };
}

test("a build lists what can be edited, in the units it was written in, and colours its parts", async () => {
  const { r } = await savedShelf();
  const p = r.report.parameters;
  const len = p.find((x) => x.id === "BOARD:geometry.length");
  assert.equal(len.value, "3 ft");
  assert.equal(len.dim, "length");
  const load = p.find((x) => x.dim === "force_per_length");
  assert.equal(load.value, "-24.3 lbf/ft", "the load stays as written, not converted to SI");
  assert.ok(p.find((x) => x.id === "BOARD:material").options.includes("white-pine"));
  // the frame check names member M1, which is the board: the board carries its colour
  assert.ok(["pass", "warn", "fail"].includes(r.report.partStatus.BOARD), JSON.stringify(r.report.partStatus));
  assert.equal(r.artifact.partRanges[0].id, "BOARD");
});

test("editing a build re-runs the solvers: a thicker board lowers the stress by the square of the thickness", async () => {
  const { db, id, r } = await savedShelf();
  const before = r.report.checked.find((c) => c.solver === "structure.frame");
  const e = await editBuild(db, { id, userId: "u1", edits: [{ id: "BOARD:geometry.height", value: "1.5 in" }], settle: false });
  assert.equal(e.ok, true, JSON.stringify(e.errors));
  const after = e.report.checked.find((c) => c.solver === "structure.frame");
  const psi = (s) => Number(/^([\d.]+) psi/.exec(s)[1]);
  // σ = 6M/(b h²): doubling h quarters σ (self-weight doubles too, so slightly more than a quarter)
  const ratio = psi(after.demand) / psi(before.demand);
  assert.ok(ratio > 0.25 && ratio < 0.3, `ratio ${ratio}`);
  assert.equal(loadBuild(db, id, "u1").plan.ir.nodes.find((n) => n.id === "BOARD").geometry.height, "1.5 in");
});

test("a longer board moves the free end of its frame member; the span follows the part", async () => {
  const { db, id } = await savedShelf();
  const e = await editBuild(db, { id, userId: "u1", edits: [{ id: "BOARD:geometry.length", value: "4 ft" }], settle: false });
  assert.equal(e.ok, true);
  const B = e.ir.nodes.find((n) => n.id === "SHELF").props.frameModel.nodes.find((n) => n.id === "B");
  assert.ok(Math.abs(B.x - 1.2192) < 1e-6, String(B.x));
  assert.ok(e.applied.some((a) => /frame joint B moved/.test(a.label)));
  assert.ok(!e.report.gaps.some((g) => /frame check models member/.test(g.reason)));
});

test("a load typed without a sign keeps its direction", async () => {
  const { db, id } = await savedShelf();
  const load = (await savedShelf()).r.report.parameters.find((x) => x.dim === "force_per_length");
  const e = await editBuild(db, { id, userId: "u1", edits: [{ id: load.id, value: "60 lbf/ft" }], settle: false });
  assert.equal(e.ok, true);
  assert.equal(e.report.parameters.find((x) => x.id === load.id).value, "-60 lbf/ft");
});

test("edits are refused when they are not values of this build, the wrong kind, or not a material", async () => {
  const ir = shelfIr(["x", "y", "z", "rx"]);
  for (const [edit, re] of [
    [{ id: "BOARD:props.secret", value: "1" }, /not an editable value/],
    [{ id: "BOARD:geometry.height", value: "5 kg" }, /expected a length/],
    [{ id: "BOARD:geometry.height", value: "-2 in" }, /more than zero/],
    [{ id: "BOARD:material", value: "unobtainium" }, /not a library material/],
    [{ id: "SHELF:props.frameModel.factorOfSafety.value", value: "0" }, /positive number/],
  ]) {
    const r = applyEdits(ir, [edit]);
    assert.equal(r.ok, false, JSON.stringify(edit));
    assert.match(r.errors.join(" "), re);
  }
  // another person's build cannot be edited
  const { db, id } = await savedShelf();
  assert.equal((await editBuild(db, { id, userId: "someone-else", edits: [{ id: "BOARD:geometry.height", value: "1 in" }] })).error, "not_found");
  assert.ok(listParameters(ir).length >= 5);
});

test("a saved build reopens with its report and its 3D parts; only its owner can open it", async () => {
  const { openBuild } = await import("../lib/conkay/build/index.js");
  const { db, id, r } = await savedShelf();
  const o = openBuild(db, id, "u1");
  assert.equal(o.artifact.buildId, id);
  assert.equal(o.artifact.report.headline, r.report.headline);
  assert.ok(o.artifact.positions.length > 0);
  assert.equal(o.artifact.partRanges[0].id, "BOARD");
  assert.equal(openBuild(db, id, "someone-else"), null);
});
