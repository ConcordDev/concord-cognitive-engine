// Honesty contract for studio.bounce + studio.export-stems.
//
// These two macros used to FAKE the expensive last mile: they set
// status:"completed" and returned a string-built /renders/*.wav URL while no
// audio was ever encoded (the file 404'd). The fix: a render is "completed"
// ONLY when the client-rendered audio is persisted to route_artifacts (real
// bytes, downloadable); with no audioDataUrl it honestly reports status:"pending"
// with NO download URL — never a fabricated success. This test pins BOTH the
// real-artifact path AND the honest-not-produced path.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import registerStudioActions from "../domains/studio.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  assert.ok(fn, `studio.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

const tinyAudio = Buffer.alloc(100, 0x7f).toString("base64");
const TINY_WAV_DATA_URL = `data:audio/wav;base64,${tinyAudio}`;

let tmpDataDir;
let db;

before(() => {
  registerStudioActions(register);
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "concord-studio-bounce-"));
  process.env.DATA_DIR = tmpDataDir;
});

after(() => {
  try { fs.rmSync(tmpDataDir, { recursive: true, force: true }); } catch { /* idempotent */ }
  delete process.env.DATA_DIR;
});

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  db = new Database(":memory:");
  // The real DB always has route_artifacts (the macro also self-ensures it);
  // pre-create so the "0 rows persisted" assertion on the not-produced path
  // queries an existing (empty) table rather than throwing "no such table".
  db.exec(`
    CREATE TABLE IF NOT EXISTS route_artifacts (
      artifact_id TEXT PRIMARY KEY, dtu_id TEXT, name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      storage_mode TEXT NOT NULL DEFAULT 'inline',
      content_b64 TEXT, storage_path TEXT, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      description TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]'
    );
  `);
});

const ctxAlice = () => ({ actor: { userId: "user_alice" }, userId: "user_alice", db });

async function makeProjectWithTracks(trackCount = 2) {
  const pr = await call("project-create", ctxAlice(), { name: "Test Song", bpm: 120 });
  assert.equal(pr.ok, true);
  const projectId = pr.result.project.id;
  const trackIds = [];
  for (let i = 0; i < trackCount; i++) {
    const tr = await call("track-add", ctxAlice(), { projectId, name: `Track ${i + 1}`, kind: "audio" });
    assert.equal(tr.ok, true);
    trackIds.push(tr.result.track.id);
  }
  return { projectId, trackIds };
}

describe("studio.bounce — honest artifact production", () => {
  it("HONEST not-produced: no audioDataUrl → ok:false, status pending, NO downloadUrl, NO artifact row", async () => {
    const { projectId } = await makeProjectWithTracks(1);
    const r = await call("bounce", ctxAlice(), { projectId, format: "wav_24", sampleRate: 48000 });
    assert.equal(r.ok, false, "must NOT report success when nothing was produced");
    assert.equal(r.result.render.status, "pending");
    assert.equal(r.result.render.reason, "needs_client_render");
    assert.equal(r.result.render.downloadUrl, undefined, "no fabricated download URL");
    assert.equal(r.result.render.outputUrl, undefined, "the fake /renders/*.wav URL is gone");
    const rows = db.prepare("SELECT COUNT(*) AS n FROM route_artifacts").get().n;
    assert.equal(rows, 0, "no artifact persisted for a pending render");
  });

  it("REAL: with a client audioDataUrl → ok:true, status completed, route_artifacts row with real bytes, working downloadUrl", async () => {
    const { projectId } = await makeProjectWithTracks(1);
    const r = await call("bounce", ctxAlice(), { projectId, format: "wav_24", sampleRate: 48000, audioDataUrl: TINY_WAV_DATA_URL });
    assert.equal(r.ok, true);
    assert.equal(r.result.render.status, "completed");
    assert.ok(r.result.render.artifactId);
    assert.equal(r.result.render.downloadUrl, `/api/artifacts/${r.result.render.artifactId}/download`);
    assert.equal(r.result.render.sizeBytes, 100);

    const art = db.prepare("SELECT * FROM route_artifacts WHERE artifact_id = ?").get(r.result.render.artifactId);
    assert.ok(art, "artifact row must exist");
    assert.equal(art.size_bytes, 100, "real decoded bytes persisted");
    assert.equal(art.mime_type, "audio/wav");
    assert.equal(art.storage_mode, "inline");
    assert.equal(Buffer.from(art.content_b64, "base64").length, 100, "downloadable bytes match");
  });

  it("rejects a malformed audioDataUrl (not a base64 audio data URL) — no silent fake", async () => {
    const { projectId } = await makeProjectWithTracks(1);
    const r = await call("bounce", ctxAlice(), { projectId, audioDataUrl: "https://example/x.wav" });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64 audio data/i);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM route_artifacts").get().n, 0);
  });
});

describe("studio.export-stems — honest per-stem production", () => {
  it("HONEST not-produced: no stems supplied → ok:false, job pending, every stem pending, NO artifact rows", async () => {
    const { projectId } = await makeProjectWithTracks(2);
    const r = await call("export-stems", ctxAlice(), { projectId, format: "wav_24" });
    assert.equal(r.ok, false);
    assert.equal(r.result.job.status, "pending");
    assert.equal(r.result.job.producedCount, 0);
    for (const stem of r.result.job.stems) {
      assert.equal(stem.status, "pending");
      assert.equal(stem.outputUrl, undefined, "no fabricated stem URL");
      assert.equal(stem.downloadUrl, undefined);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM route_artifacts").get().n, 0);
  });

  it("REAL: every track rendered client-side → ok:true, job completed, one artifact per stem with downloadUrl", async () => {
    const { projectId, trackIds } = await makeProjectWithTracks(2);
    const stemsIn = trackIds.map((trackId) => ({ trackId, audioDataUrl: TINY_WAV_DATA_URL }));
    const r = await call("export-stems", ctxAlice(), { projectId, format: "wav_24", stems: stemsIn });
    assert.equal(r.ok, true);
    assert.equal(r.result.job.status, "completed");
    assert.equal(r.result.job.producedCount, 2);
    for (const stem of r.result.job.stems) {
      assert.equal(stem.status, "completed");
      assert.ok(stem.artifactId);
      assert.equal(stem.downloadUrl, `/api/artifacts/${stem.artifactId}/download`);
      const art = db.prepare("SELECT * FROM route_artifacts WHERE artifact_id = ?").get(stem.artifactId);
      assert.ok(art, "each stem persists a real artifact");
      assert.equal(art.size_bytes, 100);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM route_artifacts").get().n, 2);
  });

  it("PARTIAL: only some tracks supplied → ok:false, job pending, missing track stays pending (honest), supplied one is real", async () => {
    const { projectId, trackIds } = await makeProjectWithTracks(2);
    const r = await call("export-stems", ctxAlice(), { projectId, stems: [{ trackId: trackIds[0], audioDataUrl: TINY_WAV_DATA_URL }] });
    assert.equal(r.ok, false, "job not complete until EVERY track produced a real artifact");
    assert.equal(r.result.job.status, "pending");
    assert.equal(r.result.job.producedCount, 1);
    const byTrack = Object.fromEntries(r.result.job.stems.map((s) => [s.trackId, s]));
    assert.equal(byTrack[trackIds[0]].status, "completed");
    assert.ok(byTrack[trackIds[0]].downloadUrl);
    assert.equal(byTrack[trackIds[1]].status, "pending");
    assert.equal(byTrack[trackIds[1]].downloadUrl, undefined);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM route_artifacts").get().n, 1);
  });
});
