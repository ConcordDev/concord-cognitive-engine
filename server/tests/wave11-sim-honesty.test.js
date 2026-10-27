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

  it("digest refuses instead of minting citations and royalties", async () => {
    const { status, body } = await get("/api/world/sim/digest/user-wave11");
    assert.equal(status, 501);
    assert.equal(body.ok, false);
    assert.equal(body.reason, "no_recorded_digest");
    assert.equal(body.digest, undefined);
    assert.equal(JSON.stringify(body).includes("USB-A"), false);
  });

  it("personal, world, and global analytics refuse invented counters", async () => {
    const personal = await get("/api/world/sim/analytics/personal/user-wave11");
    assert.equal(personal.status, 501);
    assert.equal(personal.body.reason, "no_recorded_stats");
    assert.equal(personal.body.stats, undefined);

    const world = await get("/api/world/sim/analytics/world/anywhere");
    assert.equal(world.status, 501);
    assert.equal(world.body.reason, "no_world_telemetry");

    const global = await get("/api/world/sim/analytics/global");
    assert.equal(global.status, 501);
    assert.equal(global.body.reason, "no_global_telemetry");
    assert.equal(JSON.stringify(global.body).includes("45000"), false);
  });

  it("project board does not seed paid tasks", async () => {
    const board = await get("/api/world/sim/projects/board-1");
    assert.equal(board.status, 501);
    assert.equal(board.body.reason, "no_project_board");
    const created = await post("/api/world/sim/projects/board-1/tasks", { title: "Pave the road", payment: 50 });
    assert.equal(created.status, 501);
    assert.equal(created.body.task, undefined);
    const claimed = await post("/api/world/sim/projects/board-1/tasks/task-1/claim", {});
    assert.equal(claimed.status, 501);
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

  it("export does not report a completed file size", async () => {
    const missing = await post("/api/world/sim/export", {});
    assert.equal(missing.status, 400);
    const { status, body } = await post("/api/world/sim/export", { dtuId: "dtu-1", format: "json" });
    assert.equal(status, 501);
    assert.equal(body.reason, "export_not_wired");
    assert.equal(body.export, undefined);
    assert.equal(Object.hasOwn(body, "size"), false);
    assert.equal(Object.hasOwn(body, "url"), false);
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

  it("refuses a real catalog standard instead of scoring it at random", async () => {
    const list = await fetch(`${app.url}/api/standards`);
    const listed = await list.json();
    assert.ok(listed.standards.length > 0);
    const standardId = listed.standards[0].id;
    const res = await fetch(`${app.url}/api/standards/check`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetId: "bldg-1", standardId, data: { floors: 2 } }),
    });
    assert.equal(res.status, 501);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.reason, "compliance_not_measured");
    assert.equal(body.standardId, standardId);
    assert.equal(body.compliance, undefined);
    assert.equal(body.overallScore, undefined);
  });
});
