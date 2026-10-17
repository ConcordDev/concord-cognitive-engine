// server/tests/conkay-workbench-continuation.test.js
//
// The workbench questions stage keeps the conversation (routes/conkay-workbench.js):
//   - a prompt that leaves requirements open answers stage 'questions' with a
//     pendingId and the turn history, stored under the caller's ownership;
//   - the reply POSTs { pendingId, text }; the joined turns re-run designFromChat
//     as ONE brief, so the answers continue the same design instead of starting a
//     fresh brief + message; on 'designed' the normal session id comes back and
//     the pending entry is dropped;
//   - ownership is enforced like own(): another user's continuation, a pending id
//     used as a session id, a pending id after it became a session, and an
//     unsigned call all refuse;
//   - the designed view carries feaFrame — one load case of the conversation's
//     own structure.frame run in the engineering.runFEA shape (chat/workbench.js
//     feaFrameOf): the model the solve used (real sections' A/I, the material's
//     E and yield, the case's resolved nodal loads) and the solver's own
//     displacements + utilization, joined by member id. (The showcase snapshot
//     path serves receipts only — no geometry — so the designs adapter renders no
//     artifact for a plain snapshot.)
//
// One orchestrate on the screening car (no CAD kernel) in before(); the its
// assert on the recorded replies.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { carEvaluator } from "../lib/conkay/chat/orchestrator.js";
import { carAcceptanceAsync } from "../lib/conkay/compiler/car-from-library.js";
import createConkayWorkbenchRouter from "../routes/conkay-workbench.js";

const evaluate = carEvaluator({ carAcceptanceAsync, cadBody: false });

let server, port;
let unsigned, questions, wrongOwner, designed, pendingAsSession, pendingAfterDesigned, sessionView;

const call = (method, p, user, body) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : null;
  const req = http.request({ host: "127.0.0.1", port, path: p, method, headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}), ...(data ? { "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
    let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve({ status: res.statusCode, body: s ? JSON.parse(s) : null }));
  });
  req.on("error", reject);
  if (data) req.write(data);
  req.end();
});

before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: req.get("x-test-user") || null }; next(); });
  app.use("/api/conkay", createConkayWorkbenchRouter({ requireAuth: (req, res, next) => (req.user?.id ? next() : res.status(401).json({ ok: false })), evaluatorFor: () => evaluate }));
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  port = server.address().port;

  unsigned = await call("POST", "/api/conkay/workbench", null, { prompt: "x" });
  questions = await call("POST", "/api/conkay/workbench", "u1", { prompt: "Design a car" });
  const pendingId = questions.body.pendingId;
  wrongOwner = await call("POST", "/api/conkay/workbench", "u2", { pendingId, text: "a four-seat electric car that holds 140 mph" });
  designed = await call("POST", "/api/conkay/workbench", "u1", { pendingId, text: "a four-seat electric car that holds 140 mph" });
  pendingAsSession = await call("GET", `/api/conkay/workbench/${pendingId}`, "u1");
  pendingAfterDesigned = await call("POST", "/api/conkay/workbench", "u1", { pendingId, text: "4 seats" });
  sessionView = await call("GET", `/api/conkay/workbench/${designed.body.id}`, "u1");
});

after(() => new Promise((r) => server.close(r)));

describe("the questions stage keeps the conversation", () => {
  it("an unsigned start is refused; an open prompt returns the questions with a pendingId and the turn history", () => {
    assert.equal(unsigned.status, 401);
    assert.equal(questions.status, 200);
    assert.equal(questions.body.stage, "questions");
    assert.ok(Array.isArray(questions.body.questions) && questions.body.questions.length > 0);
    assert.ok(questions.body.pendingId, "the reply must be continuable");
    assert.deepEqual(questions.body.history, [{ role: "user", text: "Design a car" }]);
  });

  it("the reply continues the same conversation: the joined turns design once, the session id comes back and the pending entry is dropped", () => {
    assert.equal(designed.status, 200);
    assert.equal(designed.body.stage, "designed");
    assert.ok(designed.body.id, "a real session id");
    assert.ok(designed.body.view, "the workbench view of the continued design");
    assert.notEqual(designed.body.id, questions.body.pendingId);
    // the pending conversation is gone: not a session, not continuable
    assert.equal(pendingAsSession.status, 404);
    assert.equal(pendingAfterDesigned.status, 404);
    // the designed session is live and owned
    assert.equal(sessionView.status, 200);
    assert.ok(sessionView.body.view.revision >= 0);
  });

  it("ownership is enforced like own(): another user's continuation is refused", () => {
    assert.equal(wrongOwner.status, 404);
  });

  it("the designed view carries feaFrame: one honest load case of the conversation's own structure.frame run", () => {
    const f = designed.body.view.feaFrame;
    assert.ok(f, "the screening car's frame run is in the conversation, so the view carries it");
    assert.equal(f.runId, "structure.frame@CHASSIS");
    assert.ok(typeof f.case === "string" && f.case.length > 0);

    const nodeIds = new Set(f.model.nodes.map((n) => n.id));
    assert.ok(nodeIds.size > 10, "the tub frame's real node set");
    for (const n of f.model.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z), JSON.stringify(n));
    // members: the real sections and material constants the solve used
    assert.equal(f.model.members.length, f.result.utilization.length);
    for (const m of f.model.members) {
      assert.ok(nodeIds.has(m.nodeI) && nodeIds.has(m.nodeJ), `member ${m.id} joins real nodes`);
      assert.ok(m.area > 0 && m.momentI > 0 && m.depthIn > 0, `member ${m.id} carries its real section`);
      assert.ok(m.elasticModulus > 0 && m.allowableStress > 0, `member ${m.id} carries its real material`);
    }
    // loads: the case's resolved nodal forces (re-runnable through the runFEA element)
    assert.ok(f.model.loads.length > 0);
    for (const l of f.model.loads) {
      assert.ok(nodeIds.has(l.nodeId), "a load on a real node");
      assert.ok([l.Fx, l.Fy, l.Fz].some((v) => Number.isFinite(v) && v !== 0), "a real applied force");
    }
    assert.ok(f.model.supports.length > 0);
    // result: the solver's own numbers, one displacement per real node, one row per member
    assert.equal(f.result.displacements.length, f.model.nodes.length);
    for (const d of f.result.displacements) assert.ok(nodeIds.has(d.nodeId) && Number.isFinite(d.dx + d.dy + d.dz));
    for (const u of f.result.utilization) assert.ok(u.utilization == null || Number.isFinite(u.utilization));
    for (const s of f.result.stresses) assert.ok(Number.isFinite(s.combinedStress) && s.combinedStress >= 0);
    assert.ok(Number.isFinite(f.result.summary.maxUtilization));
  });
});