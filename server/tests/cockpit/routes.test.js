import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { memDb, fakeExec } from "./_helpers.js";
import { mountCockpitRoutes } from "../../routes/cockpit.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";
import { publishRun } from "../../lib/cockpit/events.js";

const planWith = (tool) => ({ brainChat: async () => ({ ok: true, text: JSON.stringify({ steps: [{ goal: "do the thing", tool }] }) }) });
const GOAL = "decide what to name my cat";

async function makeApp({ tool = "web_search", reply, table } = {}) {
  const db = memDb();
  const exec = fakeExec(table || { web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }], create_dtu: [{ tool: "create_dtu", ok: true, result: { dtuId: "d1" } }] });
  const mock = createMockModel({ steps: { "*": [reply || (tool === "create_dtu" ? { tool: "create_dtu", args: { title: "A" } } : { tool: "web_search", args: { query: "q" } })] } });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.get("x-user") || "u1", role: "member" }; next(); });
  mountCockpitRoutes({
    app, db, lensActions: new Map(), planDeps: planWith(tool),
    makeDeps: () => ({ exec, sleep: async () => {}, stepCall: (a) => mock.next(a), emit: (e) => publishRun(e.runId, e) }),
  });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body, user) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
  const waitFor = async (id, pred) => {
    for (let i = 0; i < 40; i++) {
      const r = await call("GET", `/api/cockpit/runs/${id}`);
      if (pred(r.json)) return r.json;
      await new Promise((x) => setTimeout(x, 50));
    }
    throw new Error("timeout waiting for run state");
  };
  return { db, call, waitFor, close: () => server.close() };
}

test("flag off: 404 cockpit_disabled", async () => {
  delete process.env.CONCORD_COCKPIT_RUNS;
  const t = await makeApp();
  try {
    const r = await t.call("POST", "/api/cockpit/runs", { goal: GOAL });
    assert.equal(r.status, 404);
    assert.equal(r.json.error, "cockpit_disabled");
  } finally { t.close(); }
});

test("create, finish, receipt, SSE, privacy", async () => {
  process.env.CONCORD_COCKPIT_RUNS = "1";
  const t = await makeApp();
  try {
    assert.equal((await t.call("POST", "/api/cockpit/runs", { goal: "" })).status, 400);
    const c = await t.call("POST", "/api/cockpit/runs", { goal: GOAL });
    assert.equal(c.status, 201);
    const id = c.json.run.id;
    const done = await t.waitFor(id, (j) => j.run.status === "done");
    assert.equal(done.steps[0].hasReceipt, true);
    assert.ok(!JSON.stringify(done).includes('"args"'));
    assert.equal((await t.call("GET", `/api/cockpit/runs/${id}`, null, "u2")).status, 404);
    const rc = await t.call("GET", `/api/cockpit/runs/${id}/steps/${done.steps[0].id}/receipt`);
    assert.equal(rc.status, 200);
    assert.equal(rc.json.receipt.stepId, done.steps[0].id);
    const sse = await t.call("GET", `/api/cockpit/runs/${id}/events`);
    assert.ok(sse.text.includes("cockpit:step"));
    assert.ok(!sse.text.includes("web_search"));
  } finally { delete process.env.CONCORD_COCKPIT_RUNS; t.close(); }
});

test("a write waits for approval, then finishes; a non-waiting decision is 409", async () => {
  process.env.CONCORD_COCKPIT_RUNS = "1";
  const t = await makeApp({ tool: "create_dtu" });
  try {
    const c = await t.call("POST", "/api/cockpit/runs", { goal: GOAL });
    const id = c.json.run.id;
    const waiting = await t.waitFor(id, (j) => j.run.status === "awaiting_confirm");
    const stepId = waiting.steps[0].id;
    const bad = await t.call("POST", `/api/cockpit/runs/${id}/decision`, { stepId: "stp_nope", decision: "approve" });
    assert.equal(bad.status, 409);
    const ok = await t.call("POST", `/api/cockpit/runs/${id}/decision`, { stepId, decision: "approve" });
    assert.equal(ok.status, 200);
    await t.waitFor(id, (j) => j.run.status === "done");
    const again = await t.call("POST", `/api/cockpit/runs/${id}/decision`, { stepId, decision: "approve" });
    assert.equal(again.status, 409);
  } finally { delete process.env.CONCORD_COCKPIT_RUNS; t.close(); }
});

test("a third concurrent run is refused", async () => {
  process.env.CONCORD_COCKPIT_RUNS = "1";
  const t = await makeApp({ tool: "create_dtu" });
  try {
    assert.equal((await t.call("POST", "/api/cockpit/runs", { goal: GOAL })).status, 201);
    assert.equal((await t.call("POST", "/api/cockpit/runs", { goal: GOAL })).status, 201);
    const third = await t.call("POST", "/api/cockpit/runs", { goal: GOAL });
    assert.equal(third.status, 429);
    assert.equal(third.json.error, "too_many_runs");
  } finally { delete process.env.CONCORD_COCKPIT_RUNS; t.close(); }
});

test("pause, resume and cancel", async () => {
  process.env.CONCORD_COCKPIT_RUNS = "1";
  const t = await makeApp({ tool: "create_dtu" });
  try {
    const c = await t.call("POST", "/api/cockpit/runs", { goal: GOAL });
    const id = c.json.run.id;
    await t.waitFor(id, (j) => j.run.status === "awaiting_confirm");
    assert.equal((await t.call("POST", `/api/cockpit/runs/${id}/resume`)).status, 409);
    assert.equal((await t.call("POST", `/api/cockpit/runs/${id}/pause`)).json.run.status, "paused");
    assert.equal((await t.call("POST", `/api/cockpit/runs/${id}/cancel`)).json.run.status, "cancelled");
    assert.equal((await t.call("POST", `/api/cockpit/runs/${id}/cancel`)).status, 409);
  } finally { delete process.env.CONCORD_COCKPIT_RUNS; t.close(); }
});
