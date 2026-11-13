process.env.EMBEDDINGS_ENABLED = "false";
import test from "node:test";
import assert from "node:assert/strict";
import { buildToolMenu, menuSchemaBlock } from "../../lib/cockpit/tool-menu.js";
import { MODEL_PROFILES } from "../../lib/cockpit/model-caps.js";
import { TOOL_SCHEMA_BLOCK } from "../../lib/chat-agent.js";

const f = () => {};
const lensActions = new Map([["physics.power", f], ["tasks.task-add", f], ["tasks.list", f]]);
const ids = (r) => r.menu.map((m) => m.id);

test("web search goal", async () => {
  const r = await buildToolMenu({ goal: "search the web for heat pump prices", profile: "local-2b", lensActions });
  assert.ok(ids(r).includes("web_search"));
  assert.ok(r.menu.length <= 6);
});
test("declared tool leads, its first fallback follows", async () => {
  const r = await buildToolMenu({ goal: "x", declaredTool: "run_recipe", profile: "local-2b", lensActions });
  assert.deepEqual(ids(r).slice(0, 2), ["run_recipe", "run_compute"]);
});
test("lens context pulls that lens's actions", async () => {
  const r = await buildToolMenu({ goal: "add a task to buy milk", lensContext: "tasks", profile: "local-2b", lensActions });
  assert.ok(ids(r).includes("lens:tasks.task-add"));
});
test("every profile respects maxMenu", async () => {
  for (const [name, p] of Object.entries(MODEL_PROFILES)) {
    const r = await buildToolMenu({ goal: "add a task and search the web and compute and record a log", profile: name, lensActions });
    assert.ok(r.menu.length <= p.maxMenu, name);
  }
});
test("exclude removes a tool", async () => {
  const r = await buildToolMenu({ goal: "search the web", profile: "local-2b", lensActions, exclude: ["web_search"] });
  assert.ok(!ids(r).includes("web_search"));
});
test("negative control: an unknown declared tool does not throw or appear", async () => {
  const r = await buildToolMenu({ goal: "x", declaredTool: "nope", profile: "local-2b", lensActions });
  assert.ok(!ids(r).includes("nope"));
});
test("menuSchemaBlock narrows the real block", () => {
  const block = menuSchemaBlock([
    { id: "web_search" }, { id: "run_compute" }, { id: "dtu_search" },
  ], TOOL_SCHEMA_BLOCK);
  assert.ok(block);
  assert.ok(block.includes("- web_search:"));
  assert.ok(!block.includes("- generate_image:"));
});
test("menuSchemaBlock returns null when too little survives", () => {
  assert.equal(menuSchemaBlock([{ id: "nope" }], "- a: x\n- b: y"), null);
});
