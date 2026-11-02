// POST /api/studio/:projectId/render (routes/studio.js) used to insert the render and mark it
// status:"complete" at once, with no output: a success that produced nothing (live: 200 "complete").
// This router mounts BEFORE server/durable.js's handler for the same path, so it is the one that
// answers. No renderer is connected: the request is recorded and failed with audio_worker_unavailable,
// exactly like durable.js, with no output_path and no artifact. These tests drive the real router.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import createStudioRouter from "../routes/studio.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}
const j = async (url, opts) => { const r = await fetch(url, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const post = (url, body) => j(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });

describe("routes/studio.js render is honest when no renderer is connected", () => {
  let app, db, projectId;
  before(async () => {
    db = new Database(":memory:");
    const a = express();
    a.use(express.json());
    a.use((req, _res, next) => { req.user = { id: "alice", role: "member" }; next(); });
    a.use("/api/studio", createStudioRouter({ db, requireAuth: () => (_req, _res, next) => next() }));
    app = await listen(a);
    const created = await post(`${app.url}/api/studio/projects`, { name: "Song", type: "audio" });
    projectId = created.body.project?.projectId || created.body.projectId || created.body.project?.project_id;
    assert.ok(projectId, `project created: ${JSON.stringify(created.body)}`);
  });
  after(async () => { await app.close(); db.close(); });

  it("fails the render with audio_worker_unavailable instead of reporting complete", async () => {
    const { status, body } = await post(`${app.url}/api/studio/${projectId}/render`, { format: "wav", quality: "high" });
    assert.equal(status, 200);
    assert.equal(body.ok, false, "a render that produced nothing is not ok");
    assert.equal(body.status, "failed");
    assert.notEqual(body.status, "complete");
    assert.match(body.error, /^audio_worker_unavailable/);
    assert.ok(body.renderId);
    assert.equal(body.format, "wav");
    assert.equal(body.quality, "high");
  });

  it("the stored render row is failed with the reason and no output", async () => {
    const { body } = await post(`${app.url}/api/studio/${projectId}/render`, { format: "mp3" });
    const row = db.prepare("SELECT * FROM route_studio_renders WHERE render_id = ?").get(body.renderId);
    assert.equal(row.status, "failed");
    assert.match(row.error, /^audio_worker_unavailable/);
    assert.equal(row.output_path, null);
    assert.ok(row.completed_at, "it finished (as a failure), it is not left queued");
    const got = await j(`${app.url}/api/studio/renders/${body.renderId}`);
    assert.equal(got.body.render.status, "failed");
    const listed = await j(`${app.url}/api/studio/renders`);
    assert.ok(listed.body.renders.every((r) => r.status !== "complete"), "no render anywhere reads complete");
  });

  it("a missing project is still a plain 404 and writes no render", async () => {
    const before = db.prepare("SELECT COUNT(*) n FROM route_studio_renders").get().n;
    const { status, body } = await post(`${app.url}/api/studio/nope/render`, { format: "wav" });
    assert.equal(status, 404);
    assert.equal(body.error, "Project not found");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM route_studio_renders").get().n, before);
  });

  it("unknown format/quality still fall back to the defaults (validation unchanged)", async () => {
    const { body } = await post(`${app.url}/api/studio/${projectId}/render`, { format: "exe", quality: "ultra" });
    assert.equal(body.format, "mp4");
    assert.equal(body.quality, "medium");
  });
});
