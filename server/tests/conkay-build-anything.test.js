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
  const expect = { parts: "mass.part", frame: "structure.frame", pressure: "vessel.hoop-stress", flow: "fluid.pipe-network", heat: "thermal.conduction-1d", electrical: "electrical.dc-budget", mixture: "chem.solution", combustion: "chem.equilibrium" };
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
