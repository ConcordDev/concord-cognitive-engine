// ARTIFACTS-DURABLE-READ regression test (FIX-ALL Q29, audit row A#1).
//
// Pins the read path for studio durable-job artifacts: server/durable.js's
// render/vocal/master pipelines INSERT into the migration-001 `artifacts`
// table (+ artifact_versions, content in the storage adapter), but the
// /api/artifacts router only ever read its own `route_artifacts` table —
// the studio rows had no read path at all (the durable.js TODO).
//
// Now: list merges both tables, get/info/download fall back to the durable
// row, download streams the latest version's storage content, and the
// router's visibility rules apply unchanged (public → anyone; private →
// owner or admin; anonymous on private → 401; non-owner → 404).
// Also pins GET /paginated as a list alias (the frontend's call used to
// fall into /:id with id="paginated").

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import express from "express";

import createArtifactsRouter from "../routes/artifacts.js";
import { createStorageAdapter } from "../storage/index.js";

const OWNER = "owner-1";
const OTHER = "other-2";

let tmpDir;
let db;
let server;
let baseUrl;
let durableId;
let durableBytes;
let publicDurableId;
let versionlessId;

function makeFakeRequireAuth() {
  return () => (req, res, next) => {
    if (req.user?.id) return next();
    return res.status(401).json({ ok: false, error: "auth_required" });
  };
}

function authMiddleware(req, res, next) {
  const h = req.headers["x-test-user"];
  if (h) {
    req.user = { id: h, role: h === "admin" ? "admin" : undefined };
  } else {
    req.user = null;
  }
  next();
}

