// server/tests/conkay-workbench.test.js
//
// Workbench v0 (conversational-loop item 5), on the screening car (no CAD kernel):
//   - locking a design variable makes the orchestrator report it as binding instead of changing it (the brief's
//     acceptance): the drive unit locked at the iM-225, "what about 150 mph" (it reaches 148.8 mph on the screening
//     body) leaves the iM-225 in place and names the lock as binding;
//   - a knob and a chat edit take the same path; a locked variable refuses both; bounds and options are enforced;
//   - the view: knobs, the graph from the engine's recorded reads, a receipt per run whose explanation substitutes
//     the receipt's own numbers (utilization = demand / capacity);
//   - the routes: signed in, owner-only, the same calls end to end over HTTP.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { orchestrate, carEvaluator } from "../lib/conkay/chat/orchestrator.js";
import { REPAIR_RULES } from "../lib/conkay/chat/repair-rules.js";
import { DesignConversation } from "../lib/conkay/chat/what-if.js";
import { workbenchView, explainCheck } from "../lib/conkay/chat/workbench.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import createConkayWorkbenchRouter from "../routes/conkay-workbench.js";

const evaluate = carEvaluator({ carAcceptanceAsync, cadBody: false });
const REQ140 = { topSpeedMs: 140 * 0.44704, seats: 4, massMaxKg: null };

async function conversation(speedMph = 140) {
  const run = await orchestrate({ evaluate, rules: REPAIR_RULES, initialState: { brief: `Design a car that can go ${speedMph} mph, seats 4 people.`, fuelType: "electric", tailExtensionM: 0.22 } });
  return new DesignConversation({ evaluate, rules: REPAIR_RULES, requirements: { ...REQ140, topSpeedMs: speedMph * 0.44704 }, state: run.state, final: run.final });
}

describe("locks: the orchestrator reports a locked variable as binding instead of changing it", () => {
  it("the drive unit locked at the iM-225; 150 mph is asked; the iM-225 stays and the lock is named", async () => {
    const conv = await conversation(140);
    assert.equal(conv.current.final.report.selection.engine_or_motor.chosen, "motor.cascadia.im-225-dz");
    assert.equal(conv.lock("motorId").ok, true);
    const reply = await conv.ask("what about 150 mph");
    assert.equal(conv.current.final.report.selection.engine_or_motor.chosen, "motor.cascadia.im-225-dz", "not changed");
    const binding = reply.outcome.binding || [];
    assert.ok(binding.some((b) => b.variable === "motorId" && /locked by the user/.test(b.why)), JSON.stringify(reply.outcome));
    assert.equal(reply.outcome.kind, "proven-infeasible");
    // unlocked, the same request takes the next drive unit
    conv.unlock("motorId");
    await conv.undo();
    const again = await conv.ask("what about 150 mph");
    assert.equal(conv.current.state.motorId, "motor.cascadia.im-375-dz");
    assert.ok(again.ok);
  });
  it("a locked variable refuses a knob move and a chat edit alike", async () => {
    const conv = await conversation(140);
    conv.lock("motorId");
    const k = await conv.setKnob("motorId", "motor.cascadia.im-375-dz");
    assert.equal(k.kind, "locked");
    assert.equal(conv.revisions.length, 1, "nothing changed");
  });
  it("knob options and bounds are enforced; an unknown knob is refused", async () => {
    const conv = await conversation(140);
    assert.equal((await conv.setKnob("motorId", "motor.nope")).kind, "error");
    assert.equal((await conv.setKnob("colour", "red")).kind, "error");
    assert.equal(conv.lock("colour").ok, false);
  });
});

