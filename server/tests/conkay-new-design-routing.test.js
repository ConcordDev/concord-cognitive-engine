// New designs from the ConKay workspace box (live test 2026-10-17): a bridge is a truss (Pratt unless named), the
// chat agent routes bridge / car design requests to its design tools, and POST /api/conkay/workbench answers a truss
// brief with the class-problem solver instead of refusing it as "not a car".
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { detectDomain, parseChatBrief } from "../lib/conkay/chat/brief-parser.js";
import { chatAgentRoute } from "../lib/chat/agent-route.js";
import createConkayWorkbenchRouter from "../routes/conkay-workbench.js";

const claim = (claims, field) => claims.find((c) => c.field === field);

describe("bridge -> truss", () => {
  for (const t of ["design me a pedestrian bridge 30 m span 5 kN steel", "a footbridge over the creek", "build a bridge"]) {
    it(`"${t}" is a truss`, () => assert.equal(detectDomain(t), "truss"));
  }
  it("a beam bridge stays a beam; a named truss form wins", () => {
    assert.equal(detectDomain("size a steel beam bridge girder 12 m"), "beam");
    const p = parseChatBrief("design a Warren truss footbridge 30 m span 5 kN at each top joint");
    assert.equal(claim(p.claims, "type").value, "warren");
  });
  it("Pratt is a stated, cited default, not a silent fill", () => {
    const p = parseChatBrief("design me a pedestrian bridge 30 m span 5 kN steel");
    assert.equal(p.domain, "truss");
    assert.equal(claim(p.claims, "type").value, "pratt");
    assert.equal(claim(p.claims, "type").status, "default");
    assert.match(claim(p.claims, "type").source, /Pratt/);
    assert.equal(claim(p.claims, "span").value, 30);
    // still asks what it cannot know
    assert.deepEqual(p.questions.map((q) => q.field).sort(), ["height", "panels"]);
  });
});

describe("chat agent route", () => {
  it("bridge and car design requests go to the design tools", () => {
    assert.equal(chatAgentRoute("design me a pedestrian bridge 30 m span"), "design");
    assert.equal(chatAgentRoute("can you design a four-seat electric car"), "design");
    // A factual question is a tool lookup (web/textbook), not a design.
    assert.equal(chatAgentRoute("what is a bridge"), "lookup");
  });
});

describe("POST /api/conkay/workbench with a non-car brief", () => {
  let server, port;
  const evaluate = () => { throw new Error("the car evaluator must not run for a truss"); };
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: "u1" }; next(); });
    app.use("/api/conkay", createConkayWorkbenchRouter({ evaluatorFor: () => evaluate }));
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    port = server.address().port;
  });
  after(() => new Promise((r) => server.close(r)));
  const post = (body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path: "/api/conkay/workbench", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
      let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(s) }));
    });
    req.on("error", reject); req.write(data); req.end();
  });

  it("a full bridge brief is solved: Pratt geometry, bar forces, reactions", async () => {
    const r = await post({ prompt: "Design me a pedestrian bridge, 30 m span, 3 m tall, 6 panels, 5 kN at each top joint, A36 steel" });
    assert.equal(r.status, 200);
    assert.equal(r.body.stage, "solved");
    assert.equal(r.body.domain, "truss");
    assert.equal(claim(r.body.claims, "type").value, "pratt");
    const a = r.body.answer;
    assert.equal(a.geometry.joints.length, 12);
    assert.equal(a.forces.length, 21);
    // 5 kN at each of the 5 interior top joints (Pratt: top chord has 5 loaded joints) -> 12.5 kN per support
    const ry = a.reactions.reduce((s, x) => s + x.Ry, 0);
    assert.ok(Math.abs(ry - a.loads.reduce((s, l) => s - l.Fy, 0)) < 1e-6);
  });

  it("a short brief comes back as questions with its domain", async () => {
    const r = await post({ prompt: "design me a pedestrian bridge 30 m span 5 kN steel" });
    assert.equal(r.body.stage, "questions");
    assert.equal(r.body.domain, "truss");
    assert.ok(r.body.questions.length >= 1);
  });
});
