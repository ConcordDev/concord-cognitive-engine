import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { COCKPIT_MCP_TOOLS, callCockpitMcpTool, advertisedCockpitMcpTools } from "../../lib/cockpit/mcp-tools.js";

const saved = { lt: process.env.CONCORD_COCKPIT_LONG_TASK, runs: process.env.CONCORD_COCKPIT_RUNS };
const setFlags = (on) => { for (const k of ["CONCORD_COCKPIT_LONG_TASK", "CONCORD_COCKPIT_RUNS"]) { if (on) process.env[k] = "1"; else delete process.env[k]; } };
before(() => setFlags(true));
after(() => { for (const [k, v] of [["CONCORD_COCKPIT_LONG_TASK", saved.lt], ["CONCORD_COCKPIT_RUNS", saved.runs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

const actor = (id, scopes) => ({ id, userId: id, scopes });
const plan = { planRun: async () => ({ ok: true, source: "template", steps: [{ key: "s1", goal: "save it", tool: "create_dtu", args: { title: "A" }, expects: [], dependsOn: [], required: true }] }) };

test("start_run without the compute scope is scope_denied", async () => {
  const db = memDb();
  const r = await callCockpitMcpTool("start_run", { goal: "write a note about beams" }, { db, actor: actor("u1", ["mcp:lens:read"]), deps: plan });
  assert.equal(r.reason, "scope_denied");
});

test("start_run then get_run; another user gets not_found", async () => {
  const db = memDb();
  db.prepare("INSERT INTO users (id, role, scopes) VALUES ('u2','member','[]')").run();
  const a = actor("u1", ["mcp:lens:compute", "mcp:lens:read"]);
  const s = await callCockpitMcpTool("start_run", { goal: "write a note about beams" }, { db, actor: a, deps: plan });
  assert.equal(s.ok, true);
  const g = await callCockpitMcpTool("get_run", { run_id: s.run_id }, { db, actor: a });
  assert.equal(g.ok, true);
  assert.equal(g.steps.length, 1);
  const other = await callCockpitMcpTool("get_run", { run_id: s.run_id }, { db, actor: actor("u2", ["mcp:lens:read"]) });
  assert.equal(other.reason, "not_found");
});

test("an awaiting_confirm run reports needs_person and no tool can decide", async () => {
  const db = memDb();
  const a = actor("u1", ["mcp:lens:compute", "mcp:lens:read"]);
  const s = await callCockpitMcpTool("start_run", { goal: "write a note about beams" }, { db, actor: a, deps: plan });
  const step = store.listSteps(db, s.run_id)[0];
  store.updateStep(db, step.id, { status: "awaiting_confirm" });
  store.updateRun(db, s.run_id, { status: "awaiting_confirm" });
  const g = await callCockpitMcpTool("get_run", { run_id: s.run_id }, { db, actor: a });
  assert.equal(g.needs_person, true);
  assert.ok(!COCKPIT_MCP_TOOLS.some((t) => /decision|approve|confirm/i.test(t.name)));
  assert.equal(store.getRun(db, s.run_id).status, "awaiting_confirm");
});

test("flag off: disabled and not advertised", async () => {
  setFlags(false);
  try {
    const r = await callCockpitMcpTool("get_run", { run_id: "x" }, { db: memDb(), actor: actor("u1", []) });
    assert.equal(r.reason, "disabled");
    assert.equal(advertisedCockpitMcpTools().length, 0);
  } finally { setFlags(true); }
});
