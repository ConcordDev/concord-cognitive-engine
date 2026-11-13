process.env.EMBEDDINGS_ENABLED = "false";
import test from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { planRun, normalizePlan, materializePlan } from "../../lib/cockpit/planner.js";

const chatReturning = (obj) => async () => ({ ok: true, text: typeof obj === "string" ? obj : JSON.stringify(obj), provider: "t", model: "m" });
const base = { db: null, userId: "u1", profile: "local-2b", lensActions: new Map() };

test("research + report picks the research template", async () => {
  const r = await planRun({ ...base, goal: "research heat pumps and write me a report" });
  assert.equal(r.source, "template");
  assert.equal(r.steps.length, 4);
  assert.ok(r.steps[3].dependsOn.includes("s1"));
});
test("beam + 3D model picks size_and_model", async () => {
  const r = await planRun({ ...base, goal: "size a steel cantilever beam and make a 3d model" });
  assert.equal(r.templateId, "size_and_model");
  assert.equal(r.steps[0].tool, "conkay_design");
});
test("add a task picks find_and_act", async () => {
  const r = await planRun({ ...base, goal: "add a task to buy milk" });
  assert.equal(r.templateId, "find_and_act");
  assert.equal(r.steps[0].tool, "find_lens_actions");
});
test("a model plan drops tools outside the candidates", async () => {
  const r = await planRun({
    ...base, goal: "decide what to name my cat",
    deps: { brainChat: chatReturning({ steps: [{ goal: "look up names", tool: "web_search" }, { goal: "do magic", tool: "bogus_tool", after: [1] }] }) },
  });
  assert.equal(r.source, "model");
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].tool, "web_search");
});
test("nonsense from the model falls back to a single step", async () => {
  const r = await planRun({ ...base, goal: "decide what to name my cat", deps: { brainChat: chatReturning("nonsense") } });
  assert.equal(r.source, "single");
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].tool, null);
});
test("a cycle is rejected", () => {
  const r = normalizePlan([
    { key: "s1", goal: "a", tool: null, dependsOn: ["s2"] },
    { key: "s2", goal: "b", tool: null, dependsOn: ["s1"] },
  ], { candidateIds: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "cycle");
});
test("materializePlan stores real step ids in dependsOn", () => {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g" });
  const steps = materializePlan(db, run.id, 1, [
    { key: "s1", goal: "a", tool: null, args: null, expects: [], dependsOn: [], required: true },
    { key: "s2", goal: "b", tool: null, args: null, expects: [], dependsOn: ["s1"], required: true },
  ]);
  assert.deepEqual(steps[1].dependsOn, [steps[0].id]);
  assert.match(steps[0].id, /^stp_/);
});
test("negative control: 100 model steps are cut to at most 60", async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ goal: `step ${i}`, tool: "auto" }));
  const r = await planRun({ ...base, goal: "decide what to name my cat", deps: { brainChat: chatReturning({ steps: many }) } });
  assert.ok(r.steps.length <= 60);
  assert.equal(r.steps.length, 60);
});
test("empty goal is refused", async () => {
  assert.equal((await planRun({ ...base, goal: "  " })).reason, "empty_goal");
});
