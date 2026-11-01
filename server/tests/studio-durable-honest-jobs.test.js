// The durable studio job endpoints (render / vocal analyze / vocal
// process / master) used to "complete" jobs with fabricated output:
// zero-filled stub buffers stored as the render/master/processed audio,
// invented vocal-analysis numbers returned as measurements, and the
// requested target LUFS echoed back as the job's result. No audio
// worker is connected to this server, so the honest behavior is to
// record the job and fail it with `audio_worker_unavailable`, writing
// no artifacts. These tests pin that contract.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";
import { registerDurableEndpoints } from "../durable.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function post(url, payload) {
  return json(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
}

describe("durable studio jobs fail honestly when no audio worker is connected", () => {
  let app;
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, type TEXT, owner_user_id TEXT, status TEXT,
        input_json TEXT, output_json TEXT, error_json TEXT,
        created_at TEXT, started_at TEXT, finished_at TEXT
      );
      CREATE TABLE studio_projects (
        id TEXT PRIMARY KEY, owner_user_id TEXT, name TEXT,
        created_at TEXT, updated_at TEXT
      );
      CREATE TABLE studio_renders (
        id TEXT PRIMARY KEY, project_id TEXT, job_id TEXT, status TEXT,
        format TEXT, created_at TEXT
      );
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, owner_user_id TEXT, type TEXT, title TEXT,
        metadata_json TEXT, visibility TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE artifact_versions (
        id TEXT PRIMARY KEY, artifact_id TEXT, version INTEGER,
        storage_uri TEXT, sha256 TEXT, size_bytes INTEGER, mime_type TEXT,
        created_at TEXT
      );
      CREATE TABLE job_artifacts (job_id TEXT, artifact_id TEXT, role TEXT);
      CREATE TABLE events (
        id TEXT PRIMARY KEY, type TEXT, actor_user_id TEXT,
        payload_json TEXT, created_at TEXT, request_id TEXT
      );
    `);
    db.prepare(
      "INSERT INTO studio_projects (id, owner_user_id, name) VALUES (?, ?, ?)"
    ).run("proj-1", "alice", "Alice Song");

    const expressApp = express();
    expressApp.use(express.json());
    registerDurableEndpoints(expressApp, db);
    app = await listen(expressApp);
  });
  after(async () => {
    await app.close();
    db.close();
  });

  function jobRow(id) {
    return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  }
  function artifactCount() {
    return db.prepare("SELECT COUNT(*) AS n FROM artifacts").get().n;
  }

  it("render: job fails with audio_worker_unavailable, no artifact is written", async () => {
    const { status, body } = await post(`${app.url}/api/studio/proj-1/render`, { format: "wav" });
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.error, /^audio_worker_unavailable/);
    assert.ok(body.job_id);
    assert.ok(body.render_id);

    const job = jobRow(body.job_id);
    assert.equal(job.status, "failed");
    assert.equal(JSON.parse(job.error_json).message, body.error);
    assert.equal(job.output_json, null);

    const render = db.prepare("SELECT * FROM studio_renders WHERE id = ?").get(body.render_id);
    assert.equal(render.status, "failed");
    assert.equal(artifactCount(), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM job_artifacts").get().n, 0);

    const { body: jobBody } = await json(`${app.url}/api/jobs/${body.job_id}`);
    assert.equal(jobBody.job.status, "failed");
    assert.match(jobBody.job.error.message, /^audio_worker_unavailable/);
  });

  it("render: a missing project is still a plain 404", async () => {
    const { status, body } = await post(`${app.url}/api/studio/nope/render`, { format: "wav" });
    assert.equal(status, 404);
    assert.equal(body.error, "Project not found");
  });

  it("vocal analyze: refuses instead of returning invented measurements", async () => {
    const { status, body } = await post(`${app.url}/api/studio/vocal/analyze`, {
      project_id: "proj-1", track_id: "trk-1", owner_user_id: "alice",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.error, /^audio_worker_unavailable/);
    assert.equal("analysis" in body, false);
    assert.equal(jobRow(body.job_id).status, "failed");
    assert.equal(artifactCount(), 0);
  });

  it("vocal process: refuses instead of storing a stub buffer as processed audio", async () => {
    const { status, body } = await post(`${app.url}/api/studio/vocal/process`, {
      project_id: "proj-1", track_id: "trk-1", corrections: [], owner_user_id: "alice",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.error, /^audio_worker_unavailable/);
    assert.equal(jobRow(body.job_id).status, "failed");
    assert.equal(artifactCount(), 0);
  });

  it("master: refuses instead of echoing the requested LUFS as a measured result", async () => {
    const { status, body } = await post(`${app.url}/api/studio/master/job`, {
      project_id: "proj-1", preset: "balanced", target_lufs: -9, format: "wav", owner_user_id: "alice",
    });
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.match(body.error, /^audio_worker_unavailable/);
    const job = jobRow(body.job_id);
    assert.equal(job.status, "failed");
    assert.equal(job.output_json, null);
    assert.equal(artifactCount(), 0);
  });
});