describe("the view", () => {
  let view;
  before(async () => { view = workbenchView(await conversation(140)); });
  it("knobs with their options, the graph from the engine's reads, a receipt per run", () => {
    const motor = view.knobs.find((k) => k.variable === "motorId");
    assert.ok(motor.options.includes("motor.cascadia.im-225-dz") && motor.options.includes("motor.cascadia.im-375-dz"));
    assert.equal(motor.value, "motor.cascadia.im-225-dz");
    assert.equal(view.checks.length, view.graph.nodes.filter((n) => n.kind === "run").length);
    for (const e of view.graph.edges) assert.ok(view.graph.nodes.some((n) => n.id === e.from) && view.graph.nodes.some((n) => n.id === e.to), JSON.stringify(e));
    const acc = view.graph.nodes.find((n) => n.id === "vehicle.acceptance@VEH");
    const req = view.graph.nodes.find((n) => n.id === "requirement.check@REQ_topSpeed");
    assert.ok(acc.depth > req.depth, "acceptance reads the requirement checks, so it sits after them");
  });
  it("the explanation substitutes the receipt's own numbers", () => {
    const c = view.checks.find((x) => x.runId === "requirement.check@REQ_topSpeed");
    const m = c.margins[0];
    assert.match(c.explanation, new RegExp(`utilization = demand / capacity = ${+m.demand.toPrecision(5)} m/s / ${+m.capacity.toPrecision(5)} m/s`));
    assert.match(c.explanation, /not physical validation/);
    assert.ok(c.solver.id && c.solver.version && c.inputHash);
    const battery = view.checks.find((x) => x.runId === "vehicle.traction-battery@VEH");
    assert.ok(battery.sources.some((u) => /molicel/.test(u)), "the cell data sheet is linked");
  });
  it("a NOT_COMPUTED run says why, never a number", () => {
    const text = explainCheck({ status: "NOT_COMPUTED", reason: "needs the CAD body", solver: { method: "m" }, margins: [] });
    assert.match(text, /Not computed: needs the CAD body/);
    assert.equal(/utilization/.test(text), false);
  });
});

describe("the routes (signed in, owner only)", () => {
  let server, port;
  before(async () => {
    const app = express();
    app.use(express.json());
    // the user comes from a header in this test (requireAuth sets req.user in the server)
    app.use((req, _res, next) => { req.user = { id: req.get("x-test-user") || null }; next(); });
    app.use("/api/conkay", createConkayWorkbenchRouter({ requireAuth: (req, res, next) => (req.user?.id ? next() : res.status(401).json({ ok: false })), evaluatorFor: () => evaluate }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));
  const call = (method, p, user, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });

  it("start, lock, knob refused while locked, ask, undo; another user cannot see it; unsigned is 401", async () => {
    assert.equal((await call("POST", "/api/conkay/workbench", null, { prompt: "x" })).status, 401);
    const q = await call("POST", "/api/conkay/workbench", "u1", { prompt: "Design a car" });
    assert.equal(q.body.stage, "questions");
    const s = await call("POST", "/api/conkay/workbench", "u1", { prompt: "Design a four-seat electric car that holds 140 mph" });
    assert.equal(s.body.stage, "designed");
    const id = s.body.id;
    assert.equal((await call("GET", `/api/conkay/workbench/${id}`, "u2")).status, 404);
    const l = await call("POST", `/api/conkay/workbench/${id}/lock`, "u1", { variable: "motorId" });
    assert.deepEqual(l.body.view.locked, ["motorId"]);
    const k = await call("POST", `/api/conkay/workbench/${id}/knob`, "u1", { variable: "motorId", value: "motor.cascadia.im-375-dz" });
    assert.equal(k.body.reply.kind, "locked");
    await call("POST", `/api/conkay/workbench/${id}/lock`, "u1", { variable: "motorId", locked: false });
    const a = await call("POST", `/api/conkay/workbench/${id}/ask`, "u1", { text: "use titanium for the tub" });
    assert.equal(a.body.reply.kind, "parameter");
    assert.equal(a.body.view.revision, 1);
    const u = await call("POST", `/api/conkay/workbench/${id}/undo`, "u1");
    assert.equal(u.body.reply.matches, true);
    assert.equal(u.body.view.revision, 0);
  });
});
