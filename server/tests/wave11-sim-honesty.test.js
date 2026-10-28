// Invented sim metrics and a random compliance score.
// The digest, personal/world/global analytics, project board, and export
// routes returned ok:true with numbers that were never measured.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createWorldRoutes from "../routes/world.js";
import createFrontierRoutesPart4 from "../routes/frontier-part4.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe("world sim routes do not invent metrics", () => {
  let app;

  before(async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use((req, _res, next) => {
      req.user = { id: "user-wave11" };
      next();
    });
    expressApp.use("/api/world", createWorldRoutes({
      requireAuth: (_req, _res, next) => next(),
    }));
    app = await listen(expressApp);
  });

  after(async () => { await app.close(); });

  async function get(path) {
    const res = await fetch(`${app.url}${path}`);
    return { status: res.status, body: await res.json() };
  }

  async function post(path, body) {
    const res = await fetch(`${app.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, body: await res.json() };
  }

  // Digest and analytics read stored counts since #1586 (tests/wave15-sim-stats.test.js).

  it("project board aliases cobuild: an unknown board is 404, nothing is seeded", async () => {
    const board = await get("/api/world/sim/projects/board-1");
    assert.equal(board.status, 404);
    assert.equal(board.body.ok, false);
    assert.equal(board.body.tasks, undefined);
    const created = await post("/api/world/sim/projects/board-1/tasks", { title: "Pave the road", payment: 50 });
    assert.equal(created.status, 404);
    assert.equal(created.body.task, undefined);
    const claimed = await post("/api/world/sim/projects/board-1/tasks/task-1/claim", {});
    assert.equal(claimed.status, 404);
  });

  it("voice match is a keyword, not a random confidence, and does not claim execution", async () => {
    const { status, body } = await post("/api/world/sim/voice/command", { transcript: "please navigate home" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.intent, "navigate");
    assert.equal(body.result.match, "keyword");
    assert.equal(body.result.confidence, null);
    assert.equal(body.result.executed, false);
  });

  it("export validates input and reports 501 when no DTU store is wired", async () => {
    const missing = await post("/api/world/sim/export", {});
    assert.equal(missing.status, 400);
    const bad = await post("/api/world/sim/export", { dtuId: "dtu-1", format: "docx" });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.supportedFormats.includes("json"));
    const saved = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    try {
      const { status, body } = await post("/api/world/sim/export", { dtuId: "dtu-1", format: "json" });
      assert.equal(status, 501);
      assert.equal(body.reason, "not_wired");
      assert.ok(body.missing);
      assert.equal(Object.hasOwn(body, "content"), false);
    } finally { globalThis._concordSTATE = saved; }
  });
});

describe("POST /api/standards/check does not invent a compliance score", () => {
  let app;

  before(async () => {
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use("/api", createFrontierRoutesPart4({}));
    app = await listen(expressApp);
  });

  after(async () => { await app.close(); });

  it("names a missing standard before refusing", async () => {
    const res = await fetch(`${app.url}/api/standards/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: "bldg-1" }),
    });
    assert.equal(res.status, 400);
  });

  it("refuses a catalog standard with no coded rules instead of scoring it", async () => {
    const list = await fetch(`${app.url}/api/standards`);
    const listed = await list.json();
    const std = listed.standards.find((x) => x.code === "ISO 9001");
    const standardId = std.id;
    const res = await fetch(`${app.url}/api/standards/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: "bldg-1", standardId, data: { floors: 2 } }),
    });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "compliance_not_measured");
    assert.ok(body.missing);
    assert.equal(body.standardId, standardId);
    assert.equal(body.compliance, undefined);
    assert.equal(body.overallScore, undefined);
  });
});