async function call(method, p, { user, body } = {}) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary download */ }
  return { status: res.status, json, text };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifacts-durable-"));
  process.env.DATA_DIR = tmpDir;
  db = new Database(path.join(tmpDir, "test.db"));
  // Migration-001 durable tables (DDL copied from migrations/001_core_tables.js).
  db.exec(`
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      type TEXT NOT NULL DEFAULT 'file',
      title TEXT NOT NULL DEFAULT 'Untitled',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      visibility TEXT NOT NULL DEFAULT 'private',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      storage_uri TEXT NOT NULL,
      sha256 TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed durable rows the way durable.js's master pipeline does: content
  // through the storage adapter, then the two INSERTs.
  const storage = createStorageAdapter();
  durableBytes = Buffer.from("FAKE-MASTER-AUDIO-BYTES");
  durableId = "art_master_1";
  const put = await storage.put(`mastered/${durableId}/v1/master.wav`, durableBytes, "audio/wav");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'master', 'Mastered Audio', ?, 'private', ?, ?)")
    .run(durableId, OWNER, JSON.stringify({ format: "wav", projectId: "proj-1" }), now, now);
  db.prepare("INSERT INTO artifact_versions (id, artifact_id, version, storage_uri, sha256, size_bytes, mime_type, created_at) VALUES (?, ?, 1, ?, ?, ?, 'audio/wav', ?)")
    .run("artv_1", durableId, put.uri, put.sha256, put.size, now);

  publicDurableId = "art_render_public";
  db.prepare("INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'render', 'Shared Render', '{}', 'public', ?, ?)")
    .run(publicDurableId, OTHER, now, now);

  versionlessId = "art_analysis_nocontent";
  db.prepare("INSERT INTO artifacts (id, owner_user_id, type, title, metadata_json, visibility, created_at, updated_at) VALUES (?, ?, 'analysis', 'Vocal Analysis', '{}', 'private', ?, ?)")
    .run(versionlessId, OWNER, now, now);

  const router = createArtifactsRouter({ db, requireAuth: makeFakeRequireAuth(), STATE: {} });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(authMiddleware);
  app.use("/api/artifacts", router);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) db.close();
  delete process.env.DATA_DIR;
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("artifacts durable read path (Q29)", () => {
  it("owner can read their durable artifact's metadata", async () => {
    const r = await call("GET", `/api/artifacts/${durableId}`, { user: OWNER });
    assert.equal(r.status, 200);
    assert.equal(r.json.artifact.source, "durable");
    assert.equal(r.json.artifact.name, "Mastered Audio");
    assert.equal(r.json.artifact.type, "master");
    assert.equal(r.json.artifact.createdBy, OWNER);
    assert.deepEqual(r.json.artifact.metadata, { format: "wav", projectId: "proj-1" });
    assert.equal(r.json.artifact.version, 1);
    assert.equal(r.json.artifact.sizeBytes, durableBytes.length);
  });

  it("private durable artifact: non-owner gets 404, anonymous gets 401", async () => {
    const asOther = await call("GET", `/api/artifacts/${durableId}`, { user: OTHER });
    assert.equal(asOther.status, 404);
    const asAnon = await call("GET", `/api/artifacts/${durableId}`, {});
    assert.equal(asAnon.status, 401);
  });

  it("public durable artifact is readable by anyone", async () => {
    const r = await call("GET", `/api/artifacts/${publicDurableId}`, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.artifact.source, "durable");
  });

  it("info returns the durable artifact with a download URL", async () => {
    const r = await call("GET", `/api/artifacts/${durableId}/info`, { user: OWNER });
    assert.equal(r.status, 200);
    assert.equal(r.json.downloadUrl, `/api/artifacts/${durableId}/download`);
  });

  it("download streams the stored version bytes for the owner", async () => {
    const res = await fetch(`${baseUrl}/api/artifacts/${durableId}/download`, {
      headers: { "x-test-user": OWNER },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "audio/wav");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.ok(buf.equals(durableBytes), "downloaded bytes match the stored version");
    const asOther = await call("GET", `/api/artifacts/${durableId}/download`, { user: OTHER });
    assert.equal(asOther.status, 404);
  });

  it("a durable artifact with no version reads as metadata but downloads 404", async () => {
    const meta = await call("GET", `/api/artifacts/${versionlessId}`, { user: OWNER });
    assert.equal(meta.status, 200);
    assert.equal(meta.json.artifact.version, null);
    const dl = await call("GET", `/api/artifacts/${versionlessId}/download`, { user: OWNER });
    assert.equal(dl.status, 404);
  });

  it("list merges durable rows with route artifacts, scoped to the caller", async () => {
    const up = await call("POST", "/api/artifacts/upload", {
      user: OWNER,
      body: { name: "route-note.txt", mimeType: "text/plain", content: Buffer.from("hello").toString("base64") },
    });
    assert.equal(up.status, 200, JSON.stringify(up.json));

    const list = await call("GET", "/api/artifacts/", { user: OWNER });
    assert.equal(list.status, 200);
    const ids = list.json.artifacts.map((a) => a.artifactId);
    assert.ok(ids.includes(durableId), "own durable artifact listed");
    assert.ok(ids.includes(up.json.artifactId), "route artifact listed");
    assert.ok(ids.includes(publicDurableId), "public durable artifact listed");

    const otherList = await call("GET", "/api/artifacts/", { user: OTHER });
    const otherIds = otherList.json.artifacts.map((a) => a.artifactId);
    assert.ok(!otherIds.includes(durableId), "owner's private durable hidden from others");
    assert.ok(otherIds.includes(publicDurableId), "public durable visible to others");
  });

  it("GET /paginated is a working list alias, not an artifact-id lookup", async () => {
    const r = await call("GET", "/api/artifacts/paginated", { user: OWNER });
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.artifacts));
    assert.ok(r.json.artifacts.some((a) => a.artifactId === durableId));
  });

  it("admin can read and list private durable artifacts", async () => {
    const r = await call("GET", `/api/artifacts/${durableId}`, { user: "admin" });
    assert.equal(r.status, 200);
    const list = await call("GET", "/api/artifacts/", { user: "admin" });
    assert.ok(list.json.artifacts.some((a) => a.artifactId === durableId));
  });

  it("unknown ids still 404 in both tables", async () => {
    const r = await call("GET", "/api/artifacts/art_does_not_exist", { user: OWNER });
    assert.equal(r.status, 404);
  });
});
